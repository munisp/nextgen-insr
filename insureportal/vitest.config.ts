import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@schema": path.resolve(templateRoot, "drizzle", "schema"),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    environment: "node",
    env: {
      KEYCLOAK_URL: "https://auth.test.insureportal.ng",
      KEYCLOAK_REALM: "insureportal",
      KEYCLOAK_CLIENT_ID: "insureportal-web",
      DATABASE_URL: "postgresql://test:test@localhost:5432/insureportal_test",
    },
    testTimeout: 30000,
    include: [
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["server/**/*.ts"],
      exclude: ["server/_core/**", "server/**/*.test.ts", "server/**/*.d.ts"],
    },
  },
});
