import type { ConfluencePage, PathEntry, UnconvertedItem } from './types.js';

/**
 * Builds the output layout from the flat page list + parent pointers:
 *
 *   pages[] (each with parentId)  ──▶  tree  ──▶  slugified relative paths
 *
 * The path map is also the link-resolution table: an internal Confluence link
 * (by page title) is re-pointed to the target's relative .md path so links
 * survive the migration instead of 404-ing.
 */
export function buildPathMap(pages: ConfluencePage[]): Map<string, PathEntry> {
  const byId = new Map<string, ConfluencePage>();
  for (const p of pages) byId.set(p.id, p);

  const segmentsCache = new Map<string, string[]>();
  const usedPaths = new Set<string>();

  const segmentsFor = (page: ConfluencePage): string[] => {
    if (segmentsCache.has(page.id)) return segmentsCache.get(page.id)!;
    const slug = slugify(page.title);
    const parent = page.parentId ? byId.get(page.parentId) : undefined;
    const segs = parent ? [...segmentsFor(parent), slug] : [slug];
    segmentsCache.set(page.id, segs);
    return segs;
  };

  const map = new Map<string, PathEntry>();
  for (const page of pages) {
    const segments = segmentsFor(page);
    let relPath = segments.join('/') + '.md';
    // Disambiguate collisions (duplicate titles under same parent) by id suffix.
    if (usedPaths.has(relPath.toLowerCase())) {
      relPath = segments.join('/') + `-${page.id}.md`;
    }
    usedPaths.add(relPath.toLowerCase());
    map.set(page.id, { page, segments, relPath });
  }
  return map;
}

/** Title -> pageId index for resolving ac:link references by content title. */
export function buildTitleIndex(pages: ConfluencePage[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const p of pages) idx.set(p.title.toLowerCase(), p.id);
  return idx;
}

/** Relative link from one page's file to another's, both relative to outDir. */
export function relativeLink(fromRel: string, toRel: string): string {
  const fromDirs = fromRel.split('/').slice(0, -1);
  const toDirs = toRel.split('/');
  let i = 0;
  while (i < fromDirs.length && i < toDirs.length - 1 && fromDirs[i] === toDirs[i]) i++;
  const up = fromDirs.length - i;
  const prefix = up > 0 ? '../'.repeat(up) : './';
  return prefix + toDirs.slice(i).join('/');
}

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'untitled'
  );
}

/** Render the honest "what didn't convert" report grouped by page. */
export function renderUnconvertedReport(items: UnconvertedItem[], spaceKey: string): string {
  const lines: string[] = [
    `# Migration report — space ${spaceKey}`,
    '',
    items.length === 0
      ? '✅ Everything converted cleanly. No manual review needed.'
      : `⚠️ ${items.length} item(s) need manual review. Each is listed below with the page it came from.`,
    '',
  ];
  if (items.length === 0) return lines.join('\n') + '\n';

  const byPage = new Map<string, UnconvertedItem[]>();
  for (const it of items) {
    const key = `${it.pageTitle} (id ${it.pageId})`;
    (byPage.get(key) ?? byPage.set(key, []).get(key)!).push(it);
  }

  // Summary table of macro/issue frequency — tells you the bulk-fix targets.
  const freq = new Map<string, number>();
  for (const it of items) freq.set(`${it.kind}:${it.name}`, (freq.get(`${it.kind}:${it.name}`) ?? 0) + 1);
  lines.push('## Most common issues', '', '| Count | Kind | Name |', '|------:|------|------|');
  [...freq.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, n]) => {
    const [kind, name] = k.split(':');
    lines.push(`| ${n} | ${kind} | \`${name}\` |`);
  });
  lines.push('');

  lines.push('## By page', '');
  for (const [page, its] of byPage) {
    lines.push(`### ${page}`, '');
    for (const it of its) lines.push(`- **${it.kind}** \`${it.name}\` — ${it.note}`);
    lines.push('');
  }
  return lines.join('\n') + '\n';
}
