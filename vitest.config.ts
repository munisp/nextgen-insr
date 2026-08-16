import { defineConfig, defaultExclude } from "vitest/config";
import path from "path";
import fs from "fs";

const templateRoot = path.resolve(import.meta.dirname);

// Single-test exclusions (assurance-lead approved, tests/quarantined-tests.json).
// Central + auditable: a negative testNamePattern built from the registry —
// no describe.skip/it.skip in test files. testNames must stay unique repo-wide.
const quarantinedTests = JSON.parse(
  fs.readFileSync(path.resolve(templateRoot, "tests/quarantined-tests.json"), "utf-8")
) as { entries: { testName: string }[] };
const qNames = quarantinedTests.entries.map((e) =>
  e.testName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
);
const quarantineNamePattern = qNames.length
  ? new RegExp(`^(?!.*(?:${qNames.join("|")})).*$`)
  : undefined;

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    environment: "node",
    env: {
      // Provide a well-formed test URL so Keycloak URL-construction tests
      // (buildAuthorizationUrl) can run without a live Keycloak instance.
      // This does NOT enable real Keycloak auth — it only satisfies new URL().
      KEYCLOAK_URL: "https://auth.test.insureportal.io",
      KEYCLOAK_REALM: "insureportal",
      KEYCLOAK_CLIENT_ID: "insurance-portal",
      // env.ts marks these requireEnv (throw at import). Tests must satisfy
      // them with dummies — they do NOT enable any real gateway calls.
      // CI dummies for every requireEnv() in server/_core/env.ts (values are
      // random-looking: env.ts rejects change-me/dev-/test-/demo-/example-/
      // placeholder substrings as suspicious defaults). No real calls enabled.
      PLATFORM_API_KEY: "ci3f9a7b2e4d6f8a0c1e3b5a7d9f2c4e6a8b0d2f4",
      PLATFORM_SERVICE_TOKEN: "svc9f1e7d5c3b1a0987654321fedcba0987654321",
      // 2026-08-16 (lead-approved): unit job has no Permify container; align
      // with integration.yml which already runs PERMIFY_FAIL_OPEN=true. Unit
      // tests then exercise role-middleware denials; Permify-policy-level
      // coverage is a disclosed gap (see ci-evidence.md residual-risk note).
      PERMIFY_FAIL_OPEN: "true",
      KEYCLOAK_CLIENT_SECRET: "kc8e6d4c2a0f8e6d4c2a0f8e6d4c2a0f8e6d4c2a0",
      MINIO_SECRET_KEY: "mn7b5d3f1a9c8e6b4d2f0a8c6e4b2d0f8a6c4e2",
      APISIX_ADMIN_KEY: "ax5c3e1a9f7d5b3c1e9a7f5d3b1c9e7a5f3d1b9",
    },
    testTimeout: 30000,
    // NOTE (2026-08-12): tests/smoke/comprehensive_smoke_test.spec.ts stays in
    // the default run, but it is an OPTIONS-LEVEL CONNECTIVITY SMOKE —
    // NON-FUNCTIONAL. Its suites are labelled "connectivity smoke
    // (non-functional)", it fails on 5xx/missing procedures when infra is
    // reachable, and it prints "SKIPPED — no infra" otherwise. It must never
    // be cited in reporters, dashboards, or readiness docs as functional
    // test proof (e.g. "89/89 passed").
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/**/*.test.ts",
      "client/src/**/*.spec.ts",
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
    ],
    // Integration tests require a real database and run via
    // `pnpm test:integration` (vitest.integration.config.ts).
    testNamePattern: quarantineNamePattern,
    exclude: [
      ...defaultExclude,
      "**/*.integration.test.ts",
      // ═══ QUARANTINED (2026-08-16, assurance-lead approved, tests/QUARANTINE.md) ═══
      // Do NOT add entries without per-file assurance-lead approval.
      // CAT-A undelivered-scope (zero commits in git history, API-verified):
      "server/sprint73-resilience.test.ts",
      "server/helm-charts.test.ts",
      "server/lib/__tests__/sprint62-production.test.ts",
      "server/lib/__tests__/sprint65-final.test.ts",
      "server/sprint71-security.test.ts",
      "server/sprint79.test.ts",
      "server/sprint80.test.ts",
      "server/sprint81.test.ts",
      "server/sprint83.test.ts",
      "server/sprint85.test.ts",
      "server/sprint86.test.ts",
      "server/business-rules.test.ts",
      "server/liveness-improvements.test.ts",
      "server/liveness-noise-tolerance.test.ts",
      "server/sprint35.test.ts",
      // CAT-B assembled-stack dependency (require running server/gateway):
      "tests/integration/api.test.ts",
      "tests/integration/j02_policy_purchase.test.ts",
      "server/sprint28.test.ts",
      // QUARANTINED-OPEN-DEFECT (genuine defects / partial deliveries — MUST
      // be re-enabled as fixes land; tracked as F-12 sub-items):
      "server/sprint37.test.ts",
      "server/sprint39.test.ts",
      "server/sprint40.test.ts",
      "server/sprint41.test.ts",
      "server/sprint82.test.ts",
      "server/sprint93.test.ts",
      "server/sprint87.test.ts",
      "server/middleware-wiring-sprint44.test.ts",
      "server/security-audit.test.ts",
      "server/pos.test.ts",
      "server/sprint12.test.ts",
      "server/sprint13.test.ts",
      "server/sprint16.test.ts",
      "server/sprint20.test.ts",
      "server/sprint24.test.ts",
      "server/sprint25.test.ts",
      "server/sprint26.test.ts",
      "server/sprint27.test.ts",
      "server/sprint31-production.test.ts",
      "server/sprint69-production.test.ts",
      "server/sprint78.test.ts",
      "server/sprint84.test.ts",
      "server/sprint85-phase2.test.ts",
      "server/sprint88.test.ts",
      "server/sprint88-integration.test.ts",
      "server/websocket-analytics.test.ts",
      "server/lib/__tests__/sprint59-features.test.ts",
      "tests/integration/all_28_journeys_tb_consistency.test.ts",
      "server/middleware-integration.test.ts",
      "server/db-performance.test.ts",
      "server/observability-middleware.test.ts",
      "server/sprint95.test.ts",
      "server/gap-fixes.test.ts",
      // ═══ DE-DUPLICATED EXECUTION (lead-approved 2026-08-16): these suites run
      // green in integration.yml's dedicated contract/e2e jobs with the correct
      // harness (globalSetup schema push, real auth env); including them in the
      // default run duplicates execution WITHOUT that harness (behavioral diffs:
      // auth.me anonymous, 403-vs-400 — see ci-evidence.md).
      "tests/contract/**",
      "tests/e2e/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["server/**/*.ts", "client/src/**/*.ts", "client/src/**/*.tsx"],
      exclude: [
        "server/_core/**",
        "server/**/*.test.ts",
        "server/**/*.d.ts",
        "client/src/**/*.test.ts",
        "client/src/**/*.spec.ts",
      ],
    },
  },
});
