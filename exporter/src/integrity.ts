import { createHash } from 'node:crypto';
import type { ImportPlan } from './import-planner.js';

/**
 * Migration-integrity report — the "nothing was lost" check.
 *
 * Silent loss is the trust-killer in every Confluence migration: images that never
 * arrive, pages that vanish, branches that flatten. This module turns the import
 * result into an explicit statement: how many pages/images the SOURCE had, how many
 * actually landed, exactly what is missing and why.
 *
 * Baseline honesty matters. When the ingester can count the source directly (HTML
 * export file count, Word <img> tags, API space size) we compare against THAT — so
 * loss that happens *during* ingest is visible. When no source count is available we
 * fall back to the post-ingest manifest and label the baseline `self-derived`, which
 * can only catch loss during UPLOAD, not during ingest. The report always states which
 * baseline it used, so "COMPLETE" is never silently weaker than it looks.
 *
 * The `checksum` is an unkeyed sha256 over the canonical report: it detects ACCIDENTAL
 * edits and corruption, not a determined forger (anyone can recompute it). Keyed
 * cryptographic signing belongs to the governance layer, not this free core.
 */

/** Per-page image accounting collected during import. */
export interface PageImageRecord {
  page: string;
  found: number;        // local image refs found in the page
  uploaded: string[];   // refs successfully uploaded to BookStack
  missing: string[];    // refs whose local file was absent (lost in export)
  failed: string[];     // refs whose upload errored (left in place)
}

export interface IntegrityInput {
  plan: ImportPlan;
  pagesImported: number;          // pages BookStack actually created
  imageManifest: PageImageRecord[];
  source?: string;                // e.g. "Confluence space ENG (HTML export)"
  /** Counts taken from the SOURCE export (not the post-ingest output), when the ingester can supply them. */
  sourceBaseline?: { pages?: number; images?: number };
}

export interface IntegrityReport {
  source: string;
  baselineSource: 'source-export' | 'self-derived (post-ingest)';
  pages: { expected: number; imported: number; failed: number };
  images: { source: number | null; found: number; uploaded: number; missing: number; failed: number; droppedAtIngest: number };
  tree: { flattened: number; notes: string[] };
  perPageImageGaps: PageImageRecord[]; // only pages with missing/failed images
  verdict: 'COMPLETE' | 'INCOMPLETE';
  checksum: string;                    // sha256 of the canonical report (minus this field) — integrity, not a signature
}

export function buildIntegrityReport(input: IntegrityInput): IntegrityReport {
  const { plan, pagesImported, imageManifest, sourceBaseline } = input;

  // Pages: prefer the source-side count; fall back to the (weaker) self-derived plan size.
  const haveSourcePages = typeof sourceBaseline?.pages === 'number';
  const expected = haveSourcePages ? sourceBaseline!.pages! : plan.pages.length;
  const failedPages = Math.max(0, expected - pagesImported);

  let found = 0, uploaded = 0, missing = 0, failed = 0;
  for (const r of imageManifest) {
    found += r.found;
    uploaded += r.uploaded.length;
    missing += r.missing.length;
    failed += r.failed.length;
  }

  // Images the SOURCE referenced. If known and larger than what survived ingest, the
  // difference was dropped before it ever became a ref — exactly the silent loss this guards.
  const sourceImages = typeof sourceBaseline?.images === 'number' ? sourceBaseline!.images! : null;
  const droppedAtIngest = sourceImages != null ? Math.max(0, sourceImages - found) : 0;

  const baselineSource: IntegrityReport['baselineSource'] =
    haveSourcePages || sourceImages != null ? 'source-export' : 'self-derived (post-ingest)';

  const report: Omit<IntegrityReport, 'checksum'> = {
    source: input.source ?? 'unknown source',
    baselineSource,
    pages: { expected, imported: pagesImported, failed: failedPages },
    images: { source: sourceImages, found, uploaded, missing, failed, droppedAtIngest },
    tree: { flattened: plan.flattened.length, notes: plan.flattened.map((f) => `${f.pageTitle}: ${f.note}`) },
    perPageImageGaps: imageManifest.filter((r) => r.missing.length || r.failed.length),
    verdict:
      failedPages === 0 && missing === 0 && failed === 0 && droppedAtIngest === 0
        ? 'COMPLETE'
        : 'INCOMPLETE',
  };
  return { ...report, checksum: checksum(report) };
}

/** Deterministic sha256 over the canonical (sorted-key) JSON of the report body. Detects accidental edits/corruption. */
export function checksum(reportBody: Omit<IntegrityReport, 'checksum'>): string {
  return 'sha256:' + createHash('sha256').update(canonical(reportBody)).digest('hex');
}

/** Re-derive the checksum and confirm it matches — catches accidental edits/corruption (not a determined forger). */
export function verifyReport(report: IntegrityReport): boolean {
  const { checksum: sum, ...body } = report;
  return sum === checksum(body);
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v as Record<string, unknown>).sort()
      .map((k) => JSON.stringify(k) + ':' + canonical((v as Record<string, unknown>)[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

/** Human-readable report — what you hand the compliance officer. */
export function renderIntegrityReport(r: IntegrityReport): string {
  const L: string[] = [];
  const mark = r.verdict === 'COMPLETE' ? '✅' : '⚠️';
  L.push(`${mark} MIGRATION INTEGRITY REPORT — ${r.verdict}`);
  L.push(`Source: ${r.source}`);
  L.push(
    `Baseline: ${r.baselineSource}` +
      (r.baselineSource.startsWith('self')
        ? ' — counts are derived from the import output, so this catches upload loss only, not ingest loss'
        : ' — counts are taken from the source export, so loss during ingest is visible'),
  );
  L.push('');
  L.push(`Pages:  ${r.pages.imported}/${r.pages.expected} imported` + (r.pages.failed ? `  (${r.pages.failed} MISSING)` : '  ✓'));
  const img = r.images;
  const denom = img.source != null ? img.source : img.found;
  L.push(
    `Images: ${img.uploaded}/${denom} moved` +
      (img.droppedAtIngest ? `, ${img.droppedAtIngest} DROPPED AT INGEST` : '') +
      (img.missing ? `, ${img.missing} MISSING` : '') +
      (img.failed ? `, ${img.failed} FAILED` : '') +
      (img.droppedAtIngest || img.missing || img.failed ? '' : '  ✓'),
  );
  L.push(`Tree:   ${r.tree.flattened} page(s) flattened` + (r.tree.flattened ? '' : '  ✓'));
  if (r.perPageImageGaps.length) {
    L.push('', 'Image gaps (page → refs):');
    for (const g of r.perPageImageGaps) {
      if (g.missing.length) L.push(`  • ${g.page}: MISSING ${g.missing.join(', ')}`);
      if (g.failed.length) L.push(`  • ${g.page}: FAILED ${g.failed.join(', ')}`);
    }
  }
  if (r.tree.notes.length) {
    L.push('', 'Flattened pages:');
    for (const n of r.tree.notes) L.push(`  • ${n}`);
  }
  L.push('', `Checksum: ${r.checksum}`);
  L.push(`(verify with verifyReport() — detects accidental edits/corruption; not a cryptographic signature)`);
  return L.join('\n');
}
