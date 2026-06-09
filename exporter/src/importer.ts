import { existsSync } from 'node:fs';
import type { BookStackImportClient } from './bookstack-import-client.js';
import type { ImportPlan } from './import-planner.js';
import { rewritePageImages } from './import-images.js';
import type { PageImageRecord } from './integrity.js';

export interface ImportSummary {
  books: number;
  chapters: number;
  pages: number;
  flattened: number;
  imagesUploaded: number;
  imagesMissing: number;
  imageManifest: PageImageRecord[]; // per-page image accounting for the integrity report
}

/**
 * Executes an ImportPlan against BookStack, resolving plan keys → real ids in
 * dependency order (books → chapters → pages). One failed page is reported but
 * doesn't sink the whole import.
 */
export async function runImport(
  plan: ImportPlan,
  client: BookStackImportClient,
  log: (msg: string) => void = console.log,
  exportDir?: string, // when set, local images are uploaded to BookStack + refs rewritten
): Promise<ImportSummary> {
  const bookIds = new Map<string, number>();
  const chapterIds = new Map<string, number>();
  let imagesUploaded = 0;
  let imagesMissing = 0;
  const imageManifest: PageImageRecord[] = [];

  for (const b of plan.books) {
    bookIds.set(b.key, await client.createBook({ name: b.name, description: b.description }));
    log(`  book:    ${b.name}`);
  }
  for (const c of plan.chapters) {
    const bookId = bookIds.get(c.bookKey);
    if (bookId === undefined) continue;
    chapterIds.set(c.key, await client.createChapter({ book_id: bookId, name: c.name }));
    log(`  chapter: ${c.name}`);
  }

  let pageCount = 0;
  for (const p of plan.pages) {
    try {
      // Create the page first so images can be scoped to its id (uploaded_to).
      let pageId: number;
      if (p.chapterKey && chapterIds.has(p.chapterKey)) {
        pageId = await client.createPage({ chapter_id: chapterIds.get(p.chapterKey)!, name: p.name, markdown: p.markdown });
      } else {
        const bookId = bookIds.get(p.bookKey);
        if (bookId === undefined) throw new Error(`no book for ${p.key}`);
        pageId = await client.createPage({ book_id: bookId, name: p.name, markdown: p.markdown });
      }
      pageCount++;

      // Upload local images into BookStack, rewrite refs, update the page.
      if (exportDir) {
        const r = await rewritePageImages({
          markdown: p.markdown, pageId, exportDir, sourcePath: p.sourcePath,
          uploader: client, exists: existsSync,
        });
        imagesUploaded += r.uploaded;
        imagesMissing += r.missing.length + r.failed.length;
        if (r.found || r.missing.length || r.failed.length) {
          imageManifest.push({ page: p.name, found: r.found, uploaded: r.uploadedRefs, missing: r.missing, failed: r.failed });
        }
        if (r.markdown !== p.markdown) await client.updatePage(pageId, r.markdown);
        const imgNote = r.uploaded || r.missing.length || r.failed.length
          ? `  (${r.uploaded} img${r.missing.length ? `, ${r.missing.length} missing` : ''}${r.failed.length ? `, ${r.failed.length} failed` : ''})`
          : '';
        log(`  page:    ${p.name}${imgNote}`);
      } else {
        log(`  page:    ${p.name}`);
      }
    } catch (e) {
      log(`  ! page failed: ${p.name} — ${(e as Error).message}`);
    }
  }

  return {
    books: plan.books.length, chapters: plan.chapters.length, pages: pageCount,
    flattened: plan.flattened.length, imagesUploaded, imagesMissing, imageManifest,
  };
}

/** Human-readable tree of a plan, for --dry-run. */
export function renderPlanTree(plan: ImportPlan): string {
  const lines: string[] = [];
  const pagesIn = (bookKey: string, chapterKey?: string) =>
    plan.pages.filter((p) => p.bookKey === bookKey && p.chapterKey === chapterKey);

  for (const book of plan.books) {
    lines.push(`📕 Book: ${book.name}`);
    for (const pg of pagesIn(book.key, undefined)) lines.push(`   📄 ${pg.name}`);
    for (const ch of plan.chapters.filter((c) => c.bookKey === book.key)) {
      lines.push(`   📂 Chapter: ${ch.name}`);
      for (const pg of pagesIn(book.key, ch.key)) lines.push(`      📄 ${pg.name}`);
    }
  }
  if (plan.flattened.length) {
    lines.push('', `⚠️ ${plan.flattened.length} page(s) flattened:`);
    for (const f of plan.flattened) lines.push(`   - ${f.pageTitle}: ${f.note}`);
  }
  return lines.join('\n');
}
