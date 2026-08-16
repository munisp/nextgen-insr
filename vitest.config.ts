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
      PLATFORM_API_KEY: "test-platform-api-key",
      PLATFORM_SERVICE_TOKEN: "test-platform-service-token",
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
