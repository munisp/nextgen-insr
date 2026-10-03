// 2026-10-02 (C2-b11b12): Redis-backed conversation state store (audit B11).
// 2026-10-03 (W8-B3): internals DELEGATED to @insureportal/channel-core's
// RedisConversationStore (extracted from this bot's C2 store during the W8
// triplication audit; same migration as whatsapp-bot W8-B2). This module is
// now a thin telegram-specific adapter:
//   - keeps the bot's ConversationState shape ({chatId, language,
//     lastActive}) — channel-core's generic ConversationState carries
//     channel/member fields this bot does not use;
//   - keeps the bot's wire contract: key prefix "tg:conv:", TTL env var
//     TG_CONVERSATION_TTL_SECONDS, default 86400s (24h — the pre-Redis Map
//     never expired), and the set(state) call signature keyed by
//     state.chatId (a number);
//   - getUserId(state) = String(state.chatId) maintains channel-core's
//     per-user index (listByUser) for support tooling.
// Serialization note (behavior change, internal only): state is now stored as
// one JSON blob per key instead of a hand-rolled Redis HASH. TTL, key prefix,
// and degradation policy (Redis first, loudly-logged throttled in-memory
// fallback only on outage, never written on the happy path) are unchanged.
// Pre-migration HASH keys are unreadable by GET (WRONGTYPE → treated as an
// outage read, state re-created); they expire within the old 24h TTL, so no
// migration is needed (state is ephemeral).
// Log-text note (internal only): the outage fallback log now reads
// "[telegram-bot] REDIS OUTAGE: conversation <op> for <chatId> fell back ..."
// — the word "chat" before the id was dropped to match the channel-core
// message shared with the other bots; the [telegram-bot] label is preserved
// via serviceName.
//
// Vendoring note: channel-core is consumed from vendor/channel-core (built
// dist + package.json) via a file: dependency with install-links=true
// (.npmrc) so this package stays standalone-installable: the Dockerfile build
// context is just telegram-bot/, so file:../packages/channel-core would not
// resolve. Refresh with `npm run sync:channel-core`.
import {
  RedisConversationStore as CoreRedisConversationStore,
  RedisConversationStoreOptions as CoreStoreOptions,
} from "@insureportal/channel-core";

export interface ConversationState {
  chatId: number;
  language: string;
  lastActive: number;
}

/** Default idle timeout: 24h (the pre-Redis Map never expired). */
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export interface ConversationStoreOptions {
  /** Override REDIS_URL (tests point this at an unreachable port). */
  url?: string;
  /** Idle TTL in seconds; env TG_CONVERSATION_TTL_SECONDS, default 86400. */
  ttlSeconds?: number;
  keyPrefix?: string;
}

// 2026-10-03 (W8-B3): composition, not inheritance — the bot's set(state)
// wire contract (keyed by numeric state.chatId) is incompatible with
// channel-core's set(conversationId, state) signature, so subclassing would
// force a lying override. The inner core store is exposed for new call sites
// that want the generic API (delete/listByUser).
export class RedisConversationStore {
  private readonly inner: CoreRedisConversationStore<ConversationState>;

  constructor(opts: ConversationStoreOptions = {}) {
    const coreOpts: CoreStoreOptions<ConversationState> = {
      url: opts.url,
      ttlSeconds:
        opts.ttlSeconds ??
        (Number(process.env.TG_CONVERSATION_TTL_SECONDS) || DEFAULT_TTL_SECONDS),
      keyPrefix: opts.keyPrefix ?? "tg:conv:",
      serviceName: "telegram-bot",
      getUserId: (state) => String(state.chatId),
    };
    this.inner = new CoreRedisConversationStore<ConversationState>(coreOpts);
  }

  get(chatId: number): Promise<ConversationState | null> {
    return this.inner.get(String(chatId));
  }

  /** telegram-bot wire contract: state is keyed by state.chatId. */
  set(state: ConversationState): Promise<void> {
    return this.inner.set(String(state.chatId), state);
  }

  delete(chatId: number): Promise<void> {
    return this.inner.delete(String(chatId));
  }

  /** All conversation ids indexed for a chat (channel-core per-user index). */
  listByUser(chatId: number): Promise<string[]> {
    return this.inner.listByUser(String(chatId));
  }
}
