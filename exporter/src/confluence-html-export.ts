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

/**
 * The immediate parent page id from a Confluence page's breadcrumb trail — the reliable hierarchy
 * signal in HTML exports (the index.html nested list varies a lot by version). The breadcrumb lists
 * the ancestors as links to their exported files; the LAST one that isn't the space home (index.html)
 * is the parent. Returns null for top-level pages.
 */
function parentFromBreadcrumbs(root: HTMLElement, selfId: string): string | null {
  const links = root.querySelectorAll('#breadcrumbs a, #breadcrumb-section a, .breadcrumbs a, ol#breadcrumbs a');
  let parent: string | null = null;
  for (const a of links) {
    const href = ((a as HTMLElement).getAttribute('href') || '').trim();
    if (!href || /(^|\/)index\.html(\?|#|$)/i.test(href)) continue; // skip the space home
    const cid = safeDecode(href.replace(/[?#].*$/, '')).replace(/\.html$/i, '').split(/[\\/]/).pop() || '';
    if (cid && cid !== selfId) parent = cid; // last non-self crumb = immediate parent
  }
  return parent;
}

/**
 * Confluence renders emoji as a 72px <img class="emoticon" data-emoji-id="1f4d8" src="…/emoticons/…">.
 * Left as an image it imports as a giant external picture. Convert it to the actual inline Unicode
 * character (from the codepoint in data-emoji-id), so it reads like a normal emoji. Returns null when
 * the <img> is NOT an emoji (a real picture).
 */
function emojiText(node: any): string | null {
  const cls = node.getAttribute('class') || '';
  const id = (node.getAttribute('data-emoji-id') || '').trim();
  const src = node.getAttribute('src') || '';
  const isEmoji = !!id || /\bemoticon\b/.test(cls) || /\/emoticons?\//.test(src);
  if (!isEmoji) return null;
  if (/^[0-9a-fA-F]+(-[0-9a-fA-F]+)*$/.test(id)) { // codepoint(s), e.g. "1f4d8" or "1f1ef-1f1f5"
    try {
      const ch = id.split('-').map((h: string) => String.fromCodePoint(parseInt(h, 16))).join('');
      if (ch) return ch;
    } catch { /* fall through to other signals */ }
  }
  const fb = node.getAttribute('data-emoji-fallback') || '';
  if (fb && !fb.includes('\\u')) return fb;                  // an actual char, not a "\uXXXX" escape
  const short = node.getAttribute('data-emoji-shortname') || '';
  return short || '';                                        // ":blue_book:" beats a broken 72px image; '' drops it
}

/** Compact rendered-HTML → Markdown. Covers the tags Confluence pages actually use.
 *  onImage: map an <img> src to a local ref (copies the file). onFile (optional): map a linked
 *  attachment file href to a marker the importer uploads. */
export function htmlToMarkdown(el: HTMLElement, onImage: (src: string) => string, onFile?: (href: string) => string): string {
  const walk = (node: any, depth = 0): string => {
    // Text node: collapse whitespace runs to a single space, like HTML rendering does. Confluence
    // exports are pretty-printed, so inter-tag newlines+indentation would otherwise leak in as leading
    // spaces — and 4+ leading spaces make Markdown render the line as a CODE BLOCK (e.g. the
    // "Related articles" links). <pre> content bypasses this (the pre case uses node.text directly).
    if (node.nodeType === 3) return node.rawText ? decodeEntities(node.rawText).replace(/\s+/g, ' ') : '';
    const tag = (node.rawTagName || '').toLowerCase();
    // Drop two bits of Confluence chrome:
    //  • toc-macro / toc-indentation — the Table-of-Contents macro: a list of #anchor links to in-page
    //    headings. BookStack assigns its OWN heading ids so these never resolve, and it already shows a
    //    "Page Navigation" sidebar from the headings.
    //  • content-type-* — the little "Page:" / "Blog:" type label before each link in the "Related
    //    articles" (content-by-label) macro. Noise; drop it so the list is just clean links.
    const cls = node.getAttribute ? (node.getAttribute('class') || '') : '';
    if (/\btoc-macro\b|\btoc-indentation\b|\bcontent-type-/.test(cls)) return '';
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
      case 'a': {
        const href = node.getAttribute('href') || ''; const inner = kids().trim();
        // Bracket-safe label: literal [ ] in link text (a page title like "[WIP] …", or a Confluence
        // thumbnail image used as the label) breaks BOTH Markdown link syntax AND the importer's
        // [txt](marker) rewrite — leaving raw "lwpage:/lwfile:" junk on the page. Swap [ ]→( ) for a
        // PLAIN-text label; leave a label that is itself Markdown (a nested image/link) untouched.
        const safe = (t: string) => /!\[|\]\(/.test(t) ? t : t.replace(/\[/g, '(').replace(/\]/g, ')');
        const txt = safe(inner) || href;
        // Confluence marks an internal PAGE link explicitly (data-linked-resource-type/-id) — e.g. the
        // "Related articles" macro. Use that page id directly; it's the most reliable signal.
        const lrId = node.getAttribute('data-linked-resource-id') || '';
        if (node.getAttribute('data-linked-resource-type') === 'page' && /^\d+$/.test(lrId)) return `[${txt}](lwpage:${lrId})`;
        if (!href) return inner;
        // Inter-PAGE links break on migration. Emit a "lwpage:<id>" marker the importer rewrites to the
        // new BookStack page URL once every page exists. Forms: relative "<Title>_<id>.html" (id =
        // basename), and any Confluence URL with "/pages/<num>" (absolute atlassian.net OR a relative
        // "/wiki/spaces/…/pages/<num>/…") or "?pageId=<num>" (id = numeric). All resolved.
        const rel = /^([^/?#:]+)\.html(?:[?#].*)?$/i.exec(href);
        if (rel && rel[1].toLowerCase() !== 'index') return `[${txt}](lwpage:${rel[1]})`;
        const abs = /\/pages\/(\d+)|[?&]pageId=(\d+)/i.exec(href);
        if (abs) { const id = abs[1] || abs[2]; if (id) return `[${txt}](lwpage:${id})`; }
        // Local attachment link (not external/anchor/mailto) with a file extension.
        const clean = href.split(/[?#]/)[0];
        if (!/^[a-z][a-z0-9+.-]*:|^\/\/|^#/i.test(href) && /\.[a-z0-9]{1,8}$/i.test(clean)) {
          // Confluence wraps embedded images in a link to the full-size file. Drop that redundant link
          // (the inner <img> is already uploaded); keep the image.
          if (/\.(png|jpe?g|gif|webp|svg|bmp|tiff?)$/i.test(clean)) return inner || txt;
          // A real download (pdf, mp4, …): the importer uploads it as a BookStack attachment. If the
          // visible label is just a Confluence thumbnail image (external URL that won't migrate, and
          // whose brackets break the rewrite), label the download with its filename instead.
          if (onFile) {
            let fname = 'download'; try { fname = decodeURIComponent(clean.split('/').pop() || 'download'); } catch { /* keep default */ }
            const label = (!inner || /!\[/.test(inner)) ? fname : txt;
            return `[${label}](${onFile(href)})`;
          }
        }
        // External / anchor / mailto. An empty-text link to an external image/icon (e.g. Confluence's
        // grey_arrow_down.png sort arrow) is macro chrome — drop it, not a useless empty [](…) link.
        if (!inner && /\.(png|jpe?g|gif|svg|webp)$/i.test(clean)) return '';
        return `[${txt}](${href})`;
      }
      case 'ul': return '\n' + node.childNodes.filter((c:any)=>(c.rawTagName||'').toLowerCase()==='li')
        .map((li:any)=>`- ${walk(li,depth).trim()}`).join('\n') + '\n\n';
      case 'ol': return '\n' + node.childNodes.filter((c:any)=>(c.rawTagName||'').toLowerCase()==='li')
        .map((li:any,i:number)=>`${i+1}. ${walk(li,depth).trim()}`).join('\n') + '\n\n';
      case 'li': return kids();
      case 'img': {
        const emoji = emojiText(node);
        if (emoji !== null) return emoji; // Confluence emoji/emoticon → inline Unicode char, not a 72px image
        const src = node.getAttribute('src') || ''; const alt = node.getAttribute('alt') || '';
        if (!src) return '';
        // Confluence UI chrome (sort arrows, expand carets, status icons) lives under /images/icons/ —
        // it's not content and would migrate as a broken external image. Drop it (emoji handled above).
        if (/\/images\/icons\//i.test(src)) return '';
        const ref = onImage(src);
        // Preserve Confluence's DISPLAY width so images don't render at full natural size (kills
        // readability — a 408px screenshot otherwise fills the whole column). Markdown has no width
        // syntax, so emit inline HTML <img width> (BookStack keeps it through the markdown import).
        // Source of the width: the width="N" attribute, else the ?width=N the export bakes into src.
        const wAttr = (node.getAttribute('width') || '').trim();
        const width = /^\d+(px)?$/.test(wAttr) ? wAttr.replace('px', '') : (/[?&]width=(\d+)/.exec(src)?.[1] || '');
        // Use inline STYLE, not the width attribute: BookStack ignores a bare width="N" on display
        // (the image renders full-column) but honors style="width:Npx" — that's how its own image
        // resize stores sizes. height:auto keeps the aspect ratio; max-width:100% via theme CSS caps it.
        // display:block so following text goes BELOW the image, not beside it (an inline img lets text
        // wrap next to it — bad for reading). Honor Confluence's image-center / image-right alignment.
        if (width) {
          const cls = node.getAttribute('class') || '';
          const align = /image-center/.test(cls) ? 'margin:0 auto;' : /image-right/.test(cls) ? 'margin-left:auto;' : '';
          return `<img src="${ref}" alt="${alt.replace(/"/g, '&quot;')}" style="display:block;${align}width:${width}px;height:auto">`;
        }
        return `![${alt}](${ref})`;
      }
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
  const usedSlugs = new Set<string>(); // de-dupe: two pages with the same title-slug must not overwrite each other

  for (const file of files) {
    const id = file.replace(/\.html$/i, '');
    const root = parse(readFileSync(join(inDir, file), 'utf8'));
    const title = pageTitle(root);
    let s = slug(title);
    if (usedSlugs.has(s)) { let n = 2; while (usedSlugs.has(`${s}-${n}`)) n++; s = `${s}-${n}`; } // unique .md + attachments dir
    usedSlugs.add(s);
    const attachDir = `${s}.attachments`;

    // Source-side count: how many local images this page references, before any conversion.
    // This is the integrity baseline — if conversion later drops one, the gap stays visible.
    sourceImages += contentRoot(root).querySelectorAll('img')
      .filter((n: any) => isLocalImageSrc(n.getAttribute('src') || '')).length;

    // Copy a referenced attachment into the page's attachments dir, return its local ref. Strips any
    // ?query/#fragment first (Confluence adds ?width=NNN; keeping it would bake "_width_306" into the
    // filename AND miss the real file on disk). basename-only — never escape attachDir (zip-slip).
    const attachRef = (rawHref: string): string => {
      const decoded = safeDecode(rawHref).split(/[?#]/)[0];
      const fileName = safeBasename(decoded);
      const abs = join(inDir, decoded);
      if (isInside(inDir, abs) && existsSync(abs)) {
        mkdirSync(join(outDir, attachDir), { recursive: true });
        copyFileSync(abs, join(outDir, attachDir, fileName));
        attachmentsCopied++;
      }
      return `${attachDir}/${fileName}`;
    };
    const md = htmlToMarkdown(contentRoot(root),
      (src) => { if (!isLocalImageSrc(src)) return src; imagesReferenced++; return attachRef(src); }, // images
      (href) => `lwfile:${attachRef(href)}`,                                                          // linked files
    );

    const path = `${s}.md`;
    writeFileSync(join(outDir, path), md);
    // Hierarchy: prefer the page's own breadcrumb trail (reliable across versions); fall back to the
    // index.html nested list below for pages/exports without breadcrumbs.
    pages.push({ id, title, path, parentId: parentFromBreadcrumbs(root, id), version: 1 });
  }

  // Fill any still-unknown parents from index.html's nested <ul><li><a href="<id>.html">.
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
      // Only fill a parent we don't already know from breadcrumbs, and only if the parent page exists.
      if (id && byId.has(id) && parentId !== id && byId.get(id)!.parentId == null && (parentId == null || byId.has(parentId))) {
        byId.get(id)!.parentId = parentId;
      }
      const childUl = li.querySelector('ul');
      if (childUl && id) visit(childUl, id);
    });
  };
  const top = root.querySelector('ul');
  if (top) visit(top, null);
}
