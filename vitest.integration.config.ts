import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

/**
 * Integration test configuration.
 *
 * Runs the tests in tests/integration against a REAL PostgreSQL database:
 *   - POSTGRES_URL set in the environment  -> used as-is (CI postgres service)
 *   - otherwise                            -> globalSetup spawns a PGlite
 *     wire-protocol server (see tests/integration/setup/globalSetup.ts)
 *
 * PGlite serves a single client and the whole suite shares one database,
 * so files run sequentially in a single fork without module isolation.
 */
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
    name: "integration",
    include: ["tests/integration/**/*.integration.test.ts"],
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        isolate: false,
      },
    },
    globalSetup: ["./tests/integration/setup/globalSetup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    env: {
      NODE_ENV: "test",
      TZ: "UTC",
      // JWT secret for the test context (context.ts requires one outside
      // dev/test; NODE_ENV=test also bypasses the production guard).
      JWT_SECRET: "integration-jwt-secret-9f27c1e4b8d34a06",
      // Authorization fail-open: no Permify sidecar in integration tests.
      PERMIFY_FAIL_OPEN: "true",
      PERMIFY_URL: "http://127.0.0.1:9",
      // External compliance endpoints pointed at a dead local port so network
      // calls fail fast and routers must persist honest "pending" records.
      CBN_AML_URL: "http://127.0.0.1:9",
      NFIU_API_URL: "http://127.0.0.1:9",
      // Single-connection pool for PGlite (defaults unchanged in prod code).
      DB_POOL_MAX: "1",
      DB_POOL_MIN: "0",
      // Fire-and-forget middleware/sidecar clients: fail fast instead of
      // waiting on DNS/timeouts for nonexistent infra.
      REDIS_URL: "redis://127.0.0.1:9",
      KAFKA_BROKERS: "127.0.0.1:9",
      FLUVIO_HTTP_URL: "http://127.0.0.1:9",
      PLATFORM_BASE_URL: "http://127.0.0.1:9",
      TB_SIDECAR_URL: "http://127.0.0.1:9",
      RUST_BRIDGE_URL: "http://127.0.0.1:9",
      GO_LEDGER_URL: "http://127.0.0.1:9",
      PYTHON_ML_URL: "http://127.0.0.1:9",
      // Required at import time by server/_core/env.ts (throws when missing).
      PLATFORM_API_KEY: "integration-platform-key-c41f9e2a",
      PLATFORM_SERVICE_TOKEN: "integration-service-token-b87d30f1",
      KEYCLOAK_URL: "https://auth.test.insureportal.io",
      KEYCLOAK_REALM: "insureportal",
      KEYCLOAK_CLIENT_ID: "insurance-portal",
      KEYCLOAK_CLIENT_SECRET: "integration-keycloak-secret-55aa02d9",
      // POSTGRES_URL is intentionally NOT set here: it is passed through from
      // the environment when provided (CI), otherwise globalSetup spawns
      // PGlite and exports the connection string before workers start.
    },
  },
});
