import type { ConfluenceConfig, ConfluencePage, Attachment } from './types.js';

/**
 * Thin client over the Confluence Cloud REST API (v1: /wiki/rest/api).
 *
 * Pagination model: the API returns `results` plus `_links.next` (a relative
 * path) when more pages exist. We follow `next` until it's absent — robust
 * against large spaces without guessing offsets.
 *
 * Auth: Confluence Cloud uses Basic auth with `email:apiToken`. Server/DC can
 * use a Bearer PAT instead; flip `authHeader()` if you target Server/DC.
 */
export class ConfluenceClient {
  private readonly base: string;
  private readonly auth: string;
  private readonly pageSize: number;

  constructor(private readonly config: ConfluenceConfig) {
    this.base = config.baseUrl.replace(/\/+$/, '');
    this.pageSize = config.pageSize ?? 50;
    this.auth = config.email
      ? 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
      : `Bearer ${config.apiToken}`;
  }

  /**
   * Resolve a path or (paginated/attachment) URL to fetch. SECURITY: the API
   * token rides on every request, so we must NEVER follow an absolute URL to a
   * different origin — a malicious API response could put a cross-origin link in
   * `_links.next`/download and exfiltrate the token. Relative paths and
   * same-origin absolute URLs only.
   */
  private resolveUrl(pathOrUrl: string): string {
    if (!/^https?:\/\//i.test(pathOrUrl)) return `${this.base}${pathOrUrl}`;
    const baseOrigin = new URL(this.base).origin;
    const targetOrigin = new URL(pathOrUrl).origin;
    if (targetOrigin !== baseOrigin) {
      throw new Error(`refusing cross-origin URL ${targetOrigin} (auth would leak; expected ${baseOrigin})`);
    }
    return pathOrUrl;
  }

  private async get(path: string): Promise<any> {
    const url = this.resolveUrl(path);
    const res = await fetch(url, {
      headers: { Authorization: this.auth, Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Confluence API ${res.status} ${res.statusText} for ${url}\n${body.slice(0, 500)}`);
    }
    return res.json();
  }

  /** Verify the space exists and credentials work. Returns the space name. */
  async verifySpace(): Promise<string> {
    const data = await this.get(`/rest/api/space/${encodeURIComponent(this.config.spaceKey)}`);
    return data?.name ?? this.config.spaceKey;
  }

  /**
   * Fetch every page in the space, with body + ancestry, following pagination.
   * `ancestors` gives us the parent chain so we can rebuild the tree.
   */
  async fetchAllPages(): Promise<ConfluencePage[]> {
    const pages: ConfluencePage[] = [];
    const expand = 'body.storage,ancestors,version';
    let next: string | null =
      `/rest/api/content?spaceKey=${encodeURIComponent(this.config.spaceKey)}` +
      `&type=page&status=current&expand=${expand}&limit=${this.pageSize}`;

    while (next) {
      const data: any = await this.get(next);
      for (const r of data.results ?? []) {
        const ancestors: any[] = r.ancestors ?? [];
        const parent = ancestors.length ? ancestors[ancestors.length - 1] : null;
        pages.push({
          id: String(r.id),
          title: r.title ?? '(untitled)',
          parentId: parent ? String(parent.id) : null,
          storageBody: r.body?.storage?.value ?? '',
          version: r.version?.number ?? 1,
        });
      }
      next = data._links?.next ?? null;
    }
    return pages;
  }

  /** Attachments for a single page (paginated). */
  async fetchAttachments(pageId: string): Promise<Attachment[]> {
    const out: Attachment[] = [];
    let next: string | null = `/rest/api/content/${pageId}/child/attachment?limit=${this.pageSize}`;
    while (next) {
      const data: any = await this.get(next);
      for (const r of data.results ?? []) {
        const dl = r._links?.download;
        if (!dl) continue;
        out.push({
          id: String(r.id),
          fileName: r.title ?? String(r.id),
          downloadPath: dl, // relative to /wiki, resolved at download time
          mediaType: r.metadata?.mediaType ?? 'application/octet-stream',
          pageId,
        });
      }
      next = data._links?.next ?? null;
    }
    return out;
  }

  /** Download an attachment's bytes. `downloadPath` is relative to the wiki base. */
  async downloadAttachment(downloadPath: string): Promise<Buffer> {
    const url = this.resolveUrl(downloadPath); // same-origin guard (auth attached)
    const res = await fetch(url, { headers: { Authorization: this.auth } });
    if (!res.ok) throw new Error(`Attachment download failed ${res.status} for ${url}`);
    return Buffer.from(await res.arrayBuffer());
  }
}
