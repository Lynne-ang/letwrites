import { describe, it, expect, vi } from 'vitest';
import { findLocalImages, rewritePageImages, rewritePageFiles, type ImageUploader, type FileUploader } from './import-images.js';

describe('rewritePageFiles (linked attachments → BookStack download URLs)', () => {
  it('uploads lwfile links and repoints them; missing/failed degrade to plain text', async () => {
    const md = 'see [Spec](lwfile:p.attachments/spec.pdf) and [Clip](lwfile:p.attachments/clip.mp4) and [Gone](lwfile:p.attachments/missing.zip)';
    const uploader: FileUploader = { uploadAttachment: vi.fn(async (_id, _abs, name) => `/attachments/${name === 'spec.pdf' ? 9 : 10}`) };
    const exists = (abs: string) => !abs.includes('missing.zip'); // the zip is absent on disk
    const r = await rewritePageFiles({ markdown: md, pageId: 1, exportDir: '/x', sourcePath: 'p.md', uploader, exists });
    expect(r.uploaded).toBe(2);
    expect(r.missing).toEqual(['p.attachments/missing.zip']);
    expect(r.markdown).toContain('[Spec](/attachments/9)');
    expect(r.markdown).toContain('[Clip](/attachments/10)');
    expect(r.markdown).toContain('Gone');            // dead link kept as text
    expect(r.markdown).not.toContain('lwfile:');     // no markers left
  });
});

describe('findLocalImages', () => {
  it('finds local image refs, skips http/absolute/data', () => {
    const md = `![a](pic.attachments/a.png) ![b](https://x.com/b.png) ![c](/abs/c.png) ![d](sub/d.png)`;
    expect(findLocalImages(md).map((i) => i.ref)).toEqual(['pic.attachments/a.png', 'sub/d.png']);
  });
});

describe('rewritePageImages', () => {
  const uploader = (url: string): ImageUploader => ({ upload: vi.fn(async () => url) });

  it('uploads local images and rewrites refs to BookStack URLs', async () => {
    const r = await rewritePageImages({
      markdown: '# A\n\n![diagram](architecture.attachments/topology.png)\n',
      pageId: 12,
      exportDir: '/export',
      sourcePath: 'engineering-handbook/architecture.md',
      uploader: uploader('https://docs.acme.com/uploads/images/gallery/2026/topology.png'),
      exists: () => true,
    });
    expect(r.uploaded).toBe(1);
    expect(r.markdown).toContain('](https://docs.acme.com/uploads/images/gallery/2026/topology.png)');
    expect(r.markdown).not.toContain('architecture.attachments');
  });

  it('also uploads + rewrites width-bearing inline <img src> images (preserving width)', async () => {
    const r = await rewritePageImages({
      markdown: 'before <img src="p.attachments/shot.png" alt="s" style="width:408px;height:auto"> after',
      pageId: 1, exportDir: '/x', sourcePath: 'p.md',
      uploader: uploader('/uploads/images/x.png'), exists: () => true,
    });
    expect(r.uploaded).toBe(1);
    expect(r.markdown).toContain('<img src="/uploads/images/x.png" alt="s" style="width:408px;height:auto">'); // src rewritten, width(style) kept
    expect(r.markdown).not.toContain('p.attachments');
  });

  it('resolves the local file relative to the page dir + export dir', async () => {
    const up = vi.fn(async () => 'https://x/y.png');
    await rewritePageImages({
      markdown: '![x](architecture.attachments/topology.png)',
      pageId: 12, exportDir: '/export', sourcePath: 'eng/architecture.md',
      uploader: { upload: up }, exists: () => true,
    });
    expect(up).toHaveBeenCalledWith(12, '/export/eng/architecture.attachments/topology.png', 'topology.png');
  });

  it('records missing files and leaves the ref in place', async () => {
    const r = await rewritePageImages({
      markdown: '![x](gone.attachments/missing.png)',
      pageId: 1, exportDir: '/export', sourcePath: 'p.md',
      uploader: uploader('https://x'), exists: () => false,
    });
    expect(r.uploaded).toBe(0);
    expect(r.missing).toEqual(['gone.attachments/missing.png']);
    expect(r.markdown).toContain('gone.attachments/missing.png'); // untouched
  });

  it('degrades gracefully when an upload fails — image left, reported, import not broken', async () => {
    const r = await rewritePageImages({
      markdown: '![x](p.attachments/a.png)',
      pageId: 1, exportDir: '/export', sourcePath: 'p.md',
      uploader: { upload: async () => { throw new Error('413 too large'); } },
      exists: () => true,
    });
    expect(r.failed).toEqual(['p.attachments/a.png']);
    expect(r.markdown).toContain('p.attachments/a.png');
  });

  it('leaves pages with no local images untouched', async () => {
    const md = '# A\n\ntext only, ![remote](https://x.com/r.png)';
    const r = await rewritePageImages({
      markdown: md, pageId: 1, exportDir: '/e', sourcePath: 'p.md',
      uploader: uploader('https://x'), exists: () => true,
    });
    expect(r.markdown).toBe(md);
    expect(r.uploaded).toBe(0);
  });
});
