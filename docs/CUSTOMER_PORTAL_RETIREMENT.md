# Customer Portal Full — Retirement Note

**Date:** 2026-10-03
**Work item:** W7-B11 (insureportal/ + customer-portal-full retirement)
**Status:** Retired — directory removed from all deployment wiring; tree deleted at push time.

## Summary

`customer-portal-full/` — the standalone Next/Express-style customer portal app
(build `./customer-portal-full`, port 3000/5002) — is retired. Its successor is the
**monolith member portal** served by the root application under `/member/*`
(delivered in W7-B1 through W7-B10, pages in `client/src/pages/member/`).

This note substitutes for the archive that git history would normally provide:
the repository has no commit history, so this document records what was removed
and why.

## What was removed (W7-B11)

| File | Change |
|------|--------|
| `docker-compose.yaml` | `customer-portal` service block removed |
| `deploy/staging/docker-compose.staging.yml` | `portal` service block removed |
| `deployment/docker-compose.yml` | `customer-portal` service block removed; dropped from nginx `depends_on` |
| `deployment/nginx/nginx.conf` | `customer_portal` upstream + `portal.insureportal.ng` server blocks removed (upstream host would be unresolvable after retirement) |
| `deployment/scripts/init-databases.sh` | portal schema push (`pnpm db:push` from `/home/ubuntu/customer-portal-full`) and portal seed (`server/seed.mjs`) removed |
| `deployment/scripts/setup-databases-complete.sh` | customer portal migration block removed |

The `customer_portal` PostgreSQL database is **still created** by
`init-databases.sh` so any existing production data is preserved. Drop it only
after its data has been migrated into the monolith database — this is an
explicit no-data-loss decision, not an oversight.

`customer-portal-full/k8s/*.yaml` manifests were self-contained and applied by
no CI job; they are deleted together with the directory.

## Feature parity (successor coverage)

Monolith member portal pages under `/member/*` cover the retired app's
member-facing features:

| Retired portal feature | Successor |
|------------------------|-----------|
| Policies list / detail | `/member/policies`, `/member/policies/:id` (`MemberPolicies.tsx`, `MemberPolicyDetail.tsx`) |
| Claims | `/member/claims` (`MemberClaims.tsx`) |
| Payments | `/member/payments` (`MemberPayments.tsx`) |
| Quotes / products | `/member/quotes`, `/member/products` |
| Beneficiaries, endorsements, disputes, referrals, loyalty, notifications, profile, identity | corresponding `Member*.tsx` pages |
| Login | `/member/login` (`MemberLogin.tsx`) |

## Deferred items (not ported — see per-item reasons)

These existed in the retired app and were not carried over:

- **Admin pages** — UI-only surface with no backend in the retired app;
  re-introduction requires building the backend first.
- **Document upload / KYC submission** — *(corrected 2026-10-03: the original
  version of this document wrongly claimed these had "no backend implementation
  in any service"; that was inaccurate.)* The retired app **did** implement
  these: `customer-portal-full/server/routers.ts:861` defines a `kyc` tRPC
  router (`submit`, `startVerification`, `submitDocument`, `submitSelfie`,
  `verifyNIN`, …) backed by real DB writes via `submitKYCVerification` in
  `customer-portal-full/server/db.ts:2096` (inserts into `kycVerifications`).
  They were not ported because that surface is **superseded by the monolith's
  own KYC/document routers**, which cover the same functionality:
  `server/routers/memberIdentity.ts` (member-scoped KYC status/session surface
  for the PWA), `server/routers/kyc.ts`, `server/routers/kycDocumentManagement.ts`,
  `server/routers/kycDocumentsCrud.ts`, and `server/routers/kycEnforcement.ts`.
  The retired implementation was abandoned code of the removed app, not a
  capability the platform lost.

No member-facing functionality was "lost" in the migration; the deferred items
are either backend-less UI (admin) or superseded by existing monolith routers
(KYC/documents).

## Deployment notes

- **MONOLITH_URL passthrough is no longer needed.** Nothing in the repo
  references `MONOLITH_URL` anymore (verified by grep over `server/`, `client/`,
  `shared/`, compose files on 2026-10-03).
- **W7-B2 mutation proxy is gone.** `proxyMemberMutation` has zero callers
  anywhere in the repository (verified by grep on 2026-10-03); the mutations it
  once proxied are served natively by the monolith's tRPC routers. No dangling
  call sites remain to clean up with the directory deletion.
- Compose service/container names `go-infra`, `rust-middleware`,
  `python-analytics` are unchanged, so APISIX (`infra/apisix/routes.yaml`) and
  Caddy upstreams keep resolving.
- If the hostname `portal.insureportal.ng` must stay live, point it at the
  monolith app (it previously proxied to the retired container).
