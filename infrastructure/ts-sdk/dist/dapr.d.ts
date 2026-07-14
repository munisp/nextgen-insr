/**
 * Dapr client with state management, caching (TTL + metadata), pub/sub,
 * service invocation, secrets, and cache-aside pattern.
 */
export declare class DaprClient {
    private baseUrl;
    private stateStore;
    private cacheStore;
    private pubsubName;
    private localCache;
    private readonly localCacheMaxSize;
    constructor(httpPort?: number, stateStore?: string, pubsubName?: string);
    ping(): Promise<void>;
    saveState(key: string, value: unknown, etag?: string): Promise<void>;
    getState<T = unknown>(key: string): Promise<{
        value: T | null;
        etag: string;
    }>;
    deleteState(key: string): Promise<void>;
    /** Cache a value with TTL using Dapr state store metadata. */
    cacheSet(key: string, value: unknown, ttlSeconds?: number): Promise<void>;
    /** Get a cached value (checks local first, then Dapr state store). */
    cacheGet<T = unknown>(key: string): Promise<T | null>;
    /** Delete a cached value. */
    cacheDelete(key: string): Promise<void>;
    /** Cache-aside pattern: get from cache, or compute + cache on miss. */
    cacheAside<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T>;
    private _setLocal;
    private _getLocal;
    publishEvent(topic: string, data: unknown): Promise<void>;
    invokeService(appId: string, method: string, data?: unknown, httpMethod?: string): Promise<unknown>;
    getSecret(secretStore: string, secretName: string): Promise<Record<string, string>>;
    saveKYCSession(sessionId: string, data: Record<string, unknown>): Promise<void>;
    getKYCSession(sessionId: string): Promise<Record<string, unknown> | null>;
    publishKYCEvent(eventType: string, customerId: string, data: Record<string, unknown>): Promise<void>;
    savePolicyState(policyId: string, state: Record<string, unknown>): Promise<void>;
    saveClaimState(claimId: string, state: Record<string, unknown>): Promise<void>;
    /** Warm the Dapr cache with commonly-accessed state entries. */
    warmCache(entries: Array<{
        key: string;
        loader: () => Promise<unknown>;
        ttl: number;
    }>): Promise<number>;
}
