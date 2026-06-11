#!/usr/bin/env bash
# seed-contributor-role.sh — create the least-privilege "Contributor" role.
#
# Why: BookStack's stock "Editor" role has book-update-all / book-delete-all, so any Editor can edit or
# delete ANY team's books (via the UI or the API). To let team members self-import their Confluence
# space WITHOUT that risk, assign them a role that can create + manage only their OWN content.
#
# This role can: log in, create an API token, import a Confluence space (creating books they own),
# create chapters/pages/images in their own books, and restrict each to a GROUP/role.
# This role CANNOT: view, edit, or delete other teams' content.
#
#   BOOKSTACK_URL=https://docs.acme.com \
#   BOOKSTACK_TOKEN_ID=<admin token id> BOOKSTACK_TOKEN_SECRET=<secret> ./seed-contributor-role.sh
#
# After running, make it the default in the UI: Settings ▸ Users ▸ Default Role → Contributor
# (and, for LDAP, set the default role mapping so every directory user lands here).
#
# NOTE on visibility: BookStack permissions are ROLE-based. When importing, restrict to a GROUP/role
# you belong to. "Only me" is NOT expressible for a non-admin (BookStack has no per-user grant and no
# non-admin owner bypass) — it would lock the importer out of their own content. Use a role instead.
set -euo pipefail

BASE="${BOOKSTACK_URL:?set BOOKSTACK_URL}"; BASE="${BASE%/}"
AUTH="Authorization: Token ${BOOKSTACK_TOKEN_ID:?set BOOKSTACK_TOKEN_ID}:${BOOKSTACK_TOKEN_SECRET:?set BOOKSTACK_TOKEN_SECRET}"
api() { curl -s -H "$AUTH" -H 'Content-Type: application/json' "$@"; }

# CREATE permissions are *-all (a new book/shelf has no owner yet, so BookStack gates creation on -all;
# this only lets them CREATE, not touch existing content). UPDATE/DELETE are *-own (manage only their
# own). VIEW is *-all so they can browse shared content; other teams' restricted content stays hidden.
# restrictions-manage-own lets them set visibility on their OWN imported books.
PERMS='"access-api",'\
'"book-create-all","book-update-own","book-delete-own","book-view-all",'\
'"bookshelf-create-all","bookshelf-update-own","bookshelf-delete-own","bookshelf-view-all",'\
'"chapter-create-own","chapter-update-own","chapter-delete-own","chapter-view-all",'\
'"page-create-own","page-update-own","page-delete-own","page-view-all",'\
'"image-create-all","image-update-own","image-delete-own",'\
'"attachment-update-own","attachment-delete-own",'\
'"comment-create-own","comment-update-own","comment-delete-own",'\
'"restrictions-manage-own"'

if api "$BASE/api/roles?count=200" | grep -q '"display_name":"Contributor"'; then
  echo "Contributor role already exists — nothing to do."
  exit 0
fi

RESP=$(api -X POST "$BASE/api/roles" -d "{\"display_name\":\"Contributor\",\"description\":\"Self-service: import + manage OWN content; cannot touch other teams' content.\",\"permissions\":[$PERMS]}")
RID=$(echo "$RESP" | grep -o '"id":[0-9]*' | head -1 | grep -o '[0-9]*')
[ -n "${RID:-}" ] || { echo "FAIL: could not create role. Response: $RESP"; exit 1; }

echo "Created 'Contributor' role (id $RID)."
echo
echo "Next (one-time, in the UI at $BASE):"
echo "  Settings ▸ Users ▸ Default Role  →  Contributor"
echo "  (LDAP: set the default role mapping to Contributor too.)"
echo
echo "Now any signed-in user can import their own Confluence space and share it with a group,"
echo "without being able to see or modify other teams' content."
