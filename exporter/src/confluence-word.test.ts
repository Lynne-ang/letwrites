import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ingestConfluenceWordExport } from './confluence-word.js';

let docPath = '', out = '';
// 1x1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'word-'));
  out = mkdtempSync(join(tmpdir(), 'word-out-'));
  docPath = join(dir, 'page.doc');
  // Confluence-style MHTML: QP-encoded HTML part + one base64 image part
  const mhtml = [
    'Content-Type: multipart/related; boundary="BND"',
    '',
    '--BND',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    '<html><head><title>IT Help Center : Printer Setup</title></head><body><div id=3D"main-content">' +
      '<h2>Steps</h2><p>Enter ID =E2=9C=93</p><img src=3D"file:///C:/abc"/></div></body></html>',
    '--BND',
    'Content-Type: application/octet-stream',
    'Content-Transfer-Encoding: base64',
    '',
    PNG_B64,
    '--BND--',
    '',
  ].join('\r\n');
  writeFileSync(docPath, mhtml, 'latin1');
});

afterAll(() => { rmSync(out, { recursive: true, force: true }); });

describe('Confluence Word (.doc / MHTML) ingester', () => {
  it('extracts the embedded base64 image and writes a real PNG', () => {
    const r = ingestConfluenceWordExport(docPath, out);
    expect(r.imagesExtracted).toBe(1);
    const imgs = readdirSync(join(out, 'printer-setup.attachments'));
    expect(imgs).toContain('img1.png');
    const bytes = readFileSync(join(out, 'printer-setup.attachments', 'img1.png'));
    expect(bytes.slice(0, 4).toString('hex')).toBe('89504e47'); // real PNG magic
  });

  it('decodes quoted-printable text + title and rewrites the image ref to the local file', () => {
    ingestConfluenceWordExport(docPath, out);
    const md = readFileSync(join(out, 'printer-setup.md'), 'utf8');
    expect(md).toMatch(/## Steps/);
    expect(md).toMatch(/Enter ID ✓/);                 // =E2=9C=93 QP → ✓ (UTF-8)
    expect(md).toMatch(/!\[.*\]\(printer-setup\.attachments\/img1\.png\)/);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.pages[0].title).toBe('Printer Setup'); // "Space : Title" → Title
  });
});
