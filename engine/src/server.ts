#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { answer } from './engine.js';
import { BookStackDocStore } from './bookstack-doc-store.js';
import { BookStackWriteClient } from './bookstack-write-client.js';
import { BookStackAuthz } from './bookstack-authz-client.js';
import { FilesystemDocStore, FILE_PREFIX } from './filesystem-doc-store.js';
import { CompositeDocStore, type Member } from './composite-doc-store.js';
import { HashChainedFileSink, verifyChain } from './audit.js';
import type { DocStore } from './doc-store.js';
import type { Principal } from './types.js';

/**
 * Letwrites engine HTTP service — the internal agent-safe answering API.
 *
 * ⚠️ INTERNAL ONLY. This service is NOT meant to face agents or the internet
 * directly. It must sit behind the OAuth/MCP gateway (the identity-propagation
 * spike, not built yet), which resolves the *verified* end-user and sets the
 * `X-Letwrites-User-Id` header. Until that gateway exists, this runs on the internal
 * Docker network with no public route, guarded by a shared secret.
 *
 *   GET  /health                      → {ok, configured}
 *   POST /ask  (secret-guarded)       → run the permission-safe answer for a user
 *        headers: X-Letwrites-Engine-Secret, X-Letwrites-User-Id
 *        body:    {"query": "..."}
 *
 * Identity note: trusting X-Letwrites-User-Id is correct ONLY because (a) the caller
 * is the trusted gateway, not the agent, and (b) the secret gates access. It is
 * NOT the agent self-declaring identity. The engine still enforces that user's
 * permissions live and fails closed.
 */

const PORT = Number(process.env.PORT ?? 8787);
const ENGINE_SECRET = process.env.LETWRITES_ENGINE_SECRET ?? '';
const AUDIT_FILE = process.env.LETWRITES_AUDIT_FILE ?? './data/audit/audit.jsonl';

// One sink for the process — appends are serialized internally (mutex), so it's
// safe across concurrent /ask requests.
const auditSink = new HashChainedFileSink(AUDIT_FILE);

/**
 * Compose the configured knowledge sources. BookStack and/or an on-prem filesystem share; if
 * both are set they're federated behind one CompositeDocStore (cross-source enforcement). Returns
 * null only when NOTHING is configured. Each source enforces its own permissions, fail-closed.
 */
function storeFromEnv(): DocStore | null {
  const members: Member[] = [];

  const baseUrl = process.env.BOOKSTACK_URL;
  const apiTokenId = process.env.BOOKSTACK_TOKEN_ID;
  const apiTokenSecret = process.env.BOOKSTACK_TOKEN_SECRET;
  const authzSecret = process.env.LETWRITES_AUTHZ_SECRET;
  if (baseUrl && apiTokenId && apiTokenSecret && authzSecret) {
    members.push({
      prefixes: ['page', 'book', 'chapter', 'shelf'],
      store: new BookStackDocStore({ baseUrl, apiTokenId, apiTokenSecret, authzSecret }),
    });
  }

  const fsRoot = process.env.LETWRITES_FS_ROOT;
  if (fsRoot) {
    const aclPath = process.env.LETWRITES_FS_ACL ?? join(fsRoot, '.letwrites-acl.json');
    members.push({ prefixes: [FILE_PREFIX], store: new FilesystemDocStore(fsRoot, aclPath) });
  }

  if (members.length === 0) return null;
  return members.length === 1 ? members[0].store : new CompositeDocStore(members);
}

/**
 * Write side (BookStack only). Returns a write client + the authz client used for the per-user
 * can-write check, or null if BookStack isn't configured (writes are then unavailable).
 */
function writerFromEnv(): { writer: BookStackWriteClient; authz: BookStackAuthz } | null {
  const baseUrl = process.env.BOOKSTACK_URL;
  const apiTokenId = process.env.BOOKSTACK_TOKEN_ID;
  const apiTokenSecret = process.env.BOOKSTACK_TOKEN_SECRET;
  const authzSecret = process.env.LETWRITES_AUTHZ_SECRET;
  if (!baseUrl || !apiTokenId || !apiTokenSecret || !authzSecret) return null;
  return {
    writer: new BookStackWriteClient(baseUrl, apiTokenId, apiTokenSecret),
    authz: new BookStackAuthz(baseUrl, authzSecret),
  };
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Constant-time secret compare using a vetted primitive.
function secretOk(provided: string): boolean {
  if (!ENGINE_SECRET) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(ENGINE_SECRET);
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}

// Per-target write lock: serialize concurrent publishes to the SAME {book, chapter, title} so a
// find-page → not-found → create race can't create duplicate pages. Different targets stay parallel.
const writeLocks = new Map<string, Promise<unknown>>();
function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = writeLocks.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  writeLocks.set(key, run.then(() => undefined, () => undefined));
  // best-effort cleanup so the map can't grow unbounded
  run.finally(() => { if (writeLocks.get(key) === undefined) writeLocks.delete(key); }).catch(() => {});
  return run;
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      return send(res, 200, { ok: true, service: 'letwrites-engine', configured: storeFromEnv() !== null });
    }

    if (req.method === 'POST' && req.url === '/ask') {
      if (!secretOk(req.headers['x-letwrites-engine-secret'] as string ?? '')) {
        return send(res, 401, { error: 'unauthorized' });
      }
      const store = storeFromEnv();
      if (!store) {
        return send(res, 503, { error: 'engine not configured — set BOOKSTACK_URL/TOKEN/AUTHZ_SECRET and restart' });
      }
      const userId = (req.headers['x-letwrites-user-id'] as string ?? '').trim();
      if (!userId) {
        // No resolved identity → refuse. The gateway must supply a verified user.
        return send(res, 401, { error: 'no resolved user identity' });
      }
      const raw = await readBody(req);
      let query = '';
      try { query = String(JSON.parse(raw || '{}').query ?? ''); } catch { /* fall through */ }
      if (!query) return send(res, 422, { error: 'expected {"query": "..."}' });

      const principal: Principal = { userId };
      // auditSink persists every decision before the answer returns (fail-closed).
      const result = await answer(principal, query, store, undefined, auditSink);
      return send(res, 200, result);
    }

    // Governed WRITE-BACK: an agent publishes a document on behalf of a verified user. We resolve
    // the target, ask BookStack whether THIS user may write there (fail-closed), AUDIT the decision
    // before doing anything, and only then create/update the page. Same trust model as /ask.
    if (req.method === 'POST' && req.url === '/write') {
      if (!secretOk((req.headers['x-letwrites-engine-secret'] as string) ?? '')) {
        return send(res, 401, { error: 'unauthorized' });
      }
      const w = writerFromEnv();
      if (!w) return send(res, 503, { error: 'engine not configured for writes — set BOOKSTACK_URL/TOKEN/AUTHZ_SECRET' });
      const userId = (req.headers['x-letwrites-user-id'] as string ?? '').trim();
      if (!userId) return send(res, 401, { error: 'no resolved user identity' });

      let body: { book?: string; chapter?: string; title?: string; markdown?: string } = {};
      try { body = JSON.parse((await readBody(req)) || '{}'); } catch { /* fall through */ }
      const { book, chapter, title, markdown } = body;
      if (!book || !title || markdown == null) return send(res, 422, { error: 'expected {book, title, markdown, chapter?}' });

      // Resolve target. Governed mode does NOT auto-create books/chapters — the destination must
      // exist (creating containers is a separate, higher privilege we don't grant an agent here).
      const bk = await w.writer.findBook(book);
      if (!bk) return send(res, 404, { error: `book not found: "${book}" (create it in Letwrites first)` });
      let chapterId: number | undefined;
      if (chapter) {
        const ch = await w.writer.findChapter(bk.id, chapter);
        if (!ch) return send(res, 404, { error: `chapter not found in "${book}": "${chapter}"` });
        chapterId = ch.id;
      }
      // Serialize same-target writes: re-resolve the page, authz, audit, and create/update all inside
      // the lock so two concurrent identical publishes can't both see "not found" and both create.
      const lockKey = `${bk.id}:${chapterId ?? 0}:${title.trim().toLowerCase()}`;
      const out = await withWriteLock(lockKey, async (): Promise<{ status: number; body: unknown }> => {
        const existing = await w.writer.findPage(bk.id, title, chapterId);
        // Authoritative per-user write check, then AUDIT before the write (fail-closed).
        const principal: Principal = { userId };
        const allowed = await w.authz.canWrite(principal, { bookId: bk.id, chapterId, pageId: existing?.id });
        await auditSink.append([{
          ts: new Date().toISOString(), userId,
          query: `[publish] ${title}`,
          resourceId: existing ? `page:${existing.id}` : `book:${bk.id}`,
          decision: allowed ? 'allowed' : 'denied',
        }]);
        if (!allowed) return { status: 403, body: { error: 'not authorized to write here' } };
        const page = existing
          ? await w.writer.updatePage(existing.id, title, markdown)
          : await w.writer.createPage({ bookId: bk.id, chapterId }, title, markdown);
        return { status: 200, body: { action: existing ? 'updated' : 'created', title, url: w.writer.pageUrl(bk, page) } };
      });
      return send(res, out.status, out.body);
    }

    // Audit-chain integrity check (secret-guarded). For ops/CISO to confirm the
    // log hasn't been tampered with.
    if (req.method === 'GET' && req.url === '/audit/verify') {
      if (!secretOk((req.headers['x-letwrites-engine-secret'] as string) ?? '')) {
        return send(res, 401, { error: 'unauthorized' });
      }
      return send(res, 200, await verifyChain(AUDIT_FILE));
    }

    return send(res, 404, { error: 'not found' });
  } catch (e) {
    return send(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`letwrites-engine listening on :${PORT} (configured=${storeFromEnv() !== null})`);
});
