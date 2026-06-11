#!/usr/bin/env node
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { scopeToBook } from './import-planner.js';
import { loadPlanFromDir } from './load-plan.js';
import { renderPlanTree, runImport } from './importer.js';
import { BookStackImportClient } from './bookstack-import-client.js';
import { ingestConfluenceHtmlExport } from './confluence-html-export.js';
import { ingestConfluenceWordExport } from './confluence-word.js';
import { buildIntegrityReport, renderIntegrityReport } from './integrity.js';

/**
 * Import an exported tree into BookStack (Letwrites's store).
 *
 *   # see the plan without touching BookStack (great for a demo):
 *   letwrites-import --in ./demo-export --dry-run
 *
 *   # actually import into a running BookStack:
 *   BOOKSTACK_URL=http://localhost:6875 \
 *   BOOKSTACK_TOKEN_ID=… BOOKSTACK_TOKEN_SECRET=… \
 *   letwrites-import --in ./demo-export
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const loadPlan = loadPlanFromDir;

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`letwrites-import — import an exported tree into BookStack (Letwrites)

  --in <DIR>                     export directory (with manifest.json), e.g. ./demo-export
  --from-confluence-export <DIR> ingest an unzipped Confluence "Export space → HTML" bundle first
  --from-confluence-word <FILE>  ingest a Confluence "Export → Word" .doc (images embedded; no admin needed)
  --dry-run                      print the BookStack plan, don't call the API
  --into-book <ID>               import UNDER an existing book (no new top-level books). Use this when
                                 you are a team editor without "Create Books" rights: pass a book you
                                 can edit and your team's space nests inside it.
  --integrity-out <FILE>         where to write the migration-integrity report (default: <in>/integrity-report.txt)

Live import needs (flags or env):
  --base <URL>          / BOOKSTACK_URL
  --token-id <ID>       / BOOKSTACK_TOKEN_ID
  --token-secret <SEC>  / BOOKSTACK_TOKEN_SECRET`);
    return;
  }

  // Optional: turn a Confluence HTML-export bundle or a Word (.doc) export into the standard tree first.
  const fromConf = arg('from-confluence-export');
  const fromWord = arg('from-confluence-word');
  let inDir = arg('in') ?? './demo-export';
  // Source-side baseline for the integrity report (so COMPLETE compares against the source, not the output).
  let sourceBaseline: { pages?: number; images?: number } | undefined;
  if (fromWord) {
    inDir = arg('in') ?? './letwrites-export';
    const r = ingestConfluenceWordExport(fromWord, inDir);
    sourceBaseline = { pages: r.pages, images: r.imgTags };
    console.log(`Ingested Confluence Word export: ${r.pages} page, ${r.imagesExtracted}/${r.imgTags} referenced images decoded → ${inDir}\n`);
    if (r.imgTags > r.imagesExtracted) {
      console.log(`  ⚠️  ${r.imgTags - r.imagesExtracted} referenced image(s) had no embedded data — the integrity report will flag them as not moved (see its image gaps), so the verdict will be INCOMPLETE.\n`);
    }
  } else if (fromConf) {
    inDir = arg('in') ?? './letwrites-export';
    const r = ingestConfluenceHtmlExport(fromConf, inDir);
    sourceBaseline = { pages: r.sourcePages, images: r.sourceImages };
    console.log(`Ingested Confluence HTML export: ${r.pages} pages, ${r.imagesReferenced} images referenced, ${r.attachmentsCopied} attachment files copied → ${inDir}\n`);
  }
  let plan = await loadPlan(inDir);

  // Scoped import: nest everything under an existing book so a non-admin editor can migrate.
  const intoBook = arg('into-book');
  let targetBookId: number | undefined;
  if (intoBook) {
    targetBookId = Number(intoBook);
    if (!Number.isInteger(targetBookId) || targetBookId <= 0) { console.error('--into-book needs a numeric BookStack book id, e.g. --into-book 12'); process.exit(1); }
    plan = scopeToBook(plan);
    console.log(`Scoped import: nesting everything under existing book #${targetBookId} — no new top-level books, so a team editor who can edit that book can run this without admin rights.\n`);
  }

  if (process.argv.includes('--dry-run')) {
    console.log(`Import plan for ${inDir} → BookStack:\n`);
    console.log(renderPlanTree(plan));
    console.log(`\n  ${plan.books.length} book(s), ${plan.chapters.length} chapter(s), ${plan.pages.length} page(s), ${plan.flattened.length} flattened.`);
    console.log(`\n  (dry run — nothing written. Drop --dry-run with BookStack creds to import.)`);
    return;
  }

  const creds = {
    baseUrl: arg('base') ?? process.env.BOOKSTACK_URL ?? '',
    tokenId: arg('token-id') ?? process.env.BOOKSTACK_TOKEN_ID ?? '',
    tokenSecret: arg('token-secret') ?? process.env.BOOKSTACK_TOKEN_SECRET ?? '',
  };
  if (!creds.baseUrl || !creds.tokenId || !creds.tokenSecret) {
    console.error('Missing BookStack creds (--base/--token-id/--token-secret or env). Use --dry-run to preview without them.');
    process.exit(1);
  }

  const client = new BookStackImportClient(creds);
  if (!(await client.verify())) {
    console.error(`Could not reach/authenticate BookStack at ${creds.baseUrl}. Check URL + token.`);
    process.exit(1);
  }

  console.log(`Importing ${inDir} → ${creds.baseUrl}\n`);
  const summary = await runImport(plan, client, console.log, inDir, { targetBookId }); // inDir → upload local images
  console.log(
    `\nDone: ${summary.books} books, ${summary.chapters} chapters, ${summary.pages} pages, ` +
    `${summary.imagesUploaded} images uploaded` +
    (summary.imagesMissing ? `, ${summary.imagesMissing} images missing/failed` : '') +
    (summary.flattened ? `, ${summary.flattened} flattened` : '') + '.',
  );

  // The trust product: a verifiable "nothing was lost" report (source reconciled vs imported).
  const report = buildIntegrityReport({
    plan, pagesImported: summary.pages, imageManifest: summary.imageManifest,
    source: fromWord ? `Confluence Word export (${fromWord})` : fromConf ? `Confluence HTML export (${fromConf})` : inDir,
    sourceBaseline,
    failedPageDetails: summary.failedPages,
    links: { rewritten: summary.linksRewritten, broken: summary.linksBroken },
    files: { uploaded: summary.filesUploaded, missing: summary.filesMissing },
  });
  console.log('\n' + renderIntegrityReport(report));
  const outTxt = arg('integrity-out') ?? join(inDir, 'integrity-report.txt');
  await writeFile(outTxt, renderIntegrityReport(report));
  await writeFile(outTxt.replace(/\.txt$/, '') + '.json', JSON.stringify(report, null, 2));
  console.log(`\nIntegrity report written: ${outTxt}`);
}

main().catch((e) => {
  console.error(`Import failed: ${e.message}`);
  process.exit(1);
});
