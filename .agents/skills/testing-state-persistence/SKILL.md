---
name: testing-state-persistence
description: Test that in-memory state persists to PostgreSQL and survives server kill/restart cycles. Use when verifying session, token blacklist, rate limit, metrics, or FX rate persistence changes.
---

# Testing State Persistence (Kill/Restart Cycles)

## Prerequisites
- PostgreSQL running locally (`ngapp@localhost:5432`, database `ngapp`)
- Node.js available (v18+)
- `psql` CLI available for direct DB queries

## Devin Secrets Needed
- None — uses local PostgreSQL with `ngapp`/`ngapp` credentials (configured in server.cjs)

## Setup
1. Start the server:
   ```bash
   cd /home/ubuntu/repos/nextgen-insr/customer-portal-full && node server.cjs 2>&1 &
   ```
2. Wait for startup logs:
   ```
   ✓ PostgreSQL connected
   ✓ Database schema initialized (122 tables)
   ✓ Restored X sessions, Y blacklisted tokens from PostgreSQL
   ✓ Connection pool pre-warmed (5 connections)
   ```
3. Verify server is responding: `curl -s http://localhost:5002/health | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])"`

## Key Files
- `customer-portal-full/server.cjs` — Main monolith with all persistence logic
  - `persistSession()` / `loadSessionsFromDB()` — lines ~113-152
  - `persistBlacklist()` — lines ~130-140
  - `loadRateLimitsFromDB()` — lines ~98-112
  - Metrics flush interval — 10s cycle writing to `request_metrics`
  - FX rates query — `currency.convert` route (~line 1700)
  - Startup initialization — lines ~216-226

## Test Procedures

### 1. Session Persistence (T1)
```bash
# Login and extract token
TOKEN=$(curl -s -X POST http://localhost:5002/api/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@insureportal.ng","password":"demo123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['data']['token'])")

# Verify session in DB
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -c \
  "SELECT COUNT(*) FROM user_sessions WHERE token = '$TOKEN'"
# Expect: 1

# Verify token works
curl -s http://localhost:5002/api/trpc/auth.me -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['data']['email'])"
# Expect: demo@insureportal.ng

# Kill server
kill $(ss -tlnp | grep 5002 | grep -oP 'pid=\K[0-9]+')
sleep 2

# Restart
cd /home/ubuntu/repos/nextgen-insr/customer-portal-full && node server.cjs 2>&1 &
sleep 3

# Verify same token still works after restart
curl -s http://localhost:5002/api/trpc/auth.me -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['data']['email'])"
# Expect: demo@insureportal.ng (same as before restart)
```

### 2. Token Blacklist Persistence (T2)
```bash
# Login, then logout to blacklist the token
TOKEN_A=$(curl -s -X POST http://localhost:5002/api/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@insureportal.ng","password":"demo123"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['data']['token'])")

curl -s -X POST http://localhost:5002/api/trpc/auth.logout \
  -H "Authorization: Bearer $TOKEN_A" -H "Content-Type: application/json" -d '{}'

# Verify blacklisted in DB
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -c \
  "SELECT COUNT(*) FROM token_blacklist WHERE token = '$TOKEN_A'"
# Expect: 1

# Kill/restart, then verify token A is still rejected
```

### 3. Rate Limits (T3)
```bash
# Make 5 rapid requests
for i in $(seq 1 5); do curl -s -o /dev/null http://localhost:5002/health; done

# Check DB
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -c \
  "SELECT key, hits FROM rate_limits LIMIT 3"
# Expect: at least 1 row with hits array

# Kill/restart, verify same rows persist
```

### 4. Request Metrics (T4)
```bash
# Make requests, wait 15s for flush (10s interval)
for i in $(seq 1 10); do curl -s -o /dev/null http://localhost:5002/health; done
sleep 15

PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -c \
  "SELECT requests FROM request_metrics WHERE id = 1"
# Expect: requests >= 10

# Kill/restart, verify requests value unchanged
```

### 5. FX Rates from DB (T5)
```bash
# Get current rate
curl -s -X POST http://localhost:5002/api/trpc/currency.convert \
  -H "Content-Type: application/json" \
  -d '{"from":"USD","to":"NGN","amount":1}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['data']['rate'])"

# Mutate DB
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -c \
  "UPDATE fx_rates SET rate = 9999.99 WHERE from_currency = 'USD' AND to_currency = 'NGN'"

# Re-query — rate should change (proves DB-driven, not hardcoded)
# IMPORTANT: Restore original rate after test!
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -c \
  "UPDATE fx_rates SET rate = 1550 WHERE from_currency = 'USD' AND to_currency = 'NGN'"
```

### 6. Combined Integration (T6)
```bash
# Snapshot before kill
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -t -c "SELECT COUNT(*) FROM user_sessions WHERE expires_at > NOW()"
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -t -c "SELECT COUNT(*) FROM rate_limits"
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -t -c "SELECT requests FROM request_metrics WHERE id = 1"
PGPASSWORD=ngapp psql -h localhost -U ngapp -d ngapp -t -c "SELECT COUNT(*) FROM token_blacklist WHERE expires_at > NOW()"

# Kill/restart, re-query — all values should be >= pre-kill values
```

### 7. Regression Suites (T7)
```bash
cd /home/ubuntu/repos/nextgen-insr/customer-portal-full
TEST_BASE_URL=http://localhost:5002 node server.test.cjs         # 31/31
TEST_BASE_URL=http://localhost:5002 node e2e-smoke.test.cjs      # 12/12
TEST_BASE_URL=http://localhost:5002 node scenario-validation.test.cjs  # 68/68
TEST_BASE_URL=http://localhost:5002 node flow-of-funds-validation.test.cjs  # 127/127
# Total: 238/238
```

## Troubleshooting
- **`lsof` not found:** Use `ss -tlnp | grep 5002` to find PIDs instead
- **EADDRINUSE on port 5002:** Previous server still running. Kill it: `kill $(ss -tlnp | grep 5002 | grep -oP 'pid=\K[0-9]+')`
- **FX route name:** The correct route is `currency.convert`, NOT `fx.convert`
- **FX conversion math looks inverted:** The formula is `result = amount * (to_rate / from_rate)` where NGN base rate = 1. For USD→NGN with rate 1550, result for amount=1 is `1 * (1/1550) = 0.000645`. This is correct — it's the conversion factor, not the absolute rate.
- **Metrics not appearing:** The flush interval is 10 seconds. Wait at least 12-15 seconds after making requests before querying `request_metrics`.
- **Rate limits expiring:** Rate limit entries have a 2-minute window. Run DB queries promptly after creating rate limit state, or they may expire before you check.
- **Startup shows "Restored 0 sessions":** This is normal on first boot or after all sessions have expired (24h TTL). Create fresh sessions first.

## Pass/Fail Criteria
- Session tokens must work identically before and after server kill/restart
- Blacklisted tokens must remain rejected after restart
- Rate limit counters must persist (not reset to 0)
- Request metrics must accumulate across restarts
- FX rates must reflect DB mutations (proving DB-driven, not hardcoded)
- All 238 regression assertions must pass
- Graceful shutdown must log: SIGTERM → HTTP server closed → Database pool closed → exit 0
