#!/usr/bin/env node
import { answer } from './engine.js';
import { BookStackDocStore } from './bookstack-doc-store.js';

/**
 * Run the agent-safe engine against a REAL Letwrites (live BookStack), not the
 * in-memory demo. Proves the production path.
 *
 *   BOOKSTACK_URL=https://docs.acme.com \
 *   BOOKSTACK_TOKEN_ID=… BOOKSTACK_TOKEN_SECRET=… \
 *   LETWRITES_AUTHZ_SECRET=… LETWRITES_USER_ID=7 \
 *   npm run demo:live -- "what is the on-call policy?"
 *
 * LETWRITES_USER_ID is the BookStack user id to answer AS — in production this
 * comes from the agent's verified OAuth identity (the identity spike); here you
 * pass it explicitly to see real per-user enforcement.
 */
async function main() {
  const need = (k: string) => {
    const v = process.env[k];
    if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
    return v;
  };
  const store = new BookStackDocStore({
    baseUrl: need('BOOKSTACK_URL'),
    apiTokenId: need('BOOKSTACK_TOKEN_ID'),
    apiTokenSecret: need('BOOKSTACK_TOKEN_SECRET'),
    authzSecret: need('LETWRITES_AUTHZ_SECRET'),
  });
  const userId = need('LETWRITES_USER_ID');
  const query = process.argv.slice(2).join(' ') || 'on-call policy';

  if (!(await store.health())) {
    console.error('Letwrites authz endpoint not reachable — check BOOKSTACK_URL and that the theme is active (/letwrites/health).');
    process.exit(1);
  }

  console.log(`Asking Letwrites as user ${userId}: "${query}"\n`);
  const r = await answer({ userId }, query, store);
  console.log(r.answer);
  console.log(`\n  sources: ${r.sources.map((s) => s.title).join(', ') || '(none)'}`);
  console.log(`  withheld: ${r.withheldCount}   audited: ${r.audit.length} access(es)`);
}

main().catch((e) => { console.error(`demo:live failed: ${e.message}`); process.exit(1); });
