# Onboarding a company to Letwrites (Confluence → self-hosted, IT-controlled)

The whole journey, step 0 to N. Goal: take a company off Confluence and onto a
self-hosted wiki on *their* domain, where *their IT team* controls all access —
and that same access control later governs AI agents too.

```
 Confluence ──①export──▶ Markdown + attachments + honest report
                              │
                              ②import
                              ▼
   docs.acme.com  ◀──①deploy──  Letwrites (BookStack) on the company's server
        │                         ▲
   humans browse            IT admins set roles + per-page permissions
        │                         │  (one place, governs humans AND agents)
        ▼                         ▼
   ③ agents read ──▶ engine enforces those SAME permissions, audited (gated: OAuth spike)
```

## Step 0 — What the company needs

- **Somewhere to run containers.** Letwrites is just containers, so IT picks whatever
  they already operate — see Step 1 for the three common shapes (single VM, Kubernetes,
  or Cloud Run / a managed container host). 2 vCPU / 4 GB is plenty to start.
- **A domain or subdomain:** `docs.acme.com`.
- **A database.** A container handles dev/small; for production IT points it at a managed
  SQL service (Cloud SQL, RDS, Azure Database) — MySQL 8 or MariaDB 10.6+.
- **A Confluence API token** (Atlassian → Security → API tokens) for the export.

The company owns all of this. Letwrites runs on *their* infrastructure. Nothing leaves
their walls — not the documents, not the permissions, not the audit log.

## Step 1 — Stand up Letwrites on their domain (IT owns this)

**Use a stable release, not `main`.** Pick a tagged release and pin to it, so IT controls
exactly what runs:

```bash
git clone https://github.com/Lynne-ang/letwrites && cd letwrites
# For production, pin to a published release tag (see the repo Releases page); `main` tracks the latest stable build.
```

IT then runs it on whatever they already operate — **the same images, three shapes:**

- **Single VM / on-prem (simplest):**
  ```bash
  cd wiki/deploy && cp .env.example .env     # set LETWRITES_DOMAIN=docs.acme.com + email
  ./deploy.sh                                # Caddy auto-TLS + BookStack + engine + DB
  ```
  DNS A-record → server IP, open 80/443, and `https://docs.acme.com` is live with a real cert.

- **Kubernetes:** the same containers (BookStack + the Letwrites theme, the engine, a DB
  or a managed-SQL `ExternalName`) as Deployments behind an Ingress + cert-manager. The
  compose file is the reference spec for the env vars and the theme mount.

- **Cloud Run / managed container host:** run the BookStack+theme container and the engine
  container as two services, point `DB_HOST` at Cloud SQL, map `docs.acme.com`. (This is the
  same path letwrites.com's own marketing site is deployed on, so it's a proven shape.)

> The DB containers in the compose are pinned to official `mariadb:11.4` with a healthcheck,
> and BookStack waits for `service_healthy` — so first boot runs the schema migration once,
> cleanly, instead of racing a half-started DB. In production, prefer managed SQL.

**First thing after it's up: log in as admin and change the default password.** The IT team
are the **administrators** — they own the domain, the server, the database, and every setting.

## Step 2 — Set up people and access (this is the access-control answer)

**Yes — the IT team are admins and they control all access.** BookStack (the wiki
under Letwrites) has a full role + permission system. IT manages it in one place:

- **Users:** create local accounts, or wire **SSO — OIDC / SAML 2.0 / LDAP, all
  included free in the core** — so login syncs with their existing directory (Google,
  Okta, Azure AD, …). IT decides who has an account. (Automated SCIM provisioning +
  instant de-provisioning when someone leaves is the paid lifecycle add-on.)
- **Roles:** e.g. `Everyone`, `HR`, `Security`, `Engineering`. IT assigns users to roles.
- **Permissions:** content is organized as **Shelves → Books → Chapters → Pages.**
  IT sets who can view/edit each one — by role, down to a single page. A page can be
  restricted so only `HR` sees it.
- **Admin powers:** IT admins can see everything, manage users/roles, set retention,
  read the audit log, and revoke access instantly (revocation takes effect on the
  next read — no caching).

**The key idea:** the access rules IT sets here are the *single source of truth*.
When humans browse, BookStack enforces them. When an AI agent reads (Step 3), the
Letwrites engine asks BookStack the *same* question — "can this user see this?" — so
the agent is governed by the exact same rules IT already manages. **IT controls
access once; it governs both people and AI.**

### Where your data lives (SQL vs. images)

So nobody wonders where the content actually sits:

- **Documents, page hierarchy, users, roles, and permissions → the SQL database.** Every
  page's text/markup, the Shelf→Book→Chapter→Page tree, accounts, role assignments, and
  per-page permission rules are rows in MySQL/MariaDB. Back up the DB and you've backed up
  the knowledge + the access model.
- **Images and file attachments → the file/object store, not SQL.** BookStack writes
  uploaded images to its storage path (a mounted volume by default; can be pointed at S3/GCS
  for production). The DB stores the *reference*; the bytes live on disk/object storage.
  That's why the importer (Step 4) uploads each image to that store and rewrites the page to
  point at the new URL.
- **The audit log → an append-only, hash-chained file** the engine writes (tamper-evident;
  see Step 5). Separate from the DB so a DB compromise can't silently rewrite history.

## Step 3 — Export from Confluence — each team migrates its own space

**This is self-service per team, not one big-bang.** Confluence is organized into *spaces*
(usually one per team: `ENG`, `HR`, `SALES`). The `--space` flag scopes a migration to one
space, so **each team migrates its own docs on its own schedule** — Engineering moves `ENG`,
HR moves `HR` — without waiting on a central migration. IT just hands each team a Confluence
token and the one command below.

```bash
cd ../../exporter
CONFLUENCE_BASE_URL="https://acme.atlassian.net/wiki" \
CONFLUENCE_EMAIL="eng-lead@acme.com" CONFLUENCE_API_TOKEN="••••" \
  npm run export -- --space ENG --out ./acme-export
open acme-export/preview.html          # see it converted, before importing
cat acme-export/migration-report.md    # exactly what needs a human
```

**What converts cleanly (the ~80%):**

| Content mode | Converts? |
|---|---|
| Text — headings, paragraphs, bold/italic, blockquotes | ✅ clean |
| Lists (bulleted, numbered, task lists) | ✅ clean |
| Code blocks (with language) + inline code | ✅ clean |
| Tables | ✅ clean |
| Page hierarchy (nested pages) | ✅ preserved |
| Cross-page links | ✅ re-pointed (no 404s) |
| Info / note / warning / tip panels | ✅ → callouts |
| Images / attachments | ✅ downloaded on export, **uploaded into BookStack + refs rewritten** on import |
| Confluence macros (Jira, drawio, expand, include…) | ❌ flagged in the report, not auto-converted |

**Proven end-to-end (2026-06-09, against live BookStack v26.05):** a 6-page space with
nested hierarchy + an embedded image was imported with one command. Result, verified via
BookStack's REST API: **1 book, 2 chapters, 6 pages**, and the image **uploaded into
BookStack's gallery** with the page markup **rewritten** to the new URL (no dead Confluence
links). The security gate was checked on the same box: a page restricted to admins was
**returned to the admin and withheld from a non-admin** through the same endpoint agents use.

**Honest gaps (so nobody is surprised in front of the customer):**
1. **Macros don't auto-convert.** Jira links, drawio diagrams, etc. are listed in
   `migration-report.md` with the page they came from, so a human fixes exactly those
   and nothing else. We convert the clean 80% and tell you the 20% — we never silently
   mangle.

So: **not "perfect," but honest and reviewable.** That honesty is a selling point
against tools that promise one-click and deliver a mess.

## Step 4 — Import into Letwrites

```bash
# preview the mapping first (no writes):
npm run import -- --in ./acme-export --dry-run
# then import for real (BookStack API token from Edit Profile ▸ API Tokens):
BOOKSTACK_URL=https://docs.acme.com BOOKSTACK_TOKEN_ID=… BOOKSTACK_TOKEN_SECRET=… \
  npm run import -- --in ./acme-export
```
Confluence's nested pages map onto BookStack's Books → Chapters → Pages (the dry-run
shows exactly how; anything too deep is flattened and reported). After import, IT
applies the permissions from Step 2 to the new content.

## Step 5 — Verify the security gate (do this before trusting agents)

The product's promise is "the agent can't read what the user can't." Prove it on the
live box with one command (see `wiki/deploy/verify-live.sh`):

```bash
cd wiki/deploy
BOOKSTACK_URL=https://docs.acme.com LETWRITES_AUTHZ_SECRET=… \
ALLOWED_USER_ID=1 DENIED_USER_ID=5 RESTRICTED_PAGE_ID=42 \
  ./verify-live.sh
# PASS: denied user is correctly blocked ✓   ← the gate holds
# 🔴 FAIL: visible() is FAILING OPEN          ← do NOT ship agents until fixed
```

## Step 6 — Turn on agents safely (gated: the OAuth identity spike)

The engine is deployed (internal-only) and enforces the Step-2 permissions on every
agent read, with a tamper-evident audit log. The remaining piece is the OAuth gateway
that proves *which human* an agent acts for — that's the identity spike, built once
the target agent (Claude/Codex) is confirmed. Until then the engine refuses any
request without a verified user (fail-closed).

## Recap: who controls what

- **IT team = admins.** They own the domain, server, data, users, roles, permissions,
  retention, and the audit log. Full control, on their infrastructure.
- **One permission model** governs both human browsing and AI agent reads.
- **Letwrites** is the wiki + the migration + the agent-safe layer. It never sends the
  company's content anywhere.
