# Lint Debt — Decision Record & Burn-Down Plan

## Decision (2026-08-16, approved by assurance lead)

The `node-quality` ESLint gate in `ci.yml` enforced `--max-warnings 0` against a
strict, type-aware ruleset (`.eslintrc.cjs`: `@typescript-eslint/no-unsafe-*`,
`no-explicit-any`, `import/order`, etc. as **errors**). Two compounding defects
made the gate unmeetable:

1. **Resolver bug (fixed):** `.eslintrc.cjs` configured
   `settings.import/resolver.typescript`, but `eslint-import-resolver-typescript`
   was never in `devDependencies`. The runner loaded it as an "invalid interface"
   resolver, cascading **~9,400 phantom `import/*` errors**. Fixed by adding
   `eslint-import-resolver-typescript@^3` (compatible with
   `eslint-plugin-import@2.32`).
2. **Accumulated genuine debt:** since the last green CI Pipeline
   (2026-07-14, c605a064), server/ code grew to **8,365 errors / 69 warnings**
   (after `eslint --fix` landed its auto-fixes).

The approved remediation is a **count-based ratchet, explicitly NOT a rule
relaxation**: no rule severity is changed, no file is excluded, no test is
skipped. `scripts/check-eslint-baseline.mjs` runs the *same* ESLint invocation
and fails the build **only if any rule's violation count increases** above
`scripts/eslint-baseline.json` (or a previously clean rule regresses from 0).
Decreases are reported as burn-down progress.

## Baseline (post `--fix`, 2026-08-16)

- **8,365 errors, 69 warnings** across 733 files, 28 rules (baseline generated from the `--fix` run's own JSON report, commit bb417a7b).
- Baseline file: `scripts/eslint-baseline.json` (regenerate only with
  assurance-lead approval via `node scripts/check-eslint-baseline.mjs --write-baseline`).

Top debt by rule:

| Count | Rule |
|------:|------|
| 1,774 | @typescript-eslint/no-unused-vars |
| 1,774 | @typescript-eslint/no-unsafe-member-access |
| 1,204 | @typescript-eslint/no-explicit-any |
|   958 | @typescript-eslint/no-unsafe-assignment |
|   802 | @typescript-eslint/require-await |
|   507 | import/order |
|   473 | @typescript-eslint/no-unsafe-argument |
|   375 | @typescript-eslint/no-unsafe-call |
|   190 | @typescript-eslint/no-unsafe-return |

## Burn-down priority (funds/security first)

Manual fixes target `no-unsafe-*` / `no-explicit-any` on paths where an `any`
can hide real defects in money movement or access control:

1. `server/routers/{disputeRefund,agentFloatTransfer,transactions,insuranceWorkflows,agent,pinReset,multiTenantIsolation,tenantAdmin}.ts`
2. `server/db.ts`, `server/_core/*`
3. `server/middleware/*` (esp. financialAttackPrevention, rbac, pbacEnforcement, tenantIsolation, webhookHmac)
4. `server/stripe/*`, `server/journeys/*`
5. Residual: `no-unused-vars` (mostly safe deletions / `_` prefixes) and
   `require-await` (remove spurious `async` or add awaited work) repo-wide.

## Owner

Assurance engagement (munisp/nextgen-insr). Ratchet violations block CI;
baseline reductions may be committed freely — CI reports them as progress.
