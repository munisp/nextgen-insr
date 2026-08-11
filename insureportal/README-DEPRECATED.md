# DEPRECATED: insureportal/ (nested duplicate app)

**This directory is a stale, nested copy of the application and is kept for
reference only. It must NOT be deployed, built as the primary app, or used as
the source of truth for any endpoint behavior.**

## Canonical application

The canonical application lives at the **repository root**:

- `client/` — React/Vite frontend
- `server/` — tRPC/Express backend
- `drizzle/` — database schema and migrations

Build and run from the repo root (`pnpm install --frozen-lockfile && pnpm build`),
never from `insureportal/`.

## Known-stale faker endpoints in this copy

This nested copy pins older faker/mock endpoint variants that have been fixed
or replaced in the canonical root app. Known-stale implementations include:

- `server/routers/disputeRefund.ts` — `disputeRefund` with a **hardcoded
  velocity** check instead of the canonical velocity/fraud evaluation.
- `server/routers/tigerBeetle.ts` — `tigerBeetle.rotateSecret` is a **no-op
  faker**; it does not rotate any secret.
- `server/routers/ollamaLLM.ts` — `ollamaLLM.classifyTransactionMutation` faker
  classification endpoint superseded in the canonical app.

These endpoints return canned/mock data here and must not be consulted for
current API contracts.

## Deployment note

No production deploy configuration builds `insureportal/` as the primary app
(the root `Dockerfile` / `docker-compose.production.yml` build the repo root).
A small number of auxiliary services under `insureportal/services/*`
(`infra-go`, `rust-middleware`, `python-analytics`) are still referenced by
`docker-compose.production.yml`; those service directories are unaffected by
this deprecation notice.
