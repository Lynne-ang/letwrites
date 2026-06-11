import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { server } from './import-server.js';
import { PAGE_HTML } from './import-page.js';
import { IMPORT_UI_ASSET_JS } from './import-ui.js';

// Guard against template-literal mangling (e.g. a `\/` regex collapsing to `//` → a comment that
// breaks the whole <script>). new Function() parses without running, so browser globals are fine.
function scriptBlocks(html: string): string[] {
  const out: string[] = []; const re = /<script>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}
describe('served page <script> blocks are valid JS', () => {
  it('import page parses (no template-literal mangling)', () => {
    const all = scriptBlocks(PAGE_HTML);
    expect(all.length).toBeGreaterThan(0);
    for (const s of all) expect(() => new Function(s)).not.toThrow();
  });
  // The in-wiki asset is served as RAW JS (no <script> wrapper), so a mangling bug would break it
  // silently — the exact M4 failure mode. Parse it directly.
  it('the /import/ui.js mountable asset parses as valid JS', () => {
    expect(() => new Function(IMPORT_UI_ASSET_JS)).not.toThrow();
    // the log-join newline must survive as a real backslash-n, not a literal newline
    expect(IMPORT_UI_ASSET_JS).toContain("join('\\n')");
  });

  it('wires the non-admin broker-visibility path (defer + apply per created book)', () => {
    expect(IMPORT_UI_ASSET_JS).toContain('vis=defer');                // non-admin run defers token-apply
    expect(IMPORT_UI_ASSET_JS).toContain('applyBrokerVisibility');     // …then restricts via the broker
    expect(IMPORT_UI_ASSET_JS).toContain('LW_SHARE_APPLY_URL');        // same-origin session route
    expect(IMPORT_UI_ASSET_JS).toContain('LW_GROUPS');                 // group picker from the session
  });
});

// A tiny mock BookStack: validates the token header and lists two books.
let bookstack: Server, bookstackPort: number, appPort: number;
const TOKEN = 'Token id123:secret456';

beforeAll(async () => {
  let lastPermPut: any = null;
  bookstack = createServer((req, res) => {
    if (req.headers.authorization !== TOKEN) { res.writeHead(401); return res.end('{}'); }
    const ok = (o: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url?.startsWith('/api/books?') || req.url === '/api/books') return ok({ data: [{ id: 3, name: 'Team Space' }, { id: 7, name: 'Personal' }] });
    if (req.url?.startsWith('/api/roles')) return ok({ data: [{ id: 2, display_name: 'Engineering' }, { id: 5, display_name: 'Leadership' }] });
    if (req.method === 'GET' && /^\/api\/books\/\d+$/.test(req.url ?? '')) return ok({ id: 42, name: 'Q2 Roadmap' });
    if (req.method === 'PUT' && /^\/api\/content-permissions\/\w+\/\d+$/.test(req.url ?? '')) {
      let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => { lastPermPut = JSON.parse(body || '{}'); ok({ ...lastPermPut }); });
      return;
    }
    res.writeHead(404); res.end('{}');
  });
  (globalThis as any).__lastPermPut = () => lastPermPut;
  await new Promise<void>((r) => bookstack.listen(0, () => { bookstackPort = (bookstack.address() as any).port; r(); }));
  await new Promise<void>((r) => server.listen(0, () => { appPort = (server.address() as any).port; r(); }));
});
afterAll(() => { bookstack.close(); server.close(); });

const base = () => `http://127.0.0.1:${appPort}`;
const bs = () => `http://127.0.0.1:${bookstackPort}`;

describe('import web server', () => {
  it('serves the self-contained import page', async () => {
    const r = await fetch(`${base()}/import`);
    const html = await r.text();
    expect(r.status).toBe(200);
    expect(html).toContain('Import from Confluence');
    expect(html).toContain('Choose who it'); // the audience step
    expect(html).toContain('Get an API token'); // one-click route to the token page (no manual hunt)
    expect(html).toContain('window.LW_TOKEN_PATH'); // server injects the configurable token path
    expect(html).toContain('/my-account/auth'); // default: the user's Access & Security page
    // the server-injected config <script> must be valid JS too (served raw, not just the constant)
    for (const s of scriptBlocks(html)) expect(() => new Function(s)).not.toThrow();
    // no external asset loads (placeholder example URLs in input fields are fine)
    expect(/(src|href)\s*=\s*["']https?:\/\//i.test(html)).toBe(false);
  });

  it('healthz is ok', async () => {
    expect((await (await fetch(`${base()}/healthz`)).json()).ok).toBe(true);
  });

  it('serves the mountable UI asset at /import/ui.js as javascript', async () => {
    const r = await fetch(`${base()}/import/ui.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toContain('javascript');
    const js = await r.text();
    expect(js).toContain('lw-import-root'); // it mounts the UI
    expect(() => new Function(js)).not.toThrow(); // and it parses
  });

  it('lists the user\'s books as destinations when the token is valid', async () => {
    const r = await fetch(`${base()}/import/api/destinations`, {
      method: 'POST',
      headers: { 'x-bookstack-base': bs(), 'x-bookstack-token-id': 'id123', 'x-bookstack-token-secret': 'secret456' },
    });
    const d = await r.json();
    expect(d.ok).toBe(true);
    expect(d.books).toEqual([{ id: 3, name: 'Team Space' }, { id: 7, name: 'Personal' }]);
  });

  it('rejects a bad token (fail closed, no destinations leaked)', async () => {
    const r = await fetch(`${base()}/import/api/destinations`, {
      method: 'POST',
      headers: { 'x-bookstack-base': bs(), 'x-bookstack-token-id': 'id123', 'x-bookstack-token-secret': 'WRONG' },
    });
    expect(r.status).toBe(401);
    expect((await r.json()).ok).toBe(false);
  });

  it('refuses destinations with no creds', async () => {
    const r = await fetch(`${base()}/import/api/destinations`, { method: 'POST' });
    expect(r.status).toBe(400);
  });

  it('blocks SSRF to cloud metadata via a crafted base URL', async () => {
    const r = await fetch(`${base()}/import/api/destinations`, {
      method: 'POST',
      headers: { 'x-bookstack-base': 'http://169.254.169.254', 'x-bookstack-token-id': 'id123', 'x-bookstack-token-secret': 'secret456' },
    });
    expect(r.status).toBe(400); // base resolves to '' → treated as missing, never fetched
  });

  it('refuses an import with no creds', async () => {
    const r = await fetch(`${base()}/import/run?dest=new`, { method: 'POST', body: 'x' });
    expect(r.status).toBe(400);
    expect((await r.json()).ok).toBe(false);
  });

  it('runs the import as a BACKGROUND job: /import/run returns a jobId, /import/status tracks it to completion', async () => {
    const h = { 'x-bookstack-base': bs(), 'x-bookstack-token-id': 'id123', 'x-bookstack-token-secret': 'secret456' };
    const r = await fetch(`${base()}/import/run?dest=new`, { method: 'POST', headers: h, body: 'not a real zip' });
    const d = await r.json();
    expect(r.status).toBe(200);              // upload accepted, job started, returned immediately
    expect(d.ok).toBe(true);
    expect(typeof d.jobId).toBe('string');
    // poll until the detached job finishes (it errors here: the body is not a valid zip)
    let st: any;
    for (let i = 0; i < 40; i++) {
      st = await (await fetch(`${base()}/import/status?id=${d.jobId}`)).json();
      if (st.status !== 'running') break;
      await new Promise((res) => setTimeout(res, 50));
    }
    expect(st.ok).toBe(true);
    expect(st.status).toBe('error');         // unzip of a non-zip fails → job ends in error, not a hang
    expect(String(st.error)).toMatch(/unzip|Confluence/i);
  });

  it('returns 404 for an unknown job id (and never hangs)', async () => {
    const r = await fetch(`${base()}/import/status?id=does-not-exist`);
    expect(r.status).toBe(404);
    expect((await r.json()).ok).toBe(false);
  });
});
