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
#
# Optional, to also verify the owner-sharing + in-wiki import routes (M3/M4/A1):
#   WRITE_BOOK_ID         book id for the governed-write (can-write) check
#   MANAGE_ENTITY_ID      entity id for the can-manage (who-can-see) check
#   MANAGE_ENTITY_TYPE    page|book|chapter|bookshelf (default: page)
#   MANAGE_ALLOWED_USER_ID / MANAGE_DENIED_USER_ID  (default: ALLOWED/DENIED)
# (The session routes /letwrites/share-* and the /letwrites/import page are checked for being
#  registered + fail-closed to anonymous callers — the full authed flow needs a browser session.)
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

# 4) WRITE gate (governed write-back). OPTIONAL — only runs if WRITE_BOOK_ID is set.
#    Confirms the can-write route enforces BookStack's create/update permission per user.
#      WRITE_BOOK_ID         a book id used for the create-permission check
#      WRITE_ALLOWED_USER_ID a user who CAN create pages in that book (default: ALLOWED_USER_ID)
#      WRITE_DENIED_USER_ID  a user who must NOT (default: DENIED_USER_ID)
if [ -n "${WRITE_BOOK_ID:-}" ]; then
  WA="${WRITE_ALLOWED_USER_ID:-$ALLOWED}"; WD="${WRITE_DENIED_USER_ID:-$DENIED}"
  canwrite() { # $1 = userId → prints {"allowed":bool}
    curl -s -X POST "$BASE/letwrites/can-write" \
      -H "X-Letwrites-Secret: $SECRET" -H 'Content-Type: application/json' \
      -d "{\"userId\":${1},\"bookId\":${WRITE_BOOK_ID}}"
  }
  echo "4) WRITE gate on book ${WRITE_BOOK_ID}:"
  WAR=$(canwrite "$WA"); echo "   allowed writer ($WA): $WAR"
  WDR=$(canwrite "$WD"); echo "   denied  writer ($WD): $WDR"
  if echo "$WAR" | grep -q '"allowed":true'; then
    echo "   PASS: allowed user CAN write to the book ✓"
  else
    echo "   FAIL: allowed user CANNOT write — too strict, wrong IDs, or userCan() namespace moved."; PASS=false
  fi
  if echo "$WDR" | grep -q '"allowed":true'; then
    echo "   🔴 CRITICAL FAIL: DENIED user CAN write. can-write is FAILING OPEN — an agent could"
    echo "      write to a book the user isn't permitted to. DO NOT enable governed write-back."
    exit 2
  else
    echo "   PASS: denied user is correctly BLOCKED from writing ✓"
  fi
else
  echo "4) WRITE gate: skipped (set WRITE_BOOK_ID to verify governed write-back / can-write)."
fi

# 5) MANAGE gate (owner sharing). OPTIONAL — only runs if MANAGE_ENTITY_ID is set.
#    Confirms /letwrites/can-manage (the route the share broker re-checks) enforces BookStack's
#    own `restrictions-manage` ability per user: the owner can manage who-can-see; others cannot.
if [ -n "${MANAGE_ENTITY_ID:-}" ]; then
  MTYPE="${MANAGE_ENTITY_TYPE:-page}"
  MA="${MANAGE_ALLOWED_USER_ID:-$ALLOWED}"; MD="${MANAGE_DENIED_USER_ID:-$DENIED}"
  canmanage() { # $1 = userId → prints {"allowed":bool}
    curl -s -X POST "$BASE/letwrites/can-manage" \
      -H "X-Letwrites-Secret: $SECRET" -H 'Content-Type: application/json' \
      -d "{\"userId\":${1},\"entityType\":\"${MTYPE}\",\"entityId\":${MANAGE_ENTITY_ID}}"
  }
  echo "5) MANAGE gate on ${MTYPE} ${MANAGE_ENTITY_ID}:"
  MAR=$(canmanage "$MA"); echo "   allowed manager ($MA): $MAR"
  MDR=$(canmanage "$MD"); echo "   denied  manager ($MD): $MDR"
  if echo "$MAR" | grep -q '"allowed":true'; then
    echo "   PASS: allowed user CAN manage visibility ✓"
  else
    echo "   FAIL: allowed user CANNOT manage — too strict, wrong IDs, or restrictions-manage moved."; PASS=false
  fi
  if echo "$MDR" | grep -q '"allowed":true'; then
    echo "   🔴 CRITICAL FAIL: DENIED user CAN manage who-can-see. can-manage is FAILING OPEN — a user"
    echo "      could re-share content they don't own. DO NOT enable self-service sharing."
    exit 2
  else
    echo "   PASS: denied user is correctly BLOCKED from managing ✓"
  fi
else
  echo "5) MANAGE gate: skipped (set MANAGE_ENTITY_ID [+MANAGE_ENTITY_TYPE] to verify can-manage)."
fi

# 6) Session routes registered + fail-closed for anonymous callers. The owner-sharing endpoints and
#    the in-wiki import page live under BookStack's 'web' middleware (session + CSRF). We can't drive
#    the full authed flow from curl, but we CAN prove the routes EXIST (not 404 → the theme's web
#    group loaded) and REFUSE anonymous access (never serve/act without a session).
echo "6) Owner-sharing + in-wiki import routes (anonymous = must be refused, not 404):"
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

IMP=$(code "$BASE/letwrites/import")
echo "   GET /letwrites/import (no session): HTTP $IMP"
case "$IMP" in
  301|302) echo "   PASS: in-wiki import page redirects anonymous users to login ✓" ;;
  200) echo "   🔴 CRITICAL FAIL: /letwrites/import served WITHOUT a session."; exit 2 ;;
  404) echo "   FAIL: /letwrites/import not found — theme web routes did not load."; PASS=false ;;
  *)   echo "   WARN: unexpected status $IMP (expected 302 → /login)."; PASS=false ;;
esac

SA=$(code -X POST "$BASE/letwrites/share-apply" -H 'Content-Type: application/json' -d '{"entityType":"page","entityId":1}')
echo "   POST /letwrites/share-apply (no session): HTTP $SA"
case "$SA" in
  401|419|302) echo "   PASS: share-apply refuses anonymous callers (auth/CSRF) ✓" ;;
  200) echo "   🔴 CRITICAL FAIL: share-apply acted WITHOUT a session."; exit 2 ;;
  404) echo "   FAIL: share-apply not found — theme web routes did not load."; PASS=false ;;
  *)   echo "   WARN: unexpected status $SA (expected 401/419/302)."; PASS=false ;;
esac

$PASS || { echo; echo "Gate INCOMPLETE — a check failed. Re-check IDs/permissions/routes."; exit 1; }
echo
echo "✅ PERMISSION GATE HOLDS. The agent cannot read (or write) for an unauthorized user."
echo "   Safe to proceed to the agent layer."
