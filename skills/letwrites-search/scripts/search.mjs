#!/usr/bin/env node
/**
 * Search Letwrites (BookStack) or read a page — permission-safe. Two modes:
 *   - Governed (LETWRITES_GATEWAY_URL set): call the gateway's MCP search_knowledge tool. The
 *     gateway enforces the verified user's permissions and returns one composed answer + sources.
 *   - Direct / self-host: call BookStack /api/search with the REQUESTING USER's own API token, so
 *     results are scoped to that user by BookStack itself. Never use a shared admin token here.
 * Zero dependencies. Used by the letwrites-search skill.
 *
 *   node search.mjs --query "..." [--limit N] [--book "Name"]
 *   node search.mjs --open <pageId>
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? (process.argv[i + 1] ?? true) : def; }
function die(m) { console.error(`[letwrites-search] ${m}`); process.exit(1); }

const cfgPath = resolve(String(arg('config', '.letwrites.json')));
let cfg = {};
if (existsSync(cfgPath)) { try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch (e) { die(`bad config ${cfgPath}: ${e.message}`); } }

const gatewayUrl = (process.env.LETWRITES_GATEWAY_URL || '').replace(/\/+$/, '');
const baseUrl = String(arg('base-url', cfg.baseUrl || process.env.LETWRITES_URL || '')).replace(/\/+$/, '');
const query = arg('query');
const open = arg('open');
const limit = Number(arg('limit', 8));
const book = arg('book');

// ---- Governed mode: ask the gateway's MCP tool (permission-safe + audited) ----
if (gatewayUrl) {
  if (!query) die('governed mode: provide --query (page reads come back inside the answer)');
  const body = { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_knowledge', arguments: { query: String(query) } } };
  const res = await fetch(gatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Letwrites-Skill': 'letwrites-search', ...(process.env.LETWRITES_USER ? { 'x-forwarded-user': process.env.LETWRITES_USER } : {}) },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) die(`gateway returned ${res.status}`);
  console.log(j?.result?.content?.[0]?.text ?? '(no answer)');
  process.exit(0);
}

// ---- Direct mode: BookStack API with the USER's own token ----
const tokenId = process.env.LETWRITES_TOKEN_ID, tokenSecret = process.env.LETWRITES_TOKEN_SECRET;
if (!baseUrl) die('no Letwrites URL — set baseUrl in .letwrites.json or LETWRITES_GATEWAY_URL');
if (!tokenId || !tokenSecret) die('set LETWRITES_TOKEN_ID and LETWRITES_TOKEN_SECRET (the REQUESTING USER\'s own token — that is what keeps results permission-safe)');
const auth = { Authorization: `Token ${tokenId}:${tokenSecret}`, Accept: 'application/json' };

async function get(path) {
  const res = await fetch(`${baseUrl}${path}`, { headers: auth });
  if (!res.ok) die(`BookStack ${res.status} on ${path}`);
  return res.json();
}

if (open) {
  const p = await get(`/api/pages/${encodeURIComponent(String(open))}`);
  console.log(JSON.stringify({ id: p.id, title: p.name, markdown: p.markdown ?? p.html ?? '' }, null, 2));
  process.exit(0);
}

if (!query) die('provide --query or --open <pageId>');
const q = book ? `${query} {in_book:${book}}` : String(query); // BookStack search filter syntax
const data = (await get(`/api/search?query=${encodeURIComponent(q)}&count=${limit}`)).data ?? [];
if (!data.length) { console.log('No results you have access to.'); process.exit(0); }
data.forEach((r, i) => {
  const snippet = (r.preview_html?.content || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
  console.log(`${i + 1}. ${r.name} [${r.type}:${r.id}] — ${r.url}`);
  if (snippet) console.log(`   ${snippet}`);
});
