#!/usr/bin/env bash
# verify-live.sh — proves the load-bearing security gate on a LIVE Letwrites:
#   does BookStack's permission model actually DENY an agent acting for a user
#   who should not see a page? If this fails open, the whole product is theater.
#
# Run after `docker compose up` + setting up a restricted page (see seed-bookstack.sh
# or set one up in the UI). Provide:
#   BOOKSTACK_URL        e.g. https://docs.acme.com   (or http://localhost:6875)
#   LETWRITES_AUTHZ_SECRET  the shared secret from .env
#   ALLOWED_USER_ID      a BookStack user id that CAN see the page (e.g. admin = 1)
#   DENIED_USER_ID       a BookStack user id that must NOT see the page
#   RESTRICTED_PAGE_ID   the page id that's restricted away from DENIED_USER_ID
set -euo pipefail

BASE="${BOOKSTACK_URL:?set BOOKSTACK_URL}"; BASE="${BASE%/}"
SECRET="${LETWRITES_AUTHZ_SECRET:?set LETWRITES_AUTHZ_SECRET}"
ALLOWED="${ALLOWED_USER_ID:?set ALLOWED_USER_ID (a user who CAN see the page)}"
DENIED="${DENIED_USER_ID:?set DENIED_USER_ID (a user who must NOT see the page)}"
PAGE="${RESTRICTED_PAGE_ID:?set RESTRICTED_PAGE_ID}"
RES="page:${PAGE}"

canread() { # $1 = userId  → prints the JSON {"allowed":[...]}
  curl -s -X POST "$BASE/letwrites/can-read" \
    -H "X-Letwrites-Secret: $SECRET" -H 'Content-Type: application/json' \
    -d "{\"userId\":${1},\"resourceIds\":[\"${RES}\"]}"
}

echo "Letwrites live permission-gate verification"
echo "========================================"
echo "1) Letwrites authz theme loaded?"
HEALTH=$(curl -s "$BASE/letwrites/health" || true)
echo "   $HEALTH"
echo "$HEALTH" | grep -q '"ok":true' || { echo "   FAIL: /letwrites/health not OK — theme not active. Check APP_THEME=letwrites."; exit 1; }

A=$(canread "$ALLOWED"); echo "2) allowed user ($ALLOWED): $A"
D=$(canread "$DENIED");  echo "3) denied user  ($DENIED): $D"

PASS=true
if echo "$A" | grep -q "\"$RES\""; then
  echo "   PASS: allowed user CAN read the page ✓"
else
  echo "   FAIL: allowed user CANNOT read — permission too strict, or wrong IDs."; PASS=false
fi

if echo "$D" | grep -q "\"$RES\""; then
  echo "   🔴 CRITICAL FAIL: DENIED user CAN read the restricted page."
  echo "      BookStack's visible() scope is FAILING OPEN — the permission gate does"
  echo "      not actually enforce. DO NOT enable the agent layer until this is fixed."
  exit 2
else
  echo "   PASS: denied user is correctly BLOCKED ✓"
fi

$PASS || { echo; echo "Gate INCOMPLETE — allowed-user check failed. Re-check IDs/permissions."; exit 1; }
echo
echo "✅ PERMISSION GATE HOLDS. The agent cannot read for an unauthorized user."
echo "   Safe to proceed to the agent layer (once the OAuth identity spike is done)."
