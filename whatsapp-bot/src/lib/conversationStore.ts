// 2026-10-02 (C2-b11b12): Redis-backed conversation state store (audit B11).
//
// Previously ConversationEngine kept `states: Map<phone, ConversationState>`
// in process memory, so every restart wiped users' multi-step conversations
// (e.g. mid-claim). State now lives in a Redis HASH per phone
// (`wa:conv:<phone>`) with a TTL equal to the conversation idle timeout, so:
//   - a bot restart no longer loses an in-progress conversation;
//   - idle conversations still expire exactly as before.
//
// Degradation policy: conversation state is availability-critical, not
// identity/funds. Every write attempts Redis FIRST; only on a Redis error do
// we fall back to a per-process in-memory Map with a loud, throttled error
// log. State is never lost silently on the happy path.
import { InsuranceIntent } from "../engine/intent";
import { getRedisClient } from "./redisClient";

export interface ConversationState {
  phone: string;
  intent: InsuranceIntent | null;
  step: number;
  data: Record<string, string>;
  lastActive: number;
}

/** Idle timeout — unchanged from the pre-Redis in-memory behavior (10 min). */
export const CONVERSATION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

const DEFAULT_TTL_SECONDS = Math.ceil(CONVERSATION_IDLE_TIMEOUT_MS / 1000);
const ERROR_LOG_INTERVAL_MS = 60_000;

export interface ConversationStoreOptions {
  /** Override REDIS_URL (tests point this at an unreachable port). */
  url?: string;
  /** Idle TTL in seconds; env WA_CONVERSATION_TTL_SECONDS, default 600. */
  ttlSeconds?: number;
  keyPrefix?: string;
}

export class RedisConversationStore {
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private readonly url?: string;
  /** Degradation fallback only — NOT written on the happy path. */
  private readonly memory = new Map<string, ConversationState>();
  private lastErrorLog = 0;

  constructor(opts: ConversationStoreOptions = {}) {
    this.ttlSeconds =
      opts.ttlSeconds ??
      (Number(process.env.WA_CONVERSATION_TTL_SECONDS) || DEFAULT_TTL_SECONDS);
    this.keyPrefix = opts.keyPrefix ?? "wa:conv:";
    this.url = opts.url;
  }

  private key(phone: string): string {
    return `${this.keyPrefix}${phone}`;
  }

  private logFallback(op: string, phone: string, err: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog >= ERROR_LOG_INTERVAL_MS) {
      this.lastErrorLog = now;
      console.error(
        `[whatsapp-bot] REDIS OUTAGE: conversation ${op} for ${phone} fell back to ` +
          `in-memory state (lost on restart!): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async get(phone: string): Promise<ConversationState | null> {
    try {
      const h = await getRedisClient(this.url).hgetall(this.key(phone));
      if (!h || !h.phone) return null;
      return {
        phone: h.phone,
        intent: (h.intent || null) as InsuranceIntent | null,
        step: Number(h.step) || 0,
        data: h.data ? (JSON.parse(h.data) as Record<string, string>) : {},
        lastActive: Number(h.lastActive) || 0,
      };
    } catch (err) {
      this.logFallback("read", phone, err);
      return this.memory.get(phone) ?? null;
    }
  }

  async set(state: ConversationState): Promise<void> {
    try {
      await getRedisClient(this.url)
        .multi()
        .hset(this.key(state.phone), {
          phone: state.phone,
          intent: state.intent ?? "",
          step: String(state.step),
          data: JSON.stringify(state.data),
          lastActive: String(state.lastActive),
        })
        .expire(this.key(state.phone), this.ttlSeconds)
        .exec();
      this.memory.delete(state.phone); // happy path: no stale fallback copy
    } catch (err) {
      this.logFallback("write", state.phone, err);
      this.memory.set(state.phone, state);
    }
  }
}
