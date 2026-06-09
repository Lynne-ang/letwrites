import { readFile } from 'node:fs/promises';

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

export class BookStackImportClient {
  private readonly base: string;
  private readonly auth: string;

  constructor(creds: BookStackCreds) {
    this.base = creds.baseUrl.replace(/\/+$/, '');
    this.auth = `Token ${creds.tokenId}:${creds.tokenSecret}`;
  }

  async createBook(input: { name: string; description?: string }): Promise<number> {
    return (await this.post('/api/books', input)).id;
  }
  async createChapter(input: { book_id: number; name: string }): Promise<number> {
    return (await this.post('/api/chapters', input)).id;
  }
  async createPage(input: {
    book_id?: number;
    chapter_id?: number;
    name: string;
    markdown: string;
  }): Promise<number> {
    return (await this.post('/api/pages', input)).id;
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
    const form = new FormData();
    form.append('type', 'gallery');
    form.append('uploaded_to', String(pageId));
    form.append('name', name);
    form.append('image', new Blob([bytes]), name);
    const res = await fetch(`${this.base}/api/image-gallery`, {
      method: 'POST',
      headers: { Authorization: this.auth }, // do NOT set Content-Type — fetch sets the multipart boundary
      body: form,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`BookStack image upload ${res.status}: ${t.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const url = data?.url ?? (data?.content?.markdown?.match(/\(([^)]+)\)/)?.[1]);
    if (!url) throw new Error('image upload succeeded but no URL in response');
    return url;
  }

  /** Confirm creds + reachability before a long import. */
  async verify(): Promise<boolean> {
    try {
      const res = await fetch(`${this.base}/api/books?count=1`, {
        headers: { Authorization: this.auth, Accept: 'application/json' },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private post(path: string, body: unknown): Promise<any> {
    return this.send('POST', path, body);
  }

  private async send(method: 'POST' | 'PUT', path: string, body: unknown): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        Authorization: this.auth,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`BookStack ${res.status} on ${method} ${path}: ${text.slice(0, 300)}`);
    }
    return res.json();
  }
}
