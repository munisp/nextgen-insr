// 2026-10-03 (W8-B1): service-local vitest config so `npm test` inside
// packages/channel-core does not pick up the monolith's root vitest.config.ts
// (same convention as whatsapp-bot/vitest.config.ts).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 20000,
  },
});
