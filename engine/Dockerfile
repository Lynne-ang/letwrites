# Letwrites engine — internal agent-safe answering API.
# Multi-stage: build TypeScript, then run the compiled JS on a slim runtime.
# The engine has no runtime npm dependencies (only Node built-ins), so the
# final image is just node + dist/.

FROM node:20-alpine AS build
WORKDIR /app
# Copy the lockfile and use `npm ci` for a reproducible, locked install.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY src ./src
RUN npm run build

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY package.json ./
# Audit log dir, owned by the non-root user (must be writable for the hash chain).
RUN mkdir -p /app/data/audit && chown -R node:node /app/data
ENV LETWRITES_AUDIT_FILE=/app/data/audit/audit.jsonl
# Drop root — run as the unprivileged `node` user baked into the base image.
USER node
EXPOSE 8787
# Lightweight healthcheck against the engine's own /health.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health >/dev/null 2>&1 || exit 1
CMD ["node", "dist/server.js"]
