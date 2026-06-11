#!/usr/bin/env bash
# Seed Letwrites branding into BookStack's settings (app name, accent color, custom
# head CSS). IDEMPOTENT and NON-DESTRUCTIVE: only inserts a setting if it's absent,
# so an admin's own customizations in Settings ▸ Customization are never overwritten.
#
# Run once after first boot (deploy.sh calls this automatically). Re-running is safe.
#
#   ./seed-branding.sh
#
# This is supported BookStack theming (DB settings, the same ones the Customization
# UI writes) — NOT a fork.
set -euo pipefail
cd "$(dirname "$0")"
# Read DB_ROOT_PASSWORD from .env WITHOUT sourcing it — `. ./.env` executes the file, so a valid
# value with shell metacharacters (e.g. an LDAP filter like (&(uid={user}))) would crash this script.
env_val() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2-; }
[ -f .env ] && DB_ROOT_PASSWORD="$(env_val DB_ROOT_PASSWORD)"

COMPOSE="docker compose"; $COMPOSE version >/dev/null 2>&1 || COMPOSE="docker-compose"
DB_SVC="bookstack_db"
CSS_FILE="../themes/letwrites/branding.css"

# DB client + root password differ by image; mariadb image uses MARIADB_ROOT_PASSWORD.
ROOTPW="${DB_ROOT_PASSWORD:-${MARIADB_ROOT_PASSWORD:-}}"
if [ -z "$ROOTPW" ]; then echo "seed-branding: DB_ROOT_PASSWORD not set in .env — skipping"; exit 0; fi

# Read the custom-head CSS, SQL-escape single quotes.
HEAD_HTML="$(sed "s/'/''/g" "$CSS_FILE")"
# The Letwrites "L" mark, as a self-contained data URI, lives once in branding.css (the header
# a.logo::before background). Extract it here to also drive the favicon (app-icon-*) — one source.
MARK_DATAURI="$(grep -oE 'data:image/png;base64,[A-Za-z0-9+/=]+' "$CSS_FILE" | head -1)"

# --force re-applies the Letwrites-managed head (app-custom-head: favicon + injected UI + fonts) even
# if it already exists — needed to push a branding UPDATE (e.g. a new favicon) to an EXISTING deploy,
# since the default is non-destructive. It does NOT touch the customer's app-name / app-logo.
FORCE=0; [ "${1:-}" = "--force" ] && FORCE=1

# Insert a setting only if the key doesn't already exist (admin/customer overrides win).
seed() {
  local key="$1" val="$2"
  $COMPOSE exec -T "$DB_SVC" sh -c "exec mariadb -uroot -p'$ROOTPW' bookstackapp" <<SQL
INSERT INTO settings (setting_key, value, type, created_at, updated_at)
SELECT '$key', '$val', 'string', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE setting_key='$key');
SQL
}
# Force-set a setting (replace if present). Used for app-custom-head under --force.
force_set() {
  local key="$1" val="$2"
  $COMPOSE exec -T "$DB_SVC" sh -c "exec mariadb -uroot -p'$ROOTPW' bookstackapp" <<SQL
DELETE FROM settings WHERE setting_key='$key';
INSERT INTO settings (setting_key, value, type, created_at, updated_at) VALUES ('$key', '$val', 'string', NOW(), NOW());
SQL
}

echo "Seeding Letwrites branding$([ "$FORCE" = 1 ] && echo ' (--force: re-applying the managed head)')…"
seed "app-name"        "Letwrites"
seed "app-color"       "#2f6bff"
seed "app-color-dark"  "#4b81ff"
# app-custom-head carries the favicon (a self-contained data URI in branding.css), the in-wiki "Who
# can see this?" panel, the import entry, and the font. --force re-applies it so branding UPDATES land
# on an existing deploy; otherwise it's only-if-unset (respecting an admin's own head content).
if [ "$FORCE" = 1 ]; then force_set "app-custom-head" "$HEAD_HTML"; else seed "app-custom-head" "$HEAD_HTML"; fi
# Header logo: 'none' so BookStack renders NO <img> (it wraps app-logo in url(), which mangles a data
# URI, and a relative /import/logo.png needs Caddy). The Letwrites mark is painted by branding.css
# (header a.logo::before) next to the app-name wordmark. Only-if-unset, so a customer's own logo wins.
seed "app-logo"        "none"
# Favicon: BookStack's <head> uses setting('app-icon-<size>') ?: url('/icon-*.png'). Point every size
# at the self-contained mark data URI so the tab icon is the "L" — no served file, no Caddy, no /icon
# route. --force re-applies them too (to push a favicon change to an existing deploy).
if [ -n "$MARK_DATAURI" ]; then
  for k in app-icon app-icon-180 app-icon-128 app-icon-64 app-icon-32; do
    if [ "$FORCE" = 1 ]; then force_set "$k" "$MARK_DATAURI"; else seed "$k" "$MARK_DATAURI"; fi
  done
else
  echo "  (no mark data URI found in branding.css — favicon left as BookStack default)"
fi
echo "Done. Favicon + header mark (data URI) + name + Letwrites blue applied$([ "$FORCE" = 1 ] && echo '; head + favicon re-applied')."
echo "Tip: to push a branding update (e.g. a new favicon) to an existing wiki, run: ./seed-branding.sh --force"
