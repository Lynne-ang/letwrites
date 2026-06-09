import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'node-html-parser';
import { htmlToMarkdown, isLocalImageSrc } from './confluence-html-export.js';

/**
 * Ingest a Confluence "Export to Word" file (.doc) into the standard Letwrites import
 * tree (manifest + .md + <slug>.attachments/) — IMAGES INCLUDED.
 *
 * Why this matters: the HTML/XML space export needs space-admin rights, but ANY user can
 * "Export → Word" on a page. Confluence's Word export is actually MHTML (multipart/related)
 * with every image embedded as base64. So we parse the MHTML, decode the images, and splice
 * them back in — a complete, images-and-all migration that needs no admin and no OAuth.
 *
 * Image mapping is positional: Confluence emits the embedded image parts in the same order
 * the page references them, so the Nth <img> ← the Nth decoded image part.
 */

export interface WordIngestResult {
  outDir: string;
  pages: number;
  imagesExtracted: number;
  /** Source-side counts (the integrity baseline): <img> the page references, vs base64 parts decoded. */
  imgTags: number;
}

const slug = (t: string) =>
  t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'page';

/** Decode quoted-printable (the encoding of the HTML part) → UTF-8 string. */
function decodeQuotedPrintable(s: string): string {
  const noSoftBreaks = s.replace(/=\r?\n/g, '');           // soft line breaks
  const bytes: number[] = [];
  for (let i = 0; i < noSoftBreaks.length; i++) {
    const c = noSoftBreaks[i];
    if (c === '=' && /[0-9A-Fa-f]{2}/.test(noSoftBreaks.substr(i + 1, 2))) {
      bytes.push(parseInt(noSoftBreaks.substr(i + 1, 2), 16)); i += 2;
    } else {
      bytes.push(c.charCodeAt(0) & 0xff);
    }
  }
  return Buffer.from(bytes).toString('utf8');              // QP carries UTF-8 bytes
}

function imgExt(b: Buffer): string {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b.length > 6 && b.slice(0, 3).toString() === 'GIF') return 'gif';
  return 'png';
}

/** Split an MHTML document into its MIME parts: the HTML body + the embedded image buffers (in order). */
function parseMhtml(raw: string): { html: string; images: Buffer[] } {
  const boundary = /boundary="?([^";\r\n]+)"?/.exec(raw)?.[1];
  if (!boundary) throw new Error('not an MHTML/Word export (no MIME boundary found)');
  let html = '';
  const images: Buffer[] = [];
  for (const part of raw.split('--' + boundary)) {
    const sep = part.indexOf('\r\n\r\n') >= 0 ? '\r\n\r\n' : '\n\n';
    const idx = part.indexOf(sep);
    if (idx < 0) continue;
    const headers = part.slice(0, idx);
    const body = part.slice(idx + sep.length);
    const ctype = (/Content-Type:\s*([^\r\n;]+)/i.exec(headers)?.[1] ?? '').toLowerCase();
    const enc = (/Content-Transfer-Encoding:\s*([^\r\n]+)/i.exec(headers)?.[1] ?? '').trim().toLowerCase();
    if (ctype.startsWith('text/html')) {
      html = enc === 'quoted-printable' ? decodeQuotedPrintable(body) : body;
    } else if (enc === 'base64') {
      const b64 = body.replace(/[^A-Za-z0-9+/=]/g, '');
      if (b64.length > 32) images.push(Buffer.from(b64, 'base64'));
    }
  }
  if (!html) throw new Error('no HTML part found in the Word/MHTML export');
  return { html, images };
}

export function ingestConfluenceWordExport(docPath: string, outDir: string, titleOverride?: string): WordIngestResult {
  const raw = readFileSync(docPath, 'latin1'); // MHTML is ASCII transport; QP/base64 decoded above
  const { html, images } = parseMhtml(raw);
  const root = parse(html);
  const title = titleOverride
    || (() => { const t = root.querySelector('title')?.text?.trim();
        return t && t.includes(' : ') ? t.slice(t.lastIndexOf(' : ') + 3).trim() : (t || root.querySelector('h1')?.text?.trim() || 'Imported Page'); })();
  const s = slug(title);
  const attachDir = `${s}.attachments`;

  mkdirSync(join(outDir, attachDir), { recursive: true });
  // write the decoded images in document order
  const names = images.map((b, i) => { const fn = `img${i + 1}.${imgExt(b)}`; writeFileSync(join(outDir, attachDir, fn), b); return fn; });

  // convert HTML → markdown; each EMBEDDED <img> (document order) maps to the next decoded image.
  // Inline data: URIs, external URLs, and UI icons have no base64 part — skip them so they
  // don't shift the positional mapping (mirrors the HTML-export path).
  let i = 0;
  const body = root.querySelector('#main-content') || root.querySelector('.wiki-content') || root.querySelector('body') || root;
  // Source baseline: how many embedded images the page references (independent of how many we decoded).
  const imgTags = body.querySelectorAll('img').filter((n: any) => isLocalImageSrc(n.getAttribute('src') || '')).length;
  const md = htmlToMarkdown(body as any, (src) => {
    if (/^https?:\/\//i.test(src) || src.startsWith('data:') || src.includes('/images/icons/')) return src;
    const fn = names[i]; i++;
    // A referenced image we couldn't decode is surfaced (→ importer records it missing → INCOMPLETE),
    // never a silent empty ref the integrity report can't see.
    return fn ? `${attachDir}/${fn}` : `${attachDir}/MISSING-EMBEDDED-IMAGE-${i}`;
  });

  writeFileSync(join(outDir, `${s}.md`), md);
  writeFileSync(join(outDir, 'manifest.json'),
    JSON.stringify({ source: 'confluence-word-export', pageCount: 1,
      pages: [{ id: s, title, path: `${s}.md`, parentId: null, version: 1 }] }, null, 2));
  return { outDir, pages: 1, imagesExtracted: names.length, imgTags };
}
