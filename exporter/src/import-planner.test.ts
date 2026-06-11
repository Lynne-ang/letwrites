import { describe, it, expect } from 'vitest';
import { planImport, scopeToBook, TARGET_BOOK_KEY, stripFrontMatter, type ManifestPage } from './import-planner.js';

// Mirrors the sample space hierarchy:
//   Engineering Handbook (1)
//     ├─ Onboarding (2)  ─ Dev Environment Setup (3)
//     ├─ Runbooks (4)    ─ API Service Runbook (5)
//     └─ Architecture (6)  [no children]
const pages: ManifestPage[] = [
  { id: '1', title: 'Engineering Handbook', path: 'engineering-handbook.md', parentId: null, version: 1 },
  { id: '2', title: 'Onboarding', path: 'engineering-handbook/onboarding.md', parentId: '1', version: 1 },
  { id: '3', title: 'Dev Environment Setup', path: 'engineering-handbook/onboarding/dev-environment-setup.md', parentId: '2', version: 1 },
  { id: '4', title: 'Runbooks', path: 'engineering-handbook/runbooks.md', parentId: '1', version: 1 },
  { id: '5', title: 'API Service Runbook', path: 'engineering-handbook/runbooks/api-service-runbook.md', parentId: '4', version: 1 },
  { id: '6', title: 'Architecture', path: 'engineering-handbook/architecture.md', parentId: '1', version: 1 },
];
const md = (p: ManifestPage) => `# ${p.title}\n\nbody`;

describe('planImport — Confluence tree → BookStack model', () => {
  const plan = planImport(pages, md);

  it('creates one book from the top-level page', () => {
    expect(plan.books).toHaveLength(1);
    expect(plan.books[0]).toMatchObject({ key: 'book:1', name: 'Engineering Handbook' });
  });

  it('creates chapters only for depth-1 pages that have children', () => {
    const names = plan.chapters.map((c) => c.name).sort();
    expect(names).toEqual(['Onboarding', 'Runbooks']); // Architecture has no children → no chapter
    expect(plan.chapters.every((c) => c.bookKey === 'book:1')).toBe(true);
  });

  it('keeps a page (with body) for every Confluence page — nothing dropped', () => {
    expect(plan.pages).toHaveLength(6);
    expect(plan.pages.every((p) => p.markdown.includes('body'))).toBe(true);
  });

  it('places deep pages in their chapter, shallow leaf pages in the book', () => {
    const devSetup = plan.pages.find((p) => p.key === 'page:3')!;
    expect(devSetup.chapterKey).toBe('chapter:2'); // under Onboarding chapter
    const architecture = plan.pages.find((p) => p.key === 'page:6')!;
    expect(architecture.chapterKey).toBeUndefined(); // leaf depth-1 → directly in book
    expect(architecture.bookKey).toBe('book:1');
  });

  it('flattens nothing for a 3-level tree', () => {
    expect(plan.flattened).toHaveLength(0);
  });

  it('flattens and reports pages nested deeper than chapter level', () => {
    const deep: ManifestPage[] = [
      ...pages,
      { id: '7', title: 'Deep Note', path: 'x.md', parentId: '3', version: 1 }, // depth 3
    ];
    const p = planImport(deep, md);
    expect(p.flattened).toHaveLength(1);
    const deepPage = p.pages.find((x) => x.key === 'page:7')!;
    expect(deepPage.chapterKey).toBe('chapter:2');         // pulled into nearest chapter
    expect(deepPage.name).toContain('Dev Environment Setup'); // breadcrumb preserved in title
  });
});

describe('scopeToBook — import under an existing book (non-admin editor path)', () => {
  const scoped = scopeToBook(planImport(pages, md));

  it('creates NO new books (so no Create-Books permission is needed)', () => {
    expect(scoped.books).toHaveLength(0);
  });

  it('turns each source book into a chapter under the target book', () => {
    expect(scoped.chapters.some((c) => c.name === 'Engineering Handbook' && c.bookKey === TARGET_BOOK_KEY)).toBe(true);
    expect(scoped.chapters.every((c) => c.bookKey === TARGET_BOOK_KEY)).toBe(true);
  });

  it('keeps every page, all nested under the target book, and loses none', () => {
    expect(scoped.pages).toHaveLength(6);
    expect(scoped.pages.every((p) => p.bookKey === TARGET_BOOK_KEY)).toBe(true);
    expect(scoped.pages.every((p) => p.chapterKey)).toBe(true); // each page lands in a chapter under the target
  });

  it('reports the flattened nesting honestly', () => {
    // the source book had its own chapters (Onboarding, Runbooks) → flattened one level, noted
    expect(scoped.flattened.length).toBeGreaterThan(0);
    expect(scoped.flattened.some((f) => /flattened under the target book/.test(f.note))).toBe(true);
  });
});

describe('stripFrontMatter', () => {
  it('removes the YAML block the exporter adds', () => {
    const body = stripFrontMatter('---\ntitle: "X"\nversion: 1\n---\n\n# X\n\nhi');
    expect(body.startsWith('# X')).toBe(true);
    expect(body).not.toContain('title:');
  });
  it('leaves plain markdown untouched', () => {
    expect(stripFrontMatter('# X\n\nhi')).toBe('# X\n\nhi');
  });
});
