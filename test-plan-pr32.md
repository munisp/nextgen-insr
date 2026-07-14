# Test Plan — PR #32: Production Hardening

## Scope
All changes are in `customer-portal-full/server.cjs` (API/backend middleware). No UI changes.
Testing is **shell-based only** (curl + node test scripts). No browser recording needed.

## Environment
- Server: `localhost:5002` (node server.cjs)
- DB: PostgreSQL ngapp@localhost:5432
- Demo creds: `demo@insureportal.ng` / `demo123`

---

## Test 1: Security Headers Present on All Responses

**Steps:** `curl -sI http://localhost:5002/health`

**Pass criteria — ALL of these headers must be present with exact values:**
| Header | Expected Value |
|--------|---------------|
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Strict-Transport-Security | contains `preload` |
| Content-Security-Policy | starts with `default-src 'self'` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(self)` |
| X-DNS-Prefetch-Control | `off` |
| X-Download-Options | `noopen` |
| X-Permitted-Cross-Domain-Policies | `none` |
| X-Request-ID | matches UUID regex `^[0-9a-f-]{36}$` |

**Fail if:** any header is missing or has wrong value.

---

## Test 2: CORS — Allowed vs Disallowed Origin

**Step A (allowed):**
```
curl -sI -H "Origin: http://localhost:5002" http://localhost:5002/health
```
**Pass:** Response contains `Access-Control-Allow-Origin: http://localhost:5002`

**Step B (disallowed):**
```
curl -sI -H "Origin: http://evil.com" http://localhost:5002/health
```
**Pass:** Response does NOT contain `Access-Control-Allow-Origin` header at all.

**Step C (preflight):**
```
curl -sI -X OPTIONS -H "Origin: http://localhost:5002" http://localhost:5002/api/trpc/dashboard.stats
```
**Pass:** HTTP status 204, `Access-Control-Allow-Methods` header present.

**Fail if:** disallowed origin gets CORS headers, or preflight returns non-204.

---

## Test 3: JWT Token Format on Login

**Steps:**
```
curl -s -X POST http://localhost:5002/api/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@insureportal.ng","password":"demo123"}'
```

**Pass criteria:**
- Response status 200
- `.result.data.token` is a JWT: 3 dot-separated base64url segments
- Decoding the middle segment (payload) yields JSON with `sub`, `email`, `iat`, `exp` fields
- `exp - iat` equals 86400 (24 hours)

**Fail if:** token is a 64-char hex string (old format) or payload missing exp/iat claims.

---

## Test 4: Auth Enforcement — Unauthenticated POST to Protected Route

**Steps:**
```
curl -s -X POST http://localhost:5002/api/trpc/policies.create \
  -H "Content-Type: application/json" \
  -d '{"type":"motor"}'
```

**Pass criteria:**
- HTTP status 401
- Response body: `{"error":{"message":"Authentication required","code":"UNAUTHORIZED"}}`

**Fail if:** status is 200 or error code is missing.

---

## Test 5: Auth Enforcement — Unauthenticated POST to Public Route Succeeds

**Steps:**
```
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5002/api/trpc/auth.login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@insureportal.ng","password":"demo123"}'
```

**Pass:** HTTP status 200 (not 401). Public routes bypass auth enforcement.

**Fail if:** returns 401.

---

## Test 6: Token Blacklist on Logout

**Steps:**
1. Login → extract JWT token
2. Verify `auth.me` with that token → returns user data
3. Call `auth.logout` with that token
4. Call `auth.me` with same token again

**Pass criteria:**
- Step 2: returns user data (email field present)
- Step 4: does NOT return the same user session (token was blacklisted)

**Fail if:** step 4 still returns the authenticated session data.

---

## Test 7: Error Codes — 404 and 429

**Step A (unknown route):**
```
curl -s http://localhost:5002/api/trpc/nonexistent.route
```
**Pass:** HTTP 404, body contains `"code":"NOT_FOUND"`

**Step B (rate limit):**
Send 101+ rapid POST requests to `auth.login` with wrong password to trigger rate limit.
```
for i in $(seq 1 101); do curl -s -o /dev/null -w "%{http_code}\n" -X POST ...; done
```
**Pass:** After exceeding limit, response is HTTP 429 with `"code":"RATE_LIMITED"` AND headers `X-RateLimit-Limit` and `X-RateLimit-Remaining: 0`.

**Fail if:** rate-limited response lacks error code or headers.

---

## Test 8: X-Request-ID Propagation

**Steps:**
```
curl -sI -H "X-Request-ID: test-trace-12345" http://localhost:5002/health
```

**Pass:** Response `X-Request-ID` header equals exactly `test-trace-12345`.

**Fail if:** server generates a new UUID instead of echoing the provided one.

---

## Test 9: Run server.test.cjs (30+ assertions)

**Steps:** `node customer-portal-full/server.test.cjs`

**Pass:** Exit code 0, "0 failed" in output.
**Fail:** Any assertion fails.

---

## Test 10: Run e2e-smoke.test.cjs (12-step golden path)

**Steps:** `node customer-portal-full/e2e-smoke.test.cjs`

**Pass:** Exit code 0, "0 failed" in output.
**Fail:** Any step fails.
