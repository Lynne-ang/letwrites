import type { Principal, ResourceId } from './types.js';

/**
 * What the engine needs from a knowledge source to answer safely:
 *   search()  → candidate hits (the "index" — fast, NOT trusted for permissions)
 *   canRead() → authoritative LIVE permission check (the only source of truth)
 *   getDoc()  → content, fetched ONLY after canRead allows it
 *
 * In production, canRead is the BookStack authz endpoint (see bookstack-authz-client),
 * search is a real index, getDoc hits the wiki. Here, InMemorySource implements all
 * three so the differentiator demo runs with zero infra — behind the SAME boundary.
 */
export interface DocStore {
  search(query: string): Promise<ResourceId[]>;
  canRead(principal: Principal, ids: ResourceId[]): Promise<Set<ResourceId>>;
  getDoc(id: ResourceId): Promise<{ title: string; content: string }>;
}

interface Doc {
  id: ResourceId;
  title: string;
  content: string;
  /** Roles allowed to read. 'all' = everyone. */
  roles: string[];
}

/** Demo users (in production these come from your IdP / the wiki's user table). */
export const DEMO_USERS: Record<string, Principal & { role: string }> = {
  alice: { userId: 'alice', email: 'alice@acme.com', role: 'hr' },
  bob: { userId: 'bob', email: 'bob@acme.com', role: 'engineering' },
  carol: { userId: 'carol', email: 'carol@acme.com', role: 'security' },
};

/** A small "migrated wiki" — mostly open, with two restricted pages. */
const CORPUS: Doc[] = [
  {
    id: 'page:1',
    title: 'On-call Policy',
    roles: ['all'],
    content: 'On-call rotation is weekly. Primary acknowledges within 5 minutes. Escalate to secondary after 15 minutes. Comp time is granted for overnight pages.',
  },
  {
    id: 'page:2',
    title: 'Engineering Handbook',
    roles: ['all'],
    content: 'How we build and ship. Trunk-based development, code review required, deploy via CI. See the on-call policy for incident handling.',
  },
  {
    id: 'page:3',
    title: 'Compensation Bands 2026',
    roles: ['hr'], // RESTRICTED — HR only
    content: 'Band L3 engineer: 90k–120k. Band L5: 150k–200k. Director: 240k–300k. Equity refresh guidance attached.',
  },
  {
    id: 'page:4',
    title: 'Security Incident IR-0914',
    roles: ['security'], // RESTRICTED — security only
    content: 'Credential leak via a misconfigured bucket. Rotated all keys. Affected: internal analytics. Not disclosed externally.',
  },
];

const byId = new Map(CORPUS.map((d) => [d.id, d]));

export class InMemorySource implements DocStore {
  constructor(private readonly users = DEMO_USERS) {}

  /** Naive keyword candidate generation — the "index". Permission-blind on purpose. */
  async search(query: string): Promise<ResourceId[]> {
    const STOP = new Set(['the', 'and', 'are', 'what', 'for', 'you', 'your', 'with', 'this', 'that', 'show', 'her', 'his', 'our', 'who', 'how']);
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2 && !STOP.has(t));
    return CORPUS.filter((d) => {
      const hay = (d.title + ' ' + d.content).toLowerCase();
      return terms.some((t) => hay.includes(t));
    }).map((d) => d.id);
  }

  /** Authoritative LIVE permission check. The agent never influences this. */
  async canRead(principal: Principal, ids: ResourceId[]): Promise<Set<ResourceId>> {
    const role = this.users[principal.userId]?.role;
    const allowed = new Set<ResourceId>();
    if (!role) return allowed; // unknown user → nothing (fail closed)
    for (const id of ids) {
      const doc = byId.get(id);
      if (doc && (doc.roles.includes('all') || doc.roles.includes(role))) allowed.add(id);
    }
    return allowed;
  }

  async getDoc(id: ResourceId): Promise<{ title: string; content: string }> {
    const doc = byId.get(id);
    if (!doc) throw new Error(`no such doc ${id}`);
    return { title: doc.title, content: doc.content };
  }
}
