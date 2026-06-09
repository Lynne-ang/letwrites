import { describe, it, expect, vi, afterEach } from 'vitest';
import { BookStackReadClient } from './bookstack-read-client.js';
import { BookStackDocStore } from './bookstack-doc-store.js';
import { answer } from './engine.js';

function mockFetch(routes: (url: string, init: any) => { ok?: boolean; status?: number; body: unknown }) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
    const r = routes(String(url), init);
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body, text: async () => JSON.stringify(r.body) } as Response;
  });
}
afterEach(() => vi.restoreAllMocks());

describe('BookStackReadClient', () => {
  it('maps search results to resource ids (bookshelf → shelf)', async () => {
    mockFetch(() => ({ body: { data: [
      { id: 12, type: 'page', name: 'On-call' },
      { id: 3, type: 'book', name: 'Handbook' },
      { id: 5, type: 'bookshelf', name: 'Eng' },
    ] } }));
    const c = new BookStackReadClient('http://wiki', 'tid', 'tsec');
    expect(await c.search('oncall')).toEqual(['page:12', 'book:3', 'shelf:5']);
  });

  it('fetches a page title + markdown', async () => {
    mockFetch((url) => {
      expect(url).toContain('/api/pages/12');
      return { body: { id: 12, name: 'On-call Policy', markdown: 'Rotate weekly.' } };
    });
    const c = new BookStackReadClient('http://wiki', 'tid', 'tsec');
    expect(await c.getDoc('page:12')).toEqual({ title: 'On-call Policy', content: 'Rotate weekly.' });
  });

  it('sends the Token auth header', async () => {
    const spy = mockFetch(() => ({ body: { data: [] } }));
    await new BookStackReadClient('http://wiki', 'tid', 'tsec').search('x');
    expect(spy.mock.calls[0][1].headers.Authorization).toBe('Token tid:tsec');
  });
});

describe('BookStackDocStore + engine — live path, end to end (mocked BookStack)', () => {
  // Wires real answer() through the live store. page:3 is restricted: the authz
  // endpoint returns it as allowed for the HR user, denied for the engineer.
  const store = new BookStackDocStore({ baseUrl: 'http://wiki', apiTokenId: 't', apiTokenSecret: 's', authzSecret: 'secret' });

  const wire = (allowedForUser: Record<string, string[]>) =>
    mockFetch((url, init) => {
      if (url.includes('/api/search')) {
        return { body: { data: [{ id: 1, type: 'page', name: 'On-call' }, { id: 3, type: 'page', name: 'Comp' }] } };
      }
      if (url.includes('/letwrites/can-read')) {
        const userId = String(JSON.parse(init.body).userId);
        return { body: { allowed: allowedForUser[userId] ?? [] } };
      }
      if (url.includes('/api/pages/1')) return { body: { id: 1, name: 'On-call Policy', markdown: 'Rotate weekly.' } };
      if (url.includes('/api/pages/3')) return { body: { id: 3, name: 'Compensation', markdown: 'L5: 150k-200k.' } };
      return { ok: false, status: 404, body: {} };
    });

  it('HR user gets the restricted comp page through the live store', async () => {
    wire({ '7': ['page:1', 'page:3'] });
    const r = await answer({ userId: '7' }, 'compensation on-call', store);
    expect(r.sources.map((s) => s.title)).toContain('Compensation');
    expect(r.answer).toContain('150k');
  });

  it('engineer is blocked from comp by the live authz endpoint', async () => {
    wire({ '9': ['page:1'] }); // page:3 not allowed for user 9
    const r = await answer({ userId: '9' }, 'compensation on-call', store);
    expect(r.sources.map((s) => s.title)).not.toContain('Compensation');
    expect(r.answer).not.toContain('150k');
    expect(r.withheldCount).toBe(1);
  });

  it('fails closed if the authz endpoint errors', async () => {
    mockFetch((url) => {
      if (url.includes('/api/search')) return { body: { data: [{ id: 1, type: 'page', name: 'On-call' }] } };
      if (url.includes('/letwrites/can-read')) return { ok: false, status: 500, body: {} };
      return { body: { id: 1, name: 'On-call', markdown: 'x' } };
    });
    const r = await answer({ userId: '7' }, 'on-call', store);
    expect(r.sources).toHaveLength(0);
  });
});
