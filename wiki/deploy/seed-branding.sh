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
[ -f .env ] && set -a && . ./.env && set +a

COMPOSE="docker compose"; $COMPOSE version >/dev/null 2>&1 || COMPOSE="docker-compose"
DB_SVC="bookstack_db"
CSS_FILE="../themes/letwrites/branding.css"

# DB client + root password differ by image; mariadb image uses MARIADB_ROOT_PASSWORD.
ROOTPW="${DB_ROOT_PASSWORD:-${MARIADB_ROOT_PASSWORD:-}}"
if [ -z "$ROOTPW" ]; then echo "seed-branding: DB_ROOT_PASSWORD not set in .env — skipping"; exit 0; fi

# Read the custom-head CSS, SQL-escape single quotes.
HEAD_HTML="$(sed "s/'/''/g" "$CSS_FILE")"

# Insert each setting only if the key doesn't already exist (admin overrides win).
seed() {
  local key="$1" val="$2"
  $COMPOSE exec -T "$DB_SVC" sh -c "exec mariadb -uroot -p'$ROOTPW' bookstackapp" <<SQL
INSERT INTO settings (setting_key, value, type, created_at, updated_at)
SELECT '$key', '$val', 'string', NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE setting_key='$key');
SQL
}

echo "Seeding Letwrites branding (only where unset)…"
seed "app-name"        "Letwrites"
seed "app-color"       "#2f6bff"
seed "app-color-dark"  "#4b81ff"
seed "app-custom-head" "$HEAD_HTML"
echo "Done. Name + Letwrites blue (#2f6bff) applied."
echo "Logo: upload ./branding/letwrites-logo.png in Settings ▸ Customization ▸ Application Logo"
echo "      (one click; the same screen is where a customer sets THEIR own logo + color)."
