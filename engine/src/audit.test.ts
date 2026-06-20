import { describe, it, expect, afterEach } from 'vitest';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HashChainedFileSink, verifyChain, type AuditEntry, type AuditRecord } from './audit.js';
import { answer } from './engine.js';
import { InMemorySource, DEMO_USERS } from './doc-store.js';

let n = 0;
const tmpFile = () => join(tmpdir(), `letwrites-audit-${process.pid}-${n++}.jsonl`);
const files: string[] = [];
const fresh = () => { const f = tmpFile(); files.push(f); return f; };
afterEach(async () => { for (const f of files) await rm(f, { force: true }); files.length = 0; });

const entry = (userId: string, resourceId: string, decision: 'allowed' | 'denied'): AuditEntry =>
  ({ ts: '2026-06-08T00:00:00Z', userId, query: 'q', resourceId, decision });

describe('HashChainedFileSink', () => {
  it('appends a verifiable hash chain', async () => {
    const f = fresh();
    const sink = new HashChainedFileSink(f);
    await sink.append([entry('7', 'page:1', 'allowed'), entry('7', 'page:3', 'denied')]);
    const status = await verifyChain(f);
    expect(status).toEqual({ valid: true, records: 2 });
  });

  it('P1: resumes after a TORN final line (crash mid-write) without restarting the chain at seq 1', async () => {
    const f = fresh();
    await new HashChainedFileSink(f).append([entry('7', 'page:1', 'allowed'), entry('7', 'page:2', 'denied')]);
    // simulate a crash mid-append: a partial, unparseable trailing line
    await writeFile(f, (await readFile(f, 'utf8')) + '{"seq":3,"prevHash":"abc","ts":"2026');
    // new sink resumes — must drop the torn tail, continue from seq 2 (NOT reset to genesis/seq 1)
    const sink = new HashChainedFileSink(f);
    await sink.append([entry('7', 'page:4', 'allowed')]);
    const recs = (await readFile(f, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as AuditRecord);
    expect(recs.map((r) => r.seq)).toEqual([1, 2, 3]);   // torn line dropped; new record is seq 3, not seq 1
    expect(recs[2].prevHash).toBe(recs[1].hash);          // chain continues unbroken
    expect((await verifyChain(f)).valid).toBe(true);      // file stays fully parseable + valid
  });

  it('links seq and prevHash across appends', async () => {
    const f = fresh();
    const sink = new HashChainedFileSink(f);
    await sink.append([entry('7', 'page:1', 'allowed')]);
    await sink.append([entry('9', 'page:1', 'allowed')]);
    const recs = (await readFile(f, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as AuditRecord);
    expect(recs.map((r) => r.seq)).toEqual([1, 2]);
    expect(recs[1].prevHash).toBe(recs[0].hash);
    expect((await verifyChain(f)).valid).toBe(true);
  });

  it('detects an EDITED record', async () => {
    const f = fresh();
    await new HashChainedFileSink(f).append([entry('7', 'page:1', 'denied'), entry('7', 'page:2', 'allowed')]);
    const lines = (await readFile(f, 'utf8')).trim().split('\n');
    const rec = JSON.parse(lines[0]) as AuditRecord;
    rec.decision = 'allowed'; // attacker flips a denied → allowed
    lines[0] = JSON.stringify(rec);
    await writeFile(f, lines.join('\n') + '\n');
    const status = await verifyChain(f);
    expect(status.valid).toBe(false);
    expect(status.reason).toMatch(/hash mismatch/);
  });

  it('detects a DELETED record', async () => {
    const f = fresh();
    await new HashChainedFileSink(f).append([
      entry('7', 'page:1', 'denied'), entry('7', 'page:2', 'denied'), entry('7', 'page:3', 'denied'),
    ]);
    const lines = (await readFile(f, 'utf8')).trim().split('\n');
    lines.splice(1, 1); // delete the middle record (hide an access)
    await writeFile(f, lines.join('\n') + '\n');
    const status = await verifyChain(f);
    expect(status.valid).toBe(false);
  });

  it('keeps the chain valid under concurrent appends', async () => {
    const f = fresh();
    const sink = new HashChainedFileSink(f);
    await Promise.all(Array.from({ length: 20 }, (_, i) => sink.append([entry(String(i), `page:${i}`, 'allowed')])));
    const status = await verifyChain(f);
    expect(status.valid).toBe(true);
    expect(status.records).toBe(20);
  });

  it('resumes an existing chain', async () => {
    const f = fresh();
    await new HashChainedFileSink(f).append([entry('7', 'page:1', 'allowed')]);
    await new HashChainedFileSink(f).append([entry('9', 'page:2', 'allowed')]); // new instance
    expect(await verifyChain(f)).toEqual({ valid: true, records: 2 });
  });
});

describe('answer() persists audit through the sink', () => {
  it('writes allowed AND denied decisions durably', async () => {
    const f = fresh();
    const sink = new HashChainedFileSink(f);
    const store = new InMemorySource();
    await answer(DEMO_USERS.bob, 'compensation on-call policy', store, () => '2026-06-08T00:00:00Z', sink);
    const recs = (await readFile(f, 'utf8')).trim().split('\n').map((l) => JSON.parse(l) as AuditRecord);
    expect(recs.some((r) => r.decision === 'denied')).toBe(true);  // comp page denied for Bob
    expect(recs.some((r) => r.decision === 'allowed')).toBe(true); // on-call allowed
    expect((await verifyChain(f)).valid).toBe(true);
  });
});
