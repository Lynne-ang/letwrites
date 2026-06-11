# Deploying Letwrites (self-hosted, on your domain)

This stands up the Letwrites wiki on a real domain with automatic HTTPS, in one
command. It's the same package whether **you** run a demo instance or a **customer**
runs it on their own infrastructure — the data stays wherever it's deployed.

```
Caddy (auto-TLS) ──▶ BookStack (wiki + Letwrites authz theme) ──▶ MariaDB
```

## Where can I host this?

The stack is containers, so it runs wherever containers run. It is **stateful** (a real
MariaDB + file uploads), so the targets differ in fit:

| Target | Fit | How |
|--------|-----|-----|
| **VM / on-prem box (Docker Compose)** | ✅ the easy default | this guide — `./deploy.sh`, Caddy does TLS |
| **Kubernetes (incl. private / air-gapped)** | ✅ supported | the Helm chart in `helm/letwrites/` — your Ingress + cert-manager (see below) |
| **Cloud Run / serverless** | ⚠️ engine only | the *wiki + DB* is stateful (persistent disk, always-on) and is a poor fit; the stateless *engine* can run there behind the gateway. Don't put the wiki on Cloud Run. |

There is no single "Letwrites image" the way a stateless app (e.g. n8n with embedded
SQLite) ships one — the wiki **is** BookStack, which requires a separate database. Instead
we publish **pinnable images** for the parts that are ours, so no build step is needed:

| Image | What |
|-------|------|
| `ghcr.io/lynne-ang/letwrites-bookstack:<tag>` | upstream BookStack + the Letwrites authz theme baked in (no bind-mount) |
| `ghcr.io/lynne-ang/letwrites-engine:<tag>` | the agent-safe answering engine |
| `ghcr.io/lynne-ang/letwrites-migrate:<tag>` | the Confluence→Letwrites migration CLI as a container |

Pin `<tag>` to a release for reproducible deploys. (`:latest` tracks main.)

## What you need

- A server you control: a small VPS (Hetzner / DigitalOcean / Linode, ~$6–12/mo)
  or the company's own VM / on-prem box. 1 vCPU / 2 GB RAM is enough to start.
- A domain or subdomain you can point at it, e.g. `docs.acme.com`.
- Docker + Docker Compose on the server.

## Steps

**1. Provision the server and open ports 80 and 443.**

**2. Point DNS** — an `A` record for your domain → the server's public IP:
```
docs.acme.com.   A   203.0.113.10
```
TLS won't issue until this resolves, so do it first.

**3. Install Docker** (skip if present):
```bash
curl -fsSL https://get.docker.com | sh
```

**4. Get the code and configure:**
```bash
git clone <your-repo> letwrites && cd letwrites/wiki/deploy
cp .env.example .env
# edit .env: set LETWRITES_DOMAIN=docs.acme.com and LETWRITES_ACME_EMAIL=it@acme.com
```

**5. Deploy:**
```bash
./deploy.sh
```
It generates all secrets, brings up Caddy + BookStack + MariaDB, and Caddy fetches
a Let's Encrypt cert automatically. First boot takes a minute or two.

**6. First login = your IT admin** at `https://docs.acme.com/login`. Like n8n's first-run
owner, the stack ships one seeded admin account — sign in and immediately make it yours:
default `admin@admin.com` / `password` → **change the email + password right away** (Edit
Profile). That account is now your IT admin. **Public registration is disabled by default**
(`REGISTRATION_ENABLED=false`), so nobody can self-sign-up — the admin **invites** users
(Settings ▸ Users; configure SMTP for email invites, or create accounts manually) and assigns
roles. Those roles are exactly what the agent-safe layer enforces later.

**7. Verify the Letwrites authz endpoint loaded** (the one piece that needs a live check):
```bash
curl https://docs.acme.com/letwrites/health
# expect: {"ok":true,"service":"letwrites-authz","version":1}
```
If you get HTML/404 instead, the theme didn't activate — confirm `APP_THEME=letwrites`
and that `themes/letwrites` is mounted. Then confirm the permission check works:
```bash
curl -s -X POST https://docs.acme.com/letwrites/can-read \
  -H "X-Letwrites-Secret: $LETWRITES_AUTHZ_SECRET" -H 'Content-Type: application/json' \
  -d '{"userId":1,"resourceIds":["page:1"]}'
# expect: {"allowed":["page:1"]}  for a page user 1 can see; {"allowed":[]} if not.
```
The BookStack internals this relies on (the `User` model + the `visible()` permission scope)
are verified against BookStack v26.05. If a much newer BookStack ever renames them, the
endpoint fails closed (`{"allowed":[]}`) — re-run `verify-live.sh` before trusting agents.

**8. Load content** — migrate a Confluence space in. As the IT admin, create an API token
(BookStack ▸ Edit Profile ▸ API Tokens). Then run the migration **as a container** (no local
Node needed) — mount your Confluence export into `/work`:
```bash
docker run --rm -v "$PWD/exports:/work" \
  -e BOOKSTACK_URL=https://docs.acme.com \
  -e BOOKSTACK_TOKEN_ID=… -e BOOKSTACK_TOKEN_SECRET=… \
  ghcr.io/lynne-ang/letwrites-migrate:latest \
  --from-confluence-word /work/page.doc --in /work/out
```
Use `--from-confluence-export /work/space-export` for an HTML space export (space-admin),
or add `--dry-run` to preview with no creds. Every run ends with the integrity report
(written under `--in`). From source instead of the image: `cd ../../exporter && npm run import -- …`.

## The agent-safe engine (ships with the stack, internal-only)

`docker compose up` also builds and starts **`letwrites_engine`** — the permission-safe
answering API — on the internal network. It has **no public route** and is guarded by
`LETWRITES_ENGINE_SECRET`, because the public agent-facing OAuth/MCP front door isn't built
yet (that's the identity-propagation spike). So it's deployed and ready, waiting for the
gateway to sit in front.

To activate it after first boot:
1. In BookStack, create an API token (Edit Profile ▸ API Tokens). Use an account that
   can read the content you want agents to answer over (the per-user gate is enforced
   separately, so this is a service account).
2. Put it in `.env`:
   ```
   BOOKSTACK_TOKEN_ID=...
   BOOKSTACK_TOKEN_SECRET=...
   ```
3. `docker compose up -d letwrites_engine`
4. Confirm from another container on the network (it's intentionally not public):
   ```bash
   docker compose exec letwrites_engine wget -qO- http://127.0.0.1:8787/health
   # {"ok":true,"service":"letwrites-engine","configured":true}
   ```

A resolved user is required for any answer — the engine refuses a request with no
`X-Letwrites-User-Id`. In production the MCP/OAuth gateway sets that from the agent's
verified identity; until then the engine simply won't answer without it (fail-closed
by default).

## Operating it

- **Audit integrity:** the engine writes a tamper-evident, hash-chained log to the
  `engine-audit` volume. Verify it hasn't been altered any time:
  ```bash
  docker compose exec letwrites_engine wget -qO- \
    --header="X-Letwrites-Engine-Secret: $LETWRITES_ENGINE_SECRET" \
    http://127.0.0.1:8787/audit/verify
  # {"valid":true,"records":N}  — valid:false + brokenAtSeq means the log was edited
  ```
  Back up `./data/engine-audit` with the rest of `./data`.
- **Logs:** `docker compose logs -f`
- **Update:** `docker compose pull && docker compose up -d`
- **Backup:** the `./data` directory (config + database) and the `caddy_data` volume.
  A nightly `tar` of `./data` + a DB dump is enough to start.
- **Stop:** `docker compose down` (data persists in `./data`).

## Run it on Kubernetes (private network + your Ingress)

For a private cluster (incl. air-gapped), use the Helm chart in `helm/letwrites/`. It runs
MariaDB (StatefulSet + PVC), BookStack (Deployment + PVC, theme baked into the image), and
the engine (internal ClusterIP — **never** behind the Ingress), and exposes **only the wiki**
through *your* Ingress controller.

```bash
# generate secrets once
APP_KEY="base64:$(openssl rand -base64 32)"
helm install letwrites wiki/deploy/helm/letwrites \
  --set domain=docs.acme.com \
  --set ingress.className=nginx \
  --set-string ingress.annotations.'cert-manager\.io/cluster-issuer'=letsencrypt-prod \
  --set secrets.appKey="$APP_KEY" \
  --set secrets.dbPassword="$(openssl rand -hex 24)" \
  --set secrets.dbRootPassword="$(openssl rand -hex 24)" \
  --set secrets.authzSecret="$(openssl rand -hex 24)" \
  --set secrets.engineSecret="$(openssl rand -hex 24)"
```

- **Ingress:** works with any controller (nginx, traefik). TLS via cert-manager (annotation
  above) or a pre-created secret (`ingress.tls.secretName`). Point DNS at the controller.
- **Air-gapped:** mirror the three `ghcr.io/lynne-ang/letwrites-*` images + `mariadb:11.4`
  into your internal registry and set `registry=` / `mariadb.image=` accordingly.
- **First run + migration:** identical to steps 6 and 8 above (seeded admin → secure it →
  registration off → API token → run the `letwrites-migrate` image).
- The engine has **no Ingress path** by design; reach it in-cluster, behind the future gateway.

**Hardening for a security review:**
- **Secrets:** the `--set secrets.*` above is for quick start, but it lands in shell history
  and Helm release history. For production, pre-create the Secret and set
  `secrets.existingSecret`, or use an external-secrets/sealed-secrets operator.
- **Network isolation:** set `networkPolicy.enabled=true` to restrict the engine and DB so
  only in-release pods can reach them (egress stays open so SSO/SMTP/S3 work). Needs a CNI
  that enforces NetworkPolicy.
- **Resource limits** are set on every container (tune `*.resources` in values). A
  `seccompProfile: RuntimeDefault` is applied to all pods; the engine additionally runs
  non-root with `allowPrivilegeEscalation: false` and all capabilities dropped (BookStack and
  MariaDB keep root only because their init requires it).
- **Image pinning:** pin `imageTag` and `mariadb.image` to a digest for reproducible,
  supply-chain-safe deploys before production.

## Authentication & SSO (LDAP, SAML, OIDC)

Letwrites runs **unmodified BookStack** for auth, so every method in the BookStack docs
works as written, free: LDAP/Active Directory, SAML 2.0, OIDC (Google, Okta, Azure AD),
and standard email login. Our theme and engine do not touch authentication.

Enabling it is just environment variables, no code. Put them in `bookstack.env` (copy
`bookstack.env.example`), a file scoped to the BookStack container so the DB-root and
engine secrets are never exposed to it, then restart:
```bash
cp bookstack.env.example bookstack.env
# uncomment AUTH_METHOD=ldap + LDAP_SERVER / LDAP_BASE_DN / LDAP_DN / LDAP_PASS / LDAP_USER_FILTER
docker compose up -d bookstack
```
On Kubernetes, set the same vars under `bookstack.extraEnv` in the Helm values (an example
is in `values.yaml`). Full reference: https://www.bookstackapp.com/docs/admin/ldap-auth/
(and `/saml2-auth/`, `/oidc-auth/`). SSO is in the free core; we do not charge for it.

## Self-service import: the "Contributor" role

By default only **Admin** can create API tokens (BookStack's "Access System API" permission),
so a freshly-logged-in LDAP user can't reach the token page and can't self-import. The obvious
fix — granting API access to the stock **Editor** role — is a trap: Editor has
`book-update-all` / `book-delete-all`, so every such user could edit or delete **any** team's
books (via the UI or the API). The API adds no new power; the over-broad role is the risk.

Instead, create a least-privilege **Contributor** role and make it the default:
```bash
BOOKSTACK_URL=https://docs.acme.com \
BOOKSTACK_TOKEN_ID=<admin token id> BOOKSTACK_TOKEN_SECRET=<secret> \
  ./seed-contributor-role.sh
# then: Settings ▸ Users ▸ Default Role → Contributor   (LDAP: set the role mapping too)
```
A Contributor can: log in, get a token, **import their own Confluence space** (books they own),
create chapters/pages/images in those books, and **restrict each to a group/role**. A Contributor
**cannot** view, edit, or delete other teams' content (`*-update-own` / `*-delete-own`, never
`*-all`). So everyone can migrate their own team safely, and nobody can touch anyone else's books.

**Visibility is role-based.** When importing, choose **Everyone** or **specific groups/roles**.
"Only me" is **not** expressible for a non-admin — BookStack has no per-user content grant and no
non-admin owner bypass, so a deny-all-no-roles restriction would lock the importer out of their own
content. Restrict to a role you belong to instead. (Admins bypass all content permissions, so
"only me" works only for them.)

## Email & invites (SMTP)

The "admin invites your team" flow sends email, so it needs SMTP. Without it, an admin can
still create accounts by hand, but emailed invites, password resets, and notifications stay
off. Set `MAIL_*` in `bookstack.env` (there's a ready block) and restart:
```bash
docker compose up -d bookstack   # on K8s: same vars under bookstack.extraEnv
```
Ref: https://www.bookstackapp.com/docs/admin/email-webhooks/

## Two-factor authentication (MFA)

MFA is built in and free, no wiring. Each user enables TOTP or backup codes under their
profile, and an admin can **require** MFA for a role (Settings ▸ Roles), so you can enforce
it for everyone or just for admins. For a security tool this is worth turning on day one.

## Scale, storage, and other knobs

All of these are BookStack settings that go in `bookstack.env` (or `bookstack.extraEnv` on
K8s). Defaults are fine for a single box; reach for these as you grow:
- **Object storage:** `STORAGE_TYPE=s3` + `STORAGE_S3_*` to keep uploads on S3 instead of disk.
- **Upload limit:** `FILE_UPLOAD_SIZE_LIMIT` (MB).
- **Cache/session at scale:** `CACHE_DRIVER=redis`, `SESSION_DRIVER=redis`, `REDIS_SERVERS`.
- **Language:** `APP_LANG` (about 30 locales).
- **Webhooks:** configured in Settings ▸ Webhooks, useful for forwarding events to SIEM/Slack.
- **PDF export** works out of the box; for higher-fidelity PDFs, point BookStack at a wkhtmltopdf binary (see its docs).
- **Backup:** the `./data` directory (config + DB + uploads) plus a DB dump. A nightly `tar` of `./data` is enough to start.

Full configuration reference: https://www.bookstackapp.com/docs/admin/

## Make it yours: branding and white-label

Branding lives in **Settings ▸ Customization**, BookStack's built-in screen. No code. On
first boot `deploy.sh` runs `seed-branding.sh`, which sets the Letwrites name and the
Letwrites blue (`#2f6bff`) automatically. Two things to know:

- **Logo:** upload `wiki/deploy/branding/letwrites-logo.png` once, under Application Logo.
- **A customer can fully white-label it.** That same screen sets the app name, logo, primary
  colour, dark-mode colour, and custom CSS. A company self-hosting Letwrites can make it
  "Acme Docs" with Acme's own logo and brand colour, per instance, no code. Branding is
  per-deployment, so nothing is shared between organisations.

Re-running `seed-branding.sh` is safe: it only writes a setting if it is unset, so anything an
admin changes in Customization always wins.

## You vs. a customer

- **Your demo instance:** cheapest VPS, any domain you own. Gives you a live URL to show.
- **A customer:** the exact same steps on *their* server and *their* domain. Their
  content never touches your infrastructure — that's the whole pitch. You hand them
  this folder and the runbook (or run it with their IT during onboarding).

## Not yet in this deploy

The agent-safe **engine** is in this stack (internal-only, guarded by a shared secret) and
is verified on BookStack v26.05. The one piece not yet built is the agent-facing **MCP/OAuth
gateway** that proves which human an agent acts for — the paid add-on. This deploy gives you
the production-grade **wiki + complete migration** today; the agent gateway slots in front of
the engine when a customer needs it.
