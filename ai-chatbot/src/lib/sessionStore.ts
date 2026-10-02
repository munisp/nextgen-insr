// 2026-10-02 (C2-b11b12): Redis-backed chat session store (audit B12).
//
// Previously ChatEngine kept `sessions: Map<sessionId, {language, history}>`
// in process memory, so every restart wiped chat history/context. Sessions
// now live in a Redis HASH per session (`chat:session:<sessionId>`) with an
// idle TTL; history is a JSON array capped at HISTORY_CAP entries (oldest
// dropped first) so a long-lived session cannot grow unboundedly.
//
// Degradation policy: session context is availability-critical, not
// identity/funds. Every write attempts Redis FIRST; only on a Redis error do
// we fall back to a per-process in-memory Map with a loud, throttled error
// log. State is never lost silently on the happy path.
import { SupportedLanguage } from "../language/detector";
import { getRedisClient } from "./redisClient";

export interface ChatSession {
  language: SupportedLanguage;
  history: string[];
}

/** History cap — documented bound so Redis values stay small. */
export const HISTORY_CAP = Number(process.env.CHAT_HISTORY_CAP) || 50;

/** Default idle timeout: 24h between messages keeps the session alive. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;
const ERROR_LOG_INTERVAL_MS = 60_000;

export interface SessionStoreOptions {
  /** Override REDIS_URL (tests point this at an unreachable port). */
  url?: string;
  /** Idle TTL in seconds; env CHAT_SESSION_TTL_SECONDS, default 86400. */
  ttlSeconds?: number;
  keyPrefix?: string;
}

export class RedisSessionStore {
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private readonly url?: string;
  /** Degradation fallback only — NOT written on the happy path. */
  private readonly memory = new Map<string, ChatSession>();
  private lastErrorLog = 0;

  constructor(opts: SessionStoreOptions = {}) {
    this.ttlSeconds =
      opts.ttlSeconds ??
      (Number(process.env.CHAT_SESSION_TTL_SECONDS) || DEFAULT_TTL_SECONDS);
    this.keyPrefix = opts.keyPrefix ?? "chat:session:";
    this.url = opts.url;
  }

  private key(sessionId: string): string {
    return `${this.keyPrefix}${sessionId}`;
  }

  private logFallback(op: string, sessionId: string, err: unknown): void {
    const now = Date.now();
    if (now - this.lastErrorLog >= ERROR_LOG_INTERVAL_MS) {
      this.lastErrorLog = now;
      console.error(
        `[ai-chatbot] REDIS OUTAGE: session ${op} for ${sessionId} fell back to ` +
          `in-memory state (lost on restart!): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async get(sessionId: string): Promise<ChatSession | null> {
    try {
      const h = await getRedisClient(this.url).hgetall(this.key(sessionId));
      if (!h || !h.language) return null;
      return {
        language: h.language as SupportedLanguage,
        history: h.history ? (JSON.parse(h.history) as string[]) : [],
      };
    } catch (err) {
      this.logFallback("read", sessionId, err);
      return this.memory.get(sessionId) ?? null;
    }
  }

  async set(sessionId: string, session: ChatSession): Promise<void> {
    // Bound the history array before persisting (cap documented above).
    if (session.history.length > HISTORY_CAP) {
      session.history = session.history.slice(-HISTORY_CAP);
    }
    try {
      await getRedisClient(this.url)
        .multi()
        .hset(this.key(sessionId), {
          language: session.language,
          history: JSON.stringify(session.history),
        })
        .expire(this.key(sessionId), this.ttlSeconds)
        .exec();
      this.memory.delete(sessionId); // happy path: no stale fallback copy
    } catch (err) {
      this.logFallback("write", sessionId, err);
      this.memory.set(sessionId, session);
    }
  }
}
