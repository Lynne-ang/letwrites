#!/usr/bin/env node
/**
 * Publish a markdown document into Letwrites (BookStack). Finds-or-creates the target book and
 * (optional) chapter, then creates the page or updates the existing one with the same title.
 * Zero dependencies. Used by the letwrites-publish skill.
 *
 *   node publish.mjs --title "..." --file doc.md [--book B] [--chapter C] [--base-url URL] [--dry-run]
 *
 * Credentials (env): LETWRITES_TOKEN_ID + LETWRITES_TOKEN_SECRET   (direct / self-host)
 * Governed mode (env): LETWRITES_GATEWAY_URL  -> writes run as the verified SSO user, audited.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name, def) { const i = process.argv.indexOf('--' + name); return i > -1 ? (process.argv[i + 1] ?? true) : def; }
const has = (name) => process.argv.includes('--' + name);
function die(msg) { console.error(`[letwrites-publish] ${msg}`); process.exit(1); }

// ---- config: .letwrites.json (or --config) merged with CLI flags ----
const cfgPath = resolve(String(arg('config', '.letwrites.json')));
let cfg = {};
if (existsSync(cfgPath)) { try { cfg = JSON.parse(readFileSync(cfgPath, 'utf8')); } catch (e) { die(`bad config ${cfgPath}: ${e.message}`); } }

const baseUrl = String(arg('base-url', cfg.baseUrl || process.env.LETWRITES_URL || '')).replace(/\/+$/, '');
const gatewayUrl = (process.env.LETWRITES_GATEWAY_URL || '').replace(/\/+$/, '');
const book = arg('book', cfg.book);
const chapter = arg('chapter', cfg.chapter);
const title = arg('title');
const dryRun = has('dry-run');

if (!title) die('missing --title');
if (!baseUrl && !gatewayUrl) die('no Letwrites URL — set baseUrl in .letwrites.json, pass --base-url, or set LETWRITES_GATEWAY_URL');
if (!book) die('no target book — set "book" in .letwrites.json or pass --book');

const file = arg('file');
const inline = arg('md');
const markdown = file ? readFileSync(resolve(String(file)), 'utf8') : (inline ? String(inline) : die('provide --file or --md'));

// ---- HTTP helpers ----
const tokenId = process.env.LETWRITES_TOKEN_ID, tokenSecret = process.env.LETWRITES_TOKEN_SECRET;
function authHeaders() {
  if (gatewayUrl) return {}; // gateway injects the verified-user identity; no API token in the client
  if (!tokenId || !tokenSecret) die('set LETWRITES_TOKEN_ID and LETWRITES_TOKEN_SECRET (Letwrites → Edit Profile → API Tokens)');
  return { Authorization: `Token ${tokenId}:${tokenSecret}` };
}
const root = gatewayUrl || baseUrl;
async function api(method, path, body) {
  const res = await fetch(`${root}${path}`, {
    method,
    headers: { Accept: 'application/json', ...authHeaders(), ...(body ? { 'Content-Type': 'application/json', 'X-Letwrites-Skill': 'letwrites-publish' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok) die(`${method} ${path} -> ${res.status}: ${(json.error?.message || json.message || text || '').slice(0, 300)}`);
  return json;
}
const list = async (path) => (await api('GET', `${path}${path.includes('?') ? '&' : '?'}count=500`)).data ?? [];
const byName = (items, name) => items.find((x) => (x.name || '').trim().toLowerCase() === String(name).trim().toLowerCase());

async function findOrCreate(kind, name, parent) {
  // kind: 'books' | 'chapters'. parent = { book_id } for chapters.
  const found = byName(await list(`/api/${kind}${parent?.book_id ? `?filter[book_id]=${parent.book_id}` : ''}`), name);
  if (found) return found;
  if (dryRun) return { id: `(new ${kind.slice(0, -1)})`, name, slug: '(new)', _new: true };
  return api('POST', `/api/${kind}`, { name, ...(parent || {}) });
}

(async () => {
  const bk = await findOrCreate('books', book);
  const ch = chapter ? await findOrCreate('chapters', chapter, { book_id: bk.id }) : null;

  // find an existing page with the same title in this book (and chapter, if given)
  const pages = await list(`/api/pages?filter[book_id]=${bk.id}`);
  const existing = byName(pages.filter((p) => !ch || p.chapter_id === ch.id), title);

  const action = existing ? 'updated' : 'created';
  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, action, title, book: bk.name, chapter: ch?.name ?? null, baseUrl: root }, null, 2));
    return;
  }

  const payload = { name: title, markdown };
  const page = existing
    ? await api('PUT', `/api/pages/${existing.id}`, payload)
    : await api('POST', '/api/pages', ch ? { ...payload, chapter_id: ch.id } : { ...payload, book_id: bk.id });

  const url = page.url || `${baseUrl}/books/${bk.slug}/page/${page.slug}`;
  console.log(JSON.stringify({ action, title, url }, null, 2));
})().catch((e) => die(e.message));
