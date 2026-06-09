import type { DocStore } from './doc-store.js';
import type { Principal, ResourceId } from './types.js';
import { BookStackAuthz } from './bookstack-authz-client.js';
import { BookStackReadClient } from './bookstack-read-client.js';

/**
 * The LIVE DocStore — the production source behind the engine.
 *
 * Composes the two BookStack clients behind the same boundary the in-memory demo
 * uses, so `answer()` is identical whether it's running the demo or against a real
 * Letwrites:
 *
 *   search()  → BookStack API search        (service-account, candidates only)
 *   canRead() → BookStack /letwrites/can-read   (authoritative, the END user's perms)
 *   getDoc()  → BookStack API page fetch      (only after canRead allows)
 *
 * Swapping `new InMemorySource()` → `new BookStackDocStore({...})` is the entire
 * change to go from demo to live. The engine, the audit, and the fail-closed
 * guarantees are unchanged.
 */
export interface BookStackDocStoreOptions {
  baseUrl: string;
  /** API token pair (a service account that can read content) for search + fetch. */
  apiTokenId: string;
  apiTokenSecret: string;
  /** Shared secret for the Letwrites authz endpoint (the permission check). */
  authzSecret: string;
  authzTimeoutMs?: number;
}

export class BookStackDocStore implements DocStore {
  private readonly read: BookStackReadClient;
  private readonly authz: BookStackAuthz;

  constructor(opts: BookStackDocStoreOptions) {
    this.read = new BookStackReadClient(opts.baseUrl, opts.apiTokenId, opts.apiTokenSecret);
    this.authz = new BookStackAuthz(opts.baseUrl, opts.authzSecret, opts.authzTimeoutMs);
  }

  search(query: string): Promise<ResourceId[]> {
    return this.read.search(query);
  }

  /** Authoritative, fail-closed (the authz client returns an empty set on any error). */
  canRead(principal: Principal, ids: ResourceId[]): Promise<Set<ResourceId>> {
    return this.authz.canRead(principal, ids);
  }

  getDoc(id: ResourceId): Promise<{ title: string; content: string }> {
    return this.read.getDoc(id);
  }

  /** Optional readiness check before serving. */
  async health(): Promise<boolean> {
    return this.authz.health();
  }
}
