import type { DocStore } from './doc-store.js';
import type { Principal, ResourceId } from './types.js';

/**
 * Federates several knowledge sources behind ONE DocStore, so the engine — and everything above
 * it (gateway, audit, dashboard) — treats "all your sources" as a single safe surface. This is
 * the cross-source enforcement point: one agent query fans out to every source, each source makes
 * its OWN live permission decision, and the answer is composed only from what the user may read
 * everywhere. Adding a source changes nothing upstream.
 *
 * Routing is by resourceId namespace (the bit before ':'): "page:12"/"book:3" → BookStack,
 * "file:hr/x.md" → filesystem, etc. Each member declares the prefixes it owns.
 *
 * FAIL-CLOSED end to end: an id whose prefix no member owns is never allowed and never fetched;
 * if one source's canRead throws, only THAT source's candidates are dropped (denied), never the
 * others — one flaky connector can't open or close access to another.
 */
export interface Member {
  prefixes: string[]; // id namespaces this source owns, e.g. ['page','book','chapter','shelf']
  store: DocStore;
}

export class CompositeDocStore implements DocStore {
  private readonly byPrefix = new Map<string, DocStore>();
  constructor(private readonly members: Member[]) {
    for (const m of members) for (const p of m.prefixes) this.byPrefix.set(p, m.store);
  }

  private storeFor(id: ResourceId): DocStore | undefined {
    return this.byPrefix.get(id.split(':', 1)[0]);
  }

  /** Fan out to every source; concatenate candidates. One source failing yields no candidates from it. */
  async search(query: string): Promise<ResourceId[]> {
    const results = await Promise.all(
      this.members.map((m) => m.store.search(query).catch(() => [] as ResourceId[])),
    );
    return results.flat();
  }

  /** Route each id to its owning source, ask each source's LIVE canRead, union the allows. */
  async canRead(principal: Principal, ids: ResourceId[]): Promise<Set<ResourceId>> {
    const grouped = new Map<DocStore, ResourceId[]>();
    for (const id of ids) {
      const store = this.storeFor(id);
      if (!store) continue; // unknown namespace ⇒ deny (never added to any allow-set)
      (grouped.get(store) ?? grouped.set(store, []).get(store)!).push(id);
    }
    const allowed = new Set<ResourceId>();
    await Promise.all(
      [...grouped.entries()].map(async ([store, subset]) => {
        try {
          const ok = await store.canRead(principal, subset);
          for (const id of ok) allowed.add(id);
        } catch {
          /* this source failed ⇒ deny its subset only (fail closed); other sources unaffected */
        }
      }),
    );
    return allowed;
  }

  async getDoc(id: ResourceId): Promise<{ title: string; content: string }> {
    const store = this.storeFor(id);
    if (!store) throw new Error(`no source owns ${id}`);
    return store.getDoc(id);
  }
}
