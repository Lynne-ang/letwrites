/**
 * Reliability guarantees for the migration: "slow is fine, stuck is not."
 *   1. transient BookStack failures (5xx) are retried, not fatal;
 *   2. a hung connection times out with a clear error instead of freezing forever;
 *   3. a sustained outage trips the circuit breaker so the import aborts fast (not after hours).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resilientFetch } from './bookstack-import-client.js';
import { saveUploadToFile } from './web/import-server.js';
import { runImport } from './importer.js';
import type { ImportPlan } from './import-planner.js';

let srv: Server | undefined;
afterEach(() => { srv?.close(); srv = undefined; });

function serve(handler: (n: number) => { status: number; delayMs?: number }): Promise<string> {
  let n = 0;
  srv = createServer((req, res) => {
    const { status, delayMs } = handler(++n);
    setTimeout(() => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end('{"data":[]}'); }, delayMs ?? 0);
  });
  return new Promise((r) => srv!.listen(0, () => r(`http://127.0.0.1:${(srv!.address() as any).port}`)));
}

describe('resilientFetch — transient failures + hangs', () => {
  it('retries a transient 503 and then succeeds', async () => {
    const base = await serve((n) => ({ status: n < 3 ? 503 : 200 })); // fail twice, succeed on the 3rd
    const res = await resilientFetch(`${base}/api/books`, {}, { attempts: 3, label: 'test' });
    expect(res.status).toBe(200);
  });

  it('gives up on a persistent 503 (returns the failing response, does not hang)', async () => {
    const base = await serve(() => ({ status: 503 }));
    const res = await resilientFetch(`${base}/api/books`, {}, { attempts: 2, label: 'test' });
    expect(res.status).toBe(503); // caller's !res.ok path turns this into a clear "BookStack 503" error
  });

  it('times out a hung connection with a clear, non-stuck error', async () => {
    const base = await serve(() => ({ status: 200, delayMs: 1000 })); // server never answers in time
    await expect(resilientFetch(`${base}/api/books`, {}, { timeoutMs: 120, attempts: 1, label: 'checking the connection' }))
      .rejects.toThrow(/did not respond within/i);
  });
});

describe('inter-page link rewriting (second pass)', () => {
  it('rewrites lwpage markers (basename + numeric) to BookStack URLs; flattens links to non-imported pages', async () => {
    const plan: ImportPlan = {
      books: [{ key: 'b1', name: 'Book', description: '' }],
      chapters: [],
      pages: [
        { key: 'page:Target_42', name: 'Target', markdown: 'hi', bookKey: 'b1' },
        { key: 'page:Source_1', name: 'Source', markdown: 'see [T](lwpage:Target_42), [N](lwpage:42), [Gone](lwpage:Missing_99)', bookKey: 'b1' },
      ] as any,
      flattened: [],
    };
    const updates: Record<number, string> = {};
    let nextId = 10;
    const client: any = {
      createBook: async () => ({ id: 1, slug: 'book' }),
      createChapter: async () => 1,
      createPage: async (i: any) => ({ id: nextId++, slug: String(i.name).toLowerCase(), book_id: 1 }),
      updatePage: async (id: number, md: string) => { updates[id] = md; },
      upload: async () => 'x',
    };
    const summary = await runImport(plan, client, () => {});
    const sourceMd = Object.values(updates).find((m) => m.includes('see ')) ?? '';
    expect(sourceMd).toContain('[T](/books/book/page/target)');  // relative-export link resolved
    expect(sourceMd).toContain('[N](/books/book/page/target)');  // numeric id → same page
    expect(sourceMd).toContain('Gone');                          // dead-target link kept as text
    expect(sourceMd).not.toContain('lwpage:');                   // no markers left behind
    expect(summary.linksRewritten).toBe(2);
    expect(summary.linksBroken).toBe(1);
  });
});

describe('saveUploadToFile — streams to disk, enforces the cap (no memory blow-up)', () => {
  it('writes a within-cap upload straight to disk', async () => {
    const work = mkdtempSync(join(tmpdir(), 'lw-up-'));
    const dest = join(work, 'u.zip');
    await saveUploadToFile(Readable.from([Buffer.alloc(1000, 7)]) as any, dest, 10_000);
    expect(readFileSync(dest).length).toBe(1000);
    rmSync(work, { recursive: true, force: true });
  });

  it('rejects an over-cap upload as it streams (does not buffer it all first)', async () => {
    const work = mkdtempSync(join(tmpdir(), 'lw-up-'));
    const dest = join(work, 'u.zip');
    const tooBig = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]); // 1200 > cap 1000
    await expect(saveUploadToFile(tooBig as any, dest, 1000)).rejects.toThrow(/exceeds the .* MB limit/i);
    rmSync(work, { recursive: true, force: true });
  });
});

describe('importer circuit breaker — sustained outage aborts fast', () => {
  const plan: ImportPlan = {
    books: [{ key: 'b1', name: 'Book', description: '' }],
    chapters: [],
    pages: Array.from({ length: 50 }, (_, i) => ({ key: `p${i}`, name: `Page ${i}`, markdown: 'x', bookKey: 'b1' })) as any,
    flattened: [],
  };

  it('aborts after the consecutive-failure limit instead of trying all 50 pages', async () => {
    let createPageCalls = 0;
    const deadClient: any = {
      createBook: async () => ({ id: 1, slug: 'book' }),
      createChapter: async () => 1,
      createPage: async () => { createPageCalls++; throw new Error('BookStack 502'); },
      updatePage: async () => {},
      upload: async () => 'x',
    };
    const logs: string[] = [];
    await expect(runImport(plan, deadClient, (m) => logs.push(m))).rejects.toThrow(/stopped responding/i);
    expect(createPageCalls).toBe(8);                 // the default limit, not 50
    expect(createPageCalls).toBeLessThan(plan.pages.length);
  });

  it('gives an empty container page a placeholder body so BookStack does not 422', async () => {
    const emptyPlan: ImportPlan = {
      books: [{ key: 'b1', name: 'Book', description: '' }],
      chapters: [],
      pages: [{ key: 'p0', name: 'Section', markdown: '   \n  ', bookKey: 'b1' }] as any, // empty body
      flattened: [],
    };
    let sentMarkdown: string | null = null;
    const client: any = {
      createBook: async () => ({ id: 1, slug: 'book' }), createChapter: async () => 1,
      createPage: async (i: any) => { sentMarkdown = i.markdown; return { id: 7, slug: 'page', book_id: 1 }; },
      updatePage: async () => {}, upload: async () => 'x',
    };
    const summary = await runImport(emptyPlan, client, () => {});
    expect(summary.pages).toBe(1);                                  // imported (no 422)
    expect((sentMarkdown ?? '').trim().length).toBeGreaterThan(0);  // a non-empty placeholder was sent
  });

  it('does NOT trip the breaker when pages keep succeeding (resilient to isolated failures)', async () => {
    let n = 0;
    const flakyClient: any = {
      createBook: async () => ({ id: 1, slug: 'book' }),
      createChapter: async () => 1,
      // every other page fails, but never 8 in a row → import completes
      createPage: async () => { n++; if (n % 2 === 0) throw new Error('blip'); return { id: n, slug: 'p' + n, book_id: 1 }; },
      updatePage: async () => {},
      upload: async () => 'x',
    };
    const summary = await runImport(plan, flakyClient, () => {});
    expect(summary.pages).toBe(25); // the 25 odd-numbered pages succeeded; no abort
  });
});
