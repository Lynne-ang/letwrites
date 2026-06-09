#!/usr/bin/env node
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { answer } from './engine.js';
import { BookStackDocStore } from './bookstack-doc-store.js';
import { HashChainedFileSink, verifyChain } from './audit.js';
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

function storeFromEnv(): BookStackDocStore | null {
  const baseUrl = process.env.BOOKSTACK_URL;
  const apiTokenId = process.env.BOOKSTACK_TOKEN_ID;
  const apiTokenSecret = process.env.BOOKSTACK_TOKEN_SECRET;
  const authzSecret = process.env.LETWRITES_AUTHZ_SECRET;
  if (!baseUrl || !apiTokenId || !apiTokenSecret || !authzSecret) return null;
  return new BookStackDocStore({ baseUrl, apiTokenId, apiTokenSecret, authzSecret });
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
