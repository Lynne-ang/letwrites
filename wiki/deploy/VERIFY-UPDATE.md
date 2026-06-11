# Verify a Letwrites update (post-deploy checklist)

Run this after pulling the latest Letwrites on your self-hosted stack. Each item has the command
and the expected result. Items marked **NEW** are the recent self-service sharing/import work and
deserve an extra look. `<domain>` = your wiki URL (e.g. https://docs.yourcompany.com).

## 1. Update and bring it up
```bash
cd letwrites && git pull
cd wiki/deploy
# core stack (and the enterprise overlay too, if you run the paid layer):
docker compose -f docker-compose.yml [-f /path/to/letwrites-enterprise/deploy/compose.enterprise.yml] up -d --build
docker compose up -d --force-recreate caddy    # pick up any new routes (/import, /share)
```
- [ ] All containers report healthy: `docker compose ps`

## 2. Core smoke (≈2 min)
- [ ] Wiki loads at `<domain>` and you can sign in (SSO/LDAP).
- [ ] Branding: the header shows the **Letwrites logo**, not the default BookStack mark.
- [ ] Authz endpoints respond: `bash verify-live.sh` (set `WRITE_BOOK_ID` to also exercise can-write).
- [ ] `curl -s <domain>/letwrites/health` → `{"ok":true,...}`.

## 3. Self-service import — `<domain>/import`  (NEW)
- [ ] The page loads (behind your SSO).
- [ ] **"Get an API token →"** opens your BookStack token page. **Confirm the path** —
      the button targets `/my-account/auth/api-tokens`; if your BookStack version differs, tell us.
- [ ] A **non-admin editor** can import a Confluence export **into an existing book they can edit**
      (the destination picker) WITHOUT "Create Books" rights, and sees the integrity report.
- [ ] A blind create (no destination) still gives a clear 403 message if they lack create rights.

## 4. Self-service sharing — "Who can see this?"  (NEW · needs the paid broker)
Prereqs: `LETWRITES_SELF_SERVICE=on`, `LETWRITES_SHARE_SECRET` set on **both** the broker and the
bookstack container, the `letwrites_share` service up, and a **minimal-role** BookStack service
account (a custom role with only "Manage permissions") in `LETWRITES_BROKER_TOKEN_ID/SECRET`.
- [ ] `curl -s <broker>/healthz` → `{"ok":true,"selfService":true}`.
- [ ] On a page/book, the **"Who can see this?"** button appears (bottom-right) for a signed-in user.
- [ ] The panel lists your groups (it should NOT list the admin/public system roles).
- [ ] **Restrict to a group**, then verify: a user **not** in that group can no longer open the doc,
      **and the AI agent won't surface it to them either**; a user **in** the group still can.
- [ ] "Everyone" puts it back to inheriting its space.
- [ ] An audit line is written for each change (`LETWRITES_SHARE_AUDIT_FILE`), with who/decision/before/after.
- [ ] CSRF: the Apply action works from the browser (the panel sends the `<meta name="token">` value).
      If it 419s, the `web`-middleware/CSRF wiring needs adjusting for your version — tell us.

## 5. LDAP over TLS (if you use it)
- [ ] `LDAP_VERSION=3` is set (Google Secure LDAP / modern LDAPS are v3-only).
- [ ] Client cert via the **`LDAPTLS_CERT` / `LDAPTLS_KEY` / `LDAPTLS_CACERT` env vars** (NOT an
      ldap.conf `TLS_CERT`/`TLS_KEY`, which libldap ignores).
- [ ] The cert dir + files under `data/config/ldap-tls/` are owned by and readable by **uid 1000**.
- [ ] A test user can sign in via LDAP.

## 6. Paid layer (only if you run it)
- [ ] Gateway, dashboard, audit-exporter, attestation, backup-monitor each pass their `/health` /
      `--check`. The governance dashboard at its URL shows live decisions + integrity = verified.

## Rollback
If anything misbehaves: `git checkout <previous-tag>` then re-run the `docker compose up -d --build`
above. State (DB + uploads) is untouched by a code rollback.

---
Anything in sections 3–4 that doesn't behave as described is most likely a BookStack-version detail
(route middleware, CSRF, or the token-page path) — note the symptom and we'll adjust. Those paths
are the ones built against the documented API but not yet confirmed on your exact BookStack build.
