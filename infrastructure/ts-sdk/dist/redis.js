"use strict";
/**
 * Redis client with connection pooling, atomic rate limiting, safe distributed locks,
 * cache invalidation with pub/sub notification, circuit breaker, and cache warming.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedisClient = void 0;
/** Lua script for atomic rate limiting (no race condition). */
const RATE_LIMIT_LUA = `
local key = KEYS[1]
local max = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local current = redis.call('INCR', key)
if current == 1 then
    redis.call('EXPIRE', key, window)
end
if current > max then
    return 0
end
return 1
`;
/** Lua script for safe lock release (only owner can release). */
const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
`;
/** Lua script for pattern-based invalidation with pub/sub notification. */
const INVALIDATE_LUA = `
local deleted = 0
local cursor = "0"
repeat
    local result = redis.call('SCAN', cursor, 'MATCH', KEYS[1], 'COUNT', 100)
    cursor = result[1]
    local keys = result[2]
    for _, key in ipairs(keys) do
        redis.call('DEL', key)
        deleted = deleted + 1
    end
until cursor == "0"
if deleted > 0 then
    redis.call('PUBLISH', '__cache_invalidation__', KEYS[1])
end
return deleted
`;
class RedisClient {
    addr;
    client;
    circuitState = 'closed';
    failureCount = 0;
    successCount = 0;
    lastFailure = 0;
    circuitTimeout = 30_000; // 30s before half-open
    failureThreshold = 5;
    successThreshold = 3;
    constructor(addr) {
        this.addr = addr;
        try {
            const Redis = require('ioredis');
            const [host, port] = addr.split(':');
            this.client = new Redis({
                host,
                port: parseInt(port || '6379'),
                maxRetriesPerRequest: 3,
                retryStrategy: (times) => Math.min(times * 100, 3000),
                lazyConnect: false,
                enableReadyCheck: true,
            });
        }
        catch {
            this.client = null;
        }
    }
    checkCircuit() {
        if (this.circuitState === 'closed')
            return true;
        if (this.circuitState === 'open') {
            if (Date.now() - this.lastFailure >= this.circuitTimeout) {
                this.circuitState = 'half-open';
                return true;
            }
            return false;
        }
        return true; // half-open allows one attempt
    }
    recordSuccess() {
        this.failureCount = 0;
        this.successCount++;
        if (this.circuitState === 'half-open' && this.successCount >= this.successThreshold) {
            this.circuitState = 'closed';
        }
    }
    recordFailure() {
        this.failureCount++;
        this.successCount = 0;
        this.lastFailure = Date.now();
        if (this.failureCount >= this.failureThreshold) {
            this.circuitState = 'open';
        }
    }
    getCircuitState() { return this.circuitState; }
    async ping() {
        if (!this.client)
            throw new Error('Redis not initialized');
        if (!this.checkCircuit())
            throw new Error('Redis circuit breaker is open');
        try {
            await this.client.ping();
            this.recordSuccess();
        }
        catch (e) {
            this.recordFailure();
            throw e;
        }
    }
    async cacheJSON(key, value, ttlSeconds = 300) {
        if (!this.client || !this.checkCircuit())
            return;
        try {
            await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
            this.recordSuccess();
        }
        catch (e) {
            this.recordFailure();
        }
    }
    async getCachedJSON(key) {
        if (!this.client || !this.checkCircuit())
            return null;
        try {
            const data = await this.client.get(key);
            this.recordSuccess();
            return data ? JSON.parse(data) : null;
        }
        catch (e) {
            this.recordFailure();
            return null;
        }
    }
    /** Atomic rate limiting using Lua script (no INCR/EXPIRE race condition). */
    async rateLimit(key, maxRequests, windowSeconds) {
        if (!this.client || !this.checkCircuit())
            return true; // fail open
        try {
            const result = await this.client.eval(RATE_LIMIT_LUA, 1, key, maxRequests, windowSeconds);
            this.recordSuccess();
            return result === 1;
        }
        catch (e) {
            this.recordFailure();
            return true; // fail open
        }
    }
    /** Acquire a distributed lock with unique owner ID (safe release). */
    async acquireLock(key, ttlSeconds = 30) {
        if (!this.client || !this.checkCircuit())
            return null;
        const ownerId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const lockKey = `lock:${key}`;
        try {
            const result = await this.client.set(lockKey, ownerId, 'NX', 'EX', ttlSeconds);
            this.recordSuccess();
            return result === 'OK' ? { key: lockKey, ownerId } : null;
        }
        catch (e) {
            this.recordFailure();
            return null;
        }
    }
    /** Release a lock safely — only the owner can release it. */
    async releaseLock(guard) {
        if (!this.client || !this.checkCircuit())
            return false;
        try {
            const result = await this.client.eval(RELEASE_LOCK_LUA, 1, guard.key, guard.ownerId);
            this.recordSuccess();
            return result === 1;
        }
        catch (e) {
            this.recordFailure();
            return false;
        }
    }
    async publish(channel, message) {
        if (!this.client || !this.checkCircuit())
            return;
        try {
            await this.client.publish(channel, JSON.stringify(message));
            this.recordSuccess();
        }
        catch (e) {
            this.recordFailure();
        }
    }
    /** Invalidate all keys matching pattern and notify via pub/sub. */
    async invalidatePattern(pattern) {
        if (!this.client || !this.checkCircuit())
            return 0;
        try {
            const deleted = await this.client.eval(INVALIDATE_LUA, 1, pattern);
            this.recordSuccess();
            return deleted;
        }
        catch (e) {
            this.recordFailure();
            return 0;
        }
    }
    /** Publish cache invalidation event for cross-service coherence. */
    async publishInvalidation(entityType, entityId) {
        await this.publish('__cache_invalidation__', {
            type: 'cache_invalidation',
            entity_type: entityType,
            entity_id: entityId,
            timestamp: Math.floor(Date.now() / 1000),
        });
    }
    async setKYCGate(userId, allowed, level, ttl = 600) {
        await this.cacheJSON(`kyc:gate:${userId}`, { allowed, level, ts: Math.floor(Date.now() / 1000) }, ttl);
    }
    async getKYCGate(userId) {
        return this.getCachedJSON(`kyc:gate:${userId}`);
    }
    async cachePolicy(policyId, data, ttl = 3600) {
        await this.cacheJSON(`policy:${policyId}`, data, ttl);
    }
    async getCachedPolicy(policyId) {
        return this.getCachedJSON(`policy:${policyId}`);
    }
    async cacheSession(sessionId, data, ttl = 1800) {
        await this.cacheJSON(`session:${sessionId}`, data, ttl);
    }
    async getSession(sessionId) {
        return this.getCachedJSON(`session:${sessionId}`);
    }
    /** Warm cache with commonly-accessed entries on startup. */
    async warmCache(entries) {
        let loaded = 0;
        for (const { key, value, ttl } of entries) {
            try {
                await this.cacheJSON(key, value, ttl);
                loaded++;
            }
            catch { /* skip failed entries */ }
        }
        return loaded;
    }
    async close() {
        if (this.client)
            await this.client.quit();
    }
}
exports.RedisClient = RedisClient;
