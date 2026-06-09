# Letwrites migration toolkit as a container — run the Confluence → Letwrites
# import anywhere, no local Node/npm needed. "The image just works."
#
#   # Word export (any user, no admin), live import into your wiki:
#   docker run --rm -v "$PWD/exports:/work" \
#     -e BOOKSTACK_URL=https://docs.acme.com \
#     -e BOOKSTACK_TOKEN_ID=xxx -e BOOKSTACK_TOKEN_SECRET=yyy \
#     ghcr.io/lynne-ang/letwrites-migrate:latest \
#     --from-confluence-word /work/page.doc --in /work/out
#
#   # HTML space export (space-admin), or dry-run with no creds:
#   docker run --rm -v "$PWD/exports:/work" ghcr.io/lynne-ang/letwrites-migrate:latest \
#     --from-confluence-export /work/space-export --in /work/out --dry-run
#
# The integrity report is written under --in (and printed). Mount /work to keep it.
FROM node:20-alpine
WORKDIR /app
# Reproducible, locked install. tsx + parser live in deps/devDeps; we run TS directly
# (no build step), so install everything, then prune nothing — it's a short-lived CLI.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
ENV NODE_ENV=production
# Operator mounts their Confluence exports here and gets the output + integrity report back.
WORKDIR /work
ENTRYPOINT ["/app/node_modules/.bin/tsx", "/app/src/import-cli.ts"]
CMD ["--help"]
