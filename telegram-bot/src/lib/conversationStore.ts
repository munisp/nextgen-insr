// 2026-10-02 (C2-b11b12): Redis-backed conversation state store (audit B11).
//
// Previously ConversationManager kept `states: Map<chatId, ConversationState>`
// in process memory, so every restart wiped per-chat state (language
// preference, last-active). State now lives in a Redis HASH per chat
// (`tg:conv:<chatId>`) with a TTL acting as the conversation idle timeout.
//
// Degradation policy: conversation state is availability-critical, not
// identity/funds. Every write attempts Redis FIRST; only on a Redis error do
// we fall back to a per-process in-memory Map with a loud, throttled error
// log. State is never lost silently on the happy path.
import { getRedisClient } from "./redisClient";

export interface ConversationState {
  chatId: number;
  language: string;
  lastActive: number;
}

/** Default idle timeout: 24h (the pre-Redis Map never expired). */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const ERROR_LOG_INTERVAL_MS = 60_000;

export interface ConversationStoreOptions {
  /** Override REDIS_URL (tests point this at an unreachable port). */
  url?: string;
  /** Idle TTL in seconds; env TG_CONVERSATION_TTL_SECONDS, default 86400. */
  ttlSeconds?: number;
  keyPrefix?: string;
}

export class RedisConversationStore {
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private readonly url?: string;
  /** Degradation fallback only — NOT written on the happy path. */
  private readonly memory = new Map<number, ConversationState>();
  private lastErrorLog = 0;

  constructor(opts: ConversationStoreOptions = {}) {
    this.ttlSeconds =
      opts.ttlSeconds ??
      (Number(process.env.TG_CONVERSATION_TTL_SECONDS) || DEFAULT_TTL_SECONDS);
    this.keyPrefix = opts.keyPrefix ?? "tg:conv:";
    this.url = opts.url;
  }

  private key(chatId: number): string {
    return `${this.keyPrefix}${chatId}`;
  }

  private logFallback(op: string, chatId: number, err: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog >= ERROR_LOG_INTERVAL_MS) {
      this.lastErrorLog = now;
      console.error(
        `[telegram-bot] REDIS OUTAGE: conversation ${op} for chat ${chatId} fell back to ` +
          `in-memory state (lost on restart!): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async get(chatId: number): Promise<ConversationState | null> {
    try {
      const h = await getRedisClient(this.url).hgetall(this.key(chatId));
      if (!h || !h.chatId) return null;
      return {
        chatId: Number(h.chatId),
        language: h.language || "en",
        lastActive: Number(h.lastActive) || 0,
      };
    } catch (err) {
      this.logFallback("read", chatId, err);
      return this.memory.get(chatId) ?? null;
    }
  }

  async set(state: ConversationState): Promise<void> {
    try {
      await getRedisClient(this.url)
        .multi()
        .hset(this.key(state.chatId), {
          chatId: String(state.chatId),
          language: state.language,
          lastActive: String(state.lastActive),
        })
        .expire(this.key(state.chatId), this.ttlSeconds)
        .exec();
      this.memory.delete(state.chatId); // happy path: no stale fallback copy
    } catch (err) {
      this.logFallback("write", state.chatId, err);
      this.memory.set(state.chatId, state);
    }
  }
}
