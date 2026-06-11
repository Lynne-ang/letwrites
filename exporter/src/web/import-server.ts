#!/usr/bin/env node
/**
 * Letwrites self-service import — a small web page a team member uses to migrate their own
 * Confluence content. They sign in (you front this with your SSO at /import), upload their
 * Confluence "Export space → HTML" zip, pick where it lands (an audience space they can write to),
 * and get the migration integrity report.
 *
 * Key property: the import runs with the USER'S OWN BookStack API token, so it can only create or
 * write where that person is allowed. A delegated team editor migrates their team's space WITHOUT
 * admin rights (pick an existing book they can edit → scoped import, no "Create Books" needed). The
 * data never leaves your servers; this service only shuttles the upload to your own BookStack.
 *
 *   PORT=8080 node dist/web/import-server.js     # front with Caddy at /import behind SSO
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtempSync, createWriteStream, rmSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ingestConfluenceHtmlExport } from '../confluence-html-export.js';
import { loadPlanFromDir } from '../load-plan.js';
import { scopeToBook } from '../import-planner.js';
import { runImport } from '../importer.js';
import { BookStackImportClient, resilientFetch } from '../bookstack-import-client.js';
import { buildVisibilityPayload, effectiveNewBookVisibility, type Visibility } from '../content-visibility.js';
import { buildIntegrityReport, renderIntegrityReport } from '../integrity.js';
import { PAGE_HTML } from './import-page.js';
import { IMPORT_UI_ASSET_JS } from './import-ui.js';
import { resolveBase } from './safe-base.js';

const PORT = Number(process.env.PORT ?? 8080);
// The Letwrites logo, served at /import/logo.png so BOTH the standalone page and the in-wiki page
// (which reaches /import/* through Caddy) show the same brand mark without an external asset.
let LOGO_PNG: Buffer | null = null;
try { LOGO_PNG = readFileSync(new URL('./letwrites-logo.png', import.meta.url)); } catch { LOGO_PNG = null; }
// Default 2 GB. Because we STREAM the upload straight to disk (below), this is a sanity ceiling, not a
// memory limit — real Confluence exports with images are large. Operators raise it via the env var.
const MAX_UPLOAD = Number(process.env.LETWRITES_IMPORT_MAX_BYTES ?? 2 * 1024 * 1024 * 1024);

const json = (res: ServerResponse, code: number, obj: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

/**
 * Stream the request body straight to a file on disk, enforcing the byte cap AS IT FLOWS — never
 * buffering the whole upload in memory (a multi-GB Confluence export would OOM the old Buffer.concat
 * approach). On overflow the pipeline rejects and the half-written file is cleaned up by the caller.
 */
export async function saveUploadToFile(req: IncomingMessage, destPath: string, cap: number): Promise<void> {
  let size = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      size += chunk.length;
      if (size > cap) { cb(new Error(`upload exceeds the ${Math.round(cap / 1024 / 1024)} MB limit`)); return; }
      cb(null, chunk);
    },
  });
  await pipeline(req, meter, createWriteStream(destPath));
}

interface Creds { baseUrl: string; tokenId: string; tokenSecret: string }
function credsFrom(headers: IncomingMessage['headers']): Creds {
  const h = (k: string) => (Array.isArray(headers[k]) ? headers[k]![0] : headers[k]) as string ?? '';
  return { baseUrl: resolveBase(h('x-bookstack-base')), tokenId: h('x-bookstack-token-id'), tokenSecret: h('x-bookstack-token-secret') };
}

/** List the books this user can see, so they pick an existing one as the destination (audience). */
async function listBooks(c: Creds): Promise<{ id: number; name: string }[]> {
  const res = await resilientFetch(`${c.baseUrl}/api/books?count=500`, { headers: { Authorization: `Token ${c.tokenId}:${c.tokenSecret}` } }, { timeoutMs: 15_000, attempts: 2, label: 'listing your spaces' });
  if (!res.ok) throw new Error(res.status === 401
    ? 'BookStack rejected the token (401) — double-check the Token ID and Secret.'
    : `BookStack returned ${res.status} while listing your spaces.`);
  const body = await res.json();
  return (body.data ?? []).map((b: any) => ({ id: b.id, name: String(b.name) }));
}

/** Find the actual export root inside an unzipped dir (descend through a single wrapper folder). */
function exportRoot(dir: string): string {
  let cur = dir;
  for (let i = 0; i < 3; i++) {
    const entries = readdirSync(cur).filter((e) => !e.startsWith('__MACOSX') && !e.startsWith('.'));
    if (entries.length === 1) {
      const sub = join(cur, entries[0]);
      try { if (statSync(sub).isDirectory()) { cur = sub; continue; } } catch { /* */ }
    }
    break;
  }
  return cur;
}

// Background import jobs. The upload is received synchronously (the page must stay open until it
// finishes), then the import runs DETACHED — it keeps going if the user leaves or closes the tab.
// The browser gets a jobId and polls /import/status. Jobs live in memory (single-process service);
// a service restart loses tracking (the partial import in BookStack stays), which the UI handles.
interface ImportJob {
  id: string;
  status: 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt?: number;
  log: string[];
  summary?: { books: number; chapters: number; pages: number; imagesUploaded: number; imagesMissing: number; flattened: number };
  report?: string;
  error?: string;
  // Top-level books created this run (id + name + slug). The in-wiki page reads these to set
  // visibility via the session/broker — the only path a NON-admin importer can restrict content.
  createdBooks?: { id: number; name: string }[];
  // True when the caller deferred visibility to the in-wiki broker (vis=defer): the books are created
  // unrestricted and the page must restrict them right after. Surfaced so the UI knows to do that.
  deferred?: boolean;
}
const jobs = new Map<string, ImportJob>();
const JOB_TTL_MS = 6 * 60 * 60_000; // keep finished jobs 6h so a user can reopen and see the result
function pruneJobs() {
  const now = Date.now();
  for (const [id, j] of jobs) if (j.finishedAt && now - j.finishedAt > JOB_TTL_MS) jobs.delete(id);
}

/** Apply the chosen visibility to the books the import created. Fail-safe: returns the per-book
 *  outcome so a restriction that DIDN'T apply is surfaced loudly (never silently left public). */
async function applyVisibility(client: BookStackImportClient, books: { id: number; name: string }[], vis: Visibility, log: (m: string) => void): Promise<string[]> {
  const failures: string[] = [];
  for (const b of books) {
    try {
      const current = await client.getContentPermissions('book', b.id);
      await client.setContentPermissions('book', b.id, buildVisibilityPayload(current, vis));
      log(`  visibility: "${b.name}" → ${vis.mode === 'groups' ? `restricted to ${vis.roleIds?.length} group(s)` : vis.mode}`);
    } catch (e) {
      failures.push(`${b.name}: ${(e as Error).message}`);
      log(`  ! visibility NOT applied to "${b.name}" — ${(e as Error).message}`);
    }
  }
  return failures;
}

/** The detached worker: unzip → ingest → plan → import → set visibility → report. Cleans up the dir. */
async function runJob(job: ImportJob, work: string, zipPath: string, creds: Creds, dest: string, vis: Visibility | null, defer = false): Promise<void> {
  const log = (m: string) => { job.log.push(m); };
  try {
    const extracted = join(work, 'extracted');
    const unzip = spawnSync('unzip', ['-o', '-q', zipPath, '-d', extracted]);
    if (unzip.status !== 0) throw new Error('Could not unzip the upload. Provide a Confluence "Export space → HTML" .zip.');

    const tree = join(work, 'tree');
    const ingest = ingestConfluenceHtmlExport(exportRoot(extracted), tree);
    let plan = await loadPlanFromDir(tree);
    if (plan.pages.length === 0) throw new Error('No Confluence pages found in this upload. Use "Export space → HTML" in Confluence (not PDF/Word/XML) and upload that .zip.');

    let targetBookId: number | undefined;
    if (dest !== 'new') {
      targetBookId = Number(dest);
      if (!Number.isInteger(targetBookId) || targetBookId <= 0) throw new Error('Invalid destination.');
      plan = scopeToBook(plan); // nest under the chosen book → no "Create Books" right needed
    }

    const client = new BookStackImportClient(creds);
    if (!(await client.verify())) throw new Error('Could not authenticate to BookStack with that token.');

    log(`Importing ${plan.pages.length} page(s)…`);
    const summary = await runImport(plan, client, log, tree, { targetBookId });

    // Set who-can-see on the created books. Importing into an existing book inherits that book's
    // permissions. For a NEW top-level book we FAIL CLOSED: the ONLY path to public is an explicit
    // "everyone". A missing/invalid choice (null vis, or "groups" with no valid role — e.g. a direct
    // API call or a bypassed UI) defaults to "only me" (private), never silently public.
    let visNote = '';
    if (defer && dest === 'new' && summary.createdBooks.length) {
      // The in-wiki page will restrict these via the session/broker (a non-admin's token can't set
      // permissions). Hand the books back; the UI applies the chosen visibility right after this.
      job.createdBooks = summary.createdBooks;
      job.deferred = true;
      visNote = '\nVisibility: applying your choice now via the wiki…';
    } else if (dest !== 'new') {
      visNote = '\nVisibility: inherits the destination book you chose.';
    } else if (vis && vis.mode === 'everyone') {
      visNote = '\nVisibility: everyone who can reach the space (you chose public).';
    } else if (summary.createdBooks.length) {
      const effective = effectiveNewBookVisibility(vis); // fail-closed: null/empty-groups → only-me (private)
      if (effective.mode === 'only-me' && !(vis && vis.mode === 'only-me')) {
        log('  visibility: no explicit/valid choice provided → defaulting to "only me" (private), not public.');
      }
      const failures = await applyVisibility(client, summary.createdBooks, effective, log);
      if (failures.length) {
        visNote = `\n⚠️ VISIBILITY NOT FULLY APPLIED — ${failures.length} book(s) may still be visible to others. ` +
          `Your token likely lacks "Manage Permissions". Restrict them now via "Who can see this?". Details:\n  • ` + failures.join('\n  • ');
      } else {
        visNote = effective.mode === 'only-me' ? '\nVisibility: restricted to you (owner) + admins. ✓'
          : `\nVisibility: restricted to ${effective.roleIds?.length} group(s); everyone else denied. ✓`;
      }
    }

    const report = buildIntegrityReport({ plan, pagesImported: summary.pages, imageManifest: summary.imageManifest, sourceBaseline: { pages: ingest.sourcePages, images: ingest.sourceImages }, failedPageDetails: summary.failedPages, links: { rewritten: summary.linksRewritten, broken: summary.linksBroken }, files: { uploaded: summary.filesUploaded, missing: summary.filesMissing }, source: 'Confluence HTML export (self-service upload)' });
    job.summary = { books: summary.books, chapters: summary.chapters, pages: summary.pages, imagesUploaded: summary.imagesUploaded, imagesMissing: summary.imagesMissing, flattened: summary.flattened };
    job.report = renderIntegrityReport(report) + visNote;
    job.status = 'done';
  } catch (e) {
    job.error = (e as Error).message;
    job.status = 'error';
  } finally {
    job.finishedAt = Date.now();
    rmSync(work, { recursive: true, force: true });
  }
}

/** Parse the chosen visibility from the run URL: ?vis=everyone|only-me|groups [&roles=2,5]. */
function parseVisibility(params: URLSearchParams): Visibility | null {
  const m = params.get('vis');
  if (m === 'everyone' || m === 'only-me') return { mode: m };
  if (m === 'groups') return { mode: 'groups', roleIds: (params.get('roles') ?? '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0) };
  return null;
}

async function handleImport(req: IncomingMessage, res: ServerResponse, dest: string, vis: Visibility | null, defer = false): Promise<void> {
  const creds = credsFrom(req.headers);
  if (!creds.baseUrl || !creds.tokenId || !creds.tokenSecret) return json(res, 400, { ok: false, error: 'Missing BookStack URL or API token.' });

  const work = mkdtempSync(join(tmpdir(), 'letwrites-import-'));
  const zipPath = join(work, 'upload.zip');
  try {
    await saveUploadToFile(req, zipPath, MAX_UPLOAD); // must finish while the page is open
  } catch (e) {
    rmSync(work, { recursive: true, force: true });
    return json(res, 400, { ok: false, error: (e as Error).message });
  }

  // Upload received — start the import in the background and hand back a job id immediately.
  pruneJobs();
  const id = randomUUID();
  const job: ImportJob = { id, status: 'running', startedAt: Date.now(), log: [] };
  jobs.set(id, job);
  void runJob(job, work, zipPath, creds, dest, vis, defer);
  return json(res, 200, { ok: true, jobId: id });
}

function handleStatus(res: ServerResponse, id: string): void {
  const job = jobs.get(id);
  if (!job) return json(res, 404, { ok: false, error: 'This import is no longer tracked (it finished long ago, or the service restarted).' });
  // "pages so far" derived from the importer's per-page log lines, for the live progress indicator.
  const count = job.log.filter((l) => l.includes('page:')).length;
  return json(res, 200, {
    ok: true,
    status: job.status,
    count,
    log: job.log.slice(-60),
    summary: job.summary ?? null,
    report: job.report ?? null,
    error: job.error ?? null,
    createdBooks: job.createdBooks ?? null, // present only on a deferred (broker-visibility) run
    deferred: job.deferred ?? false,
  });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname;
    // All routes live under /import so a single Caddy `handle /import*` can front the whole service.
    if (req.method === 'GET' && (p === '/import' || p === '/import/' || p === '/')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      // Tell the page where this BookStack version puts the user's API-token page (the "Get a token"
      // button opens <wiki>+this). Default suits BookStack v26.05; override with LETWRITES_TOKEN_PATH.
      const tokenPath = process.env.LETWRITES_TOKEN_PATH || '/my-account/auth';
      return res.end(PAGE_HTML.replace('</head>', `<script>window.LW_TOKEN_PATH=${JSON.stringify(tokenPath)};</script>\n</head>`));
    }
    // The shared UI as a mountable asset. The in-wiki page (theme route /letwrites/import) loads
    // this so the import renders inside native BookStack chrome — same UI source as the page above.
    if (req.method === 'GET' && (p === '/import/ui.js')) {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(IMPORT_UI_ASSET_JS);
    }
    if (req.method === 'GET' && p === '/import/logo.png') {
      if (!LOGO_PNG) return json(res, 404, { ok: false, error: 'logo not found' });
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
      return res.end(LOGO_PNG);
    }
    if (req.method === 'GET' && (p === '/import/healthz' || p === '/healthz')) return json(res, 200, { ok: true, service: 'letwrites-import' });
    if (req.method === 'POST' && p === '/import/api/destinations') {
      const creds = credsFrom(req.headers);
      if (!creds.baseUrl || !creds.tokenId || !creds.tokenSecret) return json(res, 400, { ok: false, error: 'Enter your BookStack URL and API token.' });
      // Surface the real reason (bad token vs unreachable vs timeout) instead of collapsing every
      // failure into "token is invalid" — a hung BookStack was being misreported as a bad token.
      try { return json(res, 200, { ok: true, books: await listBooks(creds) }); }
      catch (e) {
        const msg = (e as Error).message;
        const isAuth = /\b401\b|rejected the token/i.test(msg); // real bad-token stays 401; reach errors are 502
        return json(res, isAuth ? 401 : 502, { ok: false, error: msg });
      }
    }
    // List roles/groups so the import can offer "restrict to a group". Only works for a token that can
    // manage roles (admin/IT migrator); a plain token gets 403 and the UI hides the group option.
    if (req.method === 'POST' && p === '/import/api/roles') {
      const creds = credsFrom(req.headers);
      if (!creds.baseUrl || !creds.tokenId || !creds.tokenSecret) return json(res, 400, { ok: false, error: 'Enter your BookStack URL and API token.' });
      try { return json(res, 200, { ok: true, roles: await new BookStackImportClient(creds).listRoles() }); }
      catch (e) { return json(res, 200, { ok: false, roles: [], error: (e as Error).message }); } // soft-fail: UI degrades to Everyone/Only-me
    }
    if (req.method === 'POST' && p === '/import/run') {
      // vis=defer: a non-admin in the wiki — create books unrestricted, the page restricts via the broker.
      const defer = url.searchParams.get('vis') === 'defer';
      return handleImport(req, res, url.searchParams.get('dest') ?? 'new', defer ? null : parseVisibility(url.searchParams), defer);
    }
    // Poll the background import job (lets the browser show live progress + survive a page close).
    if (req.method === 'GET' && p === '/import/status') {
      return handleStatus(res, url.searchParams.get('id') ?? '');
    }
    json(res, 404, { ok: false, error: 'not found' });
  } catch (e) {
    json(res, 500, { ok: false, error: (e as Error).message });
  }
});

// A large Confluence export can take a while to upload over a slow link. Node's default whole-request
// timeout is 5 min, which would abort a big upload — raise it (default 30 min, tunable). This service
// is internal + behind your SSO, so a generous request window is safe.
server.requestTimeout = Number(process.env.LETWRITES_IMPORT_REQUEST_TIMEOUT_MS ?? 30 * 60_000);

// Don't auto-listen when imported by a test. Match both the compiled .js entry and the tsx .ts run.
if (process.argv[1] && /import-server\.(js|ts)$/.test(process.argv[1])) {
  server.listen(PORT, () => console.log(`[import] self-service import on :${PORT} (front with Caddy at /import behind your SSO)`));
}
export { server };
