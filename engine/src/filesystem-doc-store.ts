import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep, basename, resolve } from 'node:path';
import type { DocStore } from './doc-store.js';
import type { Principal, ResourceId } from './types.js';

/**
 * On-prem FILESYSTEM knowledge source — connector #2.
 *
 * Indexes a local directory tree (a mounted file share, an on-prem export, etc.) behind the
 * SAME DocStore boundary as BookStack, so the engine's answer()/audit/fail-closed guarantees and
 * the whole paid control plane (gateway, audit export, dashboard) govern it with ZERO changes.
 * This is the cross-source proof: one safe agent endpoint over many sources.
 *
 * Sovereignty by construction: it reads LOCAL files only — no cloud SaaS, no credential custody.
 *
 * Permissions come from a share-level ACL file (the on-prem analogue of NTFS/POSIX share ACLs):
 *   { "users": { "<userId>": ["group", ...] },
 *     "acl":   [ { "prefix": "",        "groups": ["staff"] },     // default: all staff
 *               { "prefix": "hr/",      "groups": ["hr"] },        // most-specific prefix wins
 *               { "prefix": "security/","groups": ["security"] } ] }
 *
 * canRead is LIVE + FAIL-CLOSED: the longest matching prefix rule decides; a user may read only
 * if their groups intersect that rule's groups; no matching rule, unknown user, or any error ⇒ deny.
 *
 * resourceId namespace: "file:<relative/path>" (POSIX separators).
 */
export const FILE_PREFIX = 'file';

interface AclRule { prefix: string; groups: string[] }
interface Acl { users: Record<string, string[]>; acl: AclRule[] }

const TEXT_EXT = new Set(['.md', '.txt', '.markdown', '.rst', '.adoc', '.csv', '.json', '.yaml', '.yml', '.log']);
const STOP = new Set(['the', 'and', 'are', 'what', 'for', 'you', 'your', 'with', 'this', 'that', 'show', 'her', 'his', 'our', 'who', 'how']);
const MAX_BYTES = 256 * 1024; // cap content read per file

const toPosix = (p: string): string => p.split(sep).join('/');
const idFor = (rel: string): ResourceId => `${FILE_PREFIX}:${toPosix(rel)}`;

export class FilesystemDocStore implements DocStore {
  private readonly root: string;
  constructor(root: string, private readonly aclPath: string) {
    this.root = resolve(root);
  }

  /** Resolve an id's path and confirm it stays INSIDE the root (no traversal). null ⇒ reject. */
  private safePath(id: ResourceId): string | null {
    const [pfx, ...rest] = id.split(':');
    if (pfx !== FILE_PREFIX || rest.length === 0) return null;
    const rel = rest.join(':');
    const abs = resolve(this.root, rel);
    const r = relative(this.root, abs);
    if (r === '' || r.startsWith('..') || r.includes(`..${sep}`)) return null; // escapes root
    return abs;
  }

  private async loadAcl(): Promise<Acl> {
    try {
      const a = JSON.parse(await readFile(this.aclPath, 'utf8'));
      return { users: a.users ?? {}, acl: Array.isArray(a.acl) ? a.acl : [] };
    } catch {
      return { users: {}, acl: [] }; // no/!bad ACL ⇒ deny everything (fail closed)
    }
  }

  private async walk(dir: string, acc: string[] = []): Promise<string[]> {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return acc; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue; // skip dotfiles incl. the ACL
      const abs = join(dir, e.name);
      if (e.isDirectory()) await this.walk(abs, acc);
      else if (TEXT_EXT.has((e.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase())) acc.push(abs);
    }
    return acc;
  }

  async search(query: string): Promise<ResourceId[]> {
    const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2 && !STOP.has(t));
    if (!terms.length) return [];
    const files = await this.walk(this.root);
    const hits: ResourceId[] = [];
    for (const abs of files) {
      const rel = relative(this.root, abs);
      let body = '';
      try { body = (await readFile(abs, 'utf8')).slice(0, MAX_BYTES); } catch { /* unreadable ⇒ filename only */ }
      const hay = (toPosix(rel) + ' ' + body).toLowerCase();
      if (terms.some((t) => hay.includes(t))) hits.push(idFor(rel));
    }
    return hits;
  }

  /** Longest matching prefix rule wins; intersect user's groups. Fail-closed. */
  async canRead(principal: Principal, ids: ResourceId[]): Promise<Set<ResourceId>> {
    const allowed = new Set<ResourceId>();
    const { users, acl } = await this.loadAcl();
    const groups = users[principal.userId];
    if (!groups || groups.length === 0) return allowed; // unknown user ⇒ nothing
    const userGroups = new Set(groups);
    for (const id of ids) {
      if (!this.safePath(id)) continue; // not ours / traversal ⇒ deny
      const rel = toPosix(id.slice(FILE_PREFIX.length + 1));
      const rule = acl
        .filter((r) => rel.startsWith(r.prefix))
        .sort((a, b) => b.prefix.length - a.prefix.length)[0];
      if (rule && rule.groups.some((g) => userGroups.has(g))) allowed.add(id);
    }
    return allowed;
  }

  async getDoc(id: ResourceId): Promise<{ title: string; content: string }> {
    const abs = this.safePath(id);
    if (!abs) throw new Error(`invalid file id ${id}`);
    await stat(abs); // throws if missing
    const content = (await readFile(abs, 'utf8')).slice(0, MAX_BYTES);
    return { title: basename(abs), content };
  }
}
