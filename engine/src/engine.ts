import type { DocStore } from './doc-store.js';
import type { Principal, ResourceId } from './types.js';
import type { AuditEntry, AuditSink } from './audit.js';

export type { AuditEntry } from './audit.js'; // re-export for existing importers

/**
 * The safe-answer flow — the heart of Letwrites.
 *
 *   query ─▶ search (candidates) ─▶ LIVE canRead per candidate ─▶ answer from
 *           allowed docs only ─▶ audit EVERY decision (allowed + denied)
 *
 * Invariants (all tested):
 *  - A doc the user can't read is NEVER in the answer, and its TITLE is never
 *    revealed either — only a withheld count.
 *  - The agent cannot influence the permission decision (prompt injection in the
 *    query changes nothing — canRead is server-side and identity-bound).
 *  - FAIL CLOSED: if the permission check errors, nothing is returned.
 */
export interface AnswerResult {
  answer: string;
  sources: { id: ResourceId; title: string }[];
  withheldCount: number;
  audit: AuditEntry[];
}

export async function answer(
  principal: Principal,
  query: string,
  store: DocStore,
  now: () => string = () => new Date().toISOString(),
  auditSink?: AuditSink,
): Promise<AnswerResult> {
  const candidates = await store.search(query);

  // The ONLY thing that decides access. Fail closed on any error.
  let allowedSet: Set<ResourceId>;
  try {
    allowedSet = await store.canRead(principal, candidates);
  } catch {
    allowedSet = new Set();
  }

  const audit: AuditEntry[] = candidates.map((id) => ({
    ts: now(),
    userId: principal.userId,
    query,
    resourceId: id,
    decision: allowedSet.has(id) ? 'allowed' : 'denied',
  }));

  // Persist BEFORE returning. If the audit can't be written, the request fails —
  // no durable record, no answer. "Audited" is a guarantee, not best-effort.
  if (auditSink) await auditSink.append(audit);

  const allowedIds = candidates.filter((id) => allowedSet.has(id));
  const withheldCount = candidates.length - allowedIds.length;

  // Fetch ONLY allowed docs. Denied docs are never fetched — no title/snippet leak.
  const sources = await Promise.all(
    allowedIds.map(async (id) => ({ id, ...(await store.getDoc(id)) })),
  );

  const answerText = compose(sources, withheldCount);
  return { answer: answerText, sources: sources.map((s) => ({ id: s.id, title: s.title })), withheldCount, audit };
}

function compose(sources: { title: string; content: string }[], withheld: number): string {
  if (sources.length === 0) {
    return withheld > 0
      ? `I can't answer from anything you have access to. ${withheld} matching document(s) were withheld because you're not authorized to view them.`
      : `No documents matched.`;
  }
  const body = sources.map((s) => `• ${s.title}: ${s.content}`).join('\n');
  const tail = withheld > 0 ? `\n\n(${withheld} additional matching document(s) withheld — you're not authorized to view them.)` : '';
  return `Based on ${sources.length} document(s) you can access:\n${body}${tail}`;
}
