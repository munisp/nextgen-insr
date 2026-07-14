/**
 * Keycloak client with token validation, distributed caching with pub/sub invalidation,
 * KYC level extraction, and admin ops.
 */

interface TokenCache { claims: Record<string, unknown>; expiresAt: number; }

export class KeycloakClient {
  private realmUrl: string;
  private clientId: string;
  private clientSecret: string;
  private adminUrl: string;
  private tokenCache = new Map<string, TokenCache>();
  private readonly cacheTTL = 300_000; // 5 minutes
  private redisClient: any = null; // Optional Redis for distributed invalidation

  constructor(realmUrl: string, clientId: string, clientSecret: string, adminUrl: string) {
    this.realmUrl = realmUrl;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.adminUrl = adminUrl;
  }

  /** Attach Redis client for distributed token invalidation across replicas. */
  setRedisClient(redis: any): void {
    this.redisClient = redis;
    this._subscribeToInvalidations();
  }

  private _subscribeToInvalidations(): void {
    if (!this.redisClient?.client) return;
    try {
      const Redis = require('ioredis');
      const [host, port] = (this.redisClient.addr || 'localhost:6379').split(':');
      const sub = new Redis({ host, port: parseInt(port || '6379') });
      sub.subscribe('__token_invalidation__');
      sub.on('message', (_channel: string, message: string) => {
        try {
          const { token, user_id } = JSON.parse(message);
          if (token) {
            this.tokenCache.delete(token);
          }
          if (user_id) {
            // Invalidate all tokens for this user
            for (const [k, v] of this.tokenCache) {
              if ((v.claims as any).sub === user_id) {
                this.tokenCache.delete(k);
              }
            }
          }
        } catch (err) { console.error('[keycloak] token invalidation parse error:', err instanceof Error ? err.message : err); }
      });
    } catch (err) { console.error('[keycloak] Redis subscription unavailable:', err instanceof Error ? err.message : err); }
  }

  async ping(): Promise<void> {
    const resp = await fetch(`${this.realmUrl}/.well-known/openid-configuration`);
    if (!resp.ok) throw new Error(`Keycloak unhealthy: ${resp.status}`);
  }

  async validateToken(token: string): Promise<Record<string, unknown>> {
    const cached = this.tokenCache.get(token);
    if (cached && cached.expiresAt > Date.now()) return cached.claims;

    const resp = await fetch(`${this.realmUrl}/protocol/openid-connect/userinfo`, { headers: { Authorization: `Bearer ${token}` } });
    if (!resp.ok) throw new Error(`Token invalid (${resp.status})`);
    const claims = await resp.json() as Record<string, unknown>;
    this.tokenCache.set(token, { claims, expiresAt: Date.now() + this.cacheTTL });

    // Evict expired entries (limit scan to avoid perf issues)
    let evicted = 0;
    for (const [k, v] of this.tokenCache) {
      if (v.expiresAt <= Date.now()) { this.tokenCache.delete(k); evicted++; }
      if (evicted >= 50) break;
    }
    return claims;
  }

  /** Invalidate a specific token across all service replicas via Redis pub/sub. */
  async invalidateToken(token: string): Promise<void> {
    this.tokenCache.delete(token);
    if (this.redisClient) {
      await this.redisClient.publish('__token_invalidation__', { token, timestamp: Date.now() });
    }
  }

  /** Invalidate all tokens for a user across all replicas (e.g. on password change or revocation). */
  async invalidateUserTokens(userId: string): Promise<void> {
    for (const [k, v] of this.tokenCache) {
      if ((v.claims as any).sub === userId) {
        this.tokenCache.delete(k);
      }
    }
    if (this.redisClient) {
      await this.redisClient.publish('__token_invalidation__', { user_id: userId, timestamp: Date.now() });
    }
  }

  getKYCLevel(claims: Record<string, unknown>): number {
    const attrs = claims.attributes as Record<string, unknown> | undefined;
    if (attrs?.kyc_level !== undefined) return Number(attrs.kyc_level);
    if (claims.kyc_level !== undefined) return Number(claims.kyc_level);
    return 0;
  }

  async getServiceToken(): Promise<string> {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret });
    const resp = await fetch(`${this.realmUrl}/protocol/openid-connect/token`, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    if (!resp.ok) throw new Error(`Service token failed (${resp.status})`);
    const data = await resp.json() as Record<string, unknown>;
    return data.access_token as string;
  }

  async updateUserKYCLevel(userId: string, kycLevel: number): Promise<void> {
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
