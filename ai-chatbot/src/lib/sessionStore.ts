// 2026-10-02 (C2-b11b12): Redis-backed chat session store (audit B12).
// 2026-10-03 (W8-B4): internals DELEGATED to @insureportal/channel-core's
// RedisConversationStore (extracted from this service's C2 store during the
// W8 triplication audit; same migration as whatsapp-bot W8-B2 and
// telegram-bot W8-B3). This module is now a thin ai-chatbot-specific adapter:
//   - keeps the service's ChatSession shape ({language, history}) —
//     channel-core's generic ConversationState carries channel/member fields
//     this service does not use;
//   - keeps the wire contract: key prefix "chat:session:", TTL env var
//     CHAT_SESSION_TTL_SECONDS, default 86400s (24h — the pre-Redis Map
//     never expired), and the get/set(sessionId, session) call signature;
//   - keeps HISTORY_CAP enforcement (history bounded oldest-dropped-first)
//     before delegating the write;
//   - HISTORY_CAP itself stays service-local (CHAT_HISTORY_CAP env, default
//     50) — channel-core's store intentionally knows nothing about chat
//     history semantics.
// Serialization note (behavior change, internal only): state is now stored
// as one JSON blob per key instead of a hand-rolled Redis HASH. TTL, key
// prefix, and degradation policy (Redis first, loudly-logged throttled
// in-memory fallback only on outage, never written on the happy path) are
// unchanged. Pre-migration HASH keys are unreadable by GET (WRONGTYPE →
// treated as an outage read, session re-created); they expire within the old
// 24h TTL, so no migration is needed (sessions are ephemeral).
// Log-text note (internal only): the outage fallback log now reads
// "[ai-chatbot] REDIS OUTAGE: conversation <op> for <sessionId> fell back
// ..." — the word "session" became "conversation" to match the channel-core
// message shared with the other bots; the [ai-chatbot] label is preserved
// via serviceName.
// Per-user index note: ChatSession carries no user id (sessions are keyed by
// an opaque sessionId), so the adapter wraps the blob with the sessionId
// internally (getUserId = sessionId) and strips it on read — the public
// ChatSession shape is unchanged. listByUser(sessionId) therefore lists the
// sessions indexed under that id (at most one), kept for parity/support
// tooling.
//
// Vendoring note: channel-core is consumed from vendor/channel-core (built
// dist + package.json) via a file: dependency with install-links=true
// (.npmrc) so this package stays standalone-installable: the Dockerfile build
// context is just ai-chatbot/, so file:../packages/channel-core would not
// resolve. Refresh with `npm run sync:channel-core`.
import {
  RedisConversationStore as CoreRedisConversationStore,
  RedisConversationStoreOptions as CoreStoreOptions,
} from "@insureportal/channel-core";
import { SupportedLanguage } from "../language/detector";

export interface ChatSession {
  language: SupportedLanguage;
  history: string[];
}

/** History cap — documented bound so Redis values stay small. */
export const HISTORY_CAP = Number(process.env.CHAT_HISTORY_CAP) || 50;

/** Default idle timeout: 24h between messages keeps the session alive. */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export interface SessionStoreOptions {
  /** Override REDIS_URL (tests point this at an unreachable port). */
  url?: string;
  /** Idle TTL in seconds; env CHAT_SESSION_TTL_SECONDS, default 86400. */
  ttlSeconds?: number;
  keyPrefix?: string;
}

/** Internal wire blob: ChatSession plus the sessionId for the per-user index. */
type StoredSession = ChatSession & { sessionId: string };

// 2026-10-03 (W8-B4): composition, not inheritance — the adapter owns the
// history-cap and id-wrapping concerns; the inner core store owns Redis
// semantics. The inner store is exposed for new call sites that want the
// generic API (delete/listByUser).
export class RedisSessionStore {
  private readonly inner: CoreRedisConversationStore<StoredSession>;

  constructor(opts: SessionStoreOptions = {}) {
    const coreOpts: CoreStoreOptions<StoredSession> = {
      url: opts.url,
      ttlSeconds:
        opts.ttlSeconds ??
        (Number(process.env.CHAT_SESSION_TTL_SECONDS) || DEFAULT_TTL_SECONDS),
      keyPrefix: opts.keyPrefix ?? "chat:session:",
      serviceName: "ai-chatbot",
      getUserId: (state) => state.sessionId,
    };
    this.inner = new CoreRedisConversationStore<StoredSession>(coreOpts);
  }

  async get(sessionId: string): Promise<ChatSession | null> {
    const stored = await this.inner.get(sessionId);
    if (!stored) return null;
    return { language: stored.language, history: stored.history };
  }

  async set(sessionId: string, session: ChatSession): Promise<void> {
    // Bound the history array before persisting (cap documented above).
    if (session.history.length > HISTORY_CAP) {
      session.history = session.history.slice(-HISTORY_CAP);
    }
    await this.inner.set(sessionId, { ...session, sessionId });
  }

  delete(sessionId: string): Promise<void> {
    return this.inner.delete(sessionId);
  }

  /** Session ids indexed under a user id (channel-core per-user index). */
  listByUser(sessionId: string): Promise<string[]> {
    return this.inner.listByUser(sessionId);
  }
}
