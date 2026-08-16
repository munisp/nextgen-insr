import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

/**
 * API contract test configuration.
 *
 * Boots the REAL express/tRPC server (server/_core/index.ts createApp()) on an
 * ephemeral port and asserts the public API CONTRACT over raw HTTP:
 *   - superjson response envelope shapes ({result:{data:{json}}} /
 *     {error:{json:{message,code,data}}})
 *   - zod validation error shape on malformed input (400 + field detail)
 *   - auth error shapes (401 UNAUTHORIZED / 403 FORBIDDEN)
 *   - NOT_IMPLEMENTED stubs answer 501 truthfully
 *   - pagination params are accepted and bounded (limit caps)
 *
 * Same infrastructure as the HTTP E2E suite (see vitest.e2e.config.ts):
 * POSTGRES_URL from the environment (CI postgres:16) or a spawned PGlite
 * wire server; REDIS_URL from the environment (CI redis:7) or an in-process
 * mini-Redis. The whole suite shares one database and one server, so files
 * run sequentially in a single fork without module isolation.
 *
 * Behavioral flows (refund happy path, idempotent replay/CONFLICT) are owned
 * by tests/e2e/httpApi.e2e.test.ts — this suite asserts SHAPES, not flows,
 * and deliberately does not duplicate them.
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
    name: "contract",
    include: ["tests/contract/**/*.contract.test.ts"],
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
      JWT_SECRET: "contract-jwt-secret-9f27c1e4b8d34a06",
      // Exercise the REAL auth rejection path (see vitest.e2e.config.ts).
      DEV_AUTH_BYPASS: "false",
      PERMIFY_FAIL_OPEN: "true",
      PERMIFY_URL: "http://127.0.0.1:9",
      CBN_AML_URL: "http://127.0.0.1:9",
      NFIU_API_URL: "http://127.0.0.1:9",
      DB_POOL_MAX: "1",
      DB_POOL_MIN: "0",
      // PGlite wire port distinct from the integration (54329) and e2e
      // (54529) suites so all three can run in the same shell session.
      PGLITE_PORT: "56529",
      KAFKA_BROKERS: "127.0.0.1:9",
      FLUVIO_HTTP_URL: "http://127.0.0.1:9",
      PLATFORM_BASE_URL: "http://127.0.0.1:9",
      TB_SIDECAR_URL: "http://127.0.0.1:9",
      RUST_BRIDGE_URL: "http://127.0.0.1:9",
      GO_LEDGER_URL: "http://127.0.0.1:9",
      PYTHON_ML_URL: "http://127.0.0.1:9",
      SECURITY_FAIL_OPEN: "true",
      PLATFORM_API_KEY: "contract-platform-key-c41f9e2a",
      PLATFORM_SERVICE_TOKEN: "contract-service-token-b87d30f1",
      KEYCLOAK_URL: "https://auth.test.insureportal.io",
      KEYCLOAK_REALM: "insureportal",
      KEYCLOAK_CLIENT_ID: "insurance-portal",
      KEYCLOAK_CLIENT_SECRET: "contract-keycloak-secret-55aa02d9",
      MINIO_SECRET_KEY: "contract-minio-secret-6c2b91e0",
      APISIX_ADMIN_KEY: "contract-apisix-key-a04d77c3",
      // POSTGRES_URL is intentionally NOT set here (see vitest.e2e.config.ts).
    },
  },
});
