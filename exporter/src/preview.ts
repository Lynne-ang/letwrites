import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Renders the converted export into a single self-contained `preview.html` —
 * a clickable view of the migrated space (page tree + rendered content + the
 * migration report). Lets you show "here's your Confluence content, migrated"
 * in a browser with nothing else running.
 *
 * The Markdown renderer is intentionally small: it targets exactly what
 * converter.ts emits (headings, lists, tables, code, blockquotes, links,
 * images, bold/italic), not arbitrary Markdown.
 */
interface ManifestPage { id: string; title: string; path: string; parentId: string | null; version: number; }
interface Manifest { space: string; exportedAt: string; pageCount: number; pages: ManifestPage[]; }

export async function generatePreview(outDir: string): Promise<string> {
  const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8')) as Manifest;
  const report = await readFile(join(outDir, 'migration-report.md'), 'utf8').catch(() => '');

  const depth = new Map<string, number>();
  const byId = new Map(manifest.pages.map((p) => [p.id, p]));
  const depthOf = (p: ManifestPage): number => {
    if (depth.has(p.id)) return depth.get(p.id)!;
    const d = p.parentId && byId.has(p.parentId) ? depthOf(byId.get(p.parentId)!) + 1 : 0;
    depth.set(p.id, d);
    return d;
  };

  const navItems: string[] = [];
  const articles: string[] = [];

  for (const p of manifest.pages) {
    const raw = await readFile(join(outDir, p.path), 'utf8').catch(() => '');
    const body = stripFrontMatter(raw);
    const pageDir = dirname(p.path);
    const html = renderMarkdown(body, pageDir === '.' ? '' : pageDir);
    const anchor = 'p-' + p.id;
    navItems.push(
      `<a href="#${anchor}" style="padding-left:${12 + depthOf(p) * 16}px">${esc(p.title)}</a>`,
    );
    articles.push(`<article id="${anchor}"><div class="crumb">${esc(p.path)} · v${p.version}</div>${html}</article>`);
  }

  const reportHtml = renderMarkdown(report, '');
  const page = shell(manifest, navItems.join('\n'), articles.join('\n'), reportHtml);
  const out = join(outDir, 'preview.html');
  await writeFile(out, page, 'utf8');
  return out;
}

function stripFrontMatter(md: string): string {
  if (md.startsWith('---')) {
    const end = md.indexOf('\n---', 3);
    if (end !== -1) return md.slice(md.indexOf('\n', end + 1) + 1);
  }
  return md;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Sanitize a link/image URL. Migrated content can be attacker-influenced, so
 * block javascript:/data:/other schemes (XSS) and neutralize quotes that would
 * break out of the HTML attribute. Allow http(s) and relative URLs only.
 */
export function safeUrl(u: string): string {
  const t = u.trim();
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(t);
  if (hasScheme && !/^https?:\/\//i.test(t)) return '#'; // javascript:, data:, etc.
  return t.replace(/"/g, '%22').replace(/\s/g, '%20');
}
const attr = (s: string) => s.replace(/"/g, '&quot;');

/** Inline formatting: code, images, links, bold, italic. Order matters. */
function inline(s: string): string {
  let t = esc(s); // escapes & < > ; URL/attr handling below covers quotes + schemes
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => `<img alt="${attr(alt)}" src="${safeUrl(url)}" />`);
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${safeUrl(url)}">${label}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return t;
}

/** Block-level renderer over the converter's output, image src rewritten to pageDir. */
function renderMarkdown(md: string, pageDir: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let i = 0;

  const fixImgSrc = (html: string) =>
    pageDir
      ? html.replace(/<img alt="([^"]*)" src="([^"]+)"/g, (m, a, src) =>
          /^https?:|^\//.test(src) ? m : `<img alt="${a}" src="${pageDir}/${src}"`)
      : html;

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) buf.push(lines[i++]);
      i++;
      out.push(`<pre data-lang="${esc(lang)}"><code>${esc(buf.join('\n'))}</code></pre>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^---+\s*$/.test(line)) { out.push('<hr />'); i++; continue; }
    if (line.startsWith('>')) {
      const buf: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) buf.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${fixImgSrc(inline(buf.join(' ').trim()))}</blockquote>`);
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
      out.push('<ul>' + buf.map((b) => `<li>${fixImgSrc(inline(b))}</li>`).join('') + '</ul>');
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) buf.push(lines[i++].replace(/^\s*\d+\.\s+/, ''));
      out.push('<ol>' + buf.map((b) => `<li>${fixImgSrc(inline(b))}</li>`).join('') + '</ol>');
      continue;
    }
    if (line.trim().startsWith('|') && lines[i + 1]?.includes('---')) {
      const rows: string[] = [];
      const header = splitRow(line);
      i += 2; // skip header + separator
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) bodyRows.push(splitRow(lines[i++]));
      rows.push('<thead><tr>' + header.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead>');
      rows.push('<tbody>' + bodyRows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody>');
      out.push(`<table>${rows.join('')}</table>`);
      continue;
    }
    if (line.trim() === '') { i++; continue; }

    // paragraph: gather until blank
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${fixImgSrc(inline(buf.join(' ')))}</p>`);
  }
  return out.join('\n');
}

function isBlockStart(l: string): boolean {
  return /^(#{1,6})\s/.test(l) || l.startsWith('```') || l.startsWith('>') ||
    /^\s*[-*]\s/.test(l) || /^\s*\d+\.\s/.test(l) || /^---+\s*$/.test(l) || l.trim().startsWith('|');
}
function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}

function shell(manifest: Manifest, nav: string, articles: string, report: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Letwrites — migrated from Confluence (${esc(manifest.space)})</title>
<style>
:root{--bg:#0b0d10;--panel:#12151a;--border:#232a34;--text:#e6e9ee;--muted:#9aa4b2;--accent:#5b8cff;}
*{box-sizing:border-box;margin:0;padding:0}body{background:var(--bg);color:var(--text);font:15px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;min-height:100vh}
aside{width:280px;border-right:1px solid var(--border);padding:24px 0;position:sticky;top:0;height:100vh;overflow:auto;flex-shrink:0}
aside .brand{font-weight:800;padding:0 20px 16px;font-size:17px}aside .brand small{display:block;color:var(--muted);font-weight:500;font-size:12px;margin-top:2px}
aside a{display:block;color:var(--muted);text-decoration:none;padding:6px 20px;font-size:14px;border-left:2px solid transparent}
aside a:hover{color:var(--text);border-left-color:var(--accent);background:rgba(91,140,255,.06)}
main{flex:1;padding:48px 56px;max-width:860px}
.banner{background:rgba(91,140,255,.1);border:1px solid var(--border);border-radius:10px;padding:14px 18px;margin-bottom:36px;color:var(--muted);font-size:14px}
.banner b{color:var(--text)}
article{padding:28px 0;border-bottom:1px solid var(--border)}
.crumb{color:var(--muted);font-size:12px;font-family:ui-monospace,monospace;margin-bottom:14px}
h1{font-size:30px;letter-spacing:-.02em;margin:.2em 0 .5em}h2{font-size:21px;margin:1.2em 0 .5em}h3{font-size:17px;margin:1em 0 .4em}
p{margin:.6em 0}ul,ol{margin:.6em 0 .6em 1.4em}li{margin:.25em 0}
a{color:var(--accent)}code{background:var(--panel);border:1px solid var(--border);padding:1px 6px;border-radius:5px;font-size:13px;font-family:ui-monospace,monospace}
pre{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;overflow:auto;margin:.8em 0;position:relative}
pre code{background:none;border:none;padding:0}pre[data-lang]::before{content:attr(data-lang);position:absolute;top:8px;right:12px;color:var(--muted);font-size:11px}
blockquote{border-left:3px solid var(--accent);background:var(--panel);padding:10px 16px;margin:.8em 0;border-radius:0 8px 8px 0;color:var(--muted)}
table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:14px}th,td{border:1px solid var(--border);padding:8px 12px;text-align:left}th{background:var(--panel)}
img{max-width:100%;border:1px solid var(--border);border-radius:8px;background:#fff}hr{border:none;border-top:1px solid var(--border);margin:1.4em 0}
#report{margin-top:48px}#report h1{font-size:22px}
</style></head><body>
<aside>
  <div class="brand">🛡 Letwrites <small>migrated from Confluence · ${esc(manifest.space)}</small></div>
  ${nav}
  <a href="#report" style="margin-top:16px;color:var(--accent)">⚑ Migration report</a>
</aside>
<main>
  <div class="banner"><b>${manifest.pageCount} pages</b> migrated from Confluence into Letwrites format on ${esc(manifest.exportedAt.slice(0, 10))}. Links re-pointed, attachments inlined. Scroll the report for anything that needs a human.</div>
  ${articles}
  <div id="report">${report}</div>
</main>
</body></html>`;
}
