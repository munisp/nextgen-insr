/**
 * uxTrack.ts — 2026-10-24 (W11-B2c): member-facing UX instrumentation
 * client (member-intelligence program, Phase 2 client side).
 *
 * Thin, fail-silent tracker over the W11-B2 server surface
 * (server/routers/memberUxEvents.ts → memberUxEvents.track):
 *   - sessionId: a CLIENT-GENERATED uuid, lazily minted once per browser
 *     session and persisted in sessionStorage (deliberately NOT the auth
 *     session id — server header).
 *   - clientEventId: a fresh uuid per event; the server dedups on
 *     (customerId, clientEventId), so batch retries never double-count.
 *   - Batching: flush when 10 events are queued, or 5s after the first
 *     queued event, or on pagehide/unmount. Each flush sends at most the
 *     server batch cap (20); a failed flush requeues the batch (idempotent
 *     server-side) and backs off until the next event/flush trigger —
 *     tracking NEVER breaks the UX (fail-silent, console.warn only).
 *
 * PII DISCIPLINE (hard rule, mirrors the server zod scrub): fieldName is
 * the field NAME only; metadata is a flat record of at most 20 keys (keys
 * ≤64 chars) with leaf values number | boolean | null | string ≤64 chars.
 * Anything else is DROPPED client-side before send — user-typed values
 * (names, phones, meter numbers, descriptions) must never be passed here.
 *
 * Wiring: a member page (MemberLayout) calls useUxTracking() once so the
 * tracker sends through the REAL tRPC client inside the provider tree;
 * individual surfaces then call trackEvent(...). Without a registered
 * sender the queue simply waits (no crash, no fabricated transport).
 */
import { useEffect, useRef } from "react";
import { trpc } from "@/lib/trpc";

/** The full event vocabulary — copy of UX_EVENT_KINDS in
 *  server/routers/memberUxEvents.ts (2026-10-24, W11-B2); the server zod
 *  enum is the source of truth and rejects anything else. */
export const UX_EVENT_KINDS = [
  "form_started",
  "field_edited",
  "prefill_accepted",
  "prefill_overridden",
  "step_abandoned",
  "completed",
  "recommendation_accepted",
  "recommendation_dismissed",
  "recommendation_dismissed_forever",
  // 2026-10-25 (W11-B4b): omnibox NL-intent surface events. ACCEPTED
  // server-side since the B4c-1 batch (memberUxEvents.ts UX_EVENT_KINDS,
  // merged PR #304, 2026-10-25) — see SERVER_ACCEPTED_KINDS below. Metadata
  // discipline unchanged: intent TYPE / rail only — never raw text,
  // amounts, or identifiers.
  "omnibox_opened",
  "intent_parsed",
  "prefill_applied",
  "clarify_shown",
  // 2026-10-25 (W11-B4c-2): bill-scan intake funnel events (ScanBillButton,
  // flow "bill_scan"). CLIENT-side vocabulary ahead of the server — the
  // server zod enum does NOT accept these yet, so they are dropped
  // fail-silently at the enqueue boundary (isServerAcceptedKind), exactly
  // the pre-B4c-1 omnibox pattern. The server already records its own
  // privacy-minimal bill_scan telemetry row per attempt
  // (memberBillScan.ts recordOutcome), so no funnel data is lost. WHEN the
  // server enum accepts them: add them to SERVER_ACCEPTED_KINDS below.
  "scan_started",
  "scan_succeeded",
  "scan_failed",
] as const;
export type UxEventKind = (typeof UX_EVENT_KINDS)[number];

// ── Server-accepted kinds (2026-10-25, W11-B4c-2 update) ─────────────────
// The tRPC mutation input type is inferred from the SERVER zod schema
// (memberUxEvents.track), whose event enum is the source of truth. As of
// the merged W11-B4c-1 batch (PR #304, 2026-10-25) the server enum ACCEPTS
// the 4 omnibox kinds, so they are listed below and now flow through the
// normal queue/flush path — the old "excludes them / dropped at the
// enqueue boundary" behavior applied only pre-B4c-1. The _AllListedKinds-
// AreServerAccepted tripwire below proves every listed kind is inside the
// server's enum. The W11-B4c-2 scan_* kinds are NOT yet server-accepted
// and stay unlisted (dropped fail-silently at enqueue) until a server
// batch extends the enum.
type TrackMutationInput = Parameters<
  ReturnType<typeof trpc.memberUxEvents.track.useMutation>["mutate"]
>[0];
/** Event-kind union the server's zod enum accepts (inferred, not copied). */
export type ServerAcceptedKind =
  TrackMutationInput["events"][number]["event"];

/** The kinds the server accepts on main today (post-B4c-1, PR #304,
 *  2026-10-25): the original W11-B2 nine PLUS the 4 omnibox kinds.
 *  Every entry is compile-time-checked against ServerAcceptedKind below. */
const SERVER_ACCEPTED_KINDS = [
  "form_started",
  "field_edited",
  "prefill_accepted",
  "prefill_overridden",
  "step_abandoned",
  "completed",
  "recommendation_accepted",
  "recommendation_dismissed",
  "recommendation_dismissed_forever",
  "omnibox_opened",
  "intent_parsed",
  "prefill_applied",
  "clarify_shown",
] as const;

/** Compile-time tripwire: a listed kind the server rejects fails the build. */
type _AllListedKindsAreServerAccepted =
  (typeof SERVER_ACCEPTED_KINDS)[number] extends ServerAcceptedKind
    ? true
    : "SERVER_ACCEPTED_KINDS lists a kind the server enum rejects";
const _listedKindsAreAccepted: _AllListedKindsAreServerAccepted = true;

/** Lookup set keyed by string — no narrowing cast needed. */
const SERVER_ACCEPTED_SET: ReadonlySet<string> = new Set(SERVER_ACCEPTED_KINDS);

/** Type guard: true iff the server's zod enum accepts this kind TODAY. */
function isServerAcceptedKind(kind: UxEventKind): kind is ServerAcceptedKind {
  return SERVER_ACCEPTED_SET.has(kind);
}

/** Server caps (memberUxEvents.ts UX_EVENTS_BATCH_MAX / metadata scrub). */
const BATCH_MAX = 20;
const FLUSH_AT = 10;
const FLUSH_MS = 5_000;
const SESSION_KEY = "ux-track-session-id";

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
  /** Only server-accepted kinds are ever queued (see isServerAcceptedKind). */
  event: ServerAcceptedKind;
  fieldName?: string;
  step?: string;
  metadataJson?: Record<string, number | boolean | null | string>;
}

type UxBatchSender = (
  events: QueuedEvent[]
) => Promise<{ accepted?: number; duplicates?: number } | unknown>;

let queue: QueuedEvent[] = [];
let sender: UxBatchSender | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;

function mintUuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // 2026-10-24: RFC4122 v4 fallback for runtimes without randomUUID (older
  // WebViews); uniqueness here only feeds the idempotency key.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, ch => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** Lazily minted per-browser-session uuid (sessionStorage-persisted). */
function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const minted = mintUuid();
    sessionStorage.setItem(SESSION_KEY, minted);
    return minted;
  } catch {
    // Storage unavailable (private mode etc.) — a per-page-load id is
    // still truthful; never break UX for tracking.
    return mintUuid();
  }
}

/**
 * Client-side metadata scrub (defense in depth; the server enforces the
 * same rule): flat record, ≤20 keys, keys ≤64 chars, leaf values
 * number|boolean|null|string ≤64 chars. Non-conforming entries are DROPPED.
 */
function scrubMetadata(
  metadata: Record<string, number | boolean | null | string> | undefined
): QueuedEvent["metadataJson"] {
  if (!metadata) return undefined;
  const out: Record<string, number | boolean | null | string> = {};
  for (const [k, v] of Object.entries(metadata)) {
    if (Object.keys(out).length >= 20) break;
    if (!k || k.length > 64) continue;
    if (typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
    } else if (typeof v === "string" && v.length <= 64) {
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
  opts: UxTrackOptions = {}
): void {
  try {
    // Explicit, typed drop at the ENQUEUE boundary for kinds the server's
    // zod enum does not accept yet (today: only the W11-B4c-2 scan_*
    // kinds — the omnibox kinds are accepted since B4c-1 / PR #304,
    // 2026-10-25). A dropped event is never queued — an undeliverable
    // event would otherwise be requeued forever and poison the batch for
    // the accepted kinds it travels with.
    if (!isServerAcceptedKind(event)) {
      return;
    }
    queue.push({
      clientEventId: mintUuid(),
      sessionId: sessionId(),
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
    console.warn("uxTrack: event dropped", err);
  }
}

/** Flush up to one server-sized batch. Requeues on failure (the server
 *  dedups per clientEventId, so a retry never double-counts) and does NOT
 *  auto-reschedule — the next event/pagehide retries. */
export async function flushUxQueue(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (flushing || queue.length === 0 || !sender) return;
  flushing = true;
  const batch = queue.slice(0, BATCH_MAX);
  let sent = false;
  try {
    await sender(batch);
    sent = true;
  } catch (err) {
    console.warn("uxTrack: batch send failed (will retry on next event)", err);
  } finally {
    // 2026-10-24: the flush guard is released ONLY here — never recurse
    // from inside the try (an early `return flush()` there would clear the
    // guard via this finally while the inner flush is still in flight and
    // double-send the pending batch).
    flushing = false;
  }
  if (!sent) return; // batch stays queued; next event/pagehide retries
  queue = queue.slice(batch.length);
  if (queue.length >= FLUSH_AT) {
    // More than one batch is pending — keep draining.
    return flushUxQueue();
  }
  if (queue.length > 0 && !flushTimer) {
    flushTimer = setTimeout(() => void flushUxQueue(), FLUSH_MS);
  }
}

/**
 * Wire the tracker to the REAL tRPC client inside the provider tree
 * (member pages render under MemberLayout → trpc.Provider). Registers the
 * sender, flushes on pagehide, and flushes once on mount so events queued
 * before registration are not stranded.
 */
export function useUxTracking(): void {
  const mutation = trpc.memberUxEvents.track.useMutation();
  const mutateRef = useRef(mutation.mutateAsync);
  mutateRef.current = mutation.mutateAsync;

  useEffect(() => {
    sender = events =>
      mutateRef.current({ events }).then(() => ({}));
    const onPageHide = () => void flushUxQueue();
    window.addEventListener("pagehide", onPageHide);
    void flushUxQueue();
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      sender = null;
      void flushUxQueue();
    };
  }, []);
}
