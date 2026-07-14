# Test Plan: End-to-End Data Flow (PR #32 — Phase 2)

## What Changed
- `db/schema.sql`: 122 PostgreSQL tables with camelCase quoted columns matching server.cjs SQL queries
- `db/seed.sql`: Realistic baseline data (10 users, 12 products, 12 policies, 8 claims, agents, commissions, IFRS17, NAICOM, etc.)
- `server.cjs`: `initDatabase()` auto-init on startup + 30+ route SQL query fixes for column name mismatches
- Key fix: `products.list` now queries `insurance_products` (was incorrectly querying `policies`)

## Test Environment
- Server: `http://localhost:5002` (Node.js, PORT=5002)
- Database: PostgreSQL `ngapp@localhost:5432/ngapp`
- Auth: `demo@insureportal.ng` / `demo123` → JWT token
- All testing via shell (curl + node scripts) — no browser UI

## Why Shell-Only (No Recording)
This is a pure API backend (tRPC over HTTP). There is no frontend UI deployed. All assertions are against JSON API responses.

---

## Test 1: Dashboard Stats Return Real Aggregated Data (Not Hardcoded Defaults)

**Route:** `dashboard.stats`
**What could break:** If schema columns don't match, `q()` returns `[]`, aggregates fall to `0` or hardcoded defaults (62.3, 185, 98.2).

**Steps:**
```bash
curl -s http://localhost:5002/api/trpc/dashboard.stats | jq '.result.data'
```

**Pass criteria (ALL must be true):**
- `totalPolicies` = `12` (exact — seeded 12 policies)
- `activePolicies` = `10` (seeded 10 with status='Active', 1 Expired, 1 Pending)
- `openClaims` = `8` (seeded 8 claims)
- `premiumRevenue` > `0` and ≠ `0` (sum of Active policy premiums)
- `naicomScore` ≠ `98.2` (98.2 is the hardcoded fallback — real DB should differ since only 2/3 filings are Approved → ~66.7)

**Distinguisher:** If the schema is broken, `totalPolicies` would be `0` and `naicomScore` would be `98.2` (the fallback). Real data gives `12` and `~66.7`.

---

## Test 2: Products Come From insurance_products (Not policies)

**Route:** `products.list`
**What could break:** Before fix, this queried `policies` table with DISTINCT ON (type), returning 8 rows of policy data. After fix, it queries `insurance_products`.

**Steps:**
```bash
curl -s http://localhost:5002/api/trpc/products.list | jq '.result.data | length, .[0]'
```

**Pass criteria:**
- Response is an array with length = `12` (seeded 12 insurance_products)
- First item has `category` field (from insurance_products) NOT `type` field aliased as category from policies
- Items include product names like "Motor Comprehensive", "Motor Third Party", "Home & Property", "Life Term", NOT policy names like "Motor Comprehensive - Toyota Camry"
- Each item has `coverageAmount` field (aliased from `maxCoverage`)

**Distinguisher:** Old broken query returned 8 rows (DISTINCT ON type from policies). Fixed query returns 12 rows from insurance_products with proper product names.

---

## Test 3: Cross-Table JOIN — Claims Linked to Policies

**Route:** `dashboard.recentClaims`
**What could break:** The query JOINs `claims c LEFT JOIN policies p ON c."policyId"=p.id`. If either table has wrong columns, the JOIN fails silently.

**Steps:**
```bash
curl -s http://localhost:5002/api/trpc/dashboard.recentClaims | jq '.result.data[0]'
```

**Pass criteria:**
- Response array length = `8` (seeded 8 claims)
- First claim has `claimNumber` starting with "CLM-2026-"
- First claim has `policyNumber` starting with "POL-2026-" (from JOIN — proves cross-table link works)
- First claim has `type` field (from policies table via JOIN)
- First claim has `amount` > `0` (real monetary value)

**Distinguisher:** If JOIN fails, `policyNumber` and `type` would be `null`. Real data gives "POL-2026-0001" and "motor".

---

## Test 4: Notifications Use Correct Column Name (description → message alias)

**Route:** `notifications.list`
**What could break:** Schema has `description` column but route aliases it as `message`. Before fix, query used non-existent `message` column, returning empty array.

**Steps:**
```bash
curl -s http://localhost:5002/api/trpc/notifications.list | jq '.result.data | length, .[0]'
```

**Pass criteria:**
- Response array length ≥ `6` (seeded 6 notifications)
- Each notification has `message` field (aliased from `description`) that is non-null and non-empty
- Each has `title`, `type`, `read` (boolean), `date` fields

**Distinguisher:** Before fix, returned `[]` (empty array). After fix, returns 6 notifications with `message` field populated.

---

## Test 5: Auto-Initialization — Server Startup Creates Schema

**Route:** Server startup behavior
**What could break:** `initDatabase()` might fail silently, leaving tables uncreated.

**Steps:**
```bash
# Count tables in public schema
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"

# Verify a sample of critical tables exist with correct camelCase columns
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -c "SELECT column_name FROM information_schema.columns WHERE table_name='policies' AND column_name IN ('policyNumber','startDate','sumAssured','createdAt') ORDER BY column_name;"
```

**Pass criteria:**
- Table count = `122`
- All 4 camelCase columns exist: `createdAt`, `policyNumber`, `startDate`, `sumAssured`

**Distinguisher:** If schema.sql failed, table count would be 0 or much less than 122. If columns used snake_case, the query for camelCase columns would return 0 rows.

---

## Test 6: Broad Route Coverage — 62 Routes Return Non-Empty Data

**Route:** 62 key routes across all domains
**What could break:** Any of the 30+ fixed queries could still have column mismatches.

**Steps:**
Run the comprehensive route checker (node script testing all 62 routes, counting OK/empty/error).

**Pass criteria:**
- `ok` count = `62` (or very close — at least 58)
- `empty` count = `0`
- `error` count = `0`

**Distinguisher:** Before fixes, only 31/93 routes returned data. After fixes, 62/62 should return non-empty results.

---

## Test 7: Auth Flow Still Works (Regression)

**Route:** `auth.login` → `auth.me` → `auth.logout`
**What could break:** Schema changes could break the users table or JWT flow.

**Steps:**
```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:5002/api/trpc/auth.login -H 'Content-Type: application/json' -d '{"json":{"email":"demo@insureportal.ng","password":"demo123"}}' | jq -r '.result.data.token')

# Verify token works
curl -s http://localhost:5002/api/trpc/auth.me -H "Authorization: Bearer $TOKEN" | jq '.result.data.email'

# Logout
curl -s -X POST http://localhost:5002/api/trpc/auth.logout -H "Authorization: Bearer $TOKEN" | jq '.result.data.success'
```

**Pass criteria:**
- Login returns a JWT token (3-part base64url string)
- `auth.me` returns `"demo@insureportal.ng"`
- Logout returns `true`

**Distinguisher:** If users table is broken, login would fail with empty response or error.

---

## Test 8: Existing Test Suites Pass (Regression)

**Steps:**
```bash
cd customer-portal-full && node server.test.cjs
cd customer-portal-full && node e2e-smoke.test.cjs
```

**Pass criteria:**
- server.test.cjs: `31 passed, 0 failed`
- e2e-smoke.test.cjs: `12 passed, 0 failed`
