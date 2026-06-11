import { existsSync } from 'node:fs';
import type { BookStackImportClient } from './bookstack-import-client.js';
import { TARGET_BOOK_KEY, type ImportPlan } from './import-planner.js';
import { rewritePageImages, rewritePageFiles } from './import-images.js';
import type { PageImageRecord } from './integrity.js';

export interface ImportSummary {
  books: number;
  chapters: number;
  pages: number;
  flattened: number;
  imagesUploaded: number;
  imagesMissing: number;
  filesUploaded: number;  // non-image attachments (pdf/mp4/…) uploaded + linked
  filesMissing: number;   // linked attachments whose file was absent / upload failed
  imageManifest: PageImageRecord[]; // per-page image accounting for the integrity report
  failedPages: { page: string; reason: string }[]; // pages that couldn't be created (name + why) — for the report
  createdBooks: { id: number; name: string }[]; // top-level books created (so the caller can set their visibility)
  linksRewritten: number; // inter-page links repointed to BookStack URLs
  linksBroken: number;    // inter-page links whose target didn't import (flattened to plain text)
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
  opts: { targetBookId?: number } = {}, // scoped import: nest under this existing book (no createBook)
): Promise<ImportSummary> {
  const bookIds = new Map<string, number>();
  const bookSlugById = new Map<number, string>(); // book id → slug, for building inter-page link URLs
  // Scoped import (plan from scopeToBook): the synthetic target key resolves to the existing book,
  // so no book is created and the importer needs only edit rights on that book.
  if (opts.targetBookId != null) bookIds.set(TARGET_BOOK_KEY, opts.targetBookId);
  const chapterIds = new Map<string, number>();
  let imagesUploaded = 0;
  let imagesMissing = 0;
  let filesUploaded = 0;
  let filesMissing = 0;
  const imageManifest: PageImageRecord[] = [];
  const failedPages: { page: string; reason: string }[] = [];
  const createdBooks: { id: number; name: string }[] = [];
  // Created pages, for the second pass that rewrites inter-page links once every page exists.
  const created: { sourceId: string; pageId: number; slug: string; bookId: number; md: string }[] = [];

  for (const b of plan.books) {
    const book = await client.createBook({ name: b.name, description: b.description });
    bookIds.set(b.key, book.id);
    bookSlugById.set(book.id, book.slug);
    createdBooks.push({ id: book.id, name: b.name });
    log(`  book:    ${b.name}`);
  }
  for (const c of plan.chapters) {
    const bookId = bookIds.get(c.bookKey);
    if (bookId === undefined) continue;
    chapterIds.set(c.key, await client.createChapter({ book_id: bookId, name: c.name }));
    log(`  chapter: ${c.name}`);
  }

  let pageCount = 0;
  // Circuit breaker: a single failed page is logged and skipped (resilient), but if pages keep
  // failing to CREATE in a row, BookStack has gone down — abort fast with a clear message instead of
  // grinding through hundreds of doomed pages. Image hiccups don't count (the page still got made).
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = Number(process.env.LETWRITES_IMPORT_FAIL_LIMIT ?? 8);
  for (const p of plan.pages) {
    let pageId: number | undefined;
    // BookStack rejects a body-less page (422 "markdown field is required"). Confluence "container"
    // pages — sections that only hold children — have empty content; give them a small placeholder so
    // they still import and keep the tree intact.
    const md = (p.markdown && p.markdown.trim()) ? p.markdown : '_(No content in Confluence — this page organizes its sub-pages.)_';
    let slug = '', createdBookId = 0;
    try {
      // Create the page first so images can be scoped to its id (uploaded_to).
      if (p.chapterKey && chapterIds.has(p.chapterKey)) {
        const pg = await client.createPage({ chapter_id: chapterIds.get(p.chapterKey)!, name: p.name, markdown: md });
        pageId = pg.id; slug = pg.slug; createdBookId = pg.book_id;
      } else {
        const bookId = bookIds.get(p.bookKey);
        if (bookId === undefined) throw new Error(`no book for ${p.key}`);
        const pg = await client.createPage({ book_id: bookId, name: p.name, markdown: md });
        pageId = pg.id; slug = pg.slug; createdBookId = pg.book_id;
      }
      pageCount++;
      consecutiveFailures = 0; // BookStack just accepted a page — it's responding

      // Upload local images into BookStack, rewrite refs, update the page.
      let finalMd = md;
      if (exportDir) {
        const r = await rewritePageImages({
          markdown: md, pageId, exportDir, sourcePath: p.sourcePath,
          uploader: client, exists: existsSync,
        });
        imagesUploaded += r.uploaded;
        imagesMissing += r.missing.length + r.failed.length;
        if (r.found || r.missing.length || r.failed.length) {
          imageManifest.push({ page: p.name, found: r.found, uploaded: r.uploadedRefs, missing: r.missing, failed: r.failed });
        }
        // Then upload any LINKED files (pdf/mp4/…) and repoint the links to BookStack download URLs.
        const rf = await rewritePageFiles({ markdown: r.markdown, pageId, exportDir, sourcePath: p.sourcePath, uploader: client, exists: existsSync });
        filesUploaded += rf.uploaded;
        filesMissing += rf.missing.length + rf.failed.length;
        if (rf.markdown !== md) { await client.updatePage(pageId, rf.markdown); finalMd = rf.markdown; }
        const imgNote = r.uploaded || r.missing.length || r.failed.length
          ? `  (${r.uploaded} img${r.missing.length ? `, ${r.missing.length} missing` : ''}${r.failed.length ? `, ${r.failed.length} failed` : ''})`
          : '';
        const fileNote = rf.uploaded || rf.missing.length || rf.failed.length
          ? `  (${rf.uploaded} file${rf.missing.length + rf.failed.length ? `, ${rf.missing.length + rf.failed.length} unresolved` : ''})`
          : '';
        log(`  page:    ${p.name}${imgNote}${fileNote}`);
      } else {
        log(`  page:    ${p.name}`);
      }
      created.push({ sourceId: p.key.replace(/^page:/, ''), pageId, slug, bookId: createdBookId, md: finalMd });
    } catch (e) {
      log(`  ! page failed: ${p.name} — ${(e as Error).message}`);
      // Only a page-CREATE failure (pageId never set) signals a real outage; image errors don't.
      if (pageId === undefined) {
        failedPages.push({ page: p.name, reason: (e as Error).message });
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          throw new Error(`BookStack stopped responding — aborted after ${consecutiveFailures} pages failed to create in a row (${pageCount} imported first). Fix BookStack, then DELETE the partially-imported book and re-run (re-importing into the same place would create duplicates).`);
        }
      }
    }
  }

  // Second pass: every page now exists, so rewrite inter-page links (lwpage:<id> markers) to real
  // BookStack page URLs. Index each page by its full source id AND its trailing Confluence numeric id,
  // so both relative-export links and absolute Confluence URLs resolve. Links to pages that did not
  // import degrade to plain text (better than a dead .html that 404s).
  const urlBySource = new Map<string, string>();
  for (const c of created) {
    let slug = bookSlugById.get(c.bookId);
    if (!slug) { try { slug = await client.getBookSlug(c.bookId); bookSlugById.set(c.bookId, slug); } catch { slug = ''; } }
    if (!slug || !c.slug) continue;
    const url = `/books/${slug}/page/${c.slug}`;
    urlBySource.set(c.sourceId, url);
    const num = /(?:^|_)(\d+)$/.exec(c.sourceId); // also index by the trailing Confluence page id
    if (num) urlBySource.set(num[1], url);
  }
  let linksRewritten = 0, linksBroken = 0;
  for (const c of created) {
    if (!c.md.includes('lwpage:')) continue;
    const rewritten = c.md.replace(/\[([^\]]*)\]\(lwpage:([^)]+)\)/g, (_full, txt, sid) => {
      const url = urlBySource.get(sid);
      if (url) { linksRewritten++; return `[${txt}](${url})`; }
      linksBroken++; return txt; // target not imported → keep the text, drop the dead link
    });
    if (rewritten !== c.md) { try { await client.updatePage(c.pageId, rewritten); } catch (e) { log(`  ! link rewrite failed for page ${c.pageId}: ${(e as Error).message}`); } }
  }
  if (linksRewritten || linksBroken) log(`  links: ${linksRewritten} rewritten to BookStack pages${linksBroken ? `, ${linksBroken} to non-imported pages flattened to text` : ''}`);

  return {
    books: plan.books.length, chapters: plan.chapters.length, pages: pageCount,
    flattened: plan.flattened.length, imagesUploaded, imagesMissing, filesUploaded, filesMissing, imageManifest, failedPages, createdBooks,
    linksRewritten, linksBroken,
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
