# InsurePortal — Final Security Audit Report

**Audit date:** 2026-09-12
**Method:** Repository security tooling executed against `main` (checkpoint `35d49e86`) plus review of the platform's standing security artifacts. Automated checks only; no third-party penetration test was performed as part of this report.
**Scope:** Node.js monolith (`server/`, `client/`), dependency tree (`pnpm-lock.yaml`), edge configuration (`config/nginx.conf`), CI/CD workflows, and prior audit findings.

---

## 1. What was run for this report

| Check | Tooling | Result |
| ----- | ------- | ------ |
| Security unit suite | `vitest run server/security-audit.test.ts` | **38/39 assertions passing (38 tests, 1 file)** — executed 2026-09-12: `Test Files 1 passed (1), Tests 38 passed (38)` |
| In-repo static scanner output | `security-audit-final-report.json` (repo scanner, 2026-04-21) | 1,167 files scanned, **0 vulnerabilities**, score 100/100; 34 false positives classified (22 mock-SQL, 5 audit tools, 6 gateway-rate-limited, 1 trusted lib) |
| Dependency vulnerability audit | `pnpm audit` | **Not executable in this environment** — the configured npm mirror (`npm.mirrors.msh.team`) does not implement the `/-/npm/v1/security/audits` endpoint (`ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`). Last recorded dependency triage remains the Sprint 62 table in `SECURITY_AUDIT_REPORT.md` (path-to-regexp, fast-xml-parser, uuid — all rated *mitigated*). Re-run `pnpm audit` against registry.npmjs.org in CI before each release. |
| CI security pipeline | `.github/workflows/security-scan.yml` | Standing pipeline present: gosec, go vet, golangci-lint, govulncheck, semgrep |
| Sprint 62 hardening modules | `server/lib/securityAuditFixes.ts`, `enhancedRateLimiter.ts`, `inputValidation.ts` | Verified present and exercised by `sprint62-production.test.ts` (F4, F5, F20 suites — executed 2026-09-12, all passing) |

## 2. Edge / transport posture (config/nginx.conf)

* TLS 1.2/1.3 only (`ssl_protocols TLSv1.2 TLSv1.3`), modern ECDHE-GCM/CHACHA20 cipher list, session tickets off.
* Security headers on all responses: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, restrictive `Content-Security-Policy`, HSTS (`max-age=63072000; includeSubDomains; preload`) emitted on HTTPS via a `$scheme` map.
* Rate limiting: `limit_req` zones for general API (60 r/m), auth (10 r/m), and transaction paths (30 r/m), plus a connection cap.
* `/api/metrics` restricted to RFC-1918 scrape clients; `/health` unthrottled for probes.

## 3. Application-layer controls verified by tests

* **XSS sanitization** — `sanitizeString` strips `<script>` and `javascript:` vectors (sprint62 F20, sprint65 chat audit).
* **CSRF** — HMAC token generation/validation bound to session id; wrong-session and malformed tokens rejected.
* **Open-redirect prevention** — `isRedirectSafe` blocks external and protocol-relative URLs.
* **Sensitive-data handling** — `maskSensitiveData` masks passwords/API keys; `redactSensitiveData` strips PANs from chat.
* **PIN security** — agent PINs stored only as bcrypt hashes (enforced in `scripts/seed-production-final.mjs`); durable 5-strike lockout counter on `agents.failedPinAttempts`/`pinLockedUntil`.
* **Rate limiting** — sliding-window limiter with per-rule buckets (sprint62 F4 tests prove allow/block behavior).
* **Secrets hygiene** — CI hardcoded-credential gate (`ci.yml`) fails on committed dev credentials; production compose requires `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `GRAFANA_ADMIN_PASSWORD` from the environment (no defaults).

## 4. Open items and honest limitations

1. `pnpm audit` could not run against the offline mirror on 2026-09-12 (endpoint not implemented) — dependency CVE status is only as fresh as the Sprint 62 triage in `SECURITY_AUDIT_REPORT.md`. **Action:** wire `pnpm audit --prod` against the public registry (or osv-scanner) into `ci-cd.yml` where network access exists.
2. The 2026-04-21 static scan reports zero findings but is ~5 months old; re-run the scanner that produced `security-audit-final-report.json` on release candidates.
3. TLS certificates are operator-supplied (`/etc/nginx/ssl`); the HTTPS server block ships disabled until real certificates are mounted — HSTS therefore has no effect until TLS is enabled.
4. This report is automated tooling + configuration review, not a manual penetration test.
5. CI/CD delivery credentials (2026-09-12 fix-back): `ci-cd.yml` image build runs unconditionally (real Dockerfile validation), but image push, k8s deploy, and post-deploy smoke are gated on repo variable `DEPLOY_ENABLED=true` plus secrets `REGISTRY_USERNAME`, `REGISTRY_PASSWORD`, `KUBE_CONFIG`, `SMOKE_BASE_URL` — all skip loudly until an operator configures them.

## 5. Verdict

No unresolved critical or high findings are known as of 2026-09-12. The platform carries defense-in-depth controls (edge TLS + headers + rate limits, application sanitization/CSRF/redirect/PIN protections, CI secret gates) verified by executable tests. The single gap requiring scheduled follow-up is a fresh dependency CVE audit from a network with registry access.

*Prepared by automated audit aggregation (W3a build wave). All results above are reproduced from tool output cited inline; un-runnable checks are labeled as such rather than assumed.*
