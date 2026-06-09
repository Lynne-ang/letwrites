#!/usr/bin/env node
import { exportSpace } from './exporter.js';
import { SampleSource } from './sample/space.js';
import { generatePreview } from './preview.js';
import type { ConfluenceConfig } from './types.js';

/**
 * Credential-free demo: converts the bundled sample Confluence space and writes
 * a clickable preview. This is the "Confluence → Letwrites" example you can show
 * with nothing else running.
 *
 *   npm run demo            → writes ./demo-export/ + preview.html
 *   npm run demo -- ./out   → custom output dir
 */
async function main() {
  const outDir = process.argv[2] ?? './demo-export';
  const config: ConfluenceConfig = {
    baseUrl: 'sample://local',
    apiToken: 'n/a',
    spaceKey: 'ENG',
    outDir,
  };

  console.log('Letwrites — Confluence → Letwrites export demo (sample space, no credentials)\n');
  const summary = await exportSpace(config, new SampleSource());
  const preview = await generatePreview(outDir);

  console.log(`\n  pages:       ${summary.pagesExported}`);
  console.log(`  attachments: ${summary.attachmentsDownloaded}`);
  console.log(`  flagged:     ${summary.unconvertedCount}  (see ${outDir}/migration-report.md)`);
  console.log(`\n  Markdown tree:  ${outDir}/`);
  console.log(`  Clickable view: ${preview}`);
  console.log(`\n  Open it:  open ${preview}`);
}

main().catch((e) => {
  console.error(`Demo failed: ${e.message}`);
  process.exit(1);
});
