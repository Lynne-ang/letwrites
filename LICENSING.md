# Licensing & the open-core boundary

Letwrites is **open-core**. This repository is the **free, open-source core**, licensed
under **Apache-2.0** (see `LICENSE`). You can self-host, modify, and run all of it,
forever, for free — including commercially.

We make money from a separate **proprietary Enterprise tier** (a different,
private codebase) and from **managed hosting**. Nothing in *this* repo is gated:
everything here is real Apache-2.0 open source.

## What's in this repo (free, Apache-2.0)

| Component | What it does |
|-----------|--------------|
| `exporter/` | Confluence → Letwrites migration toolkit (export, convert, import) |
| `wiki/` | Self-host the wiki: BookStack + the Letwrites authz theme + one-command deploy |
| `engine/` | The agent-safe core: connector boundary + live permission-checked answering + audit |
| `web/` | Landing page |

That includes the differentiator — **permission-safe agent access** — on purpose.
For a security product, being auditable open source is a trust asset, not a leak.

## What's in the paid tiers (proprietary — NOT in this repo)

> Note: **SSO (OIDC / SAML 2.0 / LDAP) is in the free core** — it's a built-in
> BookStack capability. We do not charge for SSO. The paid value is the
> *governance* around identity and the breadth/scale layers below.

- SCIM auto-provisioning + instant de-provisioning (identity lifecycle)
- The CISO governance dashboard (access reviews, rich audit views, anomaly detection, SIEM export)
- Additional connectors (Google Drive, SharePoint, Slack, Jira, Notion, …)
- The managed agent gateway (hosted MCP, multi-agent, agent-identity OAuth binding + usage analytics)
- Advanced/tamper-proof (WORM) audit retention + compliance reporting
- Priority support & SLA
- Managed hosting

This is the standard open-core split (cf. GitLab, Sentry): the core is genuinely
open; enterprise/governance features and convenience are paid.

## Why Apache-2.0 (not a fair-source / BSL license)

Our buyers self-host security software and need to *audit* it. Real OSI-approved
open source maximizes that trust and removes lock-in fear — both central to the
pitch. Our moat is the enterprise layer + being the trusted vendor, not preventing
someone from running the core. (This is a different bet than n8n, whose value is
easily cloned-and-hosted; ours sits in the hard enterprise/security layer we keep
proprietary anyway.)

## Trademarks

The Apache-2.0 grant covers the code, not the name/marks. "Letwrites" (working name)
and the logo are not licensed for use in a way that implies endorsement.
