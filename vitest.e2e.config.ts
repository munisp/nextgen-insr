import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

/**
 * HTTP E2E configuration.
 *
 * Boots the REAL express/tRPC server (server/_core/index.ts createApp()) on an
 * ephemeral port, wired to a real Postgres database, and drives raw HTTP
 * requests through the full middleware chain:
 *   helmet -> rate limit (Redis store) -> body parsers -> security hardening
 *   -> security orchestrator -> financial attack prevention -> tRPC adapter
 *   -> context (Keycloak session JWT verification) -> procedure middleware
 *
 * Database (same mechanism as the integration suite):
 *   - POSTGRES_URL set in the environment  -> used as-is (CI postgres:16)
 *   - otherwise                            -> globalSetup spawns a PGlite
 *     wire-protocol server (tests/integration/setup/globalSetup.ts)
 *
 * Redis:
 *   - REDIS_URL set in the environment     -> used as-is (CI redis:7)
 *   - otherwise                            -> globalSetup starts a local
 *     in-process mini RESP server (tests/e2e/setup/miniRedis.ts)
 *
 * The whole suite shares one database and one server, so files run
 * sequentially in a single fork without module isolation.
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
    name: "e2e",
    include: ["tests/e2e/**/*.e2e.test.ts"],
    environment: "node",
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
        isolate: false,
      },
    },
    globalSetup: ["./tests/e2e/setup/globalSetup.ts"],
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    env: {
      NODE_ENV: "test",
      TZ: "UTC",
      // JWT secret for session-cookie signing/verification.
      JWT_SECRET: "e2e-jwt-secret-9f27c1e4b8d34a06",
      // CRITICAL: context.ts grants an implicit admin fallback user under
      // NODE_ENV=test. The E2E suite must exercise the REAL auth rejection
      // path, so the bypass is explicitly disabled here.
      DEV_AUTH_BYPASS: "false",
      // Authorization fail-open: no Permify sidecar in e2e tests.
      PERMIFY_FAIL_OPEN: "true",
      PERMIFY_URL: "http://127.0.0.1:9",
      // External compliance endpoints pointed at a dead local port so network
      // calls fail fast and routers must persist honest "pending" records.
      CBN_AML_URL: "http://127.0.0.1:9",
      NFIU_API_URL: "http://127.0.0.1:9",
      // Single-connection pool for PGlite (defaults unchanged in prod code).
      DB_POOL_MAX: "1",
      DB_POOL_MIN: "0",
      // PGlite wire port distinct from the integration suite so both can run
      // in the same shell session without colliding.
      PGLITE_PORT: "54529",
      // Fire-and-forget middleware/sidecar clients: fail fast instead of
      // waiting on DNS/timeouts for nonexistent infra. NOTE: REDIS_URL is
      // deliberately NOT set here — globalSetup wires either the CI redis:7
      // service or a local mini-Redis.
      KAFKA_BROKERS: "127.0.0.1:9",
      FLUVIO_HTTP_URL: "http://127.0.0.1:9",
      PLATFORM_BASE_URL: "http://127.0.0.1:9",
      TB_SIDECAR_URL: "http://127.0.0.1:9",
      RUST_BRIDGE_URL: "http://127.0.0.1:9",
      GO_LEDGER_URL: "http://127.0.0.1:9",
      PYTHON_ML_URL: "http://127.0.0.1:9",
      // Fail-open the multi-language security orchestrator (no Rust/Go/Python
      // sidecars in tests) — same default as development.
      SECURITY_FAIL_OPEN: "true",
      // Required at import time by server/_core/env.ts (throws when missing).
      PLATFORM_API_KEY: "e2e-platform-key-c41f9e2a",
      PLATFORM_SERVICE_TOKEN: "e2e-service-token-b87d30f1",
      KEYCLOAK_URL: "https://auth.test.insureportal.io",
      KEYCLOAK_REALM: "insureportal",
      KEYCLOAK_CLIENT_ID: "insurance-portal",
      KEYCLOAK_CLIENT_SECRET: "e2e-keycloak-secret-55aa02d9",
      MINIO_SECRET_KEY: "e2e-minio-secret-6c2b91e0",
      APISIX_ADMIN_KEY: "e2e-apisix-key-a04d77c3",
      // POSTGRES_URL is intentionally NOT set here: it is passed through from
      // the environment when provided (CI), otherwise globalSetup spawns
      // PGlite and exports the connection string before workers start.
    },
  },
});
