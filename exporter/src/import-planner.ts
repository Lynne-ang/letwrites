/**
 * Plans the import of an exported tree into BookStack (Letwrites's store).
 *
 * The hard part: Confluence has arbitrary page nesting; BookStack has a fixed
 * model — Book ▸ (Chapter ▸ Page | Page). We map it so NO page body is ever
 * lost, and we honestly report any nesting we had to flatten.
 *
 * Mapping rule:
 *   depth 0 (top-level page)            → a Book   (+ a Page for its own body)
 *   depth 1 with children               → a Chapter (+ a Page for its own body)
 *   depth 1 without children            → a Page directly in the Book
 *   depth ≥ 2                           → a Page in the nearest Chapter (else Book)
 *   depth > 2                           → flattened into that Chapter; original
 *                                         path kept as a title prefix + reported
 */

export interface ManifestPage {
  id: string;
  title: string;
  path: string;
  parentId: string | null;
  version: number;
}

export interface BookOp { key: string; name: string; description: string; }
export interface ChapterOp { key: string; bookKey: string; name: string; }
export interface PageOp {
  key: string;
  bookKey: string;
  chapterKey?: string;
  name: string;
  markdown: string;
  sourcePath: string;
}
export interface FlattenNote { pageTitle: string; note: string; }

export interface ImportPlan {
  books: BookOp[];
  chapters: ChapterOp[];
  pages: PageOp[];
  flattened: FlattenNote[];
}

export function planImport(
  pages: ManifestPage[],
  getMarkdown: (p: ManifestPage) => string,
): ImportPlan {
  const byId = new Map(pages.map((p) => [p.id, p]));
  const childCount = new Map<string, number>();
  for (const p of pages) {
    if (p.parentId) childCount.set(p.parentId, (childCount.get(p.parentId) ?? 0) + 1);
  }

  const depthCache = new Map<string, number>();
  const depthOf = (p: ManifestPage): number => {
    if (depthCache.has(p.id)) return depthCache.get(p.id)!;
    const d = p.parentId && byId.has(p.parentId) ? depthOf(byId.get(p.parentId)!) + 1 : 0;
    depthCache.set(p.id, d);
    return d;
  };
  const ancestorAtDepth = (p: ManifestPage, target: number): ManifestPage => {
    let cur = p;
    while (depthOf(cur) > target && cur.parentId && byId.has(cur.parentId)) cur = byId.get(cur.parentId)!;
    return cur;
  };
  const topAncestor = (p: ManifestPage) => ancestorAtDepth(p, 0);
  const breadcrumb = (p: ManifestPage): string => {
    const parts: string[] = [];
    let cur: ManifestPage | undefined = p.parentId ? byId.get(p.parentId) : undefined;
    while (cur && depthOf(cur) >= 1) {
      parts.unshift(cur.title);
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(' / ');
  };

  const plan: ImportPlan = { books: [], chapters: [], pages: [], flattened: [] };
  const seenBooks = new Set<string>();
  const seenChapters = new Set<string>();

  // Create books/chapters before the pages that reference them.
  const sorted = [...pages].sort((a, b) => depthOf(a) - depthOf(b));

  for (const p of sorted) {
    const d = depthOf(p);
    const bookHost = topAncestor(p);
    const bookKey = `book:${bookHost.id}`;
    if (!seenBooks.has(bookKey)) {
      plan.books.push({ key: bookKey, name: bookHost.title, description: 'Migrated from Confluence by Letwrites.' });
      seenBooks.add(bookKey);
    }

    // Does this page live under a chapter? Chapters come from depth-1 pages that
    // have children.
    let chapterKey: string | undefined;
    if (d >= 1) {
      const chapterHost = ancestorAtDepth(p, 1);
      if ((childCount.get(chapterHost.id) ?? 0) > 0) {
        chapterKey = `chapter:${chapterHost.id}`;
        if (!seenChapters.has(chapterKey)) {
          plan.chapters.push({ key: chapterKey, bookKey: `book:${topAncestor(chapterHost).id}`, name: chapterHost.title });
          seenChapters.add(chapterKey);
        }
      }
    }

    let name = p.title;
    if (d > 2) {
      name = `${breadcrumb(p)} / ${p.title}`;
      plan.flattened.push({ pageTitle: p.title, note: `was nested ${d} levels deep; flattened into chapter, original path kept in title` });
    }

    plan.pages.push({
      key: `page:${p.id}`,
      bookKey,
      chapterKey,
      name,
      markdown: getMarkdown(p),
      sourcePath: p.path,
    });
  }

  return plan;
}

/** Strip YAML front-matter the exporter added, leaving body Markdown. */
export function stripFrontMatter(md: string): string {
  if (md.startsWith('---')) {
    const end = md.indexOf('\n---', 3);
    if (end !== -1) {
      const nl = md.indexOf('\n', end + 1);
      return nl !== -1 ? md.slice(nl + 1).replace(/^\n+/, '') : '';
    }
  }
  return md;
}
