import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ingestConfluenceHtmlExport } from './confluence-html-export.js';

let src = '', out = '';

beforeAll(() => {
  src = mkdtempSync(join(tmpdir(), 'conf-export-'));
  out = mkdtempSync(join(tmpdir(), 'lw-out-'));
  // A minimal Confluence-style HTML export: index + 2 pages + one attached image.
  mkdirSync(join(src, 'attachments', '101'), { recursive: true });
  writeFileSync(join(src, 'attachments', '101', 'topology.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47])); // fake PNG bytes
  writeFileSync(join(src, '100.html'),
    `<html><head><title>Eng Space : Engineering Handbook</title></head>
     <body><div id="main-content"><h1>Engineering Handbook</h1><p>Welcome team.</p></div></body></html>`);
  writeFileSync(join(src, '101.html'),
    `<html><head><title>Eng Space : Architecture</title></head>
     <body><div id="main-content"><h2>Overview</h2><p>See the diagram:</p>
     <img src="attachments/101/topology.png" alt="topology"/>
     <ul><li>node A</li><li>node B</li></ul></div></body></html>`);
  // index defines hierarchy: Architecture is a child of Engineering Handbook
  writeFileSync(join(src, 'index.html'),
    `<html><body><ul><li><a href="100.html">Engineering Handbook</a>
     <ul><li><a href="101.html">Architecture</a></li></ul></li></ul></body></html>`);
});

afterAll(() => { rmSync(src, { recursive: true, force: true }); rmSync(out, { recursive: true, force: true }); });

describe('Confluence HTML export ingester', () => {
  it('produces a manifest with both pages and the recovered hierarchy', () => {
    const r = ingestConfluenceHtmlExport(src, out);
    expect(r.pages).toBe(2);
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    const titles = manifest.pages.map((p: any) => p.title).sort();
    expect(titles).toEqual(['Architecture', 'Engineering Handbook']);
    const arch = manifest.pages.find((p: any) => p.title === 'Architecture');
    expect(arch.parentId).toBe('100'); // hierarchy recovered from index.html
  });

  it('copies the attached image locally and rewrites the markdown ref to it', () => {
    ingestConfluenceHtmlExport(src, out);
    const archMd = readdirSync(out).find((f) => f.startsWith('architecture') && f.endsWith('.md'))!;
    const md = readFileSync(join(out, archMd), 'utf8');
    expect(md).toMatch(/## Overview/);
    expect(md).toMatch(/!\[topology\]\(architecture\.attachments\/topology\.png\)/);
    expect(md).toMatch(/- node A/);
    expect(existsSync(join(out, 'architecture.attachments', 'topology.png'))).toBe(true);
  });

  it('counts referenced images and copied attachments', () => {
    const r = ingestConfluenceHtmlExport(src, out);
    expect(r.imagesReferenced).toBe(1);
    expect(r.attachmentsCopied).toBe(1);
  });
});
