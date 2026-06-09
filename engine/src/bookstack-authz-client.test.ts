import { describe, it, expect, vi, afterEach } from 'vitest';
import { BookStackAuthz } from './bookstack-authz-client.js';

const principal = { userId: '7', email: 'sarah@acme.com' };

function mockFetch(impl: (url: string, init: any) => Partial<Response> | Promise<Partial<Response>>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
    return (await impl(String(url), init)) as Response;
  });
}
const json = (status: number, body: unknown): Partial<Response> => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

afterEach(() => vi.restoreAllMocks());

describe('BookStackAuthz.canRead — fail-closed contract', () => {
  it('returns the allowed subset on success', async () => {
    mockFetch(() => json(200, { allowed: ['page:1', 'book:2'] }));
    const az = new BookStackAuthz('http://wiki', 'secret');
    const got = await az.canRead(principal, ['page:1', 'book:2', 'page:9']);
    expect([...got].sort()).toEqual(['book:2', 'page:1']);
  });

  it('sends the secret header and user id', async () => {
    const spy = mockFetch(() => json(200, { allowed: [] }));
    const az = new BookStackAuthz('http://wiki', 's3cr3t');
    await az.canRead(principal, ['page:1']);
    const [, init] = spy.mock.calls[0];
    expect(init.headers['X-Letwrites-Secret']).toBe('s3cr3t');
    expect(JSON.parse(init.body)).toEqual({ userId: 7, resourceIds: ['page:1'] });
  });

  it('denies all on 401 (bad secret)', async () => {
    mockFetch(() => json(401, { error: 'unauthorized' }));
    const az = new BookStackAuthz('http://wiki', 'wrong');
    expect((await az.canRead(principal, ['page:1'])).size).toBe(0);
  });

  it('denies all on 500', async () => {
    mockFetch(() => json(500, { error: 'boom' }));
    const az = new BookStackAuthz('http://wiki', 'secret');
    expect((await az.canRead(principal, ['page:1'])).size).toBe(0);
  });

  it('denies all on network error / timeout', async () => {
    mockFetch(() => { throw new Error('ECONNREFUSED'); });
    const az = new BookStackAuthz('http://wiki', 'secret');
    expect((await az.canRead(principal, ['page:1'])).size).toBe(0);
  });

  it('denies all on malformed response (no allowed array)', async () => {
    mockFetch(() => json(200, { unexpected: true }));
    const az = new BookStackAuthz('http://wiki', 'secret');
    expect((await az.canRead(principal, ['page:1'])).size).toBe(0);
  });

  it('ignores ids the server returns that we did not ask about', async () => {
    mockFetch(() => json(200, { allowed: ['page:1', 'page:999-injected'] }));
    const az = new BookStackAuthz('http://wiki', 'secret');
    const got = await az.canRead(principal, ['page:1']);
    expect([...got]).toEqual(['page:1']);
  });

  it('short-circuits empty input without a network call', async () => {
    const spy = mockFetch(() => json(200, { allowed: [] }));
    const az = new BookStackAuthz('http://wiki', 'secret');
    expect((await az.canRead(principal, [])).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
  });
});
