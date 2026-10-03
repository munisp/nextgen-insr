"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRedisClient = getRedisClient;
exports.closeRedisClients = closeRedisClients;
// 2026-10-03 (W8-B1): Resilient shared ioredis client, generalized from the
// identical whatsapp-bot/src/lib/redisClient.ts and telegram-bot
// src/lib/redisClient.ts copies (C2-b11b12). Same semantics: lazyConnect,
// bounded retries (give up fast in tests), throttled error-logged degradation
// so the caller's store can fall back to in-memory when Redis is down.
// The only change vs the bot copies is the parameterized `serviceName` used
// in the log label.
const ioredis_1 = __importDefault(require("ioredis"));
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
// Cached per URL so tests can point a second store at an unreachable URL
// without disturbing the healthy shared client.
const _clients = new Map();
function getRedisClient(url = REDIS_URL, serviceName = "channel-core") {
    let _client = _clients.get(url) ?? null;
    if (_client && (_client.status === "end" || _client.status === "close")) {
        _clients.delete(url);
        _client = null;
    }
    if (!_client) {
        _client = new ioredis_1.default(url, {
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
            lazyConnect: true,
            retryStrategy: (times) => {
                // Test environments: give up quickly so the in-memory fallback engages
                // in ms instead of stalling the whole test run.
                const maxAttempts = process.env.NODE_ENV === "test" ? 2 : 20;
                if (times > maxAttempts)
                    return null;
                return Math.min(times * 200, 2000);
            },
            reconnectOnError: (err) => err.message.includes("READONLY") ||
                err.message.includes("ECONNREFUSED") ||
                err.message.includes("ECONNRESET"),
        });
        // Throttled (>=60s between logs) so an outage doesn't flood the logs.
        let lastErrorLog = 0;
        _client.on("error", (err) => {
            // Log but never crash — conversation state degrades to in-memory.
            const now = Date.now();
            if (now - lastErrorLog >= 60000) {
                lastErrorLog = now;
                console.error(`[${serviceName}] [Redis] connection error (state store will use memory fallback): ${err.message}`);
            }
        });
        _clients.set(url, _client);
    }
    return _client;
}
/** Test/helper hook: close every cached client. */
async function closeRedisClients() {
    const all = [..._clients.values()];
    _clients.clear();
    await Promise.allSettled(all.map((c) => c.quit()));
}
//# sourceMappingURL=redisClient.js.map