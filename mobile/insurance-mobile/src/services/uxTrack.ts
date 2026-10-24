/**
 * uxTrack.ts — 2026-10-24 (W11-B2c): member-facing UX instrumentation
 * client, mobile mirror of the web tracker (client/src/lib/uxTrack.ts).
 *
 * Sends to the W11-B2 server surface (server/routers/memberUxEvents.ts →
 * memberUxEvents.track) through the REAL memberTrpc boundary (Bearer +
 * 401 → Keycloak refresh → one retry; fail-closed auth stays server-side):
 *   - sessionId: a CLIENT-GENERATED uuid, lazily minted once per app
 *     install-session and persisted in AsyncStorage (deliberately NOT the
 *     auth session id — server header). Attached at FLUSH time so
 *     trackEvent stays synchronous.
 *   - clientEventId: a fresh uuid per event; the server dedups on
 *     (customerId, clientEventId), so batch retries never double-count.
 *   - Batching: flush when 10 events are queued, or 5s after the first
 *     queued event, or when the app goes to background (the mobile
 *     pagehide equivalent). Each flush sends at most the server batch cap
 *     (20); a failed flush requeues the batch (idempotent server-side) and
 *     backs off until the next event/flush trigger — tracking NEVER breaks
 *     the UX (fail-silent, console.warn only).
 *
 * PII DISCIPLINE (hard rule, mirrors the server zod scrub): fieldName is
 * the field NAME only; metadata is a flat record of at most 20 keys (keys
 * ≤64 chars) with leaf values number | boolean | null | string ≤64 chars.
 * Anything else is DROPPED client-side before send — user-typed values
 * (names, phones, meter numbers, descriptions) must never be passed here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { memberMutation } from './memberTrpc';

/** The full event vocabulary — copy of UX_EVENT_KINDS in
 *  server/routers/memberUxEvents.ts (2026-10-24, W11-B2); the server zod
 *  enum is the source of truth and rejects anything else. */
export const UX_EVENT_KINDS = [
  'form_started',
  'field_edited',
  'prefill_accepted',
  'prefill_overridden',
  'step_abandoned',
  'completed',
  'recommendation_accepted',
  'recommendation_dismissed',
  'recommendation_dismissed_forever',
  // 2026-10-25 (W11-B4b): omnibox NL-intent surface events. The server enum
  // (memberUxEvents.ts UX_EVENT_KINDS) is extended in a separate server
  // batch — until then these kinds are dropped by the server zod enum and
  // the tracker stays fail-silent by contract. Metadata discipline is
  // unchanged: intent TYPE / rail only — never raw text/amounts/identifiers.
  'omnibox_opened',
  'intent_parsed',
  'prefill_applied',
  'clarify_shown',
] as const;
export type UxEventKind = (typeof UX_EVENT_KINDS)[number];

/** Server caps (memberUxEvents.ts UX_EVENTS_BATCH_MAX / metadata scrub). */
const BATCH_MAX = 20;
const FLUSH_AT = 10;
const FLUSH_MS = 5_000;
const SESSION_KEY = 'ux-track-session-id';

export interface UxTrackOptions {
  /** Field NAME only — never a value the member typed. */
  fieldName?: string;
  step?: string;
  metadata?: Record<string, number | boolean | null | string>;
}

interface QueuedEvent {
  clientEventId: string;
  sessionId: string;
  flow: string;
  event: UxEventKind;
  fieldName?: string;
  step?: string;
  metadataJson?: Record<string, number | boolean | null | string>;
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let appStateHooked = false;

function mintUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // 2026-10-24: RFC4122 v4 fallback for Hermes builds without randomUUID;
  // uniqueness here only feeds the idempotency key.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Lazily minted per-install uuid (AsyncStorage-persisted). Read at each
 *  flush — flushes are serialized (see `flushing`), so no double-mint race;
 *  re-reading also self-heals if the store was cleared mid-session. */
async function sessionId(): Promise<string> {
  try {
    const existing = await AsyncStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const minted = mintUuid();
    await AsyncStorage.setItem(SESSION_KEY, minted);
    return minted;
  } catch {
    // Storage unavailable — a per-flush id is still truthful; never break
    // UX for tracking.
    return mintUuid();
  }
}

/**
 * Client-side metadata scrub (defense in depth; the server enforces the
 * same rule): flat record, ≤20 keys, keys ≤64 chars, leaf values
 * number|boolean|null|string ≤64 chars. Non-conforming entries are DROPPED.
 */
function scrubMetadata(
  metadata: Record<string, number | boolean | null | string> | undefined,
): QueuedEvent['metadataJson'] {
  if (!metadata) return undefined;
  const out: Record<string, number | boolean | null | string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (Object.keys(out).length >= 20) break;
    if (!k || k.length > 64) continue;
    if (typeof v === 'number' || typeof v === 'boolean' || v === null) {
      out[k] = v;
    } else if (typeof v === 'string' && v.length <= 64) {
      out[k] = v;
    }
    // anything else (objects, long strings) is dropped silently.
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Queue one event. Fail-silent by contract. */
export function trackEvent(
  flow: string,
  event: UxEventKind,
  opts: UxTrackOptions = {},
): void {
  try {
    ensureAppStateHook();
    queue.push({
      clientEventId: mintUuid(),
      sessionId: '', // attached at flush time (AsyncStorage is async)
      flow,
      event,
      ...(opts.fieldName ? { fieldName: opts.fieldName } : {}),
      ...(opts.step ? { step: opts.step } : {}),
      ...(scrubMetadata(opts.metadata)
        ? { metadataJson: scrubMetadata(opts.metadata) }
        : {}),
    });
    if (queue.length >= FLUSH_AT) {
      void flushUxQueue();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => void flushUxQueue(), FLUSH_MS);
    }
  } catch (err) {
    console.warn('uxTrack: event dropped', err);
  }
}

/** Flush up to one server-sized batch via the REAL memberTrpc boundary.
 *  Requeues on failure (the server dedups per clientEventId, so a retry
 *  never double-counts) and does NOT auto-reschedule — the next event or
 *  background transition retries. */
export async function flushUxQueue(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (flushing || queue.length === 0) return;
  flushing = true;
  const sid = await sessionId();
  const batch = queue.slice(0, BATCH_MAX).map((e) => ({ ...e, sessionId: sid }));
  let sent = false;
  try {
    await memberMutation('memberUxEvents.track', { events: batch });
    sent = true;
  } catch (err) {
    console.warn('uxTrack: batch send failed (will retry on next event)', err);
  } finally {
    // 2026-10-24: the flush guard is released ONLY here — never recurse
    // from inside the try (an early `return flush()` there would clear the
    // guard via this finally while the inner flush is still in flight and
    // double-send the pending batch).
    flushing = false;
  }
  if (!sent) return; // batch stays queued; next event/background retries
  queue = queue.slice(batch.length);
  if (queue.length >= FLUSH_AT) {
    // More than one batch is pending — keep draining.
    return flushUxQueue();
  }
  if (queue.length > 0 && !flushTimer) {
    flushTimer = setTimeout(() => void flushUxQueue(), FLUSH_MS);
  }
}

/** Flush when the app backgrounds — the mobile pagehide equivalent. */
function ensureAppStateHook(): void {
  if (appStateHooked) return;
  appStateHooked = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'background' || state === 'inactive') {
      void flushUxQueue();
    }
  });
}
