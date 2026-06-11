#!/usr/bin/env bash
#
# Letwrites restore — bring a snapshot back, fast, after data loss or a bad change.
#
#   ./restore.sh <SNAPSHOT_DIR> [--force]
#
# It verifies the snapshot's checksums BEFORE touching anything (a corrupt or tampered backup is
# refused), then restores the uploaded files and the database. Run a restore DRILL on a throwaway
# stack now and then — a backup you've never restored is a hope, not a backup.
set -euo pipefail
cd "$(dirname "$0")"
# Read only what we need from .env WITHOUT sourcing it — `. ./.env` executes the file, so a value
# with shell metacharacters (e.g. an LDAP filter) would crash this script (same rule as deploy.sh).
env_val() { grep -E "^$1=" .env 2>/dev/null | tail -n1 | cut -d= -f2-; }
if [ -f .env ]; then
  : "${DB_ROOT_PASSWORD:=$(env_val DB_ROOT_PASSWORD)}"
  : "${DB_DATABASE:=$(env_val DB_DATABASE)}"
  : "${LETWRITES_DB_CONTAINER:=$(env_val LETWRITES_DB_CONTAINER)}"
fi

SRC="${1:?usage: ./restore.sh <SNAPSHOT_DIR> [--force]}"
FORCE="${2:-}"
DB_CONTAINER="${LETWRITES_DB_CONTAINER:-letwrites_bookstack_db}"
DB_NAME="${DB_DATABASE:-bookstackapp}"
: "${DB_ROOT_PASSWORD:?DB_ROOT_PASSWORD not set (./.env)}"
[ -f "$SRC/db.sql" ] && [ -f "$SRC/files.tgz" ] && [ -f "$SRC/SHA256SUMS" ] || { echo "not a Letwrites snapshot: $SRC"; exit 1; }
SHA() { command -v sha256sum >/dev/null 2>&1 && sha256sum "$@" || shasum -a 256 "$@"; }

echo "[restore] verifying snapshot integrity..."
( cd "$SRC" && SHA -c SHA256SUMS ) || { echo "[restore] CHECKSUM FAILED — refusing to restore a corrupt/tampered backup"; exit 2; }

if [ "$FORCE" != "--force" ]; then
  echo "[restore] This OVERWRITES the current Letwrites database and uploaded files from: $SRC"
  read -r -p "[restore] Type 'restore' to proceed: " ans
  [ "$ans" = "restore" ] || { echo "[restore] aborted."; exit 1; }
fi

echo "[restore] restoring uploaded files + config..."
tar -xzf "$SRC/files.tgz" -C ./data

echo "[restore] restoring database '$DB_NAME'..."
# MYSQL_PWD (env) instead of -p so the password isn't exposed in the container's process list.
docker exec -i -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" sh -c \
  "(command -v mariadb >/dev/null && mariadb || mysql) -uroot \"$DB_NAME\"" \
  < "$SRC/db.sql"

echo "[restore] done. Restart the app:  docker compose restart bookstack"
