import { readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { parse, type HTMLElement } from 'node-html-parser';

/** decodeURIComponent that never throws (a malformed %-sequence must not abort a whole page). */
function safeDecode(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }

/** Reduce an attachment ref to a safe basename — no separators, no '..' — so a crafted export can't write outside the attachments dir (zip-slip). */
function safeBasename(p: string): string {
  const base = (p.split(/[\\/]/).pop() || 'image').replace(/^\.+/, '');
  return base.replace(/[^A-Za-z0-9._-]/g, '_') || 'image';
}

/** True only if `target` resolves to a path inside `dir`. */
function isInside(dir: string, target: string): boolean {
  const rel = relative(resolve(dir), resolve(target));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Ingest a Confluence "Export space → HTML" bundle (unzipped) into the standard
 * Letwrites export tree (manifest.json + per-page .md + <slug>.attachments/).
 *
 * Why this path exists: Confluence Cloud OAuth-gates attachment BYTES, so the
 * API exporter cannot auto-pull images. The space-export ZIP, however, bundles
 * EVERY attachment as a local file — so images survive. This module turns that
 * ZIP (the customer makes it with one click in Confluence) into something the
 * existing importer loads, images and all. The importer then uploads each local
 * image and the integrity report proves none were dropped.
 *
 * ⚠️ Confluence's HTML export layout varies slightly by version. This implements
 * the common modern layout (per-page <id>.html + attachments/<id>/...). Verify the
 * image counts in the integrity report against a real export from your tenant.
 */

export interface IngestResult {
  outDir: string;
  pages: number;
  attachmentsCopied: number;
  imagesReferenced: number;
  /** Source-side counts (independent of conversion) — the integrity baseline. */
  sourcePages: number;
  sourceImages: number;
}

/** A local (non-icon, non-external, non-data) <img> ref — what counts as a real attachment. */
export function isLocalImageSrc(src: string): boolean {
  return !!src && !/^https?:\/\//i.test(src) && !src.startsWith('data:') && !src.includes('/images/icons/');
}

const slug = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page';

/** Pull the page title: <title>Space : Title</title> (strip the "Space : " prefix), else first <h1>. */
function pageTitle(root: HTMLElement): string {
  const t = root.querySelector('title')?.text?.trim();
  if (t) return t.includes(' : ') ? t.slice(t.lastIndexOf(' : ') + 3).trim() : t;
  return root.querySelector('h1')?.text?.trim() || 'Untitled';
}

/** The content body Confluence wraps in #main-content (fallback: <body>). */
function contentRoot(root: HTMLElement): HTMLElement {
  return (root.querySelector('#main-content') || root.querySelector('.wiki-content') ||
    root.querySelector('body') || root) as HTMLElement;
}

/** Compact rendered-HTML → Markdown. Covers the tags Confluence pages actually use. */
export function htmlToMarkdown(el: HTMLElement, onImage: (src: string) => string): string {
  const walk = (node: any, depth = 0): string => {
    if (node.nodeType === 3) return node.rawText ? decodeEntities(node.rawText) : ''; // text node
    const tag = (node.rawTagName || '').toLowerCase();
    const kids = () => node.childNodes.map((c: any) => walk(c, depth)).join('');
    switch (tag) {
      case 'h1': return `\n# ${kids().trim()}\n\n`;
      case 'h2': return `\n## ${kids().trim()}\n\n`;
      case 'h3': return `\n### ${kids().trim()}\n\n`;
      case 'h4': case 'h5': case 'h6': return `\n#### ${kids().trim()}\n\n`;
      case 'p': case 'div': return `${kids().trim()}\n\n`;
      case 'br': return `\n`;
      case 'strong': case 'b': return `**${kids().trim()}**`;
      case 'em': case 'i': return `*${kids().trim()}*`;
      case 'code': return node.closest && node.closest('pre') ? kids() : `\`${kids().trim()}\``;
      case 'pre': return `\n\`\`\`\n${node.text.replace(/\n+$/,'')}\n\`\`\`\n\n`;
      case 'a': { const href = node.getAttribute('href') || ''; const txt = kids().trim() || href;
        return href ? `[${txt}](${href})` : txt; }
      case 'ul': return '\n' + node.childNodes.filter((c:any)=>(c.rawTagName||'').toLowerCase()==='li')
        .map((li:any)=>`- ${walk(li,depth).trim()}`).join('\n') + '\n\n';
      case 'ol': return '\n' + node.childNodes.filter((c:any)=>(c.rawTagName||'').toLowerCase()==='li')
        .map((li:any,i:number)=>`${i+1}. ${walk(li,depth).trim()}`).join('\n') + '\n\n';
      case 'li': return kids();
      case 'img': { const src = node.getAttribute('src') || ''; const alt = node.getAttribute('alt') || '';
        return src ? `![${alt}](${onImage(src)})` : ''; }
      case 'table': return '\n' + renderTable(node) + '\n';
      case 'script': case 'style': return '';
      default: return kids();
    }
  };
  return walk(el).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function renderTable(table: any): string {
  const rows = table.querySelectorAll('tr');
  if (!rows.length) return '';
  const cellTexts = (tr: any) => tr.querySelectorAll('th,td').map((c: any) => c.text.trim().replace(/\|/g, '\\|') || ' ');
  const out: string[] = [];
  rows.forEach((tr: any, i: number) => {
    const cells = cellTexts(tr);
    out.push('| ' + cells.join(' | ') + ' |');
    if (i === 0) out.push('| ' + cells.map(() => '---').join(' | ') + ' |');
  });
  return out.join('\n');
}

function decodeEntities(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

export function ingestConfluenceHtmlExport(inDir: string, outDir: string): IngestResult {
  const files = readdirSync(inDir).filter((f) => f.endsWith('.html') && f.toLowerCase() !== 'index.html');
  mkdirSync(outDir, { recursive: true });

  const pages: { id: string; title: string; path: string; parentId: string | null; version: number }[] = [];
  let attachmentsCopied = 0;
  let imagesReferenced = 0;
  let sourceImages = 0;

  for (const file of files) {
    const id = file.replace(/\.html$/i, '');
    const root = parse(readFileSync(join(inDir, file), 'utf8'));
    const title = pageTitle(root);
    const s = slug(title);
    const attachDir = `${s}.attachments`;

    // Source-side count: how many local images this page references, before any conversion.
    // This is the integrity baseline — if conversion later drops one, the gap stays visible.
    sourceImages += contentRoot(root).querySelectorAll('img')
      .filter((n: any) => isLocalImageSrc(n.getAttribute('src') || '')).length;

    const md = htmlToMarkdown(contentRoot(root), (src) => {
      // Only local attachment refs (skip absolute URLs and Confluence UI icons).
      if (!isLocalImageSrc(src)) return src;
      imagesReferenced++;
      const decoded = safeDecode(src);
      const fileName = safeBasename(decoded);            // basename only — never escape attachDir
      const abs = join(inDir, decoded);
      if (isInside(inDir, abs) && existsSync(abs)) {     // source must stay inside the export dir
        mkdirSync(join(outDir, attachDir), { recursive: true });
        copyFileSync(abs, join(outDir, attachDir, fileName));
        attachmentsCopied++;
      }
      return `${attachDir}/${fileName}`; // importer uploads this local file + rewrites to a BookStack URL
    });

    const path = `${s}.md`;
    writeFileSync(join(outDir, path), md);
    pages.push({ id, title, path, parentId: null, version: 1 });
  }

  // Best-effort hierarchy from index.html nested <ul><li><a href="<id>.html">.
  applyHierarchyFromIndex(inDir, pages);

  writeFileSync(join(outDir, 'manifest.json'),
    JSON.stringify({ source: 'confluence-html-export', pageCount: pages.length, pages }, null, 2));

  return { outDir, pages: pages.length, attachmentsCopied, imagesReferenced, sourcePages: pages.length, sourceImages };
}

/** Parse index.html's nested list to recover parent/child links (best-effort). */
function applyHierarchyFromIndex(inDir: string, pages: { id: string; parentId: string | null }[]): void {
  const idx = join(inDir, 'index.html');
  if (!existsSync(idx)) return;
  const byId = new Map(pages.map((p) => [p.id, p]));
  const root = parse(readFileSync(idx, 'utf8'));
  const hrefId = (a: any) => (a.getAttribute('href') || '').replace(/\.html$/i, '').split('/').pop();
  const visit = (ul: any, parentId: string | null) => {
    ul.childNodes.filter((c: any) => (c.rawTagName || '').toLowerCase() === 'li').forEach((li: any) => {
      const a = li.querySelector('a');
      const id = a ? hrefId(a) : null;
      if (id && byId.has(id) && parentId !== id) byId.get(id)!.parentId = parentId;
      const childUl = li.querySelector('ul');
      if (childUl && id) visit(childUl, id);
    });
  };
  const top = root.querySelector('ul');
  if (top) visit(top, null);
}
