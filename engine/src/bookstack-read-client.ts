import type { ResourceId } from './types.js';

/**
 * Read-side BookStack client: candidate search + content fetch.
 *
 * Runs as a service account (an API token), NOT as the end user. That's correct:
 * search/fetch happen with broad access, and the END-USER permission gate is
 * applied separately by the authz endpoint (see BookStackDocStore). We only ever
 * fetch a document AFTER canRead has allowed it for the requesting user.
 *
 * Auth: BookStack API tokens →  Authorization: Token <id>:<secret>
 * Endpoints: GET /api/search, GET /api/pages|books|chapters/{id}
 */
export class BookStackReadClient {
  private readonly base: string;
  private readonly auth: string;

  constructor(baseUrl: string, tokenId: string, tokenSecret: string) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.auth = `Token ${tokenId}:${tokenSecret}`;
  }

  /** Candidate generation — returns resource ids like "page:12", "book:3". */
  async search(query: string, count = 20): Promise<ResourceId[]> {
    const data = await this.get(`/api/search?query=${encodeURIComponent(query)}&count=${count}`);
    const results: any[] = data?.data ?? [];
    return results
      .map((r) => {
        const type = r.type === 'bookshelf' ? 'shelf' : r.type; // match authz theme keys
        return r.id != null && type ? `${type}:${r.id}` : null;
      })
      .filter((x): x is string => x !== null);
  }

  /** Fetch a document's title + body. Markdown preferred; falls back to text. */
  async getDoc(id: ResourceId): Promise<{ title: string; content: string }> {
    const [type, rawId] = id.split(':', 2);
    const path =
      type === 'page' ? `/api/pages/${rawId}`
      : type === 'chapter' ? `/api/chapters/${rawId}`
      : type === 'shelf' ? `/api/shelves/${rawId}`
      : `/api/books/${rawId}`;
    const d = await this.get(path);
    const content = d?.markdown || d?.html || d?.description || '';
    return { title: d?.name ?? id, content };
  }

  private async get(path: string): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { Authorization: this.auth, Accept: 'application/json' },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`BookStack ${res.status} on ${path}: ${t.slice(0, 200)}`);
    }
    return res.json();
  }
}
