import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

/**
 * Isolated integration configuration (C3, 2026-11-28).
 *
 * Runs the 10 insureportal-ported integration suites. Unlike
 * vitest.integration.config.ts (single shared fork), each file gets a FRESH
 * fork (isolate: true) because these suites follow ip's per-suite PGlite
 * respawn harness: they spawn their own PGlite wire server, re-point
 * POSTGRES_URL/DATABASE_URL at it, push their own DDL, and end the pool in
 * afterAll. In a shared fork, server/db's module-level pool/error cache would
 * leak across files (one file's pool error makes every later getDb() return
 * null in test mode). Fresh forks keep each suite's module state honest.
 * Same globalSetup (shared PGlite for the suites' non-DB deps), same env.
 */
export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@schema": path.resolve(templateRoot, "drizzle", "schema.ts"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    name: "integration-ported",
    include: [
      "tests/integration/commissionApproveK.integration.test.ts",
      "tests/integration/disputeResolutionW31.integration.test.ts",
      "tests/integration/merchantPayoutH2.integration.test.ts",
      "tests/integration/w29Analytics.integration.test.ts",
      "tests/integration/w30SavingsPension.integration.test.ts",
      "tests/integration/w31FloatStatsReplenishment.integration.test.ts",
      "tests/integration/w31SavingsPensionTax.integration.test.ts",
      "tests/integration/w31dLoyaltyReferral.integration.test.ts",
      "tests/integration/w32FloatReplenishmentHardening.integration.test.ts",
      "tests/integration/w32cContractDrift.integration.test.ts",
    ],
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
        // Fresh module state per file (see header).
        isolate: true,
      },
    },
    globalSetup: ["./tests/integration/setup/globalSetup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      TZ: "UTC",
      JWT_SECRET: "integration-jwt-secret-9f27c1e4b8d34a06",
      PERMIFY_FAIL_OPEN: "true",
      PERMIFY_URL: "http://127.0.0.1:9",
      CBN_AML_URL: "http://127.0.0.1:9",
      NFIU_API_URL: "http://127.0.0.1:9",
      DB_POOL_MAX: "1",
      DB_POOL_MIN: "0",
      KAFKA_BROKERS: "127.0.0.1:9",
      FLUVIO_HTTP_URL: "http://127.0.0.1:9",
      PLATFORM_BASE_URL: "http://127.0.0.1:9",
      RUST_BRIDGE_URL: "http://127.0.0.1:9",
      GO_LEDGER_URL: "http://127.0.0.1:9",
      PYTHON_ML_URL: "http://127.0.0.1:9",
      PLATFORM_API_KEY: "integration-platform-key-c41f9e2a",
      PLATFORM_SERVICE_TOKEN: "integration-service-token-b87d30f1",
      KEYCLOAK_URL: "https://auth.test.insureportal.io",
      KEYCLOAK_REALM: "insureportal",
      KEYCLOAK_CLIENT_ID: "insurance-portal",
      KEYCLOAK_CLIENT_SECRET: "integration-keycloak-secret-55aa02d9",
      MINIO_SECRET_KEY: "integration-minio-secret-6c2b91e0",
      APISIX_ADMIN_KEY: "integration-apisix-key-a04d77c3",
    },
  },
});
