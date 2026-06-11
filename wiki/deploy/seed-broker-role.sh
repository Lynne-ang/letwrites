#!/usr/bin/env bash
# seed-broker-role.sh — create the BookStack service-account role the paid broker uses.
#
# The broker (letwrites_share) acts on users' behalf with ONE privileged token, so a Contributor never
# holds these permissions. This role bundles exactly what the broker needs and nothing more:
#   - restrictions-manage-all : set "Who can see this?" visibility on any content (set-visibility)
#   - user-roles-manage       : create/rename/delete the self-service GROUPS (roles)
#   - users-manage            : assign users to groups + the read-only member search
#   - *-view-all              : read content to scan which books grant a group (delete-block) + can-manage
#
# Run it, then create a user in this role and an API token for them → LETWRITES_BROKER_TOKEN_ID/SECRET.
# (BookStack has no API to mint tokens, so that last step is a 30-second UI action.)
#
#   BOOKSTACK_URL=https://docs.acme.com \
#   BOOKSTACK_TOKEN_ID=<admin token id> BOOKSTACK_TOKEN_SECRET=<secret> ./seed-broker-role.sh
set -euo pipefail

BASE="${BOOKSTACK_URL:?set BOOKSTACK_URL}"; BASE="${BASE%/}"
AUTH="Authorization: Token ${BOOKSTACK_TOKEN_ID:?set BOOKSTACK_TOKEN_ID}:${BOOKSTACK_TOKEN_SECRET:?set BOOKSTACK_TOKEN_SECRET}"
api() { curl -s -H "$AUTH" -H 'Content-Type: application/json' "$@"; }

PERMS='"restrictions-manage-all","user-roles-manage","users-manage",'\
'"book-view-all","bookshelf-view-all","chapter-view-all","page-view-all"'

if api "$BASE/api/roles?count=200" | grep -q '"display_name":"Letwrites Broker"'; then
  echo "'Letwrites Broker' role already exists — nothing to do."
  exit 0
fi

RESP=$(api -X POST "$BASE/api/roles" -d "{\"display_name\":\"Letwrites Broker\",\"description\":\"Service account for the Letwrites paid broker (set-visibility + self-service groups). Do not assign to people.\",\"permissions\":[$PERMS]}")
RID=$(echo "$RESP" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
[ -n "${RID:-}" ] || { echo "FAIL: could not create role. Response: $RESP"; exit 1; }

echo "Created 'Letwrites Broker' role (id $RID)."
echo
echo "Finish the service account (one-time, in the UI at $BASE):"
echo "  1. Settings ▸ Users ▸ Add user  → assign ONLY the 'Letwrites Broker' role (no email login needed)."
echo "  2. That user ▸ API Tokens ▸ Create → put the id/secret in LETWRITES_BROKER_TOKEN_ID / _SECRET."
echo
echo "With this role, set-visibility AND self-service groups work; a missing permission would otherwise"
echo "surface as a clear 'grant Manage Users & Roles' error, never a silent failure."
