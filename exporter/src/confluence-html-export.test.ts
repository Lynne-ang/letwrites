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

describe('Confluence HTML export — real-world gotchas (query strings + duplicate titles)', () => {
  it('strips a ?width= image query so the real file is found and copied (the 257-missing-images bug)', () => {
    const s = mkdtempSync(join(tmpdir(), 'conf-q-'));
    const o = mkdtempSync(join(tmpdir(), 'lw-q-'));
    mkdirSync(join(s, 'attachments'), { recursive: true });
    writeFileSync(join(s, 'attachments', '2645229636.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(s, '200.html'),
      `<html><head><title>Sp : Login</title></head><body><div id="main-content">
       <img src="attachments/2645229636.png?width=306" alt="x"/></div></body></html>`);
    const r = ingestConfluenceHtmlExport(s, o);
    const mdName = readdirSync(o).find((f) => f.startsWith('login') && f.endsWith('.md'))!;
    const md = readFileSync(join(o, mdName), 'utf8');
    expect(md).toContain('login.attachments/2645229636.png'); // clean ref…
    expect(md).not.toContain('_width_');                       // …no mangled query baked in
    expect(existsSync(join(o, 'login.attachments', '2645229636.png'))).toBe(true); // file actually copied
    expect(r.attachmentsCopied).toBe(1);
    rmSync(s, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true });
  });

  it('recovers the parent/child tree from page breadcrumbs (so it is NOT flattened into top-level books)', () => {
    const s = mkdtempSync(join(tmpdir(), 'conf-h-'));
    const o = mkdtempSync(join(tmpdir(), 'lw-h-'));
    const bc = (crumbs: string) => `<div id="breadcrumb-section"><ol id="breadcrumbs">${crumbs}</ol></div>`;
    // Google Workspace (top-level) → Set up a Meeting (child) → Book a Meeting Room (grandchild)
    writeFileSync(join(s, '100.html'), `<html><head><title>Sp : Google Workspace</title></head><body>
      ${bc('<li><a href="index.html">Sp</a></li>')}<div id="main-content"><p>x</p></div></body></html>`);
    writeFileSync(join(s, '101.html'), `<html><head><title>Sp : Set up a Meeting</title></head><body>
      ${bc('<li><a href="index.html">Sp</a></li><li><a href="100.html">Google Workspace</a></li>')}<div id="main-content"><p>x</p></div></body></html>`);
    writeFileSync(join(s, '102.html'), `<html><head><title>Sp : Book a Meeting Room</title></head><body>
      ${bc('<li><a href="index.html">Sp</a></li><li><a href="100.html">Google Workspace</a></li><li><a href="101.html">Set up a Meeting</a></li>')}<div id="main-content"><p>x</p></div></body></html>`);
    ingestConfluenceHtmlExport(s, o);
    const m = JSON.parse(readFileSync(join(o, 'manifest.json'), 'utf8'));
    const byTitle = (t: string) => m.pages.find((p: any) => p.title === t);
    expect(byTitle('Google Workspace').parentId).toBe(null);   // top-level
    expect(byTitle('Set up a Meeting').parentId).toBe('100');   // child
    expect(byTitle('Book a Meeting Room').parentId).toBe('101'); // grandchild — tree preserved
    rmSync(s, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true });
  });

  it('converts a Confluence emoji image to an inline Unicode char (not a giant external image)', () => {
    const s = mkdtempSync(join(tmpdir(), 'conf-e-'));
    const o = mkdtempSync(join(tmpdir(), 'lw-e-'));
    writeFileSync(join(s, '400.html'), `<html><head><title>Sp : Guide</title></head><body><div id="main-content">
      <h2><img class="emoticon emoticon-blue-star" data-emoji-id="1f4d8" data-emoji-shortname=":blue_book:" src="https://appier.atlassian.net/wiki/s/x/images/icons/emoticons/72/1f4d8.png" width="16" height="16" alt="(blue star)"/> Onboarding</h2></div></body></html>`);
    ingestConfluenceHtmlExport(s, o);
    const md = readFileSync(join(o, readdirSync(o).find((f) => f.startsWith('guide') && f.endsWith('.md'))!), 'utf8');
    expect(md).toContain('📘');                 // the real emoji, inline
    expect(md).not.toContain('emoticons/72');   // not an external emoji image
    expect(md).not.toContain('![');             // not rendered as an image at all
    rmSync(s, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true });
  });

  it('links a non-image file as an upload marker; unwraps a redundant image-fullsize link', () => {
    const s = mkdtempSync(join(tmpdir(), 'conf-f-'));
    const o = mkdtempSync(join(tmpdir(), 'lw-f-'));
    mkdirSync(join(s, 'attachments', '1'), { recursive: true });
    writeFileSync(join(s, 'attachments', '1', 'clip.mp4'), Buffer.from([0, 0, 0, 24]));
    writeFileSync(join(s, 'attachments', '1', 'big.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(s, '500.html'), `<html><head><title>Sp : Files</title></head><body><div id="main-content">
      <p><a href="attachments/1/clip.mp4">Watch the clip</a></p>
      <p><a href="attachments/1/big.png"><img src="attachments/1/big.png?width=100" alt="diagram"/></a></p>
    </div></body></html>`);
    ingestConfluenceHtmlExport(s, o);
    const md = readFileSync(join(o, readdirSync(o).find((f) => f.startsWith('files') && f.endsWith('.md'))!), 'utf8');
    expect(md).toContain('[Watch the clip](lwfile:files.attachments/clip.mp4)'); // file → upload marker
    expect(existsSync(join(o, 'files.attachments', 'clip.mp4'))).toBe(true);      // file copied
    expect(md).toContain('<img src="files.attachments/big.png" alt="diagram" style="display:block;width:100px;height:auto">'); // unwrapped to the image, width (from ?width=100) preserved as style
    expect(md).not.toContain('lwfile:files.attachments/big.png');                // png NOT treated as a download
    rmSync(s, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true });
  });

  it('preserves the Confluence display width as an inline <img width> (not a full-size image)', () => {
    const s = mkdtempSync(join(tmpdir(), 'conf-w-'));
    const o = mkdtempSync(join(tmpdir(), 'lw-w-'));
    mkdirSync(join(s, 'attachments', '9'), { recursive: true });
    writeFileSync(join(s, 'attachments', '9', 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(s, '600.html'), `<html><head><title>Sp : Sized</title></head><body><div id="main-content">
      <img class="confluence-embedded-image" src="attachments/9/shot.png?width=408" width="408" alt="screen"/>
    </div></body></html>`);
    ingestConfluenceHtmlExport(s, o);
    const md = readFileSync(join(o, readdirSync(o).find((f) => f.startsWith('sized') && f.endsWith('.md'))!), 'utf8');
    expect(md).toContain('<img src="sized.attachments/shot.png" alt="screen" style="display:block;width:408px;height:auto">'); // width carried over (style — what BookStack honors), block so text goes below
    expect(md).not.toContain('![screen]');                                                   // not the unconstrained form
    expect(existsSync(join(o, 'sized.attachments', 'shot.png'))).toBe(true);
    rmSync(s, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true });
  });

  it('rewrites Confluence "Related articles" page links and avoids code-block indentation', () => {
    const s = mkdtempSync(join(tmpdir(), 'conf-ra-'));
    const o = mkdtempSync(join(tmpdir(), 'lw-ra-'));
    // The content-by-label macro, pretty-printed (leading whitespace) like a real export.
    writeFileSync(join(s, '700.html'), `<html><head><title>Sp : Related</title></head><body><div id="main-content">
      <ul class="content-by-label">
        <li>
          <div><span class="icon aui-icon content-type-page" title="Page">Page:</span></div>
          <div class="details"><a data-linked-resource-id="2861498377" data-linked-resource-type="page" href="/wiki/spaces/IHC/pages/2861498377/File+Sharing">File Sharing</a></div>
        </li>
      </ul>
    </div></body></html>`);
    ingestConfluenceHtmlExport(s, o);
    const md = readFileSync(join(o, readdirSync(o).find((f) => f.startsWith('related') && f.endsWith('.md'))!), 'utf8');
    expect(md).toContain('[File Sharing](lwpage:2861498377)'); // page link → marker (importer repoints to the BookStack page)
    expect(md).not.toMatch(/^ {4,}\[File Sharing\]/m);         // NOT indented 4+ spaces → not a code block
    expect(md).not.toContain('Page:');                         // the content-type "Page:" label is dropped
    rmSync(s, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true });
  });

  it('handles bracketed link titles, thumbnail file links, and drops empty icon links', () => {
    const s = mkdtempSync(join(tmpdir(), 'conf-edge-'));
    const o = mkdtempSync(join(tmpdir(), 'lw-edge-'));
    mkdirSync(join(s, 'attachments', '9'), { recursive: true });
    writeFileSync(join(s, 'attachments', '9', 'x.py'), Buffer.from('print(1)'));
    writeFileSync(join(s, '800.html'), `<html><head><title>Sp : Edge</title></head><body><div id="main-content">
      <p><a data-linked-resource-id="999" data-linked-resource-type="page" href="/wiki/spaces/IHC/pages/999/x">[WIP] Draft Notes</a></p>
      <p><a href="attachments/9/x.py"><img src="https://ext.atlassian.net/thumb.py?viewType=fileMacro"/></a></p>
      <p><img src="https://ext.atlassian.net/wiki/images/icons/grey_arrow_down.png"/></p>
    </div></body></html>`);
    ingestConfluenceHtmlExport(s, o);
    const md = readFileSync(join(o, readdirSync(o).find((f) => f.startsWith('edge') && f.endsWith('.md'))!), 'utf8');
    expect(md).toContain('[(WIP) Draft Notes](lwpage:999)');          // bracketed title → parens, marker stays well-formed
    expect(md).toContain('[x.py](lwfile:edge.attachments/x.py)');     // thumbnail-labelled file link → filename label
    expect(md).not.toContain('grey_arrow_down');                      // Confluence UI chrome icon dropped
  });

  it('drops the Confluence Table-of-Contents macro (dead #anchors; BookStack has its own page nav)', () => {
    const s = mkdtempSync(join(tmpdir(), 'conf-toc-'));
    const o = mkdtempSync(join(tmpdir(), 'lw-toc-'));
    writeFileSync(join(s, '810.html'), `<html><head><title>Sp : Policies</title></head><body><div id="main-content">
      <div class="toc-macro rbtoc123"><ul class="toc-indentation"><li><a href="#Policies-Jira">Jira</a></li></ul></div>
      <h2 id="Policies-Jira">Jira</h2><p>Body text.</p>
    </div></body></html>`);
    ingestConfluenceHtmlExport(s, o);
    const md = readFileSync(join(o, readdirSync(o).find((f) => f.startsWith('policies') && f.endsWith('.md'))!), 'utf8');
    expect(md).not.toContain('(#Policies-Jira)'); // the dead TOC anchor is gone
    expect(md).toContain('## Jira');              // the real heading + body survive
    expect(md).toContain('Body text.');
    rmSync(s, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true });
  });

  it('gives two same-titled pages distinct slugs so neither overwrites the other', () => {
    const s = mkdtempSync(join(tmpdir(), 'conf-d-'));
    const o = mkdtempSync(join(tmpdir(), 'lw-d-'));
    writeFileSync(join(s, '300.html'), `<html><head><title>Sp : Setup</title></head><body><div id="main-content"><p>alpha-content</p></div></body></html>`);
    writeFileSync(join(s, '301.html'), `<html><head><title>Sp : Setup</title></head><body><div id="main-content"><p>beta-content</p></div></body></html>`);
    const r = ingestConfluenceHtmlExport(s, o);
    expect(r.pages).toBe(2);
    const mds = readdirSync(o).filter((f) => f.endsWith('.md'));
    expect(mds.length).toBe(2); // two distinct files, not one silently overwritten
    const both = mds.map((f) => readFileSync(join(o, f), 'utf8')).join('\n');
    expect(both).toContain('alpha-content');
    expect(both).toContain('beta-content'); // both pages' content survived
    rmSync(s, { recursive: true, force: true }); rmSync(o, { recursive: true, force: true });
  });
});
