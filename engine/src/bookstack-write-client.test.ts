import { describe, it, expect, vi, afterEach } from 'vitest';
import { BookStackWriteClient } from './bookstack-write-client.js';
import { BookStackAuthz } from './bookstack-authz-client.js';

function mockFetch(routes: (url: string, init: any) => { status?: number; json: any }) {
  return vi.fn(async (url: string, init: any = {}) => {
    const r = routes(url, init);
    return { ok: (r.status ?? 200) < 400, status: r.status ?? 200, json: async () => r.json, text: async () => JSON.stringify(r.json) } as any;
  });
}
afterEach(() => vi.restoreAllMocks());

describe('BookStackWriteClient', () => {
  it('resolves a book by name and finds an existing page (real API shapes)', async () => {
    globalThis.fetch = mockFetch((url) => {
      if (url.includes('/api/books')) return { json: { data: [{ id: 7, slug: 'project-atlas', name: 'Project Atlas' }] } };
      if (url.includes('/api/pages')) return { json: { data: [{ id: 42, slug: 'runbook', name: 'Runbook', book_id: 7 }] } };
      return { json: {} };
    });
    const w = new BookStackWriteClient('https://docs.acme.com', 'id', 'sec');
    expect(await w.findBook('project atlas')).toEqual({ id: 7, slug: 'project-atlas', name: 'Project Atlas' });
    expect((await w.findPage(7, 'Runbook'))?.id).toBe(42);
    expect(await w.findPage(7, 'Nonexistent')).toBeNull();
  });

  it('creates a page with chapter_id or book_id and builds the page URL', async () => {
    const seen: any = {};
    globalThis.fetch = mockFetch((url, init) => {
      if (init.method === 'POST' && url.endsWith('/api/pages')) { seen.body = JSON.parse(init.body); return { json: { id: 99, slug: 'new-page', name: 'New', book_id: 7 } }; }
      return { json: {} };
    });
    const w = new BookStackWriteClient('https://docs.acme.com', 'id', 'sec');
    const page = await w.createPage({ bookId: 7, chapterId: 3 }, 'New', '# body');
    expect(seen.body).toEqual({ name: 'New', markdown: '# body', chapter_id: 3 }); // chapter wins over book
    expect(w.pageUrl({ id: 7, slug: 'project-atlas', name: 'Project Atlas' }, page)).toBe('https://docs.acme.com/books/project-atlas/page/new-page');
  });

  it('sends Token auth on every request', async () => {
    let auth = '';
    globalThis.fetch = mockFetch((_u, init) => { auth = init.headers?.Authorization; return { json: { data: [] } }; });
    await new BookStackWriteClient('https://x', 'tid', 'tsec').findBook('z');
    expect(auth).toBe('Token tid:tsec');
  });
});

describe('BookStackAuthz.canWrite (fail-closed)', () => {
  it('returns true only when BookStack says allowed:true', async () => {
    globalThis.fetch = mockFetch((url) => url.includes('/letwrites/can-write') ? { json: { allowed: true } } : { json: {} });
    expect(await new BookStackAuthz('https://x', 'secret').canWrite({ userId: '5' }, { bookId: 7, pageId: 42 })).toBe(true);
  });
  it('denies on allowed:false, non-2xx, and network error', async () => {
    const a = new BookStackAuthz('https://x', 'secret');
    globalThis.fetch = mockFetch(() => ({ json: { allowed: false } }));
    expect(await a.canWrite({ userId: '5' }, { bookId: 7 })).toBe(false);
    globalThis.fetch = mockFetch(() => ({ status: 500, json: {} }));
    expect(await a.canWrite({ userId: '5' }, { bookId: 7 })).toBe(false);
    globalThis.fetch = vi.fn(async () => { throw new Error('down'); }) as any;
    expect(await a.canWrite({ userId: '5' }, { bookId: 7 })).toBe(false);
  });
});
