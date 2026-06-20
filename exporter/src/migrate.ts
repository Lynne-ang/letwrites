#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exportSpace } from './exporter.js';
import { generatePreview } from './preview.js';
import { planImport, stripFrontMatter, type ManifestPage } from './import-planner.js';
import { runImport } from './importer.js';
import { buildIntegrityReport, renderIntegrityReport } from './integrity.js';
import { BookStackImportClient } from './bookstack-import-client.js';
import { oauthBaseUrl } from './confluence-oauth.js';
import type { ConfluenceConfig } from './types.js';

/**
 * ONE command: Confluence space → export/convert → import into Letwrites.
 *
 *   CONFLUENCE_BASE_URL=https://acme.atlassian.net/wiki \
 *   CONFLUENCE_EMAIL=you@acme.com CONFLUENCE_API_TOKEN=… \
 *   BOOKSTACK_URL=https://docs.acme.com \
 *   BOOKSTACK_TOKEN_ID=… BOOKSTACK_TOKEN_SECRET=… \
 *     npm run migrate -- --space ENG
 *
 * Add --dry-run to export + preview only (no import) — useful to review the
 * migration report before touching Letwrites.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const outDir = arg('out') ?? './migration';

  // AUTOMATED path: OAuth Bearer token (carries read:attachment scope → images come
  // across with no manual HTML export). Falls back to Basic auth (email + API token).
  const oauthToken = process.env.CONFLUENCE_OAUTH_TOKEN;
  const cloudId = process.env.CONFLUENCE_CLOUD_ID;
  const useOAuth = Boolean(oauthToken && cloudId);

  const config: ConfluenceConfig = useOAuth
    ? { baseUrl: oauthBaseUrl(cloudId!), apiToken: oauthToken!, spaceKey: arg('space') ?? '', outDir } // no email ⇒ Bearer
    : {
        baseUrl: process.env.CONFLUENCE_BASE_URL ?? '',
        email: process.env.CONFLUENCE_EMAIL,
        apiToken: process.env.CONFLUENCE_API_TOKEN ?? '',
        spaceKey: arg('space') ?? '',
        outDir,
      };
  if (useOAuth) console.log('Auth: OAuth (Bearer) — automated, images included.');
  const missing = [
    !config.baseUrl && (useOAuth ? 'CONFLUENCE_CLOUD_ID' : 'CONFLUENCE_BASE_URL'),
    !config.apiToken && (useOAuth ? 'CONFLUENCE_OAUTH_TOKEN' : 'CONFLUENCE_API_TOKEN'),
    !config.spaceKey && '--space',
  ].filter(Boolean);
  if (missing.length) {
    console.error(`Missing: ${missing.join(', ')}\nRun with --help via the README. Example:\n` +
      `  CONFLUENCE_BASE_URL=… CONFLUENCE_API_TOKEN=… npm run migrate -- --space ENG --dry-run`);
    process.exit(1);
  }

  // 1) Export + convert from Confluence
  console.log(`\n[1/3] Exporting Confluence space "${config.spaceKey}" → ${outDir}`);
  const summary = await exportSpace(config);
  const preview = await generatePreview(outDir);
  console.log(`      ${summary.pagesExported} pages, ${summary.attachmentsDownloaded} attachments, ` +
    `${summary.unconvertedCount} flagged. Preview: ${preview}`);
  console.log(`      Review what needs a human: ${outDir}/migration-report.md`);

  if (dryRun) {
    console.log(`\n[dry-run] Stopped before import. Review the preview + report, then re-run without --dry-run.`);
    return;
  }

  // 2) Build the import plan
  console.log(`\n[2/3] Planning import into Letwrites (BookStack)`);
  const manifest = JSON.parse(await readFile(join(outDir, 'manifest.json'), 'utf8')) as { pages: ManifestPage[] };
  const md = new Map<string, string>();
  // Track pages whose exported file can't be read — do NOT silently substitute '' (that hides a
  // dropped page: the planner would still import it empty and counts would line up). These feed the
  // integrity report so the verdict is INCOMPLETE instead of a false COMPLETE.
  const readFailures: { page: string; reason: string }[] = [];
  for (const p of manifest.pages) {
    try { md.set(p.id, stripFrontMatter(await readFile(join(outDir, p.path), 'utf8'))); }
    catch (e) { readFailures.push({ page: p.title || p.id, reason: `export file unreadable: ${(e as Error).message}` }); }
  }
  const plan = planImport(manifest.pages, (p) => md.get(p.id) ?? '');

  // 3) Import (requires Letwrites/BookStack creds)
  const creds = {
    baseUrl: process.env.BOOKSTACK_URL ?? '',
    tokenId: process.env.BOOKSTACK_TOKEN_ID ?? '',
    tokenSecret: process.env.BOOKSTACK_TOKEN_SECRET ?? '',
  };
  if (!creds.baseUrl || !creds.tokenId || !creds.tokenSecret) {
    console.error(`\nExport done, but import needs a Letwrites instance:\n` +
      `  set BOOKSTACK_URL + BOOKSTACK_TOKEN_ID + BOOKSTACK_TOKEN_SECRET and re-run,\n` +
      `  or import later: npm run import -- --in ${outDir}`);
    process.exit(1);
  }
  const client = new BookStackImportClient(creds);
  if (!(await client.verify())) {
    console.error(`\nCould not reach/authenticate Letwrites at ${creds.baseUrl}. Check the URL + API token.`);
    process.exit(1);
  }
  console.log(`\n[3/3] Importing into ${creds.baseUrl}`);
  const r = await runImport(plan, client, console.log, outDir);
  console.log(`\nDone. ${r.books} books, ${r.chapters} chapters, ${r.pages} pages, ${r.imagesUploaded} images.`);

  // INTEGRITY GATE: the one-command path MUST prove nothing was silently lost. Build the same signed
  // report the `import` CLI produces, compare against the SOURCE page count, fold in unreadable pages,
  // write it next to the export, and EXIT NON-ZERO on INCOMPLETE so a broken migration can't look clean.
  const report = buildIntegrityReport({
    plan,
    pagesImported: r.pages,
    imageManifest: r.imageManifest,
    source: `Confluence export → ${creds.baseUrl}`,
    sourceBaseline: { pages: manifest.pages.length },
    failedPageDetails: [...readFailures, ...r.failedPages],
  });
  const text = renderIntegrityReport(report);
  console.log('\n' + text);
  const reportPath = join(outDir, 'migration-report.md');
  await writeFile(reportPath, text);
  await writeFile(join(outDir, 'migration-report.json'), JSON.stringify(report, null, 2));
  console.log(`\nIntegrity report → ${reportPath}`);
  if (report.verdict !== 'COMPLETE') {
    console.error(`\nMIGRATION INCOMPLETE — some content did not transfer cleanly. See ${reportPath} (page/image gaps listed). Nothing was deleted at the source; fix the gaps and re-run.`);
    process.exit(2);
  }
  console.log(`\nMigration verified COMPLETE. Open ${creds.baseUrl} to see your wiki.`);
}

main().catch((e) => { console.error(`migrate failed: ${e.message}`); process.exit(1); });
