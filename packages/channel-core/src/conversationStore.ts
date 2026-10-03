// 2026-10-03 (W8-B1): Generic conversation store interface + Redis-backed
// implementation, extracted from the three near-identical bot stores:
//   whatsapp-bot/src/lib/conversationStore.ts (RedisConversationStore)
//   telegram-bot/src/lib/conversationStore.ts (RedisConversationStore)
//   ai-chatbot/src/lib/sessionStore.ts      (RedisSessionStore)
//
// Degradation policy (unchanged from C2-b11b12): conversation state is
// availability-critical, not identity/funds. Every write attempts Redis
// FIRST; only on a Redis error do we fall back to a per-process in-memory
// Map with a loud, throttled error log. State is never lost silently on the
// happy path, and the fallback is never written on the happy path (so a
// healed Redis does not serve stale copies).
import { getRedisClient } from "./redisClient";

const ERROR_LOG_INTERVAL_MS = 60_000;

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
export class RedisConversationStore<TState>
  implements ConversationStore<TState>
{
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private readonly serviceName: string;
  private readonly url?: string;
  private readonly getUserId: (state: TState) => string;
  /** Degradation fallback only — NOT written on the happy path. */
  private readonly memory = new Map<string, TState>();
  private readonly memoryUserIndex = new Map<string, Set<string>>();
  private lastErrorLog = 0;

  constructor(opts: RedisConversationStoreOptions<TState>) {
    if (typeof opts.getUserId !== "function") {
      // Fail-fast at construction: without a user-id extractor the
      // listByUser index would silently be wrong.
      throw new Error(
        "RedisConversationStore requires a getUserId(state) extractor"
      );
    }
    this.ttlSeconds =
      opts.ttlSeconds ??
      (Number(opts.ttlEnvVar ? process.env[opts.ttlEnvVar] : undefined) || 600);
    this.keyPrefix = opts.keyPrefix ?? "channel:conv:";
    this.serviceName = opts.serviceName ?? "channel-core";
    this.url = opts.url;
    this.getUserId = opts.getUserId;
  }

  private key(conversationId: string): string {
    return `${this.keyPrefix}${conversationId}`;
  }

  private userKey(channelUserId: string): string {
    return `${this.keyPrefix}byuser:${channelUserId}`;
  }

  private logFallback(op: string, conversationId: string, err: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog >= ERROR_LOG_INTERVAL_MS) {
      this.lastErrorLog = now;
      console.error(
        `[${this.serviceName}] REDIS OUTAGE: conversation ${op} for ${conversationId} fell back to ` +
          `in-memory state (lost on restart!): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async get(conversationId: string): Promise<TState | null> {
    try {
      const raw = await getRedisClient(this.url, this.serviceName).get(
        this.key(conversationId)
      );
      if (!raw) return null;
      return JSON.parse(raw) as TState;
    } catch (err) {
      this.logFallback("read", conversationId, err);
      return this.memory.get(conversationId) ?? null;
    }
  }

  async set(conversationId: string, state: TState): Promise<void> {
    const userId = this.getUserId(state);
    try {
      await getRedisClient(this.url, this.serviceName)
        .multi()
        .set(this.key(conversationId), JSON.stringify(state), "EX", this.ttlSeconds)
        .sadd(this.userKey(userId), conversationId)
        .expire(this.userKey(userId), this.ttlSeconds)
        .exec();
      this.memory.delete(conversationId); // happy path: no stale fallback copy
      this.memoryUserIndex.get(userId)?.delete(conversationId);
    } catch (err) {
      this.logFallback("write", conversationId, err);
      this.memory.set(conversationId, state);
      let set = this.memoryUserIndex.get(userId);
      if (!set) {
        set = new Set<string>();
        this.memoryUserIndex.set(userId, set);
      }
      set.add(conversationId);
    }
  }

  async delete(conversationId: string): Promise<void> {
    // Read first (best effort) so the per-user index entry can be removed.
    const existing = await this.get(conversationId);
    try {
      const client = getRedisClient(this.url, this.serviceName);
      const multi = client.multi().del(this.key(conversationId));
      if (existing) multi.srem(this.userKey(this.getUserId(existing)), conversationId);
      await multi.exec();
    } catch (err) {
      this.logFallback("delete", conversationId, err);
    }
    this.memory.delete(conversationId);
    if (existing) {
      this.memoryUserIndex.get(this.getUserId(existing))?.delete(conversationId);
    }
  }

  async listByUser(channelUserId: string): Promise<string[]> {
    try {
      const ids = await getRedisClient(this.url, this.serviceName).smembers(
        this.userKey(channelUserId)
      );
      // Filter out ids whose keys have expired (lazy index cleanup).
      const live: string[] = [];
      for (const id of ids) {
        if ((await getRedisClient(this.url, this.serviceName).exists(this.key(id))) === 1) {
          live.push(id);
        }
      }
      return live;
    } catch (err) {
      this.logFallback("listByUser", channelUserId, err);
      return [...(this.memoryUserIndex.get(channelUserId) ?? [])].filter((id) =>
        this.memory.has(id)
      );
    }
  }
}
