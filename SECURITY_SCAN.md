# Security Scan Results — F-05 remediation

**Date:** 2026-08-15 · **Branch:** fix/security-observability · **Base:** main @ 9908fa40

All commands and outputs recorded verbatim below. Tooling constraints: the
corporate npm mirror (`npm.mirrors.msh.team`) does not implement the audit
endpoint, so audits were run against `registry.npmjs.org` directly. `gitleaks`
binary was unavailable (not installable via npx — it is a Go binary), so the
secret scan used the documented grep-pattern sweep in §2 plus a CI gitleaks
step for ongoing coverage.

---

## 1. Dependency vulnerability audit (production deps)

**Command:** `pnpm audit --prod --registry=https://registry.npmjs.org --json`

**Baseline (before fixes):** `{"info":0,"low":1,"moderate":10,"high":8,"critical":0}`

High-severity advisories at baseline (all transitive):

| Package | Advisory | Fix applied (pnpm.overrides in package.json) |
|---|---|---|
| @opentelemetry/propagator-jaeger | DoS via malformed Jaeger header | floor `>=2.9.0` |
| fast-uri (×2) | host confusion via backslash authority | floor `>=4.1.2` |
| brace-expansion (×2) | DoS via unbounded expansion | `minimatch>brace-expansion >=5.0.9` |
| socket.io-parser | zero-attachment memory exhaustion | floor `>=4.2.7` |
| ip-address | SSRF/trust-boundary misclassification | floor `>=10.3.1` |
| nanoid | infinite loop with size=0 generators | `postcss>nanoid >=3.3.18` |

Moderate/low also floored: `postcss >=8.5.23`, `mermaid >=11.16.1`,
`dompurify >=3.4.13`, `@opentelemetry/core >=2.8.0` (all patch/minor bumps;
no breaking API changes; suite + build re-verified).

**Final (after fixes):** `{"info":0,"low":0,"moderate":0,"high":0,"critical":0}`
— "No known vulnerabilities found" for production dependencies.

Dev-only dependencies were not audited (`--prod`); CI runs the same prod
audit and fails on High/Critical (see `.github/workflows/security.yml`).

## 2. Secret scan

**Attempted:** `npx gitleaks detect --source . --no-git` → failed
(`could not determine executable to run` — gitleaks is not an npm package).
No gitleaks/syft/trivy binary present in the environment.

**Fallback:** grep pattern sweep over the repo (excluding
`node_modules/`, `.git/`, `dist/`, `pnpm-lock.yaml`):

- High-signal patterns: AWS keys (`AKIA[0-9A-Z]{16}`), GitHub PATs
  (`ghp_`, `github_pat_`), OpenAI/Stripe live keys (`sk-`, `sk_live_`),
  Slack tokens (`xox*`), PEM private-key blocks.
- Keyword sweep: `(password|secret|api_key|apikey|token) := "…≥12 chars…"`
  across `.ts/.js/.mjs/.json/.yml`.

**Findings — no real secrets committed.** The only hits:

1. `server/mtlsAgent.test.ts:78` — a PEM block whose payload is base64
   `"ZmFrZQ=="` ("fake"). Test fixture, benign.
2. `.env.production.example:71` — `AKIAIOSFODNN7EXAMPLE`, the well-known
   AWS documentation placeholder. Benign.
3. `infra/vault/setup_vault.sh`, `infra/alertmanager/*`, `infra/k8s/secrets.yaml`,
   `monitoring/alertmanager.yml` — all values are `${ENV_VAR}` references or
   `REPLACE_WITH_*` / `CHANGE_ME_*` placeholders. Benign.
4. `.env.example` — `KEYCLOAK_ADMIN=admin` / `KEYCLOAK_ADMIN_PASSWORD=admin`.
   Dev-default example credentials, not production secrets. **Recommend**
   rotating if any real deployment ever used these defaults; low risk in a
   `.example` file.

Coverage caveat: the sweep scans the working tree at HEAD (not full git
history); the gitleaks CI step scans full history (`fetch-depth: 0`) going
forward.

## 3. SBOM

**Attempted:** `pnpm dlx @cyclonedx/cyclonedx-npm --output-file sbom.json`
→ failed (`npm-ls exited with errors: noStatus SIGABRT` — cyclonedx-npm
requires npm's dependency tree and crashes on this pnpm-managed repo).

**Used instead:** `npx @cyclonedx/cdxgen -t js -o sbom.json` (cdxgen reads
`pnpm-lock.yaml` natively). Result: `sbom.json` committed at repo root —
CycloneDX JSON, full dependency inventory. CI also regenerates and uploads
an SBOM artifact on every security workflow run (90-day retention).

## 4. CI enforcement added

`.github/workflows/security.yml` (new):
- `audit` job: `pnpm install --frozen-lockfile` → `pnpm audit --prod --json`
  with a Node gate that fails the build on any High/Critical advisory
  (pnpm has no `--audit-level` flag); SBOM generation + artifact upload.
- `secrets` job: `gitleaks/gitleaks-action@v2` with full history.
- Triggers: push/PR to `main` + weekly schedule (Mondays 03:00 UTC).

## 5. Post-change verification

- `PGLITE_PORT=54629 pnpm test:integration` → **9 files, 62 tests, all passing**.
- `pnpm build` → vite client build ✓, esbuild server bundle ✓ (`dist/index.js`).
