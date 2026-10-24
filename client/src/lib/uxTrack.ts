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
] as const;
export type UxEventKind = (typeof UX_EVENT_KINDS)[number];

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
  event: UxEventKind;
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
