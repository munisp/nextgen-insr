import { defineConfig, defaultExclude } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

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
    exclude: [
      ...defaultExclude,
      "**/*.integration.test.ts",
      // QUARANTINED (2026-08-16, tests/QUARANTINE.md): asserts 8 sprint-73
      // resilience microservices never merged (zero commits in history).
      // Re-enable per the condition in tests/QUARANTINE.md. Do NOT add further
      // entries without assurance-lead approval.
      "server/sprint73-resilience.test.ts",
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
