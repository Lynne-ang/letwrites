import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ConfluenceClient } from './confluence-client.js';
import { convertStorageToMarkdown } from './converter.js';
import { buildPathMap, buildTitleIndex, relativeLink, renderUnconvertedReport } from './manifest.js';
import type { ConfluenceConfig, ConvertContext, ExportSummary, PageSource, UnconvertedItem } from './types.js';

/**
 * Orchestrates a full space export:
 *
 *   verify ──▶ fetch pages ──▶ build path map ──▶ for each page:
 *                                                   convert + write .md
 *                                                   download attachments
 *           ──▶ write manifest.json + migration-report.md
 *
 * Errors on a single page/attachment are recorded, not fatal — one bad page
 * shouldn't sink a 2000-page migration.
 */
export async function exportSpace(
  config: ConfluenceConfig,
  source: PageSource = new ConfluenceClient(config),
  log: (msg: string) => void = console.log,
): Promise<ExportSummary> {
  const client = source;

  const spaceName = await client.verifySpace();
  log(`Connected. Exporting space "${spaceName}" (${config.spaceKey}) → ${config.outDir}`);

  const pages = await client.fetchAllPages();
  log(`Fetched ${pages.length} pages. Building layout…`);

  const pathMap = buildPathMap(pages);
  const titleIndex = buildTitleIndex(pages);

  const allUnconverted: UnconvertedItem[] = [];
  let attachmentsDownloaded = 0;

  for (const page of pages) {
    const entry = pathMap.get(page.id)!;
    const fileAbs = join(config.outDir, entry.relPath);
    const slug = entry.segments[entry.segments.length - 1];
    const attachmentsRelDir = `${slug}.attachments`;

    const ctx: ConvertContext = {
      pageId: page.id,
      pageTitle: page.title,
      attachmentsRelDir,
      resolvePageLink: ({ id, title }) => {
        const targetId = id ?? (title ? titleIndex.get(title.toLowerCase()) : undefined);
        if (!targetId) return null;
        const target = pathMap.get(targetId);
        return target ? relativeLink(entry.relPath, target.relPath) : null;
      },
    };

    const { markdown, unconverted } = convertStorageToMarkdown(page.storageBody, ctx);
    allUnconverted.push(...unconverted);

    const frontMatter =
      `---\n` +
      `title: ${JSON.stringify(page.title)}\n` +
      `confluence_id: "${page.id}"\n` +
      `version: ${page.version}\n` +
      `---\n\n`;

    await mkdir(dirname(fileAbs), { recursive: true });
    await writeFile(fileAbs, frontMatter + `# ${page.title}\n\n` + markdown, 'utf8');

    // Attachments → <page-dir>/<slug>.attachments/<filename>
    try {
      const attachments = await client.fetchAttachments(page.id);
      if (attachments.length) {
        const attDirAbs = join(dirname(fileAbs), attachmentsRelDir);
        await mkdir(attDirAbs, { recursive: true });
        for (const att of attachments) {
          try {
            const bytes = await client.downloadAttachment(att.downloadPath);
            await writeFile(join(attDirAbs, att.fileName), bytes);
            attachmentsDownloaded++;
          } catch (e) {
            allUnconverted.push({
              pageId: page.id, pageTitle: page.title, kind: 'attachment',
              name: att.fileName, note: `download failed: ${(e as Error).message}`,
            });
          }
        }
      }
    } catch (e) {
      log(`  ! attachments for "${page.title}" failed: ${(e as Error).message}`);
    }

    log(`  ✓ ${entry.relPath}${unconverted.length ? `  (${unconverted.length} flagged)` : ''}`);
  }

  // Manifest: machine-readable map of id → path + version, for re-runs / bridge mode.
  const manifest = {
    space: config.spaceKey,
    exportedAt: new Date().toISOString(),
    pageCount: pages.length,
    pages: [...pathMap.values()].map((e) => ({
      id: e.page.id,
      title: e.page.title,
      path: e.relPath,
      parentId: e.page.parentId,
      version: e.page.version,
    })),
  };
  await writeFile(join(config.outDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  await writeFile(
    join(config.outDir, 'migration-report.md'),
    renderUnconvertedReport(allUnconverted, config.spaceKey),
    'utf8',
  );

  return {
    spaceKey: config.spaceKey,
    pagesExported: pages.length,
    attachmentsDownloaded,
    unconvertedCount: allUnconverted.length,
    outDir: config.outDir,
  };
}
