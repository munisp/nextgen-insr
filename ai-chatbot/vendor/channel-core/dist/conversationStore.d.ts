/**
 * Minimal conversation store contract. All channel bots need get/set/delete
 * with an idle TTL plus list-by-user (e.g. one member reachable on several
 * channels, or support tooling enumerating a user's conversations).
 */
export interface ConversationStore<TState> {
    get(conversationId: string): Promise<TState | null>;
    set(conversationId: string, state: TState): Promise<void>;
    delete(conversationId: string): Promise<void>;
    /** All conversation ids currently indexed for a channel user. */
    listByUser(channelUserId: string): Promise<string[]>;
}
export interface RedisConversationStoreOptions<TState> {
    /** Override REDIS_URL (tests point this at an unreachable port). */
    url?: string;
    /**
     * Idle TTL in seconds; default from `ttlEnvVar` env, then 600 (the
     * whatsapp-bot pre-Redis in-memory idle timeout).
     */
    ttlSeconds?: number;
    /** Env var consulted for the TTL when ttlSeconds is not passed. */
    ttlEnvVar?: string;
    /** Redis key prefix, e.g. "wa:conv:", "tg:conv:", "chat:session:". */
    keyPrefix?: string;
    /** Service label used in loud degradation logs (fail-closed visibility). */
    serviceName?: string;
    /**
     * Extract the channel-user id from a state object so the store can
     * maintain the per-user index used by listByUser(). Required.
     */
    getUserId: (state: TState) => string;
}
/**
 * Redis-backed store: one JSON blob per conversation key plus a per-user
 * Redis SET (`<keyPrefix>byuser:<userId>`) indexing conversation ids.
 * JSON values (not HASH fields) so arbitrary bot state shapes round-trip
 * unchanged — the bot stores each hand-rolled HASH serialization; that was
 * part of the triplication this package removes.
 */
export declare class RedisConversationStore<TState> implements ConversationStore<TState> {
    private readonly ttlSeconds;
    private readonly keyPrefix;
    private readonly serviceName;
    private readonly url?;
    private readonly getUserId;
    /** Degradation fallback only — NOT written on the happy path. */
    private readonly memory;
    private readonly memoryUserIndex;
    private lastErrorLog;
    constructor(opts: RedisConversationStoreOptions<TState>);
    private key;
    private userKey;
    private logFallback;
    get(conversationId: string): Promise<TState | null>;
    set(conversationId: string, state: TState): Promise<void>;
    delete(conversationId: string): Promise<void>;
    listByUser(channelUserId: string): Promise<string[]>;
}
//# sourceMappingURL=conversationStore.d.ts.map