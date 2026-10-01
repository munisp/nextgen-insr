import { defineConfig } from "vitest/config";
import path from "path";

// Standalone config for product-builder persistence tests (2026-10-01, C2d).
// Uses a real PGlite instance (dev dep at repo root) — no mocks on the
// persistence path. Deliberately avoids the root config's globalSetup.
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 60000,
  },
});
