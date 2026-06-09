#!/usr/bin/env bash
# seed-bookstack.sh — best-effort setup helper for verify-live.sh.
# Creates a "Letwrites Verify" book + a page via the BookStack API and prints the
# page id. Then you do a 2-minute manual step in the UI (the permission-restriction
# + viewer-user parts use version-specific APIs, so we leave them to the UI to keep
# this robust across BookStack versions).
#
#   BOOKSTACK_URL=https://docs.acme.com \
#   BOOKSTACK_TOKEN_ID=… BOOKSTACK_TOKEN_SECRET=… ./seed-bookstack.sh
set -euo pipefail

BASE="${BOOKSTACK_URL:?set BOOKSTACK_URL}"; BASE="${BASE%/}"
TID="${BOOKSTACK_TOKEN_ID:?set BOOKSTACK_TOKEN_ID}"
TSEC="${BOOKSTACK_TOKEN_SECRET:?set BOOKSTACK_TOKEN_SECRET}"
AUTH="Authorization: Token ${TID}:${TSEC}"

api() { curl -s -H "$AUTH" -H 'Content-Type: application/json' "$@"; }

echo "Creating 'Letwrites Verify' book…"
BOOK=$(api -X POST "$BASE/api/books" -d '{"name":"Letwrites Verify","description":"Temp book for permission verification"}')
BOOK_ID=$(echo "$BOOK" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
[ -n "${BOOK_ID:-}" ] || { echo "FAIL: could not create book. Response: $BOOK"; exit 1; }
echo "  book id: $BOOK_ID"

echo "Creating a restricted-candidate page…"
PAGE=$(api -X POST "$BASE/api/pages" -d "{\"book_id\":${BOOK_ID},\"name\":\"Confidential — Verify\",\"markdown\":\"# Confidential\\n\\nIf a denied user can read this via an agent, the gate failed.\"}")
PAGE_ID=$(echo "$PAGE" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
[ -n "${PAGE_ID:-}" ] || { echo "FAIL: could not create page. Response: $PAGE"; exit 1; }
echo "  page id: $PAGE_ID"

cat <<EOF

Next (2-minute manual step in the BookStack UI at $BASE):
  1. Open the "Letwrites Verify" book → Permissions → restrict it to a role that your
     test "denied" user is NOT in (e.g. allow only Admins).
  2. Note two user ids (Settings ▸ Users): an ALLOWED one (e.g. admin, usually 1)
     and a DENIED one (a viewer with no access to this book).

Then run the gate test:
  BOOKSTACK_URL=$BASE LETWRITES_AUTHZ_SECRET=<secret> \\
  ALLOWED_USER_ID=<id> DENIED_USER_ID=<id> RESTRICTED_PAGE_ID=$PAGE_ID \\
    ./verify-live.sh
EOF
