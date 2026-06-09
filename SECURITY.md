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

## Scope

This policy covers the open-source core in this repository. The Enterprise tier
is covered separately.
