/**
 * Redis client with connection pooling, atomic rate limiting, safe distributed locks,
 * cache invalidation with pub/sub notification, circuit breaker, and cache warming.
 */

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

export interface LockGuard {
  key: string;
  ownerId: string;
}

type CircuitState = 'closed' | 'open' | 'half-open';

export class RedisClient {
  private addr: string;
  private client: any;
  private circuitState: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailure = 0;
  private readonly circuitTimeout = 30_000; // 30s before half-open
  private readonly failureThreshold = 5;
  private readonly successThreshold = 3;

  constructor(addr: string) {
    this.addr = addr;
    try {
      const Redis = require('ioredis');
      const [host, port] = addr.split(':');
      this.client = new Redis({
        host,
        port: parseInt(port || '6379'),
        maxRetriesPerRequest: 3,
        retryStrategy: (times: number) => Math.min(times * 100, 3000),
        lazyConnect: false,
        enableReadyCheck: true,
      });
    } catch (err) { console.error('[redis] connection failed:', err instanceof Error ? err.message : err); this.client = null; }
  }

  private checkCircuit(): boolean {
    if (this.circuitState === 'closed') return true;
    if (this.circuitState === 'open') {
      if (Date.now() - this.lastFailure >= this.circuitTimeout) {
        this.circuitState = 'half-open';
        return true;
      }
      return false;
    }
    return true; // half-open allows one attempt
  }

  private recordSuccess(): void {
    this.failureCount = 0;
    this.successCount++;
    if (this.circuitState === 'half-open' && this.successCount >= this.successThreshold) {
      this.circuitState = 'closed';
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    this.successCount = 0;
    this.lastFailure = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.circuitState = 'open';
    }
  }

  getCircuitState(): CircuitState { return this.circuitState; }

  async ping(): Promise<void> {
    if (!this.client) throw new Error('Redis not initialized');
    if (!this.checkCircuit()) throw new Error('Redis circuit breaker is open');
    try {
      await this.client.ping();
      this.recordSuccess();
    } catch (e) {
      this.recordFailure();
      throw e;
    }
  }

  async cacheJSON(key: string, value: unknown, ttlSeconds: number = 300): Promise<void> {
    if (!this.client || !this.checkCircuit()) return;
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
      this.recordSuccess();
    } catch (e) {
      this.recordFailure();
    }
  }

  async getCachedJSON<T = unknown>(key: string): Promise<T | null> {
    if (!this.client || !this.checkCircuit()) return null;
    try {
      const data = await this.client.get(key);
      this.recordSuccess();
      return data ? JSON.parse(data) : null;
    } catch (e) {
      this.recordFailure();
      return null;
    }
  }

  /** Atomic rate limiting using Lua script (no INCR/EXPIRE race condition). */
  async rateLimit(key: string, maxRequests: number, windowSeconds: number): Promise<boolean> {
    if (!this.client || !this.checkCircuit()) return true; // fail open
    try {
      const result = await this.client.eval(RATE_LIMIT_LUA, 1, key, maxRequests, windowSeconds);
      this.recordSuccess();
      return result === 1;
    } catch (e) {
      this.recordFailure();
      return true; // fail open
    }
  }

  /** Acquire a distributed lock with unique owner ID (safe release). */
  async acquireLock(key: string, ttlSeconds: number = 30): Promise<LockGuard | null> {
    if (!this.client || !this.checkCircuit()) return null;
    const ownerId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const lockKey = `lock:${key}`;
    try {
      const result = await this.client.set(lockKey, ownerId, 'NX', 'EX', ttlSeconds);
      this.recordSuccess();
      return result === 'OK' ? { key: lockKey, ownerId } : null;
    } catch (e) {
      this.recordFailure();
      return null;
    }
  }

  /** Release a lock safely — only the owner can release it. */
  async releaseLock(guard: LockGuard): Promise<boolean> {
    if (!this.client || !this.checkCircuit()) return false;
    try {
      const result = await this.client.eval(RELEASE_LOCK_LUA, 1, guard.key, guard.ownerId);
      this.recordSuccess();
      return result === 1;
    } catch (e) {
      this.recordFailure();
      return false;
    }
  }

  async publish(channel: string, message: unknown): Promise<void> {
    if (!this.client || !this.checkCircuit()) return;
    try {
      await this.client.publish(channel, JSON.stringify(message));
      this.recordSuccess();
    } catch (e) {
      this.recordFailure();
    }
  }

  /** Invalidate all keys matching pattern and notify via pub/sub. */
  async invalidatePattern(pattern: string): Promise<number> {
    if (!this.client || !this.checkCircuit()) return 0;
    try {
      const deleted = await this.client.eval(INVALIDATE_LUA, 1, pattern);
      this.recordSuccess();
      return deleted as number;
    } catch (e) {
      this.recordFailure();
      return 0;
    }
  }

  /** Publish cache invalidation event for cross-service coherence. */
  async publishInvalidation(entityType: string, entityId: string): Promise<void> {
    await this.publish('__cache_invalidation__', {
      type: 'cache_invalidation',
      entity_type: entityType,
      entity_id: entityId,
      timestamp: Math.floor(Date.now() / 1000),
    });
  }

  async setKYCGate(userId: string, allowed: boolean, level: number, ttl: number = 600): Promise<void> {
    await this.cacheJSON(`kyc:gate:${userId}`, { allowed, level, ts: Math.floor(Date.now() / 1000) }, ttl);
  }

  async getKYCGate(userId: string): Promise<{ allowed: boolean; level: number } | null> {
    return this.getCachedJSON(`kyc:gate:${userId}`);
  }

  async cachePolicy(policyId: string, data: Record<string, unknown>, ttl: number = 3600): Promise<void> {
    await this.cacheJSON(`policy:${policyId}`, data, ttl);
  }

  async getCachedPolicy(policyId: string): Promise<Record<string, unknown> | null> {
    return this.getCachedJSON(`policy:${policyId}`);
  }

  async cacheSession(sessionId: string, data: Record<string, unknown>, ttl: number = 1800): Promise<void> {
    await this.cacheJSON(`session:${sessionId}`, data, ttl);
  }

  async getSession(sessionId: string): Promise<Record<string, unknown> | null> {
    return this.getCachedJSON(`session:${sessionId}`);
  }

  /** Warm cache with commonly-accessed entries on startup. */
  async warmCache(entries: Array<{ key: string; value: unknown; ttl: number }>): Promise<number> {
    let loaded = 0;
    for (const { key, value, ttl } of entries) {
      try {
        await this.cacheJSON(key, value, ttl);
        loaded++;
      } catch (err) { console.error('[redis] cache warmup entry failed:', err instanceof Error ? err.message : err); }
    }
    return loaded;
  }

  async close(): Promise<void> {
    if (this.client) await this.client.quit();
  }
}
