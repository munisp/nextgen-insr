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
    // 2026-11-27 (W24, verifier-found): a RELATIVE setupFiles entry is
    // resolved by vitest 3.x via mlly URL resolution against the PARENT of
    // this root — so in the full repo layout the repo-ROOT vitest.setup.ts
    // (TZ-only) silently shadows insureportal/vitest.setup.ts, which then
    // never loads (no Permify wire double, no test env). Pin the absolute
    // path so the portal setup is always the one loaded.
    setupFiles: [path.resolve(templateRoot, "vitest.setup.ts")],
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
