# Letwrites wiki = upstream BookStack (LinuxServer image) + the Letwrites authz theme
# baked in. This exists so K8s / Cloud Run / any orchestrator can run the wiki with NO
# bind-mount to manage — the theme ships inside the image. Activate it with
# APP_THEME=letwrites (the Helm chart and compose both set that).
#
# The theme is the ONLY thing we add — no BookStack fork. Build context is wiki/.
#   docker build -f wiki/Dockerfile -t ghcr.io/lynne-ang/letwrites-bookstack:dev wiki/
#
# IMPORTANT: :latest is for convenience only. publish-images.yml builds this file
# verbatim — it does NOT auto-pin. Before a production build, pin the base to a version
# tag + digest for a reproducible, supply-chain-safe image, e.g.:
#   FROM lscr.io/linuxserver/bookstack:version-v25.05@sha256:<digest>
# The LinuxServer image lays its app down at /app/www; the theme dir persists there.
FROM lscr.io/linuxserver/bookstack:latest

# Bake the theme into BookStack's themes dir (same target as the compose bind-mount).
COPY themes/letwrites /app/www/themes/letwrites
