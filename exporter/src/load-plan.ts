import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planImport, stripFrontMatter, type ImportPlan, type ManifestPage } from './import-planner.js';

/**
 * Read an exported tree (manifest.json + page .md files) on disk and build an ImportPlan.
 * Shared by the CLI and the self-service web import server so both run the identical plan.
 */
export async function loadPlanFromDir(inDir: string): Promise<ImportPlan> {
  const manifest = JSON.parse(await readFile(join(inDir, 'manifest.json'), 'utf8')) as { pages: ManifestPage[] };
  const cache = new Map<string, string>();
  for (const p of manifest.pages) {
    const raw = await readFile(join(inDir, p.path), 'utf8').catch(() => '');
    cache.set(p.id, stripFrontMatter(raw));
  }
  return planImport(manifest.pages, (p) => cache.get(p.id) ?? '');
}
