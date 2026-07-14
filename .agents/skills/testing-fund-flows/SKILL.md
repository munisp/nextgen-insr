---
name: testing-fund-flows
description: Test the 20 flow-of-funds scenarios (atomicity, idempotency, double-entry ledger, wallet balance, FX, reconciliation) in the InsurePortal monolith. Use when verifying fund flow changes, middleware integration, or financial transaction safety.
---

# Testing Fund Flow Scenarios

## Prerequisites
- PostgreSQL running on localhost:5432 (database: ngapp, user: ngapp, password: ngapp)
- Node.js available

## Devin Secrets Needed
- None — the app uses a local PostgreSQL database with hardcoded credentials for dev

## Setup
1. Start the dev server:
   ```bash
   cd /home/ubuntu/repos/nextgen-insr/customer-portal-full && node server.cjs &
   ```
2. Wait for `InsurePortal running at http://localhost:5002` and `Database schema initialized (122 tables)`
3. Verify health: `curl -s http://localhost:5002/health | jq .`
4. Get auth token:
   ```bash
   TOKEN=$(curl -s -X POST http://localhost:5002/api/trpc/auth.login \
     -H 'Content-Type: application/json' \
     -d '{"email":"demo@insureportal.ng","password":"demo123"}' | jq -r '.result.data.token')
   ```

## Test Suites
Run from `customer-portal-full/` directory. Server must be running.

| Suite | Command | Assertions | What it tests |
|-------|---------|------------|---------------|
| Fund flows | `node flow-of-funds-validation.test.cjs` | 127 | All 20 scenarios: atomicity, idempotency, edge cases |
| Server | `node server.test.cjs` | 31 | Security headers, JWT auth, CORS, rate limiting |
| E2E Smoke | `node e2e-smoke.test.cjs` | 12 | Golden path: login->dashboard->logout |
| Scenarios | `node scenario-validation.test.cjs` | 68 | 10 stakeholder workflow scenarios |

## Adversarial Testing Techniques

### Atomicity Verification
Count DB rows in 6 tables before/after a fund flow call. All must increase atomically:
```bash
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -t -A -c "
SELECT 'premium_collections', COUNT(*) FROM premium_collections
UNION ALL SELECT 'financial_transactions', COUNT(*) FROM financial_transactions
UNION ALL SELECT 'general_ledger', COUNT(*) FROM general_ledger
UNION ALL SELECT 'fund_flow_events', COUNT(*) FROM fund_flow_events
UNION ALL SELECT 'tigerbeetle_outbox', COUNT(*) FROM tigerbeetle_outbox
UNION ALL SELECT 'audit_trail', COUNT(*) FROM audit_trail;"
```

### Idempotency Verification
1. Send a fund flow request with a unique `idempotencyKey`
2. Record all table counts
3. Send the exact same request again
4. Verify response has `idempotent: true` and all table counts are unchanged

### Balance Check (Wallet)
- Topup: POST `wallet.topup` with `{amount: X, idempotencyKey: 'unique'}`
- Withdraw: POST `wallet.withdraw` with `{amount: Y, idempotencyKey: 'unique'}`
- Overdraw: Attempt withdraw > balance, verify `success: false` and zero rows added
- Always verify DB balance matches API response: `SELECT balance FROM wallets WHERE "userId"=1`

### Double-Entry Ledger
- After `premium.allocate`, query `financial_transactions WHERE reference LIKE 'ALLOC-%'`
- Sum amounts must equal gross premium
- Each entry has debitAccount and creditAccount

## Key API Field Names (Common Pitfalls)

| Route | Field | NOT this |
|-------|-------|----------|
| `fx.convertAndPay` | `foreignAmount` | `amount` |
| `fx.convertAndPay` | `fromCurrency` | `sourceCurrency` |
| `wallet.topup` | `amount` | `topupAmount` |
| `premium.allocate` | `grossPremium` | `amount` |
| Response nested fields | `.breakdown.riskPremium` | `.riskPremium` |

## Clearing State Between Test Runs
```bash
# Clear idempotency cache (allows re-running same test keys)
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -c "DELETE FROM idempotency_keys;"
```
Alternatively, use unique `idempotencyKey` values per run (e.g., append timestamp).

## Troubleshooting
- **"Amount must be positive"**: Check you're using the correct field name for the route (see table above)
- **Idempotent response when expecting fresh**: Clear `idempotency_keys` table or use a unique key
- **Wallet withdraw fails with balance 0**: The demo user (userId=1) may not have a wallet row. `wallet.topup` now creates one via upsert, so always topup before withdraw.
- **GL entries empty**: The `financial.glEntries` route queries `financial_transactions`. If it returns empty, check for SQL column errors in server logs.
- **Reconciliation batches empty**: The `reconciliation.batches` route uses camelCase columns (`"createdAt"` not `created_at`). If it returns empty, check column names.
- **audit_trail has more entries than expected**: `auth.login` and handler-level auditing also write to audit_trail. The fund-flow-specific entry uses action like `premium.collected`, `wallet.topup`, etc.

## PostgreSQL Column Conventions
This repo uses camelCase quoted columns (e.g., `"userId"`, `"createdAt"`, `"policyId"`). When writing raw SQL, always quote camelCase columns. The `financial_transactions` table does NOT have a `currency` column.
