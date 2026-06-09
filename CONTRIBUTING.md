# Contributing to Letwrites

Thanks for considering a contribution. Letwrites is open-core (Apache-2.0 core;
see `LICENSING.md`).

## Ground rules

- By submitting a contribution, you agree it's licensed under Apache-2.0 (the
  inbound=outbound model — no separate CLA for now).
- Keep PRs focused. One change per PR.
- Security-sensitive code (the engine's permission checks, the authz theme, the
  identity flow) must ship with tests. The whole product is a security claim;
  untested permission logic is a non-starter.

## Local setup

```bash
# migration toolkit
cd exporter && npm install && npm test && npm run demo

# the agent-safe engine
cd engine && npm install && npm test && npm run demo

# self-host the wiki locally
cd wiki && cp .env.example .env   # set secrets; APP_THEME=letwrites
docker compose up -d              # http://localhost:6875
```

## Tests

Every package uses `vitest`. Run `npm test`. The engine's permission-safe
invariants (`engine/src/engine.test.ts`) are the most important suite — if you
touch the permission path, those must stay green and you should add cases.

## What lives where

See `README.md` (repo layout) and `LICENSING.md` (what's open vs. enterprise).
Paid-tier features (the governance dashboard, extra connectors, the managed agent
gateway, SCIM lifecycle) are **not** in this repo — please don't submit those here.
(SSO itself — OIDC/SAML/LDAP — is part of the free core, so SSO-related fixes are welcome.)

## Reporting bugs / security issues

Bugs: open a GitHub issue. **Security vulnerabilities: do NOT open a public issue**
— see `SECURITY.md`.
