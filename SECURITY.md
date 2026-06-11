# Security Policy

Letwrites's entire value is that it keeps knowledge safe from unauthorized access —
including AI agents. We take vulnerabilities seriously.

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Email **hello@letwrites.com** (set this before launch) with:
- a description and impact,
- steps to reproduce,
- affected component (exporter / wiki authz theme / engine / deploy).

We aim to acknowledge within 2 business days and to ship a fix or mitigation
before any public disclosure. Coordinated disclosure is appreciated.

## Areas we care about most

- **Permission bypass** — any path where an agent or user can read content they
  aren't authorized for (the core invariant in `engine/src/engine.ts`).
- **Identity spoofing** — anything letting an agent act as a user it isn't.
- **Prompt-injection escalation** — content that tricks the agent into accessing
  restricted data. (By design the server-side check should make this impossible;
  a working bypass is a critical bug.)
- **Authz endpoint exposure** — the BookStack `/letwrites/can-read` endpoint returns
  permission truth and must only be reachable by the engine with the shared secret.
- **Fail-open behavior** — any case where a permission-service failure results in
  content being returned instead of denied.

## Data handling (for your privacy/DPIA review)

Everything runs on your infrastructure; Letwrites (the vendor) never receives your
content or logs. Two stores worth noting when you scope a DPIA:

- **Audit log** (`engine`, hash-chained JSONL): each record is `{ timestamp, userId,
  query, resourceId, decision }`. It stores the **raw query text**, which can contain
  sensitive terms, alongside the user id. Treat it as a personal-data store: set
  retention/rotation and access controls, and include it in your DSAR/erasure process.
  You are the data controller for this log; we cannot see it.
- **Wiki content + uploads** live in your BookStack database and storage on your servers.

If you need the query field hashed or redacted, open an issue — it's a planned config option.

## Scope

This policy covers the open-source core in this repository. The Enterprise tier
is covered separately.
