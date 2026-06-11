import { readFile } from 'node:fs/promises';
import type { ContentPermissions } from './content-visibility.js';

/**
 * Minimal BookStack REST client for creating content during import.
 *
 * Auth: BookStack uses an API token pair in the header:
 *   Authorization: Token <token_id>:<token_secret>
 * Create one in BookStack under Edit Profile ▸ API Tokens.
 *
 * Endpoints used: POST /api/books, /api/chapters, /api/pages
 * (see https://demo.bookstackapp.com/api/docs)
 */
export interface BookStackCreds {
  baseUrl: string;       // e.g. http://localhost:6875
  tokenId: string;
  tokenSecret: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 408/425/429 + 5xx are transient — worth a retry. Everything else (4xx) fails fast.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const backoff = (attempt: number) => Math.min(2000, 300 * 2 ** (attempt - 1)); // 300, 600, 1200ms…

export interface ResilientOpts { timeoutMs?: number; attempts?: number; label?: string }

/** Detect an image's type from its magic bytes (for Confluence attachments stored without an extension). */
function sniffImage(b: Buffer): { ext: string; mime: string } | null {
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: '.png', mime: 'image/png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: '.jpg', mime: 'image/jpeg' };
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: '.gif', mime: 'image/gif' };
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { ext: '.webp', mime: 'image/webp' };
  if (b.toString('ascii', 0, 200).includes('<svg')) return { ext: '.svg', mime: 'image/svg+xml' };
  return null;
}

/**
 * fetch with a HARD per-attempt timeout (so a hung BookStack connection can never freeze the import)
 * plus bounded retries on transient failures (so one blip mid-migration doesn't abort it). Throws a
 * clear, human-readable error on timeout/network failure. This is the spine of "slow is fine, stuck
 * is not". Tunable via LETWRITES_HTTP_TIMEOUT_MS.
 */
export async function resilientFetch(url: string, init: RequestInit, opts: ResilientOpts = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? Number(process.env.LETWRITES_HTTP_TIMEOUT_MS ?? 20_000);
  const attempts = opts.attempts ?? 3;
  const label = opts.label ?? 'contacting BookStack';
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctrl.signal });
      clearTimeout(timer);
      if (RETRYABLE_STATUS.has(res.status) && attempt < attempts) { await sleep(backoff(attempt)); continue; }
      return res;
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      if (attempt < attempts) { await sleep(backoff(attempt)); continue; }
      const aborted = (e as { name?: string })?.name === 'AbortError';
      throw new Error(aborted
        ? `BookStack did not respond within ${Math.round(timeoutMs / 1000)}s while ${label}. It may be overloaded — slow is fine, but this looks stuck; re-run when it's responsive.`
        : `Could not reach BookStack while ${label}: ${(e as Error).message}`);
    }
  }
  throw (lastErr instanceof Error ? lastErr : new Error(`request failed while ${label}`));
}

export class BookStackImportClient {
  private readonly base: string;
  private readonly auth: string;

  constructor(creds: BookStackCreds) {
    this.base = creds.baseUrl.replace(/\/+$/, '');
    this.auth = `Token ${creds.tokenId}:${creds.tokenSecret}`;
  }

  async createBook(input: { name: string; description?: string }): Promise<{ id: number; slug: string }> {
    const r = await this.post('/api/books', input);
    return { id: r.id, slug: String(r.slug ?? '') };
  }
  async createChapter(input: { book_id: number; name: string }): Promise<number> {
    return (await this.post('/api/chapters', input)).id;
  }
  async createPage(input: {
    book_id?: number;
    chapter_id?: number;
    name: string;
    markdown: string;
  }): Promise<{ id: number; slug: string; book_id: number }> {
    const r = await this.post('/api/pages', input);
    return { id: r.id, slug: String(r.slug ?? ''), book_id: Number(r.book_id) };
  }

  /** Update a page's markdown (used after rewriting image refs). */
  async updatePage(pageId: number, markdown: string): Promise<void> {
    await this.send('PUT', `/api/pages/${pageId}`, { markdown });
  }

  /**
   * Upload a local image to the page's gallery; return its BookStack URL.
   * Implements ImageUploader (import-images.ts). Uses POST /api/image-gallery
   * (multipart). NOTE: verify the response shape against your BookStack version —
   * recent versions return { url, ... }; we fall back to content.markdown's URL.
   */
  async upload(pageId: number, absPath: string, name: string): Promise<string> {
    const bytes = await readFile(absPath);
    // Confluence sometimes stores an attachment with NO file extension; BookStack then rejects it as
    // not-an-image. Sniff the magic bytes, give it the right extension + MIME so the upload is accepted.
    const sniff = sniffImage(bytes);
    let uploadName = name;
    if (sniff && !/\.(png|jpe?g|gif|webp|svg|bmp|tiff?)$/i.test(uploadName)) uploadName += sniff.ext;
    const blob = sniff ? new Blob([bytes], { type: sniff.mime }) : new Blob([bytes]);
    const form = new FormData();
    form.append('type', 'gallery');
    form.append('uploaded_to', String(pageId));
    form.append('name', uploadName);
    form.append('image', blob, uploadName);
    const res = await resilientFetch(`${this.base}/api/image-gallery`, {
      method: 'POST',
      headers: { Authorization: this.auth }, // do NOT set Content-Type — fetch sets the multipart boundary
      body: form,
    }, { timeoutMs: Number(process.env.LETWRITES_UPLOAD_TIMEOUT_MS ?? 90_000), label: `uploading image "${name}"` });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`BookStack image upload ${res.status}: ${t.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const url = data?.url ?? (data?.content?.markdown?.match(/\(([^)]+)\)/)?.[1]);
    if (!url) throw new Error('image upload succeeded but no URL in response');
    return url;
  }

  /** List roles/groups (needs a token that can manage roles — typically an admin). Throws on 403. */
  async listRoles(): Promise<{ id: number; display_name: string }[]> {
    const res = await resilientFetch(`${this.base}/api/roles?count=500`, { headers: { Authorization: this.auth, Accept: 'application/json' } }, { timeoutMs: 15_000, attempts: 2, label: 'listing roles' });
    if (!res.ok) throw new Error(`BookStack ${res.status} listing roles`);
    const body = await res.json();
    return (body.data ?? []).map((r: any) => ({ id: r.id, display_name: String(r.display_name ?? r.name ?? `role ${r.id}`) }));
  }

  /** A book's slug (for building inter-page link URLs to pages in an existing/scoped destination book). */
  async getBookSlug(id: number): Promise<string> {
    const res = await resilientFetch(`${this.base}/api/books/${id}`, { headers: { Authorization: this.auth, Accept: 'application/json' } }, { timeoutMs: 15_000, attempts: 2, label: `reading book ${id}` });
    if (!res.ok) throw new Error(`BookStack ${res.status} reading book ${id}`);
    return String((await res.json()).slug ?? '');
  }

  /** Read an entity's current content-permissions (for GET-merge-PUT, preserving owner_id). */
  async getContentPermissions(type: string, id: number): Promise<ContentPermissions> {
    const res = await resilientFetch(`${this.base}/api/content-permissions/${type}/${id}`, { headers: { Authorization: this.auth, Accept: 'application/json' } }, { label: `reading permissions for ${type}/${id}` });
    if (!res.ok) throw new Error(`BookStack ${res.status} reading permissions for ${type}/${id}`);
    return (await res.json()) as ContentPermissions;
  }

  /** Set an entity's content-permissions (who can see it). Needs "Manage Permissions" on the token's user. */
  async setContentPermissions(type: string, id: number, payload: ContentPermissions): Promise<void> {
    await this.send('PUT', `/api/content-permissions/${type}/${id}`, payload);
  }

  /** Upload a local FILE (non-image attachment: pdf, mp4, etc.) to a page; return its download URL. */
  async uploadAttachment(pageId: number, absPath: string, name: string): Promise<string> {
    const bytes = await readFile(absPath);
    const form = new FormData();
    form.append('uploaded_to', String(pageId));
    form.append('name', name);
    form.append('file', new Blob([bytes]), name);
    const res = await resilientFetch(`${this.base}/api/attachments`, {
      method: 'POST', headers: { Authorization: this.auth }, body: form,
    }, { timeoutMs: Number(process.env.LETWRITES_UPLOAD_TIMEOUT_MS ?? 90_000), label: `uploading attachment "${name}"` });
    if (!res.ok) { const t = await res.text().catch(() => ''); throw new Error(`BookStack attachment upload ${res.status}: ${t.slice(0, 200)}`); }
    const data: any = await res.json();
    return data?.links?.html ?? `/attachments/${data.id}`; // BookStack serves the file at /attachments/<id>
  }

  /** Confirm creds + reachability before a long import. */
  async verify(): Promise<boolean> {
    try {
      const res = await resilientFetch(`${this.base}/api/books?count=1`, {
        headers: { Authorization: this.auth, Accept: 'application/json' },
      }, { timeoutMs: 12_000, attempts: 2, label: 'checking the connection' });
      return res.ok;
    } catch {
      return false;
    }
  }

  private post(path: string, body: unknown): Promise<any> {
    return this.send('POST', path, body);
  }

  private async send(method: 'POST' | 'PUT', path: string, body: unknown): Promise<any> {
    const res = await resilientFetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: this.auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    }, { label: `${method} ${path}` });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 403 && path === '/api/books') {
        throw new Error(`BookStack 403 creating a book: your API token's user lacks the "Create Books" permission. ` +
          `Either ask an admin to grant it, or re-run with --into-book <id> to import into a book you can already edit. (${text.slice(0, 200)})`);
      }
      if (res.status === 403) {
        throw new Error(`BookStack 403 on ${method} ${path}: your API token's user is not allowed to do this. ` +
          `Check that user's role permissions for the target space. (${text.slice(0, 200)})`);
      }
      throw new Error(`BookStack ${res.status} on ${method} ${path}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }
}
