import { describe, it, expect } from 'vitest';
import { CompositeDocStore } from './composite-doc-store.js';
import type { DocStore } from './doc-store.js';
import type { Principal, ResourceId } from './types.js';

/** A tiny in-memory store: each doc owned-by a user; canRead allows only that user's docs. */
function stubStore(docs: { id: string; owner: string; body: string }[], opts: { failCanRead?: boolean } = {}): DocStore {
  return {
    async search(q) { return docs.filter((d) => (d.id + d.body).toLowerCase().includes(q.toLowerCase())).map((d) => d.id); },
    async canRead(p: Principal, ids: ResourceId[]) {
      if (opts.failCanRead) throw new Error('source down');
      return new Set(ids.filter((id) => docs.find((d) => d.id === id && d.owner === p.userId)));
    },
    async getDoc(id) { const d = docs.find((x) => x.id === id); if (!d) throw new Error('nf'); return { title: id, content: d.body }; },
  };
}

const wiki = stubStore([{ id: 'page:1', owner: 'alice', body: 'wiki comp' }, { id: 'page:2', owner: 'bob', body: 'wiki eng' }]);
const files = stubStore([{ id: 'file:hr/x.md', owner: 'alice', body: 'file comp' }, { id: 'file:eng/y.md', owner: 'bob', body: 'file eng' }]);

const composite = new CompositeDocStore([
  { prefixes: ['page', 'book'], store: wiki },
  { prefixes: ['file'], store: files },
]);

describe('CompositeDocStore', () => {
  it('fans search out across all sources', async () => {
    expect((await composite.search('comp')).sort()).toEqual(['file:hr/x.md', 'page:1']);
  });

  it('routes canRead by namespace and unions allows across sources', async () => {
    const ids = ['page:1', 'page:2', 'file:hr/x.md', 'file:eng/y.md'];
    expect([...await composite.canRead({ userId: 'alice' }, ids)].sort()).toEqual(['file:hr/x.md', 'page:1']);
    expect([...await composite.canRead({ userId: 'bob' }, ids)].sort()).toEqual(['file:eng/y.md', 'page:2']);
  });

  it('denies ids whose namespace no source owns (fail closed)', async () => {
    expect((await composite.canRead({ userId: 'alice' }, ['slack:99', 'page:1'])).has('slack:99')).toBe(false);
  });

  it('routes getDoc to the owning source; throws for an unowned namespace', async () => {
    expect((await composite.getDoc('file:hr/x.md')).content).toBe('file comp');
    await expect(composite.getDoc('slack:99')).rejects.toThrow(/no source owns/);
  });

  it('one source failing closes only ITS subset, never the others', async () => {
    const c = new CompositeDocStore([
      { prefixes: ['page'], store: wiki },
      { prefixes: ['file'], store: stubStore([{ id: 'file:hr/x.md', owner: 'alice', body: 'x' }], { failCanRead: true }) },
    ]);
    const got = await c.canRead({ userId: 'alice' }, ['page:1', 'file:hr/x.md']);
    expect([...got]).toEqual(['page:1']); // wiki still allowed; failed source denied
  });
});
