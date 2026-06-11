#!/usr/bin/env bash
#
# Letwrites backup — snapshot your self-hosted wiki to a destination YOU own.
#
# We never hold your data: this writes a verifiable snapshot to a local/NAS/mounted path you
# choose. Push it offsite with one more line (see BACKUP.md: `aws s3 sync` / `rclone` / a NAS mount).
#
#   ./backup.sh [DEST_DIR]        # default DEST_DIR = ./backups
#   ./backup.sh --check           # verify prerequisites without backing up
#
# A snapshot is a timestamped folder containing:
#   db.sql        - full database dump (pages, users, PERMISSIONS, history)
#   files.tgz     - uploaded images + app config (the BookStack /config volume)
#   SHA256SUMS    - checksums, verified on restore (corrupt/tampered backups are refused)
#   manifest.json - what/when/versions
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

DB_CONTAINER="${LETWRITES_DB_CONTAINER:-letwrites_bookstack_db}"
DB_NAME="${DB_DATABASE:-bookstackapp}"
: "${DB_ROOT_PASSWORD:?DB_ROOT_PASSWORD not set (it lives in ./.env, created by deploy.sh)}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }; }
need docker; need tar; need shasum 2>/dev/null || need sha256sum
SHA() { command -v sha256sum >/dev/null 2>&1 && sha256sum "$@" || shasum -a 256 "$@"; }

if [ "${1:-}" = "--check" ]; then
  docker exec "$DB_CONTAINER" sh -c 'command -v mariadb-dump >/dev/null || command -v mysqldump >/dev/null' \
    && echo "OK: db container '$DB_CONTAINER' reachable and dump tool present" \
    || { echo "FAIL: cannot reach db container '$DB_CONTAINER' or no dump tool"; exit 1; }
  [ -d ./data/config ] && echo "OK: ./data/config (uploaded files) present" || echo "WARN: ./data/config not found — is this the deploy dir?"
  exit 0
fi

DEST_ROOT="${1:-./backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="$DEST_ROOT/letwrites-$STAMP"
mkdir -p "$DEST"
echo "[backup] -> $DEST"

# 1) Database (consistent snapshot). mariadb:11 ships mariadb-dump; fall back to mysqldump.
echo "[backup] dumping database '$DB_NAME'..."
# Pass the password via MYSQL_PWD (env), NOT -p on the command line — a command-line password is
# visible in the DB container's process list (`ps`) for the duration of the dump.
docker exec -e MYSQL_PWD="$DB_ROOT_PASSWORD" "$DB_CONTAINER" sh -c \
  "(command -v mariadb-dump >/dev/null && mariadb-dump || mysqldump) --single-transaction --quick -uroot \"$DB_NAME\"" \
  > "$DEST/db.sql"

# 2) Uploaded images + app config (the BookStack /config bind volume)
echo "[backup] archiving uploaded files + config..."
tar -czf "$DEST/files.tgz" -C ./data config

# 3) Checksums + manifest (integrity, verified on restore)
( cd "$DEST" && SHA db.sql files.tgz > SHA256SUMS )
chmod -R go-rwx "$DEST" 2>/dev/null || true  # the dump holds password hashes — keep it owner-only
cat > "$DEST/manifest.json" <<JSON
{ "createdAt": "$STAMP", "db": "$DB_NAME", "dbContainer": "$DB_CONTAINER",
  "files": ["db.sql", "files.tgz"], "tool": "letwrites-backup", "version": 1 }
JSON

echo "[backup] done. Snapshot: $DEST"
echo "[backup] size: $(du -sh "$DEST" | cut -f1).  Verify anytime: (cd '$DEST' && ${SHA256:-sha256sum} -c SHA256SUMS)"
echo "[backup] OFFSITE (recommended): aws s3 sync '$DEST' s3://your-bucket/letwrites/$STAMP/   # or rclone / a NAS mount"
