import { defineConfig } from "vitest/config";
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
    },
    testTimeout: 30000,
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "client/src/**/*.test.ts",
      "client/src/**/*.spec.ts",
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
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
