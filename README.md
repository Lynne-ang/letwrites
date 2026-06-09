# Letwrites — leave Confluence with nothing left behind

> The open-source, self-hosted Confluence exit. One guided export (or an automated OAuth
> pull) moves your whole space — pages, structure, permissions, and the **images every
> other tool drops** — onto a wiki you own, with a **verifiable report proving nothing was
> lost** (source reconciled against what landed, every gap named). Safe for AI agents when you're ready. Apache-2.0.

## Why

Companies leaving Confluence (cost, control) have no clean way out: images break, the page
tree flattens, permissions vanish, and you can't prove what actually survived. Letwrites
moves everything onto a wiki you self-host and own, and hands you an integrity report that
reconciles the source against what landed, so "nothing was lost" is provable, not a silent surprise. The same permission model later
makes the wiki safe for AI agents — every agent sees only what the asking person is allowed
to — self-hosted and vendor-neutral.

## Repo layout

| Dir | What | Status |
|-----|------|--------|
| `web/` | Landing page | ✅ self-contained `index.html` |
| `exporter/` | Confluence → Letwrites migration: HTML-export + Word ingest, automated OAuth pull, converter, importer, source-reconciled integrity report, zero-cred demo | ✅ 47 tests green |
| `wiki/` | BookStack + the Letwrites authz theme + modern theme (the permission source) | ✅ verified on BookStack v26.05 |
| `engine/` | Agent-safe engine: live per-user `canRead` over the wiki + tamper-evident audit + HTTP service | ✅ 28 tests green |

## Migrate off Confluence (images and all)

**Guided path** — works on any Confluence, including Cloud:

```bash
# 1) In Confluence: Space settings → Export space → HTML → download + unzip
# 2) ingest + import into your wiki, with a source-reconciled integrity report:
cd exporter && npm install
npm run import -- --from-confluence-export ./confluence-export \
  --base https://docs.yourco.example --token-id … --token-secret …
```

**Automated path** — no manual export, pulls images too (Confluence OAuth):

```bash
npm run oauth -- --authorize       # one-time: authorize a Confluence OAuth app
npm run migrate -- --space ENG     # exports + imports automatically
```

Every import ends with a `MIGRATION INTEGRITY REPORT` — pages and images expected (counted
from the source) vs. moved, any missing items named, verdict COMPLETE/INCOMPLETE — so loss is never silent.
Try it with zero credentials: `cd exporter && npm run demo`.

## Host it (self-hosted, your domain, auto-HTTPS)

```bash
cd wiki/deploy && cp .env.example .env   # set LETWRITES_DOMAIN + email
./deploy.sh                              # Caddy + BookStack + DB, automatic TLS
```

Same package whether you run a demo or a customer runs it on their own infra. Full runbook:
[wiki/deploy/DEPLOY.md](./wiki/deploy/DEPLOY.md). The wiki ships with a modern Letwrites
theme (CSS only, no fork — upgrade-safe).

## Agent-safe access (the later layer)

The same permissions that governed your migration also govern AI reads:

```
   Agent (acting for a verified end-user)
        │
        ▼
   engine/  ── candidate search ──▶ live canRead() per user ──▶ tamper-evident audit
        │                                  │
        │                                  ▼
        │                    wiki/themes/letwrites  (POST /letwrites/can-read)
        │                                  ▼
        │                    BookStack's OWN permission scope = the answer
        ▼
   returns only what the user may see  (fails closed)
```

The agent gate + audit are built and verified live. The agent-facing OAuth/MCP identity
gateway (proving which human an agent acts for) is the one remaining build — a paid add-on
for when a customer needs it.

## License

Open-core, **Apache-2.0** (`LICENSE`). Self-host and modify all of it, including commercially
— **SSO (OIDC/SAML/LDAP) included** (it's native to BookStack). Paid features (SCIM lifecycle,
governance dashboard, extra connectors, the managed agent gateway, managed hosting) are a
separate proprietary tier — see [LICENSING.md](./LICENSING.md). Contributing:
[CONTRIBUTING.md](./CONTRIBUTING.md). Security: [SECURITY.md](./SECURITY.md).

## Not yet built

The agent-facing MCP/OAuth identity gateway, extra connectors beyond BookStack, the
governance dashboard, and comments/version-history mapping in the importer. The Confluence
exit (text, code, tables, hierarchy, images via export-zip or OAuth) and SSO already work —
the import is verified end-to-end against live BookStack v26.05.
