import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FilesystemDocStore } from './filesystem-doc-store.js';

let root: string;
let store: FilesystemDocStore;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lw-fs-'));
  mkdirSync(join(root, 'eng'));
  mkdirSync(join(root, 'hr'));
  writeFileSync(join(root, 'readme.md'), 'Welcome to the engineering file share. General onboarding info.');
  writeFileSync(join(root, 'eng', 'runbook.md'), 'Deploy runbook: roll back with the previous green tag.');
  writeFileSync(join(root, 'hr', 'comp.md'), 'Compensation bands: L5 150k-200k. Director 240k-300k.');
  writeFileSync(join(root, '.letwrites-acl.json'), JSON.stringify({
    users: { alice: ['hr', 'staff'], bob: ['eng', 'staff'] },
    acl: [{ prefix: '', groups: ['staff'] }, { prefix: 'hr/', groups: ['hr'] }],
  }));
  store = new FilesystemDocStore(root, join(root, '.letwrites-acl.json'));
});

const P = (userId: string) => ({ userId });

describe('FilesystemDocStore', () => {
  it('searches filename + content, returns file: ids, skips dotfiles', async () => {
    expect(await store.search('runbook')).toEqual(['file:eng/runbook.md']);
    expect(await store.search('compensation')).toEqual(['file:hr/comp.md']);
    const onboarding = await store.search('onboarding');
    expect(onboarding).toEqual(['file:readme.md']);
  });

  it('canRead: most-specific prefix wins, fail-closed on unknown user', async () => {
    const all = ['file:readme.md', 'file:eng/runbook.md', 'file:hr/comp.md'];
    const alice = await store.canRead(P('alice'), all); // hr + staff
    expect([...alice].sort()).toEqual(['file:eng/runbook.md', 'file:hr/comp.md', 'file:readme.md']);
    const bob = await store.canRead(P('bob'), all); // eng + staff, NOT hr
    expect([...bob].sort()).toEqual(['file:eng/runbook.md', 'file:readme.md']);
    expect(bob.has('file:hr/comp.md')).toBe(false); // restricted
    expect((await store.canRead(P('stranger'), all)).size).toBe(0); // unknown ⇒ nothing
  });

  it('refuses path traversal in both canRead and getDoc', async () => {
    expect((await store.canRead(P('alice'), ['file:../../../etc/passwd'])).size).toBe(0);
    await expect(store.getDoc('file:../../../etc/passwd')).rejects.toThrow(/invalid file id/);
  });

  it('getDoc returns title (basename) + content', async () => {
    const d = await store.getDoc('file:hr/comp.md');
    expect(d.title).toBe('comp.md');
    expect(d.content).toMatch(/150k-200k/);
  });

  it('fails closed when the ACL file is missing/unreadable', async () => {
    const bad = new FilesystemDocStore(root, join(root, 'nope.json'));
    expect((await bad.canRead(P('alice'), ['file:readme.md'])).size).toBe(0);
  });
});
