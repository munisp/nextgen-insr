"use strict";
/**
 * Dapr client with state management, caching (TTL + metadata), pub/sub,
 * service invocation, secrets, and cache-aside pattern.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DaprClient = void 0;
class DaprClient {
    baseUrl;
    stateStore;
    cacheStore;
    pubsubName;
    localCache = new Map();
    localCacheMaxSize = 1000;
    constructor(httpPort = 3500, stateStore = 'statestore', pubsubName = 'pubsub') {
        this.baseUrl = `http://localhost:${httpPort}/v1.0`;
        this.stateStore = stateStore;
        this.cacheStore = 'cachestore'; // Separate Dapr component for caching
        this.pubsubName = pubsubName;
    }
    async ping() {
        const resp = await fetch(`${this.baseUrl}/healthz`);
        if (!resp.ok)
            throw new Error(`Dapr unhealthy: ${resp.status}`);
    }
    // ─── State Management (strong consistency) ───────────────────────────────────
    async saveState(key, value, etag) {
        const item = { key, value };
        if (etag)
            item.etag = etag;
        item.options = { concurrency: 'first-write', consistency: 'strong' };
        await fetch(`${this.baseUrl}/state/${this.stateStore}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([item]),
        });
        // Invalidate local cache on write
        this.localCache.delete(key);
    }
    async getState(key) {
        const resp = await fetch(`${this.baseUrl}/state/${this.stateStore}/${key}`);
        if (!resp.ok)
            return { value: null, etag: '' };
        const etag = resp.headers.get('ETag') || '';
        const value = await resp.json();
        return { value, etag };
    }
    async deleteState(key) {
        await fetch(`${this.baseUrl}/state/${this.stateStore}/${key}`, { method: 'DELETE' });
        this.localCache.delete(key);
    }
    // ─── Caching Layer (TTL-based, eventual consistency) ─────────────────────────
    /** Cache a value with TTL using Dapr state store metadata. */
    async cacheSet(key, value, ttlSeconds = 300) {
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
    async cacheGet(key) {
        // L1: Local in-memory cache
        const local = this._getLocal(key);
        if (local !== null)
            return local;
        // L2: Dapr state store (Redis-backed)
        const resp = await fetch(`${this.baseUrl}/state/${this.stateStore}/cache:${key}`);
        if (!resp.ok)
            return null;
        const value = await resp.json();
        // Populate local cache with remaining TTL estimate
        this._setLocal(key, value, 60);
        return value;
    }
    /** Delete a cached value. */
    async cacheDelete(key) {
        await fetch(`${this.baseUrl}/state/${this.stateStore}/cache:${key}`, { method: 'DELETE' });
        this.localCache.delete(key);
    }
    /** Cache-aside pattern: get from cache, or compute + cache on miss. */
    async cacheAside(key, ttlSeconds, loader) {
        const cached = await this.cacheGet(key);
        if (cached !== null)
            return cached;
        const value = await loader();
        await this.cacheSet(key, value, ttlSeconds);
        return value;
    }
    _setLocal(key, value, ttl) {
        if (this.localCache.size >= this.localCacheMaxSize) {
            // Evict oldest entry
            const first = this.localCache.keys().next().value;
            if (first !== undefined)
                this.localCache.delete(first);
        }
        this.localCache.set(key, { value, cachedAt: Date.now(), ttl: ttl * 1000 });
    }
    _getLocal(key) {
        const entry = this.localCache.get(key);
        if (!entry)
            return null;
        if (Date.now() - entry.cachedAt > entry.ttl) {
            this.localCache.delete(key);
            return null;
        }
        return entry.value;
    }
    // ─── Pub/Sub ─────────────────────────────────────────────────────────────────
    async publishEvent(topic, data) {
        await fetch(`${this.baseUrl}/publish/${this.pubsubName}/${topic}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
        });
    }
    // ─── Service Invocation ──────────────────────────────────────────────────────
    async invokeService(appId, method, data, httpMethod = 'POST') {
        const opts = { method: httpMethod, headers: { 'Content-Type': 'application/json' } };
        if (data && httpMethod !== 'GET')
            opts.body = JSON.stringify(data);
        const resp = await fetch(`${this.baseUrl}/invoke/${appId}/method/${method}`, opts);
        if (!resp.ok)
            throw new Error(`Service invoke failed (${resp.status})`);
        const text = await resp.text();
        return text ? JSON.parse(text) : null;
    }
    // ─── Secrets ─────────────────────────────────────────────────────────────────
    async getSecret(secretStore, secretName) {
        const resp = await fetch(`${this.baseUrl}/secrets/${secretStore}/${secretName}`);
        if (!resp.ok)
            throw new Error(`Secret retrieval failed (${resp.status})`);
        return resp.json();
    }
    // ─── Domain Operations (KYC, Policy, Claims) ────────────────────────────────
    async saveKYCSession(sessionId, data) {
        await this.saveState(`kyc:session:${sessionId}`, { ...data, updated_at: new Date().toISOString() });
    }
    async getKYCSession(sessionId) {
        const { value } = await this.getState(`kyc:session:${sessionId}`);
        return value;
    }
    async publishKYCEvent(eventType, customerId, data) {
        await this.publishEvent('kyc-events', { event_type: eventType, customer_id: customerId, data, timestamp: new Date().toISOString() });
    }
    async savePolicyState(policyId, state) {
        await this.saveState(`policy:${policyId}`, state);
    }
    async saveClaimState(claimId, state) {
        await this.saveState(`claim:${claimId}`, state);
    }
    /** Warm the Dapr cache with commonly-accessed state entries. */
    async warmCache(entries) {
        let loaded = 0;
        for (const { key, loader, ttl } of entries) {
            try {
                const value = await loader();
                await this.cacheSet(key, value, ttl);
                loaded++;
            }
            catch { /* skip failed entries */ }
        }
        return loaded;
    }
}
exports.DaprClient = DaprClient;
