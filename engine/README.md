# @letwrites/engine

The Letwrites control-plane engine: search → **live per-user permission check** →
answer from allowed docs only → **tamper-evident, hash-chained audit** of every access,
fail-closed. Runs over an in-memory source (the demo), a **live BookStack** (production,
verified on v26.05), and/or an **on-prem filesystem share** behind the same boundary —
and federates several sources behind one `CompositeDocStore` so one agent query is gated
across all of them. The only unbuilt piece is the agent-facing MCP/OAuth identity gateway
(proving which human an agent acts for) — the paid add-on. **38 tests green.**

## What's here

| File | Status |
|------|--------|
| `src/engine.ts` | The safe-answer flow + audit (`engine.test.ts`) |
| `src/audit.ts` | Hash-chained, append-only, tamper-evident audit + `verifyChain` (`audit.test.ts`) |
| `src/doc-store.ts` | `DocStore` interface + `InMemorySource` (the zero-infra demo corpus) |
| `src/bookstack-authz-client.ts` | `/letwrites/can-read` client, **fail-closed** (`bookstack-authz-client.test.ts`) |
| `src/bookstack-read-client.ts` | BookStack API: candidate search + content fetch |
| `src/bookstack-doc-store.ts` | **LIVE** `DocStore`: authz client + read client (`bookstack-doc-store.test.ts`) |
| `src/filesystem-doc-store.ts` | **On-prem filesystem** `DocStore`: local share + share-level ACL, fail-closed, traversal-safe (`filesystem-doc-store.test.ts`) |
| `src/composite-doc-store.ts` | Federate N sources behind one boundary, route by id namespace, fail-closed (`composite-doc-store.test.ts`) |
| `src/demo.ts` | Agent-safe demo (in-memory): `npm run demo` |
| `src/demo-live.ts` | Same engine against a real Letwrites: `npm run demo:live` |

## Demo vs. live — one line of difference

```ts
// demo (zero infra)
const result = await answer(principal, query, new InMemorySource());

// live Letwrites — the engine, audit, and fail-closed guarantees are IDENTICAL
const result = await answer(principal, query, new BookStackDocStore({
  baseUrl, apiTokenId, apiTokenSecret, authzSecret,
}));
```

Run live (needs a deployed Letwrites + an API token + the authz secret):
```bash
BOOKSTACK_URL=https://docs.acme.com BOOKSTACK_TOKEN_ID=… BOOKSTACK_TOKEN_SECRET=… \
LETWRITES_AUTHZ_SECRET=… LETWRITES_USER_ID=7 \
  npm run demo:live -- "what is the on-call policy?"
```

## Multiple sources, one safe surface

Set any combination of sources; the server composes them automatically. Each source makes its
OWN live permission decision and the answer is drawn only from what the user may read everywhere.

```bash
# BookStack + an on-prem filesystem share, federated behind one CompositeDocStore
BOOKSTACK_URL=https://docs.acme.com BOOKSTACK_TOKEN_ID=… BOOKSTACK_TOKEN_SECRET=… LETWRITES_AUTHZ_SECRET=… \
LETWRITES_FS_ROOT=/mnt/share LETWRITES_FS_ACL=/mnt/share/.letwrites-acl.json \
  npm run serve
```

Resource ids are namespaced (`page:`/`book:` → BookStack, `file:` → filesystem); the composite
routes each candidate to its owning source. An id no source owns is never allowed and never
fetched. Filesystem permissions come from a share-level ACL (most-specific path prefix wins):

```json
{ "users": { "7": ["hr", "staff"] },
  "acl":   [ { "prefix": "", "groups": ["staff"] }, { "prefix": "hr/", "groups": ["hr"] } ] }
```

## The permission contract (engine ↔ BookStack)

```
POST {wiki}/letwrites/can-read     header: X-Letwrites-Secret: <shared secret>
  { "userId": 7, "resourceIds": ["page:12","book:3"] }
  → 200 { "allowed": ["page:12"] }     # BookStack's own permission scope decides
  → 401 / 422 / 5xx / timeout          # engine treats ALL of these as DENY ALL
```

The BookStack side lives in `../wiki/themes/letwrites/functions.php` (a theme, not a
fork). See `../wiki/README.md` to stand it up.

## Fail-closed

Every non-success path (bad secret, malformed body, server down, timeout) returns
an **empty** allow-set. A permission service that's unavailable must never leak
content. This is locked from the eng review and covered by tests.

## Test

```bash
npm install && npm test
```
