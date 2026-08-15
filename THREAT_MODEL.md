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
4. **API ↔ Providers (Termii SMS, Stripe, partners).** Inbound webhooks verified with HMAC-SHA256 over the raw body (`server/middleware/webhookHmac.ts`, mounted in `index.ts` ~L514–556 for `/webhooks/tigerbeetle|termii|partner`). **Caveat:** when the secret env var is unset, verification is *skipped* (dev-mode fallback) — see Residual risks.
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
| Tenant CRUD | `multiTenantIsolationRouter` — see Residual risks (mounted on plain `protectedProcedure`) |
| Session revocation | Redis token blacklist (`keycloakAuth.ts` logout) |
| OTP/PIN reset | bcrypt-hashed 6-digit OTP, expiry, single-use (`server/routers/pinReset.ts`) |

## 6. Abuse cases & mitigations

| Abuse case | Mitigation in code | Status |
|---|---|---|
| **IDOR** — read another user's policy/claim/agent by guessing ids | `assertTenantOwnership` on `insuranceWorkflows.getPolicyById/getClaimById`, `agent.getById`; regression tests in `tests/integration/tenancy.integration.test.ts` | **Fixed in this change** (was absent before) |
| **Cross-tenant list read** — enumerate other tenants' policies/claims/disputes/agents | `tenantId` filter on `listPolicies`, `listClaims`, `disputeRefund.list`, `disputeRefund.getSummary`, `agent.list` when `ctx.user.tenantId` is set | **Fixed in this change** |
| **Refund abuse / cross-tenant refund initiation** | `initiateRefund` now loads the referenced dispute and asserts tenant ownership; refund rows are tagged with caller `tenantId`; idempotency-key replay path is tenant-guarded (cross-tenant key probing → FORBIDDEN); velocity + tier caps + payload-hash CONFLICT pre-existing | **Fixed in this change** (dispute existence itself is not required — legacy free-form `disputeId` still queues a refund; see Residual risks) |
| **Replay of refunds** | `idempotencyKey` unique + `payloadHash` SHA-256, race-safe `ON CONFLICT DO NOTHING` (F-01, `disputeRefund.ts`) | Present |
| **Replay of webhooks** | HMAC-SHA256 over raw body (`webhookHmac.ts`); per-tenant webhook secret column (`tenants.webhookSecret`, `drizzle/schema.ts` ~L1398) | Present; **no timestamp/nonce freshness check** — see Residual risks |
| **OTP brute force** (PIN reset, 6-digit) | OTP bcrypt-hashed at rest, expiring, single-use (`pinReset.ts`) | **No attempt counter/lockout found** — see Residual risks |
| **Session forgery** | HS256 JWT verified locally; `JWT_SECRET` default-value startup abort outside dev/test (`context.ts`); `DEV_AUTH_BYPASS` blocked unless `NODE_ENV=development` | Present |
| **Authorization bypass during Permify outage** | Fail-closed default + circuit breaker + alert logging (`permify.ts`) | Present (since PR #120) |
| **SQL injection** | Drizzle parameterized queries throughout inspected routers | No raw-SQL string interpolation of user input found in inspected routers |
| **Log-based PII/secret leakage** | pino redaction paths (`password/secret/token/authorization/cookie`) in production logger (`server/_core/logger.ts`); request-scoped log lines carry only path/type/numeric userId/requestId/duration (`observabilityMiddleware.ts`) | Present + verified by `tests/integration/requestId.integration.test.ts` |
| **Correlation/forensics gap** | `x-request-id` honored or generated per request, stamped on response, attached to tRPC context and all per-call log lines (`context.ts`, `index.ts`, `logger.ts`) | **Fixed in this change** (previously three disconnected mechanisms: `index.ts` inline header middleware, unwired `logger.requestLoggingMiddleware`, unwired `lib/correlationId.ts`) |

## 7. Residual risks (honest list)

1. **Platform-scope bypass:** users with `tenantId IS NULL` (incl. all `admin` role users) are deliberately unscoped by the `tenantId ?? 0` sentinel convention (`tenantIsolation.ts`). If tenant assignment is ever incomplete at provisioning, that user sees *all* tenants. Recommend a provisioning-time invariant + periodic audit of `users WHERE tenantId IS NULL`.
2. **Unscoped routers remain.** The tenant filter was added to the highest-risk read paths (policies, claims, disputes, refunds, agents). Many other routers (grep `tenantId` in `server/routers/`) still accept tenantId as *input* or ignore it; each needs the same treatment or a documented single-tenant rationale.
3. **`multiTenantIsolationRouter`** (listTenants/getTenant/createTenant/suspendTenant) is mounted on plain `protectedProcedure` — any authenticated user can enumerate and suspend tenants. It is platform-admin surface and should move to `adminProcedure`. Not changed here to avoid altering admin UI behavior without product confirmation; flagged as **High**.
4. **Webhook HMAC skip:** `verifyWebhookHmac` skips verification when the secret env var is unset (`webhookHmac.ts` L29–34). Production must fail closed here.
5. **No webhook replay freshness:** HMAC verifies integrity, not recency; no timestamp/nonce window.
6. **OTP attempt throttling:** no failed-attempt counter on OTP verify in `pinReset.ts`; only generic rate limits apply (tRPC is behind the global limiter, not the stricter `/api/auth` one).
7. **`server/lib/correlationId.ts`** remains unwired legacy (it would mint a *second*, conflicting request id); keep unused or delete in a follow-up.
8. **Error messages in logs:** per-call warn lines include tRPC error messages; these are developer-controlled strings, but Zod validation messages can echo input metadata — redaction covers secrets, not arbitrary input text.
9. **`tenantFilter` helper uses `require("drizzle-orm")`** inside ESM code (`tenantIsolation.ts`) — it would throw if called; this change deliberately used `eq()` directly instead.
10. **Idempotency keys are bearer-like:** the cross-tenant replay guard relies on `refunds.tenantId` being set (rows created before this change have NULL and are replayable by anyone holding the key). Keys should be high-entropy and treated as secrets client-side.

## 8. Verification

- `tests/integration/tenancy.integration.test.ts` — 12 cross-tenant negative/positive tests (real DB, real middleware chain).
- `tests/integration/requestId.integration.test.ts` — 5 correlation-ID propagation tests incl. log-payload PII assertions.
- Full suite: `PGLITE_PORT=54629 pnpm test:integration` → 9 files, 62 tests, all passing (includes funds-integrity and ops-governance suites from main).
