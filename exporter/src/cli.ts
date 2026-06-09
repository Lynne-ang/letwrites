#!/usr/bin/env node
import { exportSpace } from './exporter.js';
import type { ConfluenceConfig } from './types.js';

/**
 * Letwrites Confluence exporter CLI.
 *
 * Config comes from flags or env vars (env is friendlier for tokens):
 *   CONFLUENCE_BASE_URL   e.g. https://your-org.atlassian.net/wiki
 *   CONFLUENCE_EMAIL      Atlassian account email (Cloud)
 *   CONFLUENCE_API_TOKEN  API token / PAT
 *
 * Usage:
 *   letwrites-export --space ENG --out ./export
 *   CONFLUENCE_API_TOKEN=… letwrites-export --space ENG --out ./export --base https://x.atlassian.net/wiki --email me@x.com
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`letwrites-export — export a Confluence space to portable Markdown

Required:
  --space <KEY>            Confluence space key (e.g. ENG)
  --base <URL>             Wiki base URL, or env CONFLUENCE_BASE_URL
  --api-token <TOKEN>      API token, or env CONFLUENCE_API_TOKEN

Optional:
  --email <EMAIL>          Atlassian email (Cloud Basic auth), or env CONFLUENCE_EMAIL
  --out <DIR>              Output directory (default ./export)
  --page-size <N>          API batch size (default 50)

Output:
  <out>/**/*.md            Pages, hierarchy preserved, front-matter + re-pointed links
  <out>/**/*.attachments/  Per-page attachments
  <out>/manifest.json      id → path map (for re-runs / bridge mode)
  <out>/migration-report.md  Exactly what couldn't be auto-converted`);
    return;
  }

  const config: ConfluenceConfig = {
    baseUrl: arg('base') ?? process.env.CONFLUENCE_BASE_URL ?? '',
    email: arg('email') ?? process.env.CONFLUENCE_EMAIL,
    apiToken: arg('api-token') ?? process.env.CONFLUENCE_API_TOKEN ?? '',
    spaceKey: arg('space') ?? '',
    outDir: arg('out') ?? './export',
    pageSize: arg('page-size') ? Number(arg('page-size')) : undefined,
  };

  const missing: string[] = [];
  if (!config.baseUrl) missing.push('--base / CONFLUENCE_BASE_URL');
  if (!config.apiToken) missing.push('--api-token / CONFLUENCE_API_TOKEN');
  if (!config.spaceKey) missing.push('--space');
  if (missing.length) {
    console.error(`Missing required config:\n  ${missing.join('\n  ')}\n\nRun with --help for usage.`);
    process.exit(1);
  }

  const t0 = Date.now();
  const summary = await exportSpace(config);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nDone in ${secs}s`);
  console.log(`  pages:       ${summary.pagesExported}`);
  console.log(`  attachments: ${summary.attachmentsDownloaded}`);
  console.log(`  flagged:     ${summary.unconvertedCount}  → see ${summary.outDir}/migration-report.md`);
}

main().catch((e) => {
  console.error(`\nExport failed: ${e.message}`);
  process.exit(1);
});
