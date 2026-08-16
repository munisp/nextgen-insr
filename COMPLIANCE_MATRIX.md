# Engineering Control Matrix — F-08 (Audit Trail & Data-Rights Compliance)

**Scope:** engineering-remediable controls only. Regulatory applicability,
control adequacy, and sign-off remain externally blocked pending qualified
owners (NAICOM compliance officer, NDPR DPO, PCI QSA). This document maps
**implemented, test-evidenced** controls and honestly marks incomplete ones.

**Evidence standard:** every "verified" row cites real code and an automated
test that executes against a real PostgreSQL database (PGlite wire-protocol
harness, `tests/integration`, PG_POOL over `PGLITE_PORT`). No compliance claim
is made beyond executed evidence.

---

## 1. NAICOM (National Insurance Commission — Nigeria)

> **APPLICABILITY PENDING QUALIFIED OWNER** — a NAICOM-accountable compliance
> officer must confirm report formats, submission channels, and retention
> obligations before any regulatory claim is made.

| # | Control | Code location | Test evidence | Status |
|---|---------|---------------|---------------|--------|
| N-1 | Tamper-evident audit trail: SHA-256 hash chain (`prevHash`/`entryHash`) on every `writeAuditLog` entry; writers serialized via `pg_advisory_xact_lock`; genesis = NULL prevHash | `server/lib/auditChain.ts`, `server/db.ts` (`writeAuditLog`), `drizzle/schema.ts` (`auditLog.prevHash/entryHash`) | `tests/integration/auditChain.integration.test.ts` (chain verifies across interleaved writers; SQL-UPDATE tamper fails at exact row; row deletion fails at exact successor link; restore heals) | **verified** |
| N-2 | Independent chain verification (recompute + fail on gap/tamper), admin-gated procedure + offline CLI | `server/routers/auditCompliance.ts` (`verifyChain`), `scripts/verify-audit-chain.mjs` | `tests/integration/auditChain.integration.test.ts` (procedure + CLI agree on tip hash and tamper verdict) | **verified** |
| N-3 | Audit export for examiners/auditors: admin-gated, paginated in chain order, includes `prevHash`/`entryHash` for offline re-verification; export itself audit-logged | `server/routers/auditCompliance.ts` (`export`) | `tests/integration/auditChain.integration.test.ts` (pagination, gating FORBIDDEN/UNAUTHORIZED, self-audit rows) | **verified** |
| N-4 | Audit retention configuration (days, env `AUDIT_RETENTION_DAYS`, default 3650) with honest deletion/anchoring state | `server/routers/auditCompliance.ts` (`retentionPolicy`) | `tests/integration/auditChain.integration.test.ts` (asserts deletion + external anchoring are reported OPEN ITEM, not "implemented") | **verified (config only)** — retention *enforcement* (tombstone deletion path) is an **open item** by design; see §5 |
| N-5 | NAICOM regulatory reporting: Monthly Activity Report generation, report submission tracking, large-claim notification | `server/routers/naicomReporting.ts` (`generateMonthlyReport`, `submitReport`, `notifyLargeClaim`, `getDashboard`), tables `naicomReports`, `complianceFilings` in `drizzle/schema.ts`; mounted at `naicomReporting` in `server/routers.ts` | `tests/integration/nfiu_naicom_pep_tests.mjs` (manual harness, **not** part of the vitest integration gate) | **incomplete** — code exists but has no vitest integration coverage in the CI gate; submission to NAICOM portal is external-API-dependent (unverifiable here) |
| N-6 | Honest limit documentation: hash chaining detects stored-row tampering; it does **not** stop a DB superuser from rewriting the whole chain; tip-truncation is undetectable without external anchoring | `server/lib/auditChain.ts` (header), `server/routers/auditCompliance.ts` (`retentionPolicy.externalAnchoring`) | `tests/integration/auditChain.integration.test.ts` ("DOCUMENTED LIMITATION" test pins that tip deletion verifies OK) | **verified (as documented limitation)** — WORM/external tip anchoring is the documented next step (**open item**) |

## 2. NDPR (Nigeria Data Protection Regulation 2019 / NITDA)

> **APPLICABILITY PENDING QUALIFIED OWNER** — a registered DPO must confirm
> lawful bases, retention schedules, and NITDA registration before any
> regulatory claim is made.

| # | Control | Code location | Test evidence | Status |
|---|---------|---------------|---------------|--------|
| D-1 | Data inventory / processing overview: real customer counts, consent counts, DSAR/erasure/breach event counts from live tables | `server/routers/gdprDashboard.ts` (`getDashboard`, `getNdprStatus`), tables `customers`, `data_consent_records`, `audit_log` | `tests/integration/gdprDataRights.integration.test.ts` (dashboards return real counts; previously these procedures ran raw SQL against nonexistent snake_case columns and the router was unmounted — both fixed) | **verified** |
| D-2 | Data subject access/portability (NDPR §2.3): export of the subject's own rows (profile, policies, transactions by phone, KYC status) | `server/routers/gdprDashboard.ts` (`exportCustomerData`) | `tests/integration/gdprDataRights.integration.test.ts` (export returns seeded subject's real rows across stores; NOT_FOUND for unknown subject) | **verified** |
| D-3 | Right to erasure (NDPR §2.3), admin-gated, anonymization-based: customers PII, `transactions.customerPhone`/name linkage, consent revocation, erasure registered in `data_rights_requests` | `server/routers/gdprDashboard.ts` (`requestErasure`) | `tests/integration/gdprDataRights.integration.test.ts` (post-erasure DB rows read back: PII anonymized, financial amounts preserved, consent revoked, register row written, admin-gating enforced) | **verified — with declared coverage limits** (see gaps §5) |
| D-4 | Consent management: grant/withdraw persisted as versioned records (supersede-on-update) | `server/routers/gdprDashboard.ts` (`updateConsent`), table `data_consent_records` | `tests/integration/gdprDataRights.integration.test.ts` (active records asserted after update) | **verified** |
| D-5 | Breach notification workflow (NDPR §4.1, 72h): breach registered in audit chain with deadline computation | `server/routers/gdprDashboard.ts` (`reportDataBreach`) | covered only indirectly (audit-chain tests prove the log write); **no dedicated procedure test** | **incomplete** — regulator submission stays `pending`; no NITDA delivery integration |
| D-6 | Agent self-service export/erasure (`gdpr.exportMyData`, `gdpr.requestErasure`) | `server/routers/gdpr.ts` (mounted at `gdpr` in `server/routers.ts`) | none in vitest gate (requires cookie-based agent session) | **incomplete** — untested in integration gate |
| D-7 | `ndpr-compliance` Go microservice (standalone NDPR service) | `ndpr-compliance/` (`main.go`, `main_test.go`, `models/`, `db/`) | Go module tests not executed in this remediation (TS gates only) | **incomplete** — service wiring to platform unverified |
| D-8 | All data-rights actions are themselves audit-chained (DSAR, export, erasure, consent, breach events) | `server/routers/gdprDashboard.ts` (all `writeAuditLog` calls) | `tests/integration/gdprDataRights.integration.test.ts` + `auditChain.integration.test.ts` (chain verifies after data-rights flows) | **verified** |

## 3. PCI DSS (Stripe boundary — SAQ-A posture assumption)

> **APPLICABILITY PENDING QUALIFIED OWNER** — a QSA must confirm the SAQ-A
> posture (fully outsourced cardholder data, no PAN touch-points) before any
> PCI claim is made. Engineering can only evidence the boundary.

| # | Control | Code location | Test evidence | Status |
|---|---------|---------------|---------------|--------|
| P-1 | Cardholder data outsourced to Stripe; platform never stores PAN — no card-number columns exist in the schema | `server/routers/billingInvoice.ts` (Stripe SDK), `drizzle/schema.ts` (no `cardNumber`/`card_number`/PAN columns) | schema grep evidence (no PAN columns); Stripe interactions go through Stripe SDK only | **verified (boundary assumption)** — QSA must confirm SAQ-A eligibility |
| P-2 | Stripe webhook authenticity enforced (signature verification rejects bad signatures) | `server/routers/billingInvoice.ts` (webhook handler, `constructEvent`) | `tests/integration/webhookSecurity.integration.test.ts` (invalid-signature webhooks rejected; log shows `[Stripe Webhook] Signature verification failed`) | **verified** |
| P-3 | Payment-related admin actions audit-chained (invoices/billing write through `writeAuditLog`) | `server/routers/billingInvoice.ts`, `server/db.ts` | chain verification covers all `writeAuditLog` writers (N-1 evidence) | **verified** |

## 4. Cross-cutting audit-trail controls

| # | Control | Code location | Test evidence | Status |
|---|---------|---------------|---------------|--------|
| X-1 | Admin-gating on all audit verify/export/retention procedures (role=admin + Permify `admin_access`) | `server/routers/auditCompliance.ts`, `server/_core/trpc.ts` (`adminProcedure`) | `tests/integration/auditChain.integration.test.ts` (anonymous UNAUTHORIZED, non-admin FORBIDDEN) | **verified** |
| X-2 | `writeAuditLog` caller contract unchanged (same signature, fire-and-forget error behavior); chain fields added transparently | `server/db.ts` | full integration suite green (105/105) with all pre-existing callers unmodified | **verified** |
| X-3 | CLI/procedure hash-format parity (offline verifier must match server) | `scripts/verify-audit-chain.mjs` ↔ `server/lib/auditChain.ts` | `tests/integration/auditChain.integration.test.ts` (same tip hash, same tamper verdict, INT8 id parsing pinned) | **verified** |

## 5. Open items and honest gaps (no claims made)

1. **External tip anchoring (WORM).** Hash chaining detects modification/deletion of stored rows but cannot stop a DB superuser from rewriting the chain, and cannot detect deletion of the chain tip (pinned by an explicit limitation test). Next step: publish a signed daily tip hash to an external WORM store. **Open.**
2. **Audit retention enforcement / deletion path.** Retention *days* are configurable (`AUDIT_RETENTION_DAYS`, default 3650); no deletion exists because deletion breaks the chain by design. Approved approach (documented in `auditCompliance.retentionPolicy`): privileged, itself-audited **tombstone** procedure that redacts content fields while preserving `prevHash`/`entryHash`/`createdAt`, with external re-anchoring of the post-tombstone tip. **Open.**
3. **Direct-insert bypass paths.** Several routers still insert into `audit_log` directly (`db.insert(auditLog)` in e.g. `agentFloatTransfer.ts`, `txMonitor.ts`, `management.ts`, `insuranceWorkflows.ts`, `multiTenantIsolation.ts`, `tenantAdmin.ts`, plus `journey-activities*.ts`, `settlementCron.ts`, others). These rows are outside the tamper-evidence boundary; strict verification fails closed on them (`unchained-row`). Remediation: route all writers through `writeAuditLog`. **Open.**
4. **Erasure coverage gaps (NDPR).** `requestErasure` anonymizes `customers` PII + `transactions.customerPhone`/name + consent revocation. NOT covered: `kyc_verifications.documentNumber/nin/bvn` (sensitive data persists), `audit_log` references to the customer id (deliberately retained: tamper-evident regulatory record), `policies`/claims (NAICOM 7-year retention), offsite backups (expire on backup schedule). **Open (kyc_verifications anonymization decision needs DPO sign-off).**
5. **NAICOM reporting test coverage.** `naicomReporting` router has no vitest integration coverage in the CI gate; only the manual `nfiu_naicom_pep_tests.mjs` harness exists. **Open.**
6. **Agent self-service GDPR router (`gdpr.*`)** untested in the integration gate (cookie-based agent session harness needed). **Open.**
7. **Breach notification delivery** to NITDA/NAICOM/CBN is not integrated; statuses remain `pending`. **Open.**
8. **Legacy rows:** production databases will have pre-chain rows with NULL hashes; `verifyChain` defaults to failing on them (strict) and offers `allowUnchained` for a documented grace period. Backfill is not implemented (re-hashing historical rows would itself be a chain-observable event). **Open.**

---
*Generated for F-08 engineering remediation. Branch: `fix/audit-compliance`.
All "verified" statuses correspond to tests executed against real PostgreSQL
(PGlite) in `tests/integration` — 105 tests passing, including 13 added by
this remediation.*
