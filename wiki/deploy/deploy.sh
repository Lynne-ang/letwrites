#!/usr/bin/env bash
# Letwrites one-command deploy. Idempotent: re-running is safe (won't clobber
# existing secrets). Generates secrets, brings up the stack, prints next steps.
set -euo pipefail
cd "$(dirname "$0")"

echo "Letwrites deploy"
echo "============="

# 1. Pre-flight.
if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is not installed. See https://docs.docker.com/engine/install/" >&2
  exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl is required to generate secrets." >&2
  exit 1
fi
COMPOSE="docker compose"
$COMPOSE version >/dev/null 2>&1 || COMPOSE="docker-compose"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from template."
  echo ">> Edit .env now: set LETWRITES_DOMAIN and LETWRITES_ACME_EMAIL, then re-run ./deploy.sh"
  exit 0
fi

# 2. Generate any secret still left as CHANGE_ME (idempotent).
set_secret() {
  local key="$1" val="$2" cur
  cur="$(grep "^${key}=" .env | cut -d= -f2- || true)"
  if [ -z "$cur" ] || [[ "$cur" == *CHANGE_ME* ]]; then
    awk -v k="$key" -v v="$val" 'BEGIN{FS=OFS="="} $1==k{print k"="v; next} {print}' .env > .env.tmp && mv .env.tmp .env
    echo "  generated ${key}"
  fi
}
set_secret APP_KEY             "base64:$(openssl rand -base64 32)"
set_secret DB_ROOT_PASSWORD    "$(openssl rand -hex 24)"
set_secret DB_PASSWORD         "$(openssl rand -hex 24)"
set_secret LETWRITES_AUTHZ_SECRET "$(openssl rand -hex 32)"
set_secret LETWRITES_ENGINE_SECRET "$(openssl rand -hex 32)"

# 3. Sanity-check the required, human-set values. Read .env values WITHOUT sourcing it:
#    `. ./.env` EXECUTES the file, so a perfectly valid value with shell metacharacters — e.g.
#    an LDAP filter like LDAP_USER_FILTER=(&(uid={user})) — would crash the script with a syntax
#    error. docker-compose reads .env literally; we do the same with a plain key lookup.
env_val() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2-; }
LETWRITES_DOMAIN="$(env_val LETWRITES_DOMAIN)"
if [[ "$LETWRITES_DOMAIN" == "docs.yourcompany.com" || -z "$LETWRITES_DOMAIN" ]]; then
  echo "ERROR: set LETWRITES_DOMAIN in .env to your real domain first." >&2
  exit 1
fi

# 4. Launch.
echo "Bringing up Letwrites for https://${LETWRITES_DOMAIN} ..."
$COMPOSE up -d

# 5. Brand the wiki as Letwrites (idempotent; won't clobber admin customizations).
#    Best-effort: wait briefly for the DB + first-boot migration, then seed.
echo "Applying Letwrites branding ..."
for i in $(seq 1 30); do
  if $COMPOSE exec -T bookstack_db sh -c 'exec mariadb -uroot -p"${MARIADB_ROOT_PASSWORD:-$DB_ROOT_PASSWORD}" -e "SELECT 1 FROM bookstackapp.settings LIMIT 1"' >/dev/null 2>&1; then
    bash ./seed-branding.sh || echo "  (branding seed skipped — set it later in Settings ▸ Customization)"
    break
  fi
  sleep 3
done

cat <<EOF

Done. Letwrites is starting.

Next:
  1. Point DNS: an A record for ${LETWRITES_DOMAIN} → this server's public IP.
     (Caddy gets a TLS cert automatically once DNS resolves + ports 80/443 are open.)
  2. Open:    https://${LETWRITES_DOMAIN}
     Default login: admin@admin.com / password  — CHANGE IT immediately.
  3. Verify the Letwrites authz endpoint loaded:
       curl https://${LETWRITES_DOMAIN}/letwrites/health
     Expect: {"ok":true,"service":"letwrites-authz","version":1}
  4. Load content: create an API token in BookStack (Edit Profile ▸ API Tokens),
     then from ../../exporter:
       BOOKSTACK_URL=https://${LETWRITES_DOMAIN} BOOKSTACK_TOKEN_ID=… BOOKSTACK_TOKEN_SECRET=… \\
         npm run import -- --in ./demo-export

Logs:    $COMPOSE logs -f
Stop:    $COMPOSE down
Backup:  the ./data directory (config + database) + the Docker volumes.
EOF
