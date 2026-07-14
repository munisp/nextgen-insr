# InsurePortal — Keycloak Roles & Permissions Breakdown
**Version:** 3.0.0 | **Realm:** `insureportal` | **Total Roles:** 16  
**Authorization Engine:** Permify v0.9 | **Entities:** 13 insurance domain objects  
**Token Delivery:** JWT via `realm_access.roles` + `platform_role` protocol mappers

---

## Architecture Overview

The InsurePortal authorization system is a **two-layer model**:

1. **Keycloak** — handles *authentication* and *identity*. It issues JWTs containing the user's role(s), tenant ID, and license number as token claims. Composite roles allow a single role to inherit the permissions of one or more base roles.
2. **Permify** — handles *fine-grained authorization*. At request time, the tRPC middleware calls Permify's `check` API to evaluate whether the authenticated user holds the required relationship on the specific resource (e.g., "does user X have `approve_settlement` on claim Y?"). This enforces row-level, resource-scoped access control beyond what Keycloak roles alone can express.

```
Client → APISIX Gateway → OpenAppSec WAF → tRPC Server
                                              ↓
                                     Keycloak OIDC verify (JWT)
                                              ↓
                                     Permify check(user, action, resource)
                                              ↓
                                     tRPC Procedure Handler
```

---

## Role Hierarchy

```
insureportal-super-admin (composite → all 15 roles)
├── insureportal-admin (composite → billing-admin, supervisor)
│   ├── insureportal-supervisor
│   └── insureportal-billing-admin (composite → billing-analyst)
│       └── insureportal-billing-analyst
├── insureportal-underwriter
├── insureportal-actuary
├── insureportal-claims-adjuster
├── insureportal-broker
├── insureportal-agent
├── insureportal-compliance-officer
├── insureportal-reinsurer
├── insureportal-policyholder
├── insureportal-beneficiary
├── insureportal-regulator
└── insureportal-user (base role — every authenticated user)
```

---

## Role 1: `insureportal-super-admin`

**Type:** Composite (inherits all 15 other roles)  
**Description:** Unrestricted platform-level administrator. Manages all tenants, system configuration, billing, and infrastructure. Intended for the InsurePortal platform operations team only.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `super_admin` |
| `scope` | `platform` |
| `requires_mfa` | `true` |
| `session_idle_timeout` | `900` (15 min) |

### JWT Claims (example)

```json
{
  "realm_access": { "roles": ["insureportal-super-admin", "insureportal-admin", "insureportal-user"] },
  "platform_role": "super_admin",
  "tenant_id": "*"
}
```

### Permify Permissions (all entities, all actions)

| Entity | Permitted Actions |
|---|---|
| `tenant` | `manage_tenant`, `view_tenant`, `manage_users`, `manage_products`, `view_reports`, `export_data`, `manage_settings`, `delete_tenant`, `manage_agents`, `view_billing`, `manage_billing` |
| `insurance_product` | `view`, `create`, `edit`, `publish`, `archive`, `set_pricing`, `view_pricing` |
| `policy` | `view`, `bind`, `pay_premium`, `cancel`, `renew`, `endorse`, `view_documents`, `upload_documents`, `view_premium_history`, `void` |
| `underwriting_application` | `view`, `submit`, `assign`, `assess_risk`, `approve`, `decline`, `refer`, `set_conditions`, `request_documents`, `view_risk_score` |
| `claim` | `view`, `file`, `assign`, `investigate`, `adjudicate`, `approve_settlement`, `reject`, `settle_payment`, `request_documents`, `escalate`, `view_settlement`, `void` |
| `actuarial_report` | `view`, `create`, `edit`, `publish`, `export`, `delete`, `run_ifrs17`, `run_reserves` |
| `compliance_filing` | `view`, `create`, `edit`, `submit`, `approve`, `reject`, `export`, `run_aml`, `run_kyc`, `freeze_account` |
| `reinsurance_treaty` | `view`, `create`, `edit`, `activate`, `terminate`, `cede_policy`, `view_cessions`, `submit_recovery`, `view_premium_accounting` |
| `broker_profile` | `view`, `edit`, `view_portfolio`, `view_commission`, `suspend`, `reactivate`, `view_license` |
| `agent` | `view`, `edit`, `suspend`, `delete`, `view_balance`, `top_up_float`, `process_tx`, `view_commission` |
| `transaction` | `view`, `void`, `reverse`, `export`, `view_fraud` |
| `fraud_alert` | `view`, `resolve`, `escalate`, `dismiss` |
| `float_request` | `view`, `approve`, `reject`, `cancel` |
| `audit_log` | `view`, `export` |
| `billing_ledger` | `view`, `record`, `reconcile`, `export` |

---

## Role 2: `insureportal-admin`

**Type:** Composite (inherits `supervisor`, `billing-admin`)  
**Description:** Tenant-scoped administrator. Manages users, products, settings, and reports within a single tenant. Cannot delete tenants or access cross-tenant data.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `admin` |
| `scope` | `tenant` |
| `requires_mfa` | `true` |
| `session_idle_timeout` | `1800` (30 min) |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `manage_tenant`, `view_tenant`, `manage_users`, `manage_products`, `view_reports`, `export_data`, `manage_settings`, `manage_agents`, `view_billing`, `manage_billing` |
| `insurance_product` | `view`, `create`, `edit`, `publish`, `archive`, `set_pricing`, `view_pricing` |
| `policy` | `view`, `bind`, `pay_premium`, `cancel`, `renew`, `endorse`, `view_documents`, `upload_documents`, `view_premium_history`, `void` |
| `underwriting_application` | `view`, `assign`, `assess_risk`, `approve`, `decline`, `request_documents`, `view_risk_score` |
| `claim` | `view`, `assign`, `investigate`, `adjudicate`, `approve_settlement`, `reject`, `settle_payment`, `request_documents`, `escalate`, `view_settlement`, `void` |
| `actuarial_report` | `view`, `create`, `publish`, `export`, `delete` |
| `compliance_filing` | `view`, `create`, `submit`, `approve`, `reject`, `export` |
| `reinsurance_treaty` | `view`, `create`, `edit`, `activate`, `terminate`, `cede_policy`, `view_cessions`, `submit_recovery`, `view_premium_accounting` |
| `broker_profile` | `view`, `edit`, `view_portfolio`, `view_commission`, `suspend`, `reactivate`, `view_license` |
| `agent` | `view`, `edit`, `suspend`, `view_balance`, `top_up_float`, `view_commission` |
| `transaction` | `view`, `void`, `reverse`, `export`, `view_fraud` |
| `fraud_alert` | `view`, `resolve`, `escalate`, `dismiss` |
| `float_request` | `view`, `approve`, `reject` |
| `audit_log` | `view`, `export` |
| `billing_ledger` | `view`, `record`, `reconcile`, `export` |

---

## Role 3: `insureportal-supervisor`

**Type:** Standard  
**Description:** Operations supervisor. Approves overrides, monitors SLA breaches, escalates issues, and manages agent teams within their assigned branch or region.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `supervisor` |
| `scope` | `branch` |
| `requires_mfa` | `false` |
| `session_idle_timeout` | `3600` (60 min) |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_tenant`, `view_reports`, `manage_agents` |
| `policy` | `view` |
| `underwriting_application` | `view`, `assign` |
| `claim` | `view`, `assign`, `escalate` |
| `agent` | `view`, `edit`, `suspend`, `view_balance`, `top_up_float`, `view_commission` |
| `transaction` | `view`, `void` |
| `fraud_alert` | `view`, `escalate` |
| `float_request` | `view`, `approve`, `reject` |

---

## Role 4: `insureportal-underwriter`

**Type:** Standard  
**Description:** Assesses risk, approves or declines policy applications, sets policy conditions and pricing. Works within the underwriting workflow on assigned applications.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `underwriter` |
| `scope` | `tenant` |
| `license_number` | `{dynamic — set per user}` |
| `requires_mfa` | `false` |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_tenant`, `manage_products` |
| `insurance_product` | `view`, `create`, `edit`, `set_pricing`, `view_pricing` |
| `policy` | `view`, `endorse`, `view_documents`, `upload_documents`, `view_premium_history` |
| `underwriting_application` | `view`, `assess_risk`, `approve`, `decline`, `refer`, `set_conditions`, `request_documents`, `view_risk_score` |
| `claim` | `view` |
| `reinsurance_treaty` | `cede_policy` |

---

## Role 5: `insureportal-actuary`

**Type:** Standard  
**Description:** Computes reserves, runs mortality/morbidity tables, produces IFRS 17 reports, and provides pricing recommendations. Has read access to all financial and policy data.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `actuary` |
| `scope` | `tenant` |
| `license_number` | `{dynamic}` |
| `requires_mfa` | `false` |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_tenant`, `view_reports`, `export_data` |
| `insurance_product` | `view`, `set_pricing`, `view_pricing` |
| `policy` | `view`, `view_premium_history` |
| `underwriting_application` | `view`, `view_risk_score` |
| `claim` | `view`, `view_settlement` |
| `actuarial_report` | `view`, `create`, `edit`, `publish`, `export`, `delete`, `run_ifrs17`, `run_reserves` |
| `compliance_filing` | `view`, `create` |
| `reinsurance_treaty` | `view`, `view_cessions`, `view_premium_accounting` |
| `transaction` | `export` |

---

## Role 6: `insureportal-claims-adjuster`

**Type:** Standard  
**Description:** Receives, investigates, adjudicates, and settles insurance claims. Manages the full claims lifecycle from FNOL through payment disbursement.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `claims_adjuster` |
| `scope` | `tenant` |
| `license_number` | `{dynamic}` |
| `requires_mfa` | `false` |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_tenant` |
| `policy` | `view`, `view_documents` |
| `claim` | `view`, `investigate`, `adjudicate`, `approve_settlement`, `reject`, `settle_payment`, `request_documents`, `escalate`, `view_settlement` |
| `transaction` | `view` |

---

## Role 7: `insureportal-broker`

**Type:** Standard  
**Description:** Licensed insurance broker. Submits policy applications on behalf of clients, manages a client portfolio, tracks commissions, and files claims.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `broker` |
| `scope` | `tenant` |
| `license_number` | `{dynamic — NAICOM broker license}` |
| `requires_mfa` | `false` |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_tenant` |
| `insurance_product` | `view`, `view_pricing` |
| `policy` | `view`, `bind`, `pay_premium`, `cancel`, `renew`, `endorse`, `view_documents`, `upload_documents`, `view_premium_history` |
| `underwriting_application` | `view`, `submit` |
| `claim` | `view`, `file`, `view_settlement` |
| `broker_profile` | `view`, `edit`, `view_portfolio`, `view_commission`, `view_license` |

---

## Role 8: `insureportal-agent`

**Type:** Standard  
**Description:** Field insurance agent. Sells policies, collects premiums, services customers, and processes transactions at POS terminals. Manages their own float balance.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `agent` |
| `scope` | `branch` |
| `requires_mfa` | `false` |
| `session_idle_timeout` | `7200` (2 hours) |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_tenant` |
| `insurance_product` | `view` |
| `policy` | `view`, `bind`, `pay_premium`, `renew`, `view_documents`, `upload_documents`, `view_premium_history` |
| `underwriting_application` | `submit` |
| `claim` | `file` |
| `agent` | `view`, `view_balance`, `process_tx`, `view_commission` |
| `transaction` | `view` |
| `float_request` | `view`, `cancel` |

---

## Role 9: `insureportal-compliance-officer`

**Type:** Standard  
**Description:** Manages NAICOM filings, NDPR audits, AML/KYC checks, and regulatory reporting. Can freeze accounts and escalate suspicious activity.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `compliance_officer` |
| `scope` | `tenant` |
| `requires_mfa` | `true` |
| `session_idle_timeout` | `1800` (30 min) |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_tenant`, `view_reports`, `export_data` |
| `policy` | `view`, `view_documents` |
| `underwriting_application` | `view` |
| `claim` | `view` |
| `actuarial_report` | `view`, `export` |
| `compliance_filing` | `view`, `create`, `edit`, `submit`, `export`, `run_aml`, `run_kyc`, `freeze_account` |
| `reinsurance_treaty` | `view` |
| `transaction` | `view_fraud` |
| `fraud_alert` | `view`, `resolve`, `escalate` |
| `audit_log` | `view`, `export` |

---

## Role 10: `insureportal-reinsurer`

**Type:** Standard  
**Description:** Manages treaty administration, cession records, recovery claims, and premium accounting for reinsurance arrangements.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `reinsurer` |
| `scope` | `tenant` |
| `license_number` | `{dynamic}` |
| `requires_mfa` | `false` |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_tenant` |
| `insurance_product` | `view` |
| `policy` | `view` |
| `reinsurance_treaty` | `view`, `create`, `edit`, `cede_policy`, `view_cessions`, `submit_recovery`, `view_premium_accounting` |
| `actuarial_report` | `view` |

---

## Role 11: `insureportal-policyholder`

**Type:** Standard  
**Description:** End customer. Purchases insurance, pays premiums, files claims, manages beneficiaries, and views policy documents.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `policyholder` |
| `scope` | `self` |
| `requires_mfa` | `false` |
| `session_idle_timeout` | `7200` (2 hours) |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_tenant` |
| `insurance_product` | `view` |
| `policy` | `view` (own policies only), `bind`, `pay_premium`, `cancel`, `renew`, `endorse`, `view_documents`, `upload_documents`, `view_premium_history` |
| `claim` | `view` (own claims only), `file`, `view_settlement` |

> **Note:** The `policyholder_user` relation on the `policy` entity enforces that a policyholder can only act on their own policies. Permify evaluates `policyholder_user = ctx.userId` at check time.

---

## Role 12: `insureportal-beneficiary`

**Type:** Standard  
**Description:** Named beneficiary on a policy. Read-only access to view the policy details and claim status for policies on which they are listed.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `beneficiary` |
| `scope` | `self` |
| `requires_mfa` | `false` |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `policy` | `view` (policies where named as beneficiary) |
| `claim` | `view` (claims on those policies) |

---

## Role 13: `insureportal-regulator`

**Type:** Standard  
**Description:** External regulator (NAICOM/CBN). Read-only access to regulatory reports, audit trails, solvency data, and compliance filings. Cannot modify any data.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `regulator` |
| `scope` | `platform` |
| `requires_mfa` | `true` |
| `session_idle_timeout` | `900` (15 min) |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_reports` |
| `insurance_product` | `view` |
| `policy` | `view` |
| `claim` | `view` |
| `actuarial_report` | `view`, `export` |
| `compliance_filing` | `view`, `export` |
| `reinsurance_treaty` | `view` |
| `audit_log` | `view`, `export` |

---

## Role 14: `insureportal-billing-admin`

**Type:** Composite (inherits `billing-analyst`)  
**Description:** Manages platform billing ledger, revenue splits, invoicing, and reconciliation. Can record entries and trigger reconciliation runs.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `billing_admin` |
| `scope` | `platform` |
| `requires_mfa` | `true` |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_billing`, `manage_billing` |
| `billing_ledger` | `view`, `record`, `reconcile`, `export` |
| `audit_log` | `view` |

---

## Role 15: `insureportal-billing-analyst`

**Type:** Standard  
**Description:** Read-only access to billing ledger, revenue splits, and reconciliation reports. Cannot record or modify entries.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `billing_analyst` |
| `scope` | `platform` |
| `requires_mfa` | `false` |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_billing` |
| `billing_ledger` | `view`, `export` |

---

## Role 16: `insureportal-user`

**Type:** Standard (base role)  
**Description:** Authenticated user. Base role automatically assigned to every registered user. Grants access to the platform shell (dashboard, profile, notifications) but no insurance domain actions.

### Keycloak Attributes

| Attribute | Value |
|---|---|
| `platform_role` | `user` |
| `scope` | `self` |
| `requires_mfa` | `false` |
| `session_idle_timeout` | `7200` (2 hours) |

### Permify Permissions

| Entity | Permitted Actions |
|---|---|
| `tenant` | `view_tenant` (member relation) |

---

## Permission Matrix Summary

The table below summarises which roles hold which actions across the 5 most critical insurance domain entities.

| Action | super_admin | admin | supervisor | underwriter | actuary | claims_adjuster | broker | agent | compliance | reinsurer | policyholder | beneficiary | regulator |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **Policy: bind** | ✓ | ✓ | — | — | — | — | ✓ | ✓ | — | — | ✓ | — | — |
| **Policy: void** | ✓ | ✓ | — | — | — | — | — | — | — | — | — | — | — |
| **Policy: view** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **UW: approve** | ✓ | ✓ | — | ✓ | — | — | — | — | — | — | — | — | — |
| **UW: decline** | ✓ | ✓ | — | ✓ | — | — | — | — | — | — | — | — | — |
| **UW: view_risk_score** | ✓ | ✓ | — | ✓ | ✓ | — | — | — | — | — | — | — | — |
| **Claim: file** | ✓ | ✓ | — | — | — | — | ✓ | ✓ | — | — | ✓ | — | — |
| **Claim: adjudicate** | ✓ | ✓ | — | — | — | ✓ | — | — | — | — | — | — | — |
| **Claim: settle_payment** | ✓ | ✓ | — | — | — | ✓ | — | — | — | — | — | — | — |
| **Claim: void** | ✓ | ✓ | — | — | — | — | — | — | — | — | — | — | — |
| **Actuarial: run_ifrs17** | ✓ | — | — | — | ✓ | — | — | — | — | — | — | — | — |
| **Compliance: run_aml** | ✓ | — | — | — | — | — | — | — | ✓ | — | — | — | — |
| **Compliance: freeze_account** | ✓ | — | — | — | — | — | — | — | ✓ | — | — | — | — |
| **Treaty: cede_policy** | ✓ | ✓ | — | ✓ | — | — | — | — | — | ✓ | — | — | — |
| **Billing: record** | ✓ | — | — | — | — | — | — | — | — | — | — | — | — |
| **Billing: reconcile** | ✓ | — | — | — | — | — | — | — | — | — | — | — | — |
| **Audit: export** | ✓ | ✓ | — | — | — | — | — | — | ✓ | — | — | — | ✓ |
| **Agent: delete** | ✓ | — | — | — | — | — | — | — | — | — | — | — | — |
| **Tenant: delete_tenant** | ✓ | — | — | — | — | — | — | — | — | — | — | — | — |

---

## Protocol Mappers (JWT Token Claims)

All roles deliver the following custom claims in the Keycloak-issued JWT:

| Claim | Source | Example Value |
|---|---|---|
| `realm_access.roles` | Keycloak built-in | `["insureportal-underwriter", "insureportal-user"]` |
| `platform_role` | User attribute mapper | `"underwriter"` |
| `tenant_id` | User attribute mapper | `"ten_abc123"` |
| `license_number` | User attribute mapper | `"NAICOM/BKR/2024/001"` |
| `sub` | Keycloak built-in | `"kc-user-uuid"` |
| `email_verified` | Keycloak built-in | `true` |

The `platform_role` claim is the primary claim used by the tRPC `requireRole()` middleware for fast role checks before delegating to Permify for resource-level checks.

---

## Service Accounts

Two machine-to-machine (M2M) service accounts are registered in the realm for internal service communication:

| Client ID | Description | Roles |
|---|---|---|
| `go-infra-service` | Go infrastructure sidecar (TigerBeetle, Fluvio, Temporal, Dapr) | `insureportal-super-admin` |
| `python-analytics-service` | Python analytics service (Actuarial, IFRS17, Fraud ML, Lakehouse) | `insureportal-actuary`, `insureportal-compliance-officer` |

Both use the **Client Credentials** grant flow and receive short-lived access tokens (TTL: 300 seconds).

---

*Generated: 2026-07-14 | Files: `infra/keycloak/realm-insureportal.json`, `infra/permify/schema.perm`*
