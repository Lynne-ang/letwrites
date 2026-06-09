# Letwrites — architecture

Two phases, two very different tools. Conflating them is the most common mistake, so this
doc draws the line explicitly.

```
  PHASE 1 — MIGRATION (one-time)                 PHASE 2 — AGENT ACCESS (ongoing)
  "get off Confluence, lose nothing"             "let agents read it, safely"

  Confluence ──┐                                 Agent (Claude, etc.)
   • Word .doc │  exporter/  (CLI / batch)             │  MCP over the customer's OWN URL,
   • HTML zip  ├─▶ ingest → convert → import      ─────┤  authenticated via their SSO/OAuth
   • OAuth API │   → BookStack + proven                ▼
               │     integrity report           Letwrites MCP server  [self-hosted, NOT built yet]
               ▼                                       │  resolves the verified end-user
        a wiki the customer OWNS  ◀────────────────────┤
        (BookStack + Letwrites theme)                  ▼
                                                 engine/  search → live per-user canRead()
                                                       → answer from allowed only → audit
```

## The line: migration is a CLI, access is an MCP

- **Migration is a one-time bulk job.** You move a whole space once. That is a batch import,
  NOT something an agent should hand-do through MCP tool calls (slow, token-expensive,
  fragile). It lives in `exporter/` as a CLI:
  - `--from-confluence-word <file.doc>` — Word export, images embedded as base64 (no admin)
  - `--from-confluence-export <dir>` — HTML space-export zip (needs space-admin)
  - `npm run migrate` with OAuth — automated pull incl. images
  - every import ends with a **verifiable integrity report** that reconciles the source against
    what landed (pages/images expected vs moved, every gap named, checksummed against accidental edits).
- **Agent access is ongoing and per-request.** That IS what MCP is for: an agent asks, the
  Letwrites MCP server resolves the verified end-user and the `engine/` returns only what
  that user may see, fail-closed, audited.

Do not drive a migration through an agent+MCP. Do not build a bespoke access path when MCP
already standardizes it.

## Self-hosted: who hosts the MCP?

**The customer does.** The Letwrites MCP server ships as part of the self-hosted deployment
(a container alongside the wiki and engine). We host nothing.

- It runs on the customer's infrastructure, exposed at *their* URL (e.g.
  `https://docs.theirco.com/mcp`) behind *their* SSO/OAuth — or fully internal / air-gapped.
- In their agent (Claude, etc.) they register **that URL** as a custom MCP server. The agent
  authenticates through their IdP, so it acts as a *verified user*; the engine enforces that
  user's permissions on every read. Nothing routes through Letwrites-the-company.
- Optional paid convenience: a *managed* gateway we host — but the default, and the whole
  sovereignty pitch, is that the customer owns the endpoint and the data never leaves.

## Components

| Dir | Phase | Role | Status |
|-----|-------|------|--------|
| `exporter/` | Migration | Confluence → Letwrites (Word / HTML / OAuth) + verifiable integrity report | ✅ built |
| `wiki/` | Both | BookStack (the wiki) + the Letwrites authz theme (the permission source) | ✅ verified v26.05 |
| `engine/` | Access | Live per-user `canRead` + tamper-evident audit, fail-closed | ✅ built |
| MCP gateway | Access | Resolve which human an agent acts for; front the engine | 🔲 the paid add-on, not built |

The free core is migration + wiki + the engine. The paid layer is the managed/MCP access
gateway, multi-source governance, SCIM, and the compliance dashboard — see `LICENSING.md`.
