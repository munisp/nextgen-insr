// 2026-10-02 (C2-b11b12): Resilient shared ioredis client for the
// telegram-bot service (finding B11). Follows the server/lib/redisClient.ts
// pattern: lazyConnect, bounded retries (give up fast in tests), error-logged
// degradation so the bot keeps working on the in-memory fallback when Redis
// is down. REDIS_URL overrides the default; docker-compose redis requires
// auth (e.g. redis://:redis_dev@redis:6379).
import Redis from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";

// Cached per URL so tests can point a second store at an unreachable URL
// without disturbing the healthy shared client.
const _clients = new Map<string, Redis>();

export function getRedisClient(url: string = REDIS_URL): Redis {
  let _client = _clients.get(url) ?? null;
  if (_client && (_client.status === "end" || _client.status === "close")) {
    _clients.delete(url);
    _client = null;
  }
  if (!_client) {
    _client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        // Test environments: give up quickly so the in-memory fallback engages
        // in ms instead of stalling the whole test run.
        const maxAttempts = process.env.NODE_ENV === "test" ? 2 : 20;
        if (times > maxAttempts) return null;
        return Math.min(times * 200, 2000);
      },
      reconnectOnError: (err: Error) =>
        err.message.includes("READONLY") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ECONNRESET"),
    });
    // Throttled (>=60s between logs) so an outage doesn't flood the logs.
    let lastErrorLog = 0;
    _client.on("error", (err) => {
      // Log but never crash — conversation state degrades to in-memory.
      const now = Date.now();
      if (now - lastErrorLog >= 60_000) {
        lastErrorLog = now;
        console.error(`[telegram-bot] [Redis] connection error (state store will use memory fallback): ${err.message}`);
      }
    });
    _clients.set(url, _client);
  }
  return _client;
}

/** Test/helper hook: close every cached client. */
export async function closeRedisClients(): Promise<void> {
  const all = [..._clients.values()];
  _clients.clear();
  await Promise.allSettled(all.map((c) => c.quit()));
}
