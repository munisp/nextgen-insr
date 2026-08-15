# Threat Model — InsurePortal (nextgen-insr)

**Date:** 2026-08-15 (finding F-05 remediation) · **Scope:** TypeScript tRPC + Drizzle/Postgres core API, Keycloak OIDC auth, Permify PBAC, TigerBeetle ledger sidecar, inbound webhooks, agent POS channel.

Every claim below references code inspected in this repository. Where a control is absent, it is listed under **Residual risks** — not asserted.

---

## 1. Assets

| Asset | Where it lives (code) | Why it matters |
|---|---|---|
| Premium funds / float / commissions | `transactions`, `agents.floatLimit`, `agents.commissionBalance`, `refunds` tables (`drizzle/schema.ts`); TigerBeetle ledger via `server/tbClient.ts` | Direct monetary value; refund abuse and ledger tampering = financial loss |
| Policyholder PII | `users`, `customers`, `agents` (name/phone/email), `beneficiaries.nationalId`, KYC tables (`drizzle/schema.ts`) | NDPR/GDPR exposure; identity theft |
| Insurance policies & claims | `policies`, `claims`, `claim_documents` (`drizzle/schema.ts` ~L4759/L4827) | Fraud surface (fake claims), privacy |
| Ledger integrity | TigerBeetle sidecar (`server/tbClient.ts`, `TB_SIDECAR_URL`), zero-amount audit transfers in `server/middleware/observabilityMiddleware.ts` | Financial source of truth |
| Credentials & secrets | `kc_session` HS256 JWT (`server/_core/keycloakAuth.ts`), `JWT_SECRET` (`server/lib/envValidation.ts`), Vault injection (`server/_core/vault.ts`), webhook HMAC secrets (`server/middleware/webhookHmac.ts`) | Forgery of sessions/webhooks |
| Tenant boundary | `tenants`, `tenant_users`, `users.tenantId`, `tenantId` columns on policies/claims/disputes/refunds/agents (`drizzle/schema.ts`) | Cross-tenant data isolation |
| Refund idempotency state | `refunds.idempotencyKey` + `refunds.payloadHash` (`drizzle/schema.ts` ~L807, `server/routers/disputeRefund.ts`) | Replay/double-refund prevention |

## 2. Actors

- **Policyholder / customer** — public client, authenticates via Keycloak OIDC.
- **Agent (POS)** — authenticated, `role="user"`; PIN + OTP flows (`server/routers/pinReset.ts`, `server/routers/agent.ts` `login`).
- **Tenant staff** — `tenant_users.role` ∈ tenant_admin/operator/viewer (`drizzle/schema.ts` ~L2691).
- **Platform admin** — `users.role="admin"`; gated by `adminProcedure` (`server/_core/trpc.ts`).
- **Super-admin** — `role="super_admin"` recognized by `server/middleware/tenantIsolation.ts` (tenantId=0 global sentinel).
- **External services** — Keycloak, Permify, TigerBeetle sidecar, Termii (SMS), Stripe/partner webhooks, Kafka/Redis/Fluvio sidecars.
- **Attacker archetypes:** unauthenticated internet user; authenticated low-privilege user attempting IDOR/cross-tenant access; malicious/compromised tenant; replay attacker on webhooks/refunds; OTP brute-forcer.

## 3. Trust boundaries

1. **Client ↔ API (Express/tRPC).** Entry: `/api/trpc` (`server/_core/index.ts` ~L484), REST bridge `/api/v1`, Socket.IO. Controls: helmet CSP/HSTS (`index.ts` ~L162), global + auth rate limiters (`index.ts` ~L256), session JWT verify in `createContext` (`server/_core/context.ts`), `requireUser`/`requirePermify`/`adminProcedure` middleware chain (`server/_core/trpc.ts`).
2. **API ↔ Keycloak.** OIDC code exchange + token verify (`server/_core/keycloak.ts`), local HS256 session cookie (`keycloakAuth.ts`, 8h max age, Redis blacklist on logout).
3. **API ↔ Permify (PBAC).** `permifyCheck` (`server/_core/permify.ts`): **fail-closed by default** with circuit breaker (5 failures → 30s open); `PERMIFY_FAIL_OPEN=true` is an explicit insecure opt-in with a loud startup warning. Schema: `infra/permify/schema.perm` (16 Keycloak roles → 13 domain entities).
4. **API ↔ Providers (Termii SMS, Stripe, partners).** Inbound webhooks verified with HMAC-SHA256 over the raw body (`server/middleware/webhookHmac.ts`, mounted in `index.ts` ~L514–556 for `/webhooks/tigerbeetle|termii|partner`; Stripe via `constructEvent` in `server/stripe/webhookHandler.ts` with a 5-minute signed-timestamp tolerance). **Fail-closed:** when the secret env var is unset, production answers 503 PRECONDITION_FAILED; only dev/test keeps a labeled, logged bypass.
5. **Service ↔ TigerBeetle.** All ledger movement through `tbCreateTransfer`/`tbEnsureAgentAccount` (`server/tbClient.ts`); refunds persist honest `pending` rows server-side with no fake settlement (`server/routers/disputeRefund.ts`).

## 4. Entry points (attack surface)

- tRPC routers (`server/routers.ts` mounts ~200 routers under `/api/trpc`).
- REST bridge `app.use("/api/v1", restBridgeRouter)` (`index.ts`).
- Webhooks: `/webhooks/tigerbeetle`, `/webhooks/termii`, `/webhooks/partner` (HMAC-gated).
- Auth: `/api/auth/*` (Keycloak login/callback/logout; stricter 50 req/15min limiter).
- Cron endpoints: `/api/scheduled/monthly-invoices`.
- Health: `/api/health` (unauthenticated; reports dependency status).
- Socket.IO channel (`server/socket.ts`).

## 5. Privileged operations

| Operation | Guard |
|---|---|
| Any authenticated procedure | `protectedProcedure` = requireUser + Permify `access` on `system:insurance-portal` (`server/_core/trpc.ts`) |
| Admin procedures | `adminProcedure` = role=admin + Permify `admin_access` |
| Refund initiation | tiered approval matrix (auto ≤ ₦5,000 / supervisor / manager+compliance / executive) + velocity cap 5 refunds/customer/30d + ₦2,000,000 daily agent cap + idempotency-key replay/CONFLICT logic (`server/routers/disputeRefund.ts`) |
| Tenant read isolation | `assertTenantOwnership` (`server/middleware/tenantIsolation.ts`) applied to policies/claims/disputes/refunds/agents read paths (this change) |
| Tenant CRUD | `multiTenantIsolationRouter` — all procedures on `adminProcedure` (role=admin + Permify `admin_access`); regression tests in `tests/integration/tenantAdminAuthz.integration.test.ts` |
| Session revocation | Redis token blacklist (`keycloakAuth.ts` logout) |
| OTP/PIN reset | bcrypt-hashed 6-digit OTP, expiry, single-use (`server/routers/pinReset.ts`) |

## 6. Abuse cases & mitigations

| Abuse case | Mitigation in code | Status |
|---|---|---|
| **IDOR** — read another user's policy/claim/agent by guessing ids | `assertTenantOwnership` on `insuranceWorkflows.getPolicyById/getClaimById`, `agent.getById`; regression tests in `tests/integration/tenancy.integration.test.ts` | **Fixed in this change** (was absent before) |
| **Cross-tenant list read** — enumerate other tenants' policies/claims/disputes/agents | `tenantId` filter on `listPolicies`, `listClaims`, `disputeRefund.list`, `disputeRefund.getSummary`, `agent.list` when `ctx.user.tenantId` is set | **Fixed in this change** |
| **Refund abuse / cross-tenant refund initiation** | `initiateRefund` now loads the referenced dispute and asserts tenant ownership; refund rows are tagged with caller `tenantId`; idempotency-key replay path is tenant-guarded (cross-tenant key probing → FORBIDDEN); velocity + tier caps + payload-hash CONFLICT pre-existing | **Fixed in this change** (dispute existence itself is not required — legacy free-form `disputeId` still queues a refund; see Residual risks) |
| **Replay of refunds** | `idempotencyKey` unique + `payloadHash` SHA-256, race-safe `ON CONFLICT DO NOTHING` (F-01, `disputeRefund.ts`) | Present |
| **Replay of webhooks** | HMAC-SHA256 over raw body (`webhookHmac.ts`); Stripe `constructEvent` enforces a 5-minute signed-timestamp tolerance (`STRIPE_WEBHOOK_TOLERANCE_SECONDS`, `webhookHandler.ts`); per-tenant webhook secret column (`tenants.webhookSecret`, `drizzle/schema.ts` ~L1398) | Present; Stripe replay freshness **fixed**. Generic partner scheme signs the body only — see Residual risks |
| **OTP brute force** (PIN reset, 6-digit) | OTP bcrypt-hashed at rest, expiring, single-use, and now **attempt-capped**: `otp_tokens.attempts` persists failures, token locks after 5 wrong tries (fail-closed; even the correct code is rejected once locked) (`pinReset.ts`, `MAX_OTP_ATTEMPTS`) | **Fixed** (`tests/integration/pinResetOtp.integration.test.ts`) |
| **Session forgery** | HS256 JWT verified locally; `JWT_SECRET` default-value startup abort outside dev/test (`context.ts`); `DEV_AUTH_BYPASS` blocked unless `NODE_ENV=development` | Present |
| **Authorization bypass during Permify outage** | Fail-closed default + circuit breaker + alert logging (`permify.ts`) | Present (since PR #120) |
| **SQL injection** | Drizzle parameterized queries throughout inspected routers | No raw-SQL string interpolation of user input found in inspected routers |
| **Log-based PII/secret leakage** | pino redaction paths (`password/secret/token/authorization/cookie`) in production logger (`server/_core/logger.ts`); request-scoped log lines carry only path/type/numeric userId/requestId/duration (`observabilityMiddleware.ts`) | Present + verified by `tests/integration/requestId.integration.test.ts` |
| **Correlation/forensics gap** | `x-request-id` honored or generated per request, stamped on response, attached to tRPC context and all per-call log lines (`context.ts`, `index.ts`, `logger.ts`) | **Fixed in this change** (previously three disconnected mechanisms: `index.ts` inline header middleware, unwired `logger.requestLoggingMiddleware`, unwired `lib/correlationId.ts`) |

## 7. Residual risks (honest list)

1. **Platform-scope bypass:** users with `tenantId IS NULL` (incl. all `admin` role users) are deliberately unscoped by the `tenantId ?? 0` sentinel convention (`tenantIsolation.ts`). If tenant assignment is ever incomplete at provisioning, that user sees *all* tenants. **Guard added:** `tenantAdmin.updateUser` is now admin-only, `.strict()` (a smuggled `tenantId` key is rejected loudly), and tenant-scoped admins may only edit users inside their own tenant (platform-scope/cross-tenant → FORBIDDEN); no tRPC procedure can create users at all (`inviteUser` is NOT_IMPLEMENTED). Regression tests: `tests/integration/tenantAdminAuthz.integration.test.ts`. Still recommend a periodic audit of `users WHERE tenantId IS NULL`.
2. **Unscoped routers remain.** The tenant filter was added to the highest-risk read paths (policies, claims, disputes, refunds, agents). Many other routers (grep `tenantId` in `server/routers/`) still accept tenantId as *input* or ignore it; each needs the same treatment or a documented single-tenant rationale.
3. ~~**`multiTenantIsolationRouter`**~~ **FIXED:** listTenants/getTenant/createTenant/suspendTenant/getStats moved from `protectedProcedure` to `adminProcedure`; non-admin → FORBIDDEN, anonymous → UNAUTHORIZED (tests: `tests/integration/tenantAdminAuthz.integration.test.ts`). Note: `createTenant` also gained the previously missing required `slug` value (the insert could never succeed without it).
4. ~~**Webhook HMAC skip**~~ **FIXED:** `verifyWebhookHmac` and the Stripe handler answer **503 PRECONDITION_FAILED** in production when the secret env var is unset; dev/test keeps a labeled, logged bypass that (for Stripe) acknowledges without processing the event.
5. ~~**No webhook replay freshness**~~ **PARTIALLY FIXED:** Stripe events older than 5 minutes are rejected via the signed `t=` timestamp (`constructEvent` tolerance, `STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300`). The generic `/webhooks/*` HMAC scheme signs only the body — adding a signed-timestamp window there requires provider-side changes and remains open.
6. ~~**OTP attempt throttling**~~ **FIXED:** `otp_tokens.attempts` counter with lockout after 5 failed verifications (fail-closed; tests: `tests/integration/pinResetOtp.integration.test.ts`). Also corrected `pinReset.ts` to look agents up by the real `agents.agentId` column (the previous `agents.agentCode` reference matched no schema column).
7. **`server/lib/correlationId.ts`** remains unwired legacy (it would mint a *second*, conflicting request id); keep unused or delete in a follow-up.
8. **Error messages in logs:** per-call warn lines include tRPC error messages; these are developer-controlled strings, but Zod validation messages can echo input metadata — redaction covers secrets, not arbitrary input text.
9. **`tenantFilter` helper uses `require("drizzle-orm")`** inside ESM code (`tenantIsolation.ts`) — it would throw if called; this change deliberately used `eq()` directly instead.
10. **Idempotency keys are bearer-like:** the cross-tenant replay guard relies on `refunds.tenantId` being set (rows created before this change have NULL and are replayable by anyone holding the key). Keys should be high-entropy and treated as secrets client-side.

## 8. Verification

- `tests/integration/tenancy.integration.test.ts` — 12 cross-tenant negative/positive tests (real DB, real middleware chain).
- `tests/integration/requestId.integration.test.ts` — 5 correlation-ID propagation tests incl. log-payload PII assertions.
- `tests/integration/tenantAdminAuthz.integration.test.ts` — admin gating of tenant CRUD + platform-provisioning invariant (tenantId NULL immutability, tenant-scoped admin confinement).
- `tests/integration/pinResetOtp.integration.test.ts` — OTP attempt counter/lockout, expiry, single-use.
- `tests/integration/webhookSecurity.integration.test.ts` — Stripe/generic webhook HMAC: mandatory verification, stale-timestamp replay rejection, production 503 without secret, labeled dev bypass.
- Full suite: `PGLITE_PORT=54629 pnpm test:integration` → 12 files, 92 tests, all passing (includes funds-integrity and ops-governance suites from main). `tests/integration/funds-flow.integration.test.ts` is now PGlite-desync-proof (dedicated fresh harness connection after the intentional in-transaction error; 5× consecutive green runs).
