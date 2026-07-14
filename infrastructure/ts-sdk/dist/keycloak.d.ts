/**
 * Keycloak client with token validation, distributed caching with pub/sub invalidation,
 * KYC level extraction, and admin ops.
 */
export declare class KeycloakClient {
    private realmUrl;
    private clientId;
    private clientSecret;
    private adminUrl;
    private tokenCache;
    private readonly cacheTTL;
    private redisClient;
    constructor(realmUrl: string, clientId: string, clientSecret: string, adminUrl: string);
    /** Attach Redis client for distributed token invalidation across replicas. */
    setRedisClient(redis: any): void;
    private _subscribeToInvalidations;
    ping(): Promise<void>;
    validateToken(token: string): Promise<Record<string, unknown>>;
    /** Invalidate a specific token across all service replicas via Redis pub/sub. */
    invalidateToken(token: string): Promise<void>;
    /** Invalidate all tokens for a user across all replicas (e.g. on password change or revocation). */
    invalidateUserTokens(userId: string): Promise<void>;
    getKYCLevel(claims: Record<string, unknown>): number;
    getServiceToken(): Promise<string>;
    updateUserKYCLevel(userId: string, kycLevel: number): Promise<void>;
}
