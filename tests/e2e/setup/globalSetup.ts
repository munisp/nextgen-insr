/**
 * globalSetup.ts — HTTP E2E bootstrap.
 *
 * Database: identical to the integration suite (see
 * tests/integration/setup/globalSetup.ts) — POSTGRES_URL from the environment
 * (CI postgres:16 service) is used as-is, otherwise a PGlite wire-protocol
 * server is spawned as a child process. Either way the schema is applied with
 * `drizzle-kit push --force`.
 *
 * Redis: the app boots real rate-limit-redis stores when REDIS_URL is set.
 * In CI the redis:7 service provides it. Locally, when no Redis is available,
 * an in-process mini RESP server (./miniRedis.ts) is started so the RedisStore
 * path is still exercised end-to-end instead of hanging on reconnect backoff.
 */
import dbGlobalSetup from "../../integration/setup/globalSetup";
import { startMiniRedis, type MiniRedis } from "./miniRedis";

let miniRedis: MiniRedis | null = null;

export default async function globalSetup(): Promise<() => Promise<void>> {
  // ── Redis (local fallback only) ──────────────────────────────────────────
  if (!process.env.REDIS_URL) {
    miniRedis = await startMiniRedis();
    process.env.REDIS_URL = miniRedis.url;
    console.log(`[e2e-setup] no REDIS_URL provided — mini-Redis at ${miniRedis.url}`);
  } else {
    console.log("[e2e-setup] using provided REDIS_URL (CI redis service)");
  }

  // ── Postgres / PGlite + schema push (shared with integration suite) ───────
  const dbTeardown = await dbGlobalSetup();

  return async () => {
    await dbTeardown();
    if (miniRedis) {
      await miniRedis.close();
      miniRedis = null;
    }
  };
}
