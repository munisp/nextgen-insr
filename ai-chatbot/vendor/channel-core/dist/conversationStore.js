"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisConversationStore = void 0;
// 2026-10-03 (W8-B1): Generic conversation store interface + Redis-backed
// implementation, extracted from the three near-identical bot stores:
//   whatsapp-bot/src/lib/conversationStore.ts (RedisConversationStore)
//   telegram-bot/src/lib/conversationStore.ts (RedisConversationStore)
//   ai-chatbot/src/lib/sessionStore.ts      (RedisSessionStore)
//
// Degradation policy (unchanged from C2-b11b12): conversation state is
// availability-critical, not identity/funds. Every write attempts Redis
// FIRST; only on a Redis error do we fall back to a per-process in-memory
// Map with a loud, throttled error log. State is never lost silently on the
// happy path, and the fallback is never written on the happy path (so a
// healed Redis does not serve stale copies).
const redisClient_1 = require("./redisClient");
const ERROR_LOG_INTERVAL_MS = 60000;
/**
 * Redis-backed store: one JSON blob per conversation key plus a per-user
 * Redis SET (`<keyPrefix>byuser:<userId>`) indexing conversation ids.
 * JSON values (not HASH fields) so arbitrary bot state shapes round-trip
 * unchanged — the bot stores each hand-rolled HASH serialization; that was
 * part of the triplication this package removes.
 */
class RedisConversationStore {
    constructor(opts) {
        /** Degradation fallback only — NOT written on the happy path. */
        this.memory = new Map();
        this.memoryUserIndex = new Map();
        this.lastErrorLog = 0;
        if (typeof opts.getUserId !== "function") {
            // Fail-fast at construction: without a user-id extractor the
            // listByUser index would silently be wrong.
            throw new Error("RedisConversationStore requires a getUserId(state) extractor");
        }
        this.ttlSeconds =
            opts.ttlSeconds ??
                (Number(opts.ttlEnvVar ? process.env[opts.ttlEnvVar] : undefined) || 600);
        this.keyPrefix = opts.keyPrefix ?? "channel:conv:";
        this.serviceName = opts.serviceName ?? "channel-core";
        this.url = opts.url;
        this.getUserId = opts.getUserId;
    }
    key(conversationId) {
        return `${this.keyPrefix}${conversationId}`;
    }
    userKey(channelUserId) {
        return `${this.keyPrefix}byuser:${channelUserId}`;
    }
    logFallback(op, conversationId, err) {
        const now = Date.now();
        if (now - this.lastErrorLog >= ERROR_LOG_INTERVAL_MS) {
            this.lastErrorLog = now;
            console.error(`[${this.serviceName}] REDIS OUTAGE: conversation ${op} for ${conversationId} fell back to ` +
                `in-memory state (lost on restart!): ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    async get(conversationId) {
        try {
            const raw = await (0, redisClient_1.getRedisClient)(this.url, this.serviceName).get(this.key(conversationId));
            if (!raw)
                return null;
            return JSON.parse(raw);
        }
        catch (err) {
            this.logFallback("read", conversationId, err);
            return this.memory.get(conversationId) ?? null;
        }
    }
    async set(conversationId, state) {
        const userId = this.getUserId(state);
        try {
            await (0, redisClient_1.getRedisClient)(this.url, this.serviceName)
                .multi()
                .set(this.key(conversationId), JSON.stringify(state), "EX", this.ttlSeconds)
                .sadd(this.userKey(userId), conversationId)
                .expire(this.userKey(userId), this.ttlSeconds)
                .exec();
            this.memory.delete(conversationId); // happy path: no stale fallback copy
            this.memoryUserIndex.get(userId)?.delete(conversationId);
        }
        catch (err) {
            this.logFallback("write", conversationId, err);
            this.memory.set(conversationId, state);
            let set = this.memoryUserIndex.get(userId);
            if (!set) {
                set = new Set();
                this.memoryUserIndex.set(userId, set);
            }
            set.add(conversationId);
        }
    }
    async delete(conversationId) {
        // Read first (best effort) so the per-user index entry can be removed.
        const existing = await this.get(conversationId);
        try {
            const client = (0, redisClient_1.getRedisClient)(this.url, this.serviceName);
            const multi = client.multi().del(this.key(conversationId));
            if (existing)
                multi.srem(this.userKey(this.getUserId(existing)), conversationId);
            await multi.exec();
        }
        catch (err) {
            this.logFallback("delete", conversationId, err);
        }
        this.memory.delete(conversationId);
        if (existing) {
            this.memoryUserIndex.get(this.getUserId(existing))?.delete(conversationId);
        }
    }
    async listByUser(channelUserId) {
        try {
            const ids = await (0, redisClient_1.getRedisClient)(this.url, this.serviceName).smembers(this.userKey(channelUserId));
            // Filter out ids whose keys have expired (lazy index cleanup).
            const live = [];
            for (const id of ids) {
                if ((await (0, redisClient_1.getRedisClient)(this.url, this.serviceName).exists(this.key(id))) === 1) {
                    live.push(id);
                }
            }
            return live;
        }
        catch (err) {
            this.logFallback("listByUser", channelUserId, err);
            return [...(this.memoryUserIndex.get(channelUserId) ?? [])].filter((id) => this.memory.has(id));
        }
    }
}
exports.RedisConversationStore = RedisConversationStore;
//# sourceMappingURL=conversationStore.js.map