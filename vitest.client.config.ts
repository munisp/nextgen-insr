import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

/**
 * Client page test configuration.
 *
 * Renders REAL page components in happy-dom with @testing-library/react.
 * The ONLY mock is the network boundary: the tRPC client module
 * (client/src/lib/trpc) is replaced by a scriptable in-test stub
 * (tests/client/helpers/trpcMock.ts) — no server code, no database.
 * Pages that fetch()/socket directly have those browser APIs stubbed at the
 * same boundary (global fetch, useSocket hook).
 *
 * Release-gate evidence lives in the integration and E2E layers; these tests
 * prove the pages render truthful loading/error/empty states and contain no
 * fabricated fallback data.
 */
export default defineConfig({
  root: templateRoot,
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    name: "client",
    include: ["tests/client/**/*.test.tsx"],
    environment: "happy-dom",
    setupFiles: ["./tests/client/setup.ts"],
    testTimeout: 30_000,
    env: {
      NODE_ENV: "test",
      TZ: "UTC",
      KEYCLOAK_URL: "https://auth.test.insureportal.io",
      KEYCLOAK_REALM: "insureportal",
      KEYCLOAK_CLIENT_ID: "insurance-portal",
    },
  },
});
