import type { Principal, ResourceId } from './types.js';

/**
 * Client for the BookStack Letwrites authz endpoint (wiki/themes/letwrites/functions.php).
 *
 *   engine ──POST /letwrites/can-read {userId, resourceIds}──▶ BookStack
 *          ◀── {allowed: [...]} ── (BookStack's own permission scope decides)
 *
 * FAIL-CLOSED contract (locked in the eng review): if the endpoint errors,
 * times out, or returns anything unexpected, we return an EMPTY allow-set —
 * deny everything. A permission service that's down must never leak content.
 */
export class BookStackAuthz {
  private readonly base: string;

  constructor(
    baseUrl: string,
    private readonly secret: string,
    private readonly timeoutMs = 3000,
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
  }

  async health(): Promise<boolean> {
    try {
      const res = await this.req('GET', '/letwrites/health');
      if (!res.ok) return false;
      const body = (await res.json()) as { ok?: boolean };
      return body?.ok === true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the subset of `resourceIds` the principal may read.
   * Empty set on any failure (fail closed).
   */
  async canRead(principal: Principal, resourceIds: ResourceId[]): Promise<Set<ResourceId>> {
    if (resourceIds.length === 0) return new Set();
    try {
      const res = await this.req('POST', '/letwrites/can-read', {
        userId: Number(principal.userId),
        resourceIds,
      });
      if (!res.ok) return new Set(); // 401/422/5xx → deny all
      const body = (await res.json()) as { allowed?: unknown };
      if (!Array.isArray(body.allowed)) return new Set();
      // Only trust ids we actually asked about (defense against a bad response
      // echoing extra ids).
      const requested = new Set(resourceIds);
      return new Set(body.allowed.filter((x): x is string => typeof x === 'string' && requested.has(x)));
    } catch {
      return new Set(); // network error / timeout → deny all
    }
  }

  /**
   * Authoritative WRITE permission check, fail-closed. Asks BookStack (the theme's can-write
   * route) whether this user may create a page in the target book/chapter, or update an existing
   * page. Any error/timeout/non-2xx ⇒ false (deny). The agent can never write where the human
   * behind it can't.
   */
  async canWrite(principal: Principal, target: { bookId: number; chapterId?: number; pageId?: number }): Promise<boolean> {
    try {
      const res = await this.req('POST', '/letwrites/can-write', {
        userId: Number(principal.userId),
        bookId: target.bookId,
        ...(target.chapterId != null ? { chapterId: target.chapterId } : {}),
        ...(target.pageId != null ? { pageId: target.pageId } : {}),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { allowed?: unknown };
      return body.allowed === true;
    } catch {
      return false; // network error / timeout ⇒ deny
    }
  }

  private async req(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await fetch(`${this.base}${path}`, {
        method,
        headers: {
          'X-Letwrites-Secret': this.secret,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
