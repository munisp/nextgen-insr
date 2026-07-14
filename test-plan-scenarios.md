# Test Plan: Top 10 Production Scenario Validation

## What Changed
Round 4 of production hardening — fixed 10 issues discovered during scenario validation:
1. `rbac.roles` query referenced nonexistent `description` column → removed
2. `microinsurance.products` referenced nonexistent `productName`/`duration` → fixed to `product_type`/`status`
3. `claims.tracker` missing aggregate `total` count → added COUNT query
4. `underwriting_rules.action` column VARCHAR(32) too narrow for JSON → widened to TEXT in schema
5. `runUnderwriting()` ORDER BY nonexistent `priority` column → changed to ORDER BY id
6. `payments.verify` duplicate handler returned `verified` without `success` → added both fields
7. Reinsurance treaties seed data missing `treatyName`/`treatyType` → populated
8. Agents seed data missing `agencyName` → populated
9. Demo user (id=1) had no KYC profile → added verified profile
10. Only 3 generic underwriting rules → expanded to 16 production-grade rules

## Testing Approach
All testing is shell-based via curl and Node.js test scripts — no browser UI involved. No recording needed.

## Test Cases

### T1: rbac.roles returns real data without SQL error
**What could break:** If the `description` column is still in the query, PostgreSQL throws `column "description" does not exist`.
- **Action:** `curl localhost:5002/api/trpc/rbac.roles`
- **Pass:** Response contains `result.data` array with objects having `id`, `name`, `permissions`, `isSystem` fields. No `description` field present. Array length ≥ 1.
- **Fail:** Response contains SQL error mentioning `description`, or empty/null result.

### T2: microinsurance.products returns product_type not productName
**What could break:** If old column refs `productName`/`duration` are still used, SQL error or empty data.
- **Action:** `curl localhost:5002/api/trpc/microinsurance.products`
- **Pass:** Response contains array with ≥1 item. Each item has `name` field (aliased from `product_type`) with non-null value like `"crop_insurance"`. No `duration` field.
- **Fail:** SQL error mentioning `productName` or `duration`, or items with null `name`.

### T3: claims.tracker includes total count
**What could break:** If the COUNT query is missing, response has no `total` field.
- **Action:** `curl localhost:5002/api/trpc/claims.tracker`
- **Pass:** Response has `total` field with numeric value ≥ 0 (expect ~9-10 based on seed data). Also has `steps` array with 5 elements, `claimId` non-null, `progress` > 0.
- **Fail:** Response missing `total` field entirely, or `total` is null/undefined.

### T4: Underwriting engine processes high-risk Life applicant correctly
**What could break:** If rules query fails (ORDER BY priority), or rules have wrong productType casing, or action column too narrow — riskScore stays at base 30 instead of being elevated by smoker+hazardous loadings.
- **Action:** POST `underwriting.evaluate` with `{ productType: "Life", applicantAge: 55, sumAssured: 20000000, annualIncome: 5000000, riskFactors: { isSmoker: true, occupationClass: "hazardous" } }`
- **Pass:** `riskScore` > 50 (base 30 + 15 smoker + 25 hazardous = 70). `premiumLoading` > 0. `decision` is NOT `auto_approved`. Response includes applied rules mentioning "Smoker" and "Hazardous".
- **Fail:** `riskScore` = 30 (rules not applied), `decision` = `auto_approved`, `premiumLoading` = 0.

### T5: payments.verify returns `success` field
**What could break:** If duplicate handler still only returns `verified` without `success`.
- **Action:** POST `payments.verify` with `{ reference: "PAYSTACK-123" }`
- **Pass:** Response contains both `success: true` AND `verified: true`. Both fields present.
- **Fail:** Response has `verified` but no `success` field.

### T6: Reinsurance treaties have non-null treatyName
**What could break:** If seed data still only populates `name` but not `treatyName`, the field is null.
- **Action:** `curl localhost:5002/api/trpc/reinsurance.treaties`
- **Pass:** Array with ≥3 items. Each treaty has `name` field that is non-null and non-empty (e.g., "Quota Share 2026").
- **Fail:** Treaties with `name: null` or empty string.

### T7: Agents have agencyName populated
**What could break:** If seed data still doesn't include `agencyName`, the field is null.
- **Action:** `curl localhost:5002/api/trpc/agents.list`
- **Pass:** Array with ≥2 agents. Each agent has non-null `name` field (from `agencyName` alias). Agent names include "Obinna" or "Adeyemi" or similar.
- **Fail:** Agents with `name: null`.

### T8: Demo user KYC allows payment flow
**What could break:** If KYC profile for user 1 is missing, payments.process returns `{ success: false, error: "KYC verification required" }`.
- **Action:** Login as demo@insureportal.ng, then POST `payments.process` with `{ policyId: 1, amount: 50000, method: "card" }`
- **Pass:** Response has `transactionId` or `success: true`. No KYC error.
- **Fail:** Response has `success: false` with `error` containing "KYC".

### T9: Full 10-scenario regression (68 assertions)
**What could break:** Any regression from individual fixes could cascade.
- **Action:** Run `node scenario-validation.test.cjs`
- **Pass:** Output shows `Passed: 68, Failed: 0`.
- **Fail:** Any assertion fails.

### T10: Existing test suites pass (regression)
**What could break:** Changes to server.cjs queries or seed data could break existing tests.
- **Action:** Run `node server.test.cjs` and `node e2e-smoke.test.cjs`
- **Pass:** `server.test.cjs`: 31/31. `e2e-smoke.test.cjs`: 12/12.
- **Fail:** Any assertion fails.
