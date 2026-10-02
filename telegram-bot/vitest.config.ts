// 2026-10-02 (C2-b11b12): service-local vitest config so `npm test` inside
// telegram-bot/ does not pick up the monolith's root vitest.config.ts.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 20000,
  },
});
