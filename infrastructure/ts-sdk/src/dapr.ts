/**
 * Dapr client with state management, caching (TTL + metadata), pub/sub,
 * service invocation, secrets, and cache-aside pattern.
 */

interface CacheEntry<T> {
  value: T;
  cachedAt: number;
  ttl: number;
}

export class DaprClient {
  private baseUrl: string;
  private stateStore: string;
  private cacheStore: string;
  private pubsubName: string;
  private localCache = new Map<string, CacheEntry<unknown>>();
  private readonly localCacheMaxSize = 1000;

  constructor(httpPort: number = 3500, stateStore: string = 'statestore', pubsubName: string = 'pubsub') {
    this.baseUrl = `http://localhost:${httpPort}/v1.0`;
    this.stateStore = stateStore;
    this.cacheStore = 'cachestore'; // Separate Dapr component for caching
    this.pubsubName = pubsubName;
  }

  async ping(): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/healthz`);
    if (!resp.ok) throw new Error(`Dapr unhealthy: ${resp.status}`);
  }

  // ─── State Management (strong consistency) ───────────────────────────────────

  async saveState(key: string, value: unknown, etag?: string): Promise<void> {
    const item: Record<string, unknown> = { key, value };
    if (etag) item.etag = etag;
    item.options = { concurrency: 'first-write', consistency: 'strong' };
    await fetch(`${this.baseUrl}/state/${this.stateStore}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([item]),
    });
    // Invalidate local cache on write
    this.localCache.delete(key);
  }

  async getState<T = unknown>(key: string): Promise<{ value: T | null; etag: string }> {
    const resp = await fetch(`${this.baseUrl}/state/${this.stateStore}/${key}`);
    if (!resp.ok) return { value: null, etag: '' };
    const etag = resp.headers.get('ETag') || '';
    const value = await resp.json() as T;
    return { value, etag };
  }

  async deleteState(key: string): Promise<void> {
    await fetch(`${this.baseUrl}/state/${this.stateStore}/${key}`, { method: 'DELETE' });
    this.localCache.delete(key);
  }

  // ─── Caching Layer (TTL-based, eventual consistency) ─────────────────────────

  /** Cache a value with TTL using Dapr state store metadata. */
  async cacheSet(key: string, value: unknown, ttlSeconds: number = 300): Promise<void> {
    const item = {
      key: `cache:${key}`,
      value,
      metadata: { ttlInSeconds: String(ttlSeconds) },
    };
    await fetch(`${this.baseUrl}/state/${this.stateStore}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([item]),
    });
    // Update local cache
    this._setLocal(key, value, ttlSeconds);
  }

  /** Get a cached value (checks local first, then Dapr state store). */
  async cacheGet<T = unknown>(key: string): Promise<T | null> {
    // L1: Local in-memory cache
    const local = this._getLocal<T>(key);
    if (local !== null) return local;

    // L2: Dapr state store (Redis-backed)
    const resp = await fetch(`${this.baseUrl}/state/${this.stateStore}/cache:${key}`);
    if (!resp.ok) return null;
    const value = await resp.json() as T;
    // Populate local cache with remaining TTL estimate
    this._setLocal(key, value, 60);
    return value;
  }

  /** Delete a cached value. */
  async cacheDelete(key: string): Promise<void> {
    await fetch(`${this.baseUrl}/state/${this.stateStore}/cache:${key}`, { method: 'DELETE' });
    this.localCache.delete(key);
  }

  /** Cache-aside pattern: get from cache, or compute + cache on miss. */
  async cacheAside<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.cacheGet<T>(key);
    if (cached !== null) return cached;
    const value = await loader();
    await this.cacheSet(key, value, ttlSeconds);
    return value;
  }

  private _setLocal(key: string, value: unknown, ttl: number): void {
    if (this.localCache.size >= this.localCacheMaxSize) {
      // Evict oldest entry
      const first = this.localCache.keys().next().value;
      if (first !== undefined) this.localCache.delete(first);
    }
    this.localCache.set(key, { value, cachedAt: Date.now(), ttl: ttl * 1000 });
  }

  private _getLocal<T>(key: string): T | null {
    const entry = this.localCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > entry.ttl) {
      this.localCache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  // ─── Pub/Sub ─────────────────────────────────────────────────────────────────

  async publishEvent(topic: string, data: unknown): Promise<void> {
    await fetch(`${this.baseUrl}/publish/${this.pubsubName}/${topic}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
  }

  // ─── Service Invocation ──────────────────────────────────────────────────────

  async invokeService(appId: string, method: string, data?: unknown, httpMethod: string = 'POST'): Promise<unknown> {
    const opts: RequestInit = { method: httpMethod, headers: { 'Content-Type': 'application/json' } };
    if (data && httpMethod !== 'GET') opts.body = JSON.stringify(data);
    const resp = await fetch(`${this.baseUrl}/invoke/${appId}/method/${method}`, opts);
    if (!resp.ok) throw new Error(`Service invoke failed (${resp.status})`);
    const text = await resp.text();
    return text ? JSON.parse(text) : null;
  }

  // ─── Secrets ─────────────────────────────────────────────────────────────────

  async getSecret(secretStore: string, secretName: string): Promise<Record<string, string>> {
    const resp = await fetch(`${this.baseUrl}/secrets/${secretStore}/${secretName}`);
    if (!resp.ok) throw new Error(`Secret retrieval failed (${resp.status})`);
    return resp.json() as Promise<Record<string, string>>;
  }

  // ─── Domain Operations (KYC, Policy, Claims) ────────────────────────────────

  async saveKYCSession(sessionId: string, data: Record<string, unknown>): Promise<void> {
    await this.saveState(`kyc:session:${sessionId}`, { ...data, updated_at: new Date().toISOString() });
  }

  async getKYCSession(sessionId: string): Promise<Record<string, unknown> | null> {
    const { value } = await this.getState<Record<string, unknown>>(`kyc:session:${sessionId}`);
    return value;
  }

  async publishKYCEvent(eventType: string, customerId: string, data: Record<string, unknown>): Promise<void> {
    await this.publishEvent('kyc-events', { event_type: eventType, customer_id: customerId, data, timestamp: new Date().toISOString() });
  }

  async savePolicyState(policyId: string, state: Record<string, unknown>): Promise<void> {
    await this.saveState(`policy:${policyId}`, state);
  }

  async saveClaimState(claimId: string, state: Record<string, unknown>): Promise<void> {
    await this.saveState(`claim:${claimId}`, state);
  }

  /** Warm the Dapr cache with commonly-accessed state entries. */
  async warmCache(entries: Array<{ key: string; loader: () => Promise<unknown>; ttl: number }>): Promise<number> {
    let loaded = 0;
    for (const { key, loader, ttl } of entries) {
      try {
        const value = await loader();
        await this.cacheSet(key, value, ttl);
        loaded++;
      } catch (err) { console.error('[dapr] cache warmup entry failed:', err instanceof Error ? err.message : err); }
    }
    return loaded;
  }
}
