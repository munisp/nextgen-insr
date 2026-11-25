# Security Advisory Triage — W14-B (2026-11-25)

Scope: `pnpm audit` against `pnpm-lock.yaml`. Baseline (W13-C state) vs post-remediation.

## Before / after

| Scope | Severity | Before | After |
|---|---|---|---|
| prod | critical | 0 | 0 |
| prod | high | 1 (follow-redirects, appeared after W13-C) | 0 |
| prod | moderate | 31 | 0 |
| prod | low | 3 | 1 |
| all (incl. dev) | high+critical | 1 | 0 |
| all (incl. dev) | moderate | 39 | 8 (all dev-only) |
| all (incl. dev) | low | 3 | 1 |

## Fixes applied (package.json overrides / direct dep bump)

| Advisory(es) | Package path | Change | Justification |
|---|---|---|---|
| GHSA 1240113, 1242826, 1243091-93, 1243442-44 | `nodemailer` (direct) | override `>=9.1.0` → `>=10.1.4` (resolves 10.6.1) | Patched floor per advisories; email queue test suite passes (6/6) |
| GHSA 1244003 (CVE-2026-116689, HIGH) | `axios > follow-redirects` | add override `follow-redirects@<1.16.2: >=1.16.2` (resolves 1.16.3) | Patch-level bump within 1.x, API-compatible |
| GHSA 1239948-49, 1240097-98, 1242883 | `express-rate-limit > ip-address` | override `>=10.3.1` → `>=10.7.4` (resolves 10.7.6) | express-rate-limit declares `^10.2.0`; 10.7.6 is semver-compatible |
| GHSA 1240090, 1240093, 1243097, 1243103 (+2 low) | `@temporalio/worker > webpack > schema-utils > ajv > fast-uri` | override `>=4.1.3` → `>=4.2.3` (resolves 4.2.4) | Minor bump within 4.x, dependency-free RFC 3986 parser |
| GHSA 1158506-07, 1243687 | `express > qs` | add override `express>qs: >=6.16.1` | express 4.x pins `~6.15.1`; override forces 6.16.1. qs 6.16 is a minor release, same parsing API; body-parser already resolves 6.16.x. Router/express tests pass |
| GHSA 1244013, 1244623 (prod path) | `auto-instrumentations-node > resource-detector-gcp > gcp-metadata > gaxios > rimraf > glob > minimatch` | add override `rimraf>glob: >=14.0.3` (resolves glob 14.0.6 + minimatch 11.0.9) | glob 14 is dual CJS/ESM, engines `18||20||>=22`; rimraf 6.x itself depends on `glob ^14`, proving rimraf's usage is glob-14 compatible. Scoped to rimraf only |
| GHSA 1241247-54 (CVE-2026-104872), 1246705 | `@opentelemetry/auto-instrumentations-node > instrumentation-{pg,mysql,mysql2,knex,mongoose,oracledb,tedious,cassandra-driver,http}` | bump direct dep `^0.75.0` → `^0.83.1` | 0.83.1 pulls patched ranges for all nine instrumentations (pg ^0.78, http ^0.301, etc.). Only consumer is `server/_core/telemetry.ts` (`getNodeAutoInstrumentations`); typecheck clean, telemetry tests pass |

## Advisories left open

### Prod

| Advisory | Package / path | Severity | Why not fixed | Exposure | Revisit trigger |
|---|---|---|---|---|---|
| GHSA 1241206 (CVE-2026-103923) | `streamdown > katex` | low | Patched in katex `>=0.18.2`; forcing a katex override across streamdown's pinned range is unverified and the flaw is low severity | Markdown/chat rendering path only; low-severity rendering issue | streamdown release depending on katex >=0.18.2 |

### Dev-only (not shipped to production)

| Advisory | Package / path | Severity | Why not fixed | Exposure | Revisit trigger |
|---|---|---|---|---|---|
| GHSA 1193683 | `vitest` | moderate | Requires vitest `>=4.1.11`, a major upgrade of the test runner; out of scope for a non-breaking pass | Test tooling only, never in prod bundle | Scheduled vitest major upgrade |
| GHSA 1193684, 1242767 | `vitest > @vitest/mocker` | moderate | Same as above — fixed by vitest >=4.1.12 | Test tooling only | Same |
| GHSA 1241257 | `pino-pretty > fast-copy` | moderate | Needs fast-copy >=4.1.0 (major); pino-pretty is a dev pretty-printer | Dev log formatting only | pino-pretty release bumping fast-copy |
| GHSA 1243379 | `@tailwindcss/typography > postcss-selector-parser` | moderate | Needs >=6.1.5; plugin is build-time only | Build-time CSS processing | @tailwindcss/typography release bumping the parser |
| GHSA 1244013, 1244623 (dev paths) | `vite-plugin-pwa > workbox-build > glob`; `@typescript-eslint/* > minimatch` | moderate | Prod path fixed via `rimraf>glob`; remaining paths are PWA build tooling and lint tooling (cross-major glob/minimatch bumps unverified for those consumers) | Build/lint tooling only | workbox-build / typescript-eslint releases bumping glob/minimatch |

## Validation evidence (2026-11-25, /tmp/w14b, Node v20.20.2, pnpm 10.34.8)

- `pnpm audit --prod --json`: 0 critical / 0 high / 0 moderate / 1 low (was 0/1/31/3).
- `pnpm audit --json`: 0 critical / 0 high / 8 moderate (all dev) / 1 low (was 0/1/39/3).
- `tsc --noEmit` (server + shared): 0 errors. (Full-project tsc exceeds the 3 GB sandbox memory; server scope is the affected surface.)
- vitest (`ESBUILD_BINARY_PATH` set): `server/lib/__tests__/emailQueue.pglite.test.ts` (6), `server/emailAndRateAlerts.test.ts` (20), `server/ddosTelemetry-windowkey.test.ts` (3), `server/auth.logout.test.ts` (1) — 30/30 passed across 4 files.
