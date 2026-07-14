"use strict";
/**
 * Keycloak client with token validation, distributed caching with pub/sub invalidation,
 * KYC level extraction, and admin ops.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeycloakClient = void 0;
class KeycloakClient {
    realmUrl;
    clientId;
    clientSecret;
    adminUrl;
    tokenCache = new Map();
    cacheTTL = 300_000; // 5 minutes
    redisClient = null; // Optional Redis for distributed invalidation
    constructor(realmUrl, clientId, clientSecret, adminUrl) {
        this.realmUrl = realmUrl;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.adminUrl = adminUrl;
    }
    /** Attach Redis client for distributed token invalidation across replicas. */
    setRedisClient(redis) {
        this.redisClient = redis;
        this._subscribeToInvalidations();
    }
    _subscribeToInvalidations() {
        if (!this.redisClient?.client)
            return;
        try {
            const Redis = require('ioredis');
            const [host, port] = (this.redisClient.addr || 'localhost:6379').split(':');
            const sub = new Redis({ host, port: parseInt(port || '6379') });
            sub.subscribe('__token_invalidation__');
            sub.on('message', (_channel, message) => {
                try {
                    const { token, user_id } = JSON.parse(message);
                    if (token) {
                        this.tokenCache.delete(token);
                    }
                    if (user_id) {
                        // Invalidate all tokens for this user
                        for (const [k, v] of this.tokenCache) {
                            if (v.claims.sub === user_id) {
                                this.tokenCache.delete(k);
                            }
                        }
                    }
                }
                catch { /* ignore parse errors */ }
            });
        }
        catch { /* Redis not available for subscription */ }
    }
    async ping() {
        const resp = await fetch(`${this.realmUrl}/.well-known/openid-configuration`);
        if (!resp.ok)
            throw new Error(`Keycloak unhealthy: ${resp.status}`);
    }
    async validateToken(token) {
        const cached = this.tokenCache.get(token);
        if (cached && cached.expiresAt > Date.now())
            return cached.claims;
        const resp = await fetch(`${this.realmUrl}/protocol/openid-connect/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
        if (!resp.ok)
            throw new Error(`Token invalid (${resp.status})`);
        const claims = await resp.json();
        this.tokenCache.set(token, { claims, expiresAt: Date.now() + this.cacheTTL });
        // Evict expired entries (limit scan to avoid perf issues)
        let evicted = 0;
        for (const [k, v] of this.tokenCache) {
            if (v.expiresAt <= Date.now()) {
                this.tokenCache.delete(k);
                evicted++;
            }
            if (evicted >= 50)
                break;
        }
        return claims;
    }
    /** Invalidate a specific token across all service replicas via Redis pub/sub. */
    async invalidateToken(token) {
        this.tokenCache.delete(token);
        if (this.redisClient) {
            await this.redisClient.publish('__token_invalidation__', { token, timestamp: Date.now() });
        }
    }
    /** Invalidate all tokens for a user across all replicas (e.g. on password change or revocation). */
    async invalidateUserTokens(userId) {
        for (const [k, v] of this.tokenCache) {
            if (v.claims.sub === userId) {
                this.tokenCache.delete(k);
            }
        }
        if (this.redisClient) {
            await this.redisClient.publish('__token_invalidation__', { user_id: userId, timestamp: Date.now() });
        }
    }
    getKYCLevel(claims) {
        const attrs = claims.attributes;
        if (attrs?.kyc_level !== undefined)
            return Number(attrs.kyc_level);
        if (claims.kyc_level !== undefined)
            return Number(claims.kyc_level);
        return 0;
    }
    async getServiceToken() {
        const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret });
        const resp = await fetch(`${this.realmUrl}/protocol/openid-connect/token`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
        if (!resp.ok)
            throw new Error(`Service token failed (${resp.status})`);
        const data = await resp.json();
        return data.access_token;
    }
    async updateUserKYCLevel(userId, kycLevel) {
        const token = await this.getServiceToken();
        const realm = this.realmUrl.split('/realms/')[1] || 'insurance';
        await fetch(`${this.adminUrl}/admin/realms/${realm}/users/${userId}`, {
            method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ attributes: { kyc_level: [String(kycLevel)] } }),
        });
        // Invalidate cached tokens for this user across all replicas
        await this.invalidateUserTokens(userId);
    }
}
exports.KeycloakClient = KeycloakClient;
