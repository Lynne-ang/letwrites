import type { ResourceId } from './types.js';

/**
 * Write-side BookStack client: resolve a target book/chapter by name and create-or-update a page.
 * Runs as a service account (an API token), exactly like the read client. The PER-USER WRITE
 * PERMISSION is decided separately by the can-write authz endpoint (see BookStackAuthz.canWrite)
 * BEFORE we ever call this — so this client only ever runs for writes already authorized for the
 * requesting person. Mirrors the real BookStack REST API (verified shapes, see import client).
 *
 * Auth: Authorization: Token <id>:<secret>
 * Endpoints: GET /api/books, /api/chapters, /api/pages ; POST/PUT /api/pages
 */
export interface BookRef { id: number; slug: string; name: string }
export interface PageRef { id: number; slug: string; name: string; book_id: number; chapter_id?: number }

export class BookStackWriteClient {
  private readonly base: string;
  private readonly auth: string;
  constructor(baseUrl: string, tokenId: string, tokenSecret: string) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.auth = `Token ${tokenId}:${tokenSecret}`;
  }

  private async req(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { Authorization: this.auth, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`BookStack ${res.status} on ${method} ${path}: ${t.slice(0, 200)}`);
    }
    return res.json();
  }
  private async list(path: string): Promise<any[]> {
    return (await this.req('GET', `${path}${path.includes('?') ? '&' : '?'}count=500`)).data ?? [];
  }
  private match<T extends { name?: string }>(items: T[], name: string): T | undefined {
    return items.find((x) => (x.name || '').trim().toLowerCase() === name.trim().toLowerCase());
  }

  async findBook(name: string): Promise<BookRef | null> {
    const b = this.match(await this.list('/api/books'), name);
    return b ? { id: b.id, slug: b.slug, name: b.name } : null;
  }
  async findChapter(bookId: number, name: string): Promise<{ id: number; name: string } | null> {
    const c = this.match(await this.list(`/api/chapters?filter[book_id]=${bookId}`), name);
    return c ? { id: c.id, name: c.name } : null;
  }
  /** Existing page with this exact title in the book (optionally within a chapter), or null. */
  async findPage(bookId: number, title: string, chapterId?: number): Promise<PageRef | null> {
    const pages = (await this.list(`/api/pages?filter[book_id]=${bookId}`)).filter((p) => chapterId == null || p.chapter_id === chapterId);
    const p = this.match(pages, title);
    return p ? { id: p.id, slug: p.slug, name: p.name, book_id: p.book_id, chapter_id: p.chapter_id } : null;
  }

  async createPage(target: { bookId: number; chapterId?: number }, title: string, markdown: string): Promise<PageRef> {
    const body: any = { name: title, markdown };
    if (target.chapterId != null) body.chapter_id = target.chapterId; else body.book_id = target.bookId;
    const p = await this.req('POST', '/api/pages', body);
    return { id: p.id, slug: p.slug, name: p.name, book_id: p.book_id, chapter_id: p.chapter_id };
  }
  async updatePage(pageId: number, title: string, markdown: string): Promise<PageRef> {
    const p = await this.req('PUT', `/api/pages/${pageId}`, { name: title, markdown });
    return { id: p.id, slug: p.slug, name: p.name, book_id: p.book_id, chapter_id: p.chapter_id };
  }

  pageUrl(book: BookRef, page: PageRef): ResourceId {
    return `${this.base}/books/${book.slug}/page/${page.slug}`;
  }
}
