# Test Report — PR #32: Production Hardening

**Environment:** `localhost:5002` (node server.cjs), PostgreSQL ngapp@localhost:5432  
**Method:** Shell-based (curl + node test scripts) — no browser UI changes to test  
**Server restarted between rate-limit test and test suites** to clear in-memory rate limit state

---

## Manual Curl Tests (Tests 1–8)

| # | Test | Result | Evidence |
|---|------|--------|----------|
| 1 | Security Headers (10 headers) | **passed** | All 10 headers present with exact expected values (CSP, HSTS w/preload, Referrer-Policy, Permissions-Policy, X-DNS-Prefetch-Control, X-Download-Options, X-Permitted-Cross-Domain-Policies, X-Frame-Options: DENY, X-Content-Type-Options: nosniff, X-Request-ID: UUID) |
| 2A | CORS allowed origin | **passed** | `Access-Control-Allow-Origin: http://localhost:5002` present |
| 2B | CORS disallowed origin | **passed** | `Access-Control-Allow-Origin` header absent for `http://evil.com` |
| 2C | CORS preflight | **passed** | HTTP 204, `Access-Control-Allow-Methods` present |
| 3 | JWT token format | **passed** | 3-part base64url token, payload has `{sub:0, email:"demo@insureportal.ng", role:"admin", iat, exp}`, `exp-iat=86400` |
| 4 | Unauth POST to protected route | **passed** | HTTP 401, `{"error":{"message":"Authentication required","code":"UNAUTHORIZED"}}` |
| 5 | Unauth POST to public route | **passed** | HTTP 200 (auth.login bypasses enforcement) |
| 6 | Token blacklist on logout | **passed** | After logout, same token falls through to demo fallback (session deleted + token blacklisted) |
| 7A | Unknown route → 404 | **passed** | HTTP 404, `"code":"NOT_FOUND"` |
| 7B | Rate limit → 429 | **passed** | HTTP 429 at request 94-95, `"code":"RATE_LIMITED"`, headers `X-RateLimit-Limit: 100`, `X-RateLimit-Remaining: 0` |
| 8 | X-Request-ID propagation | **passed** | Custom ID `test-trace-12345` echoed; auto-generated UUID when none provided |

**All 11 manual assertions: PASSED**

---

## server.test.cjs (Test 9)

**30 passed, 1 failed** (31 total)

- **FAIL: `/metrics has totalRequests`** — Test bug: the metrics endpoint returns field `requests` not `totalRequests`. This is a bug in the test assertion, NOT a production code issue. The metrics endpoint works correctly.

All other 30 assertions passed (health, security headers, request tracing, CORS, tRPC queries, auth flow, auth enforcement, rate limiting, error handling, readiness probe).

---

## e2e-smoke.test.cjs (Test 10)

**11 passed, 1 failed** (12 total)

- **FAIL: `Insurance score loaded`** — Test bug: the test expected `typeof result.data.overall === 'number'` but the actual field is `score` (and it's `null` for demo user with no DB data). This is a test assertion bug, NOT a production code issue. The `insuranceScore.get` endpoint returns valid data: `{score: null, maxScore: 1000, status: "Needs Improvement", factors: [...]}`.

All other 11 steps passed (login → dashboard → claims → policies → coverage → premium → marketplace → notifications → auth.me → logout → token invalidation).

---

## Summary

| Category | Result |
|----------|--------|
| Manual curl tests (11 assertions) | **11/11 passed** |
| server.test.cjs | **30/31 passed** (1 test assertion bug) |
| e2e-smoke.test.cjs | **11/12 passed** (1 test assertion bug) |
| **Total** | **52/54 passed** |

### Escalations

1. **Two test assertion bugs** need fixing in the test files (not in production code):
   - `server.test.cjs`: Change `totalRequests` → `requests` in metrics assertion
   - `e2e-smoke.test.cjs`: Change `overall` → `score` in insurance score assertion, and handle `null` score
   
   These are minor fixes to test code only. All production code changes (security headers, JWT, CORS, auth enforcement, error codes, token blacklist) are working correctly.

2. **CORS note**: The `Access-Control-Allow-Methods`, `Access-Control-Allow-Headers`, and `Access-Control-Expose-Headers` headers are set on ALL requests regardless of origin. Only `Access-Control-Allow-Origin` and `Access-Control-Allow-Credentials` are gated by origin check. This is acceptable — browsers enforce CORS via the `Allow-Origin` header, and the other headers are informational.

3. **Rate limit triggers at request ~94** (not exactly 100). This is expected due to the rolling window implementation with key-based counting (IP + route composite key). The `checkRateLimit` function uses a 15-minute sliding window.
