import { describe, it, expect } from 'vitest';
import { buildIntegrityReport, renderIntegrityReport, verifyReport, type PageImageRecord } from './integrity.js';
import type { ImportPlan } from './import-planner.js';

const plan = (pages: number, flattened = 0): ImportPlan => ({
  books: [{ key: 'b', name: 'B', description: '' }],
  chapters: [],
  pages: Array.from({ length: pages }, (_, i) => ({ key: `p${i}`, bookKey: 'b', name: `P${i}`, markdown: '', sourcePath: `p${i}.md` })),
  flattened: Array.from({ length: flattened }, (_, i) => ({ pageTitle: `F${i}`, note: 'too deep' })),
});

describe('integrity report', () => {
  it('names the pages that failed to import, with the reason', () => {
    const r = buildIntegrityReport({
      plan: plan(3), pagesImported: 1, imageManifest: [], sourceBaseline: { pages: 3 },
      failedPageDetails: [
        { page: 'Fax Settings', reason: 'BookStack 403 on POST /api/pages' },
        { page: 'IT Operation', reason: 'BookStack 422: name is required' },
      ],
    });
    expect(r.pageGaps.length).toBe(2);
    const text = renderIntegrityReport(r);
    expect(text).toContain('Page gaps');
    expect(text).toContain('Fax Settings: BookStack 403 on POST /api/pages');
    expect(text).toContain('IT Operation: BookStack 422: name is required');
  });

  it('is COMPLETE when every page and image landed', () => {
    const manifest: PageImageRecord[] = [{ page: 'P0', found: 2, uploaded: ['a.png', 'b.png'], missing: [], failed: [] }];
    const r = buildIntegrityReport({ plan: plan(3), pagesImported: 3, imageManifest: manifest, sourceBaseline: { pages: 3, images: 2 } });
    expect(r.verdict).toBe('COMPLETE');
    expect(r.baselineSource).toBe('source-export');
    expect(r.images).toEqual({ source: 2, found: 2, uploaded: 2, missing: 0, failed: 0, droppedAtIngest: 0 });
    expect(r.pages).toEqual({ expected: 3, imported: 3, failed: 0 });
  });

  it('is INCOMPLETE and names the gaps when an image is missing', () => {
    const manifest: PageImageRecord[] = [
      { page: 'P0', found: 2, uploaded: ['a.png'], missing: ['b.png'], failed: [] },
      { page: 'P1', found: 1, uploaded: [], missing: [], failed: ['c.png'] },
    ];
    const r = buildIntegrityReport({ plan: plan(3), pagesImported: 2, imageManifest: manifest, sourceBaseline: { pages: 3, images: 3 } });
    expect(r.verdict).toBe('INCOMPLETE');
    expect(r.images.missing).toBe(1);
    expect(r.images.failed).toBe(1);
    expect(r.pages.failed).toBe(1); // 3 expected, 2 imported
    expect(r.perPageImageGaps).toHaveLength(2);
  });

  it('catches images dropped DURING ingest via the source baseline', () => {
    // Source had 5 images, but only 3 survived ingest to become refs. The old self-derived
    // baseline (found=3) would have called this COMPLETE; the source baseline (5) does not.
    const manifest: PageImageRecord[] = [{ page: 'P0', found: 3, uploaded: ['a.png', 'b.png', 'c.png'], missing: [], failed: [] }];
    const r = buildIntegrityReport({ plan: plan(1), pagesImported: 1, imageManifest: manifest, sourceBaseline: { pages: 1, images: 5 } });
    expect(r.verdict).toBe('INCOMPLETE');
    expect(r.images.droppedAtIngest).toBe(2);
    expect(r.images.source).toBe(5);
  });

  it('catches pages dropped DURING ingest via the source baseline', () => {
    // Source space had 4 pages; only 3 made it into the manifest the importer saw.
    const r = buildIntegrityReport({ plan: plan(3), pagesImported: 3, imageManifest: [], sourceBaseline: { pages: 4 } });
    expect(r.verdict).toBe('INCOMPLETE');
    expect(r.pages).toEqual({ expected: 4, imported: 3, failed: 1 });
  });

  it('labels the baseline self-derived (and weaker) when no source count is supplied', () => {
    const r = buildIntegrityReport({ plan: plan(2), pagesImported: 2, imageManifest: [] });
    expect(r.baselineSource).toBe('self-derived (post-ingest)');
    expect(r.images.source).toBe(null);
    expect(r.verdict).toBe('COMPLETE'); // nothing to compare against beyond the output
  });

  it('checksums the report and detects accidental edits', () => {
    const r = buildIntegrityReport({ plan: plan(1), pagesImported: 1, imageManifest: [], sourceBaseline: { pages: 1, images: 0 } });
    expect(r.checksum.startsWith('sha256:')).toBe(true);
    expect(verifyReport(r)).toBe(true);
    // edit: claim more images moved than really did
    const tampered = { ...r, images: { ...r.images, uploaded: 999 } };
    expect(verifyReport(tampered)).toBe(false);
  });
});
