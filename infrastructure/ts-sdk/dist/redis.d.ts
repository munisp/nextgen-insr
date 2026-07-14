/**
 * Redis client with connection pooling, atomic rate limiting, safe distributed locks,
 * cache invalidation with pub/sub notification, circuit breaker, and cache warming.
 */
export interface LockGuard {
    key: string;
    ownerId: string;
}
type CircuitState = 'closed' | 'open' | 'half-open';
export declare class RedisClient {
    private addr;
    private client;
    private circuitState;
    private failureCount;
    private successCount;
    private lastFailure;
    private readonly circuitTimeout;
    private readonly failureThreshold;
    private readonly successThreshold;
    constructor(addr: string);
    private checkCircuit;
    private recordSuccess;
    private recordFailure;
    getCircuitState(): CircuitState;
    ping(): Promise<void>;
    cacheJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
    getCachedJSON<T = unknown>(key: string): Promise<T | null>;
    /** Atomic rate limiting using Lua script (no INCR/EXPIRE race condition). */
    rateLimit(key: string, maxRequests: number, windowSeconds: number): Promise<boolean>;
    /** Acquire a distributed lock with unique owner ID (safe release). */
    acquireLock(key: string, ttlSeconds?: number): Promise<LockGuard | null>;
    /** Release a lock safely — only the owner can release it. */
    releaseLock(guard: LockGuard): Promise<boolean>;
    publish(channel: string, message: unknown): Promise<void>;
    /** Invalidate all keys matching pattern and notify via pub/sub. */
    invalidatePattern(pattern: string): Promise<number>;
    /** Publish cache invalidation event for cross-service coherence. */
    publishInvalidation(entityType: string, entityId: string): Promise<void>;
    setKYCGate(userId: string, allowed: boolean, level: number, ttl?: number): Promise<void>;
    getKYCGate(userId: string): Promise<{
        allowed: boolean;
        level: number;
    } | null>;
    cachePolicy(policyId: string, data: Record<string, unknown>, ttl?: number): Promise<void>;
    getCachedPolicy(policyId: string): Promise<Record<string, unknown> | null>;
    cacheSession(sessionId: string, data: Record<string, unknown>, ttl?: number): Promise<void>;
    getSession(sessionId: string): Promise<Record<string, unknown> | null>;
    /** Warm cache with commonly-accessed entries on startup. */
    warmCache(entries: Array<{
        key: string;
        value: unknown;
        ttl: number;
    }>): Promise<number>;
    close(): Promise<void>;
}
export {};
