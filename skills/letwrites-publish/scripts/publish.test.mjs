import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLISH = join(HERE, 'publish.mjs');

function startServer(handler) {
  return new Promise((resolve) => {
    const s = createServer(handler);
    s.listen(0, '127.0.0.1', () => resolve({ s, port: s.address().port }));
  });
}
function readBody(req) { return new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); }); }
function run(env, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [PUBLISH, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d)); p.stderr.on('data', (d) => (err += d));
    p.on('exit', (code) => resolve({ code, out, err }));
  });
}

test('governed mode sends ONE JSON-RPC publish_document call (not BookStack REST)', async () => {
  const seen = [];
  const { s, port } = await startServer(async (req, res) => {
    const body = await readBody(req);
    seen.push({ method: req.method, url: req.url, skill: req.headers['x-letwrites-skill'], auth: req.headers['authorization'], body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'Published "Runbook" → https://wiki/books/team/page/runbook' }], isError: false } }));
  });
  const r = await run(
    { LETWRITES_GATEWAY_URL: `http://127.0.0.1:${port}`, LETWRITES_GATEWAY_TOKEN: 'tok123' },
    ['--title', 'Runbook', '--book', 'Team Notes', '--md', '# hi']
  );
  s.close();
  assert.equal(r.code, 0, `exit 0; stderr=${r.err}`);
  // Exactly one HTTP call, a POST of a JSON-RPC tools/call for publish_document — NO /api/* REST.
  assert.equal(seen.length, 1, `one request; got ${JSON.stringify(seen.map((x) => `${x.method} ${x.url}`))}`);
  assert.equal(seen[0].method, 'POST');
  assert.ok(!seen[0].url.includes('/api/'), 'must NOT hit BookStack REST /api/*');
  const rpc = JSON.parse(seen[0].body);
  assert.equal(rpc.method, 'tools/call');
  assert.equal(rpc.params.name, 'publish_document');
  assert.deepEqual(rpc.params.arguments, { title: 'Runbook', book: 'Team Notes', markdown: '# hi' });
  assert.equal(seen[0].skill, 'letwrites-publish');
  assert.equal(seen[0].auth, 'Bearer tok123');
  assert.match(r.out, /Published/);
  assert.match(r.out, /Runbook/);
});

test('governed mode surfaces a gateway refusal as a non-zero exit', async () => {
  const { s, port } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: "You're not authorized to write to \"Team Notes\"." }], isError: true } }));
  });
  const r = await run({ LETWRITES_GATEWAY_URL: `http://127.0.0.1:${port}` }, ['--title', 'X', '--book', 'Team Notes', '--md', 'b']);
  s.close();
  assert.notEqual(r.code, 0, 'a refused publish must fail loudly');
  assert.match(r.err, /not authorized/i);
});

test('direct mode (token) hits BookStack REST, not JSON-RPC', async () => {
  const paths = [];
  const { s, port } = await startServer(async (req, res) => {
    paths.push(`${req.method} ${req.url.split('?')[0]}`);
    await readBody(req);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.startsWith('/api/books')) return res.end(JSON.stringify({ data: [{ id: 1, name: 'Team Notes', slug: 'team-notes' }] }));
    if (req.url.startsWith('/api/pages') && req.method === 'GET') return res.end(JSON.stringify({ data: [] }));
    return res.end(JSON.stringify({ id: 9, slug: 'runbook', url: 'http://wiki/p/9' }));
  });
  const r = await run(
    { LETWRITES_TOKEN_ID: 'id', LETWRITES_TOKEN_SECRET: 'sec', LETWRITES_GATEWAY_URL: '' },
    ['--title', 'Runbook', '--book', 'Team Notes', '--md', '# hi', '--base-url', `http://127.0.0.1:${port}`]
  );
  s.close();
  assert.equal(r.code, 0, `exit 0; stderr=${r.err}`);
  assert.ok(paths.some((p) => p.startsWith('GET /api/books')), `expected REST; got ${JSON.stringify(paths)}`);
  assert.ok(paths.some((p) => p === 'POST /api/pages'), `expected page create; got ${JSON.stringify(paths)}`);
});
