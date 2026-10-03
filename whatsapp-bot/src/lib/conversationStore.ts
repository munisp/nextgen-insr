// 2026-10-02 (C2-b11b12): Redis-backed conversation state store (audit B11).
// 2026-10-03 (W8-B2): internals DELEGATED to @insureportal/channel-core's
// RedisConversationStore (extracted from this very file during the W8
// triplication audit). This module is now a thin whatsapp-specific adapter:
//   - keeps the bot's ConversationState shape ({phone, intent, step, data,
//     lastActive}) — channel-core's generic ConversationState carries
//     channel/member fields this bot does not use;
//   - keeps the bot's wire contract: key prefix "wa:conv:", TTL env var
//     WA_CONVERSATION_TTL_SECONDS, default 600s (= idle timeout), and the
//     set(state) call signature keyed by state.phone;
//   - getUserId(state) = state.phone maintains channel-core's per-user index
//     (listByUser) for support tooling.
// Serialization note (behavior change, internal only): state is now stored as
// one JSON blob per key instead of a hand-rolled Redis HASH. TTL, key prefix,
// degradation policy (Redis first, loudly-logged throttled in-memory fallback
// only on outage, never written on the happy path) are unchanged. Old HASH
// entries simply expire; no migration needed (state is ephemeral, 10-min TTL).
//
// Vendoring note: channel-core is consumed from vendor/channel-core (built
// dist + package.json) via a file: dependency with install-links=true
// (.npmrc) so this package stays standalone-installable: the Dockerfile build
// context is just whatsapp-bot/, so file:../packages/channel-core would not
// resolve. Refresh with `npm run sync:channel-core`.
import {
  RedisConversationStore as CoreRedisConversationStore,
  RedisConversationStoreOptions as CoreStoreOptions,
} from "@insureportal/channel-core";
import { InsuranceIntent } from "../engine/intent";

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

export interface ConversationStoreOptions {
  /** Override REDIS_URL (tests point this at an unreachable port). */
  url?: string;
  /** Idle TTL in seconds; env WA_CONVERSATION_TTL_SECONDS, default 600. */
  ttlSeconds?: number;
  keyPrefix?: string;
}

// 2026-10-03 (W8-B2): composition, not inheritance — the bot's set(state)
// wire contract (keyed by state.phone) is incompatible with channel-core's
// set(conversationId, state) signature, so subclassing would force a lying
// override. The inner core store is exposed for new call sites that want the
// generic API (delete/listByUser).
export class RedisConversationStore {
  private readonly inner: CoreRedisConversationStore<ConversationState>;

  constructor(opts: ConversationStoreOptions = {}) {
    const coreOpts: CoreStoreOptions<ConversationState> = {
      url: opts.url,
      ttlSeconds:
        opts.ttlSeconds ??
        (Number(process.env.WA_CONVERSATION_TTL_SECONDS) || DEFAULT_TTL_SECONDS),
      keyPrefix: opts.keyPrefix ?? "wa:conv:",
      serviceName: "whatsapp-bot",
      getUserId: (state) => state.phone,
    };
    this.inner = new CoreRedisConversationStore<ConversationState>(coreOpts);
  }

  get(phone: string): Promise<ConversationState | null> {
    return this.inner.get(phone);
  }

  /** whatsapp-bot wire contract: state is keyed by state.phone. */
  set(state: ConversationState): Promise<void> {
    return this.inner.set(state.phone, state);
  }

  delete(phone: string): Promise<void> {
    return this.inner.delete(phone);
  }

  /** All conversation ids indexed for a phone (channel-core per-user index). */
  listByUser(phone: string): Promise<string[]> {
    return this.inner.listByUser(phone);
  }
}
