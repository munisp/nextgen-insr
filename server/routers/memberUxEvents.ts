/**
 * memberUxEvents.ts — W11-B2 (2026-10-24): UX instrumentation backbone
 * (member-intelligence program, Phase 2).
 *
 * Member-facing write/self-read surface over ux_events (drizzle/schema.ts,
 * migration 0091) plus an admin-only aggregate funnel read. Mounted as
 * `memberUxEvents`.
 *
 * PRIVACY MANDATE (hard rules):
 *   - NO PII payloads. We store flow names, event kinds, field NAMES (never
 *     values), step names, and a small scrubbed metadata bag.
 *   - METADATA SCRUBBING RULE: metadataJson is zod-enforced to a flat record
 *     of at most 20 keys; keys are <= 64 chars; leaf values may only be
 *     number, boolean, null, or strings <= 64 chars (numeric durations /
 *     counts are the intended payload; the 64-char cap exists specifically
 *     to make PII smuggling — names, phones, free text — impossible without
 *     tripping validation). Nested objects are rejected outright.
 *   - sessionId is a CLIENT-GENERATED uuid (per app/browser session),
 *     deliberately NOT the auth session id.
 *
 * Identity: the member is resolved SESSION-SIDE ONLY
 * (customers.keycloakSub = String(ctx.user.id) — resolveMemberCustomer,
 * memberFunds.ts). No customerId is ever accepted from input; every write
 * and read is scoped customerId = <resolved id>, so cross-member rows are
 * never readable or writable.
 *
 * IDEMPOTENCY: each event carries a client-generated uuid clientEventId,
 * UNIQUE per customer (ux_events_client_event_unique). Inserts use
 * ON CONFLICT DO NOTHING, so batch retries never double-count; the response
 * reports inserted vs duplicate counts honestly.
 *
 * RATE LIMIT (mechanism choice, documented): a cheap per-customer PG count
 * query — SELECT count(*) FROM ux_events WHERE customerId = ? AND createdAt
 * > now() - 1 hour — capped at 500 events/hour. Chosen over Redis because
 * (a) the rate state is then exactly as durable as the data it limits (no
 * drift between store and limiter), (b) the (customerId, createdAt) prefix
 * of ux_events_customer_flow_created_idx makes the count index-only and
 * cheap, and (c) this surface is low-QPS member telemetry, not a hot auth
 * path. TOO_MANY_REQUESTS on breach; counted BEFORE insert so rejected
 * batches consume no budget. Note: deduped retries of already-stored events
 * still count toward the window (they are real rows) — retried duplicates
 * that were NOT stored (rejected earlier) do not.
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; no member profile →
 * UNAUTHORIZED-class NOT_FOUND for track (a caller with no member profile
 * cannot instrument) / empty aggregates for mySummary (non-enumerating).
 */
import { TRPCError } from "@trpc/server";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";

import { uxEvents } from "../../drizzle/schema";
import { resolveMemberCustomer } from "../lib/memberFunds";
import type { DrizzleDb } from "../lib/memberGuards";
import { adminProcedure, protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

async function db(): Promise<DrizzleDb> {
  const d = await getDb();
  if (!d)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable",
    });
  return d;
}

/** The full event vocabulary (enum-ish; stored as text, validated here). */
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
  // 2026-10-25 (W11-B4b fix-forward): omnibox/intent-flow kinds already
  // emitted by merged client code — previously fail-silent rejected by the
  // zod enum; now ACCEPTED and stored. Metadata scrub rules unchanged
  // (these carry intent type / rail only — short strings, no PII).
  "omnibox_opened",
  "intent_parsed",
  "prefill_applied",
  "clarify_shown",
  // 2026-10-25 (W12-R1): bill-scan lifecycle kinds already emitted by
  // merged client code (W11-B4c-2/-3) — previously fail-silent rejected by
  // the zod enum; now ACCEPTED and stored. bill_scan flow rows already
  // exist server-side from memberBillScan telemetry. Metadata scrub rules
  // unchanged.
  "scan_started",
  "scan_succeeded",
  "scan_failed",
] as const;

/** Max events one member may persist per rolling hour (see header). */
export const UX_EVENTS_RATE_LIMIT_PER_HOUR = 500;
/** Max events accepted in a single track batch. */
export const UX_EVENTS_BATCH_MAX = 20;

/**
 * Metadata scrubbing rule (PII-smuggling guard): a flat record, <= 20 keys,
 * key length <= 64, leaf values number | boolean | null | string <= 64
 * chars. No nesting, no long strings — nothing that could carry a name,
 * phone, address, or free-text answer survives validation.
 */
const metadataSchema = z
  .record(
    z.string().max(64),
    z.union([z.number(), z.boolean(), z.null(), z.string().max(64)])
  )
  .refine(obj => Object.keys(obj).length <= 20, {
    message: "metadataJson may carry at most 20 keys",
  });

const trackEventSchema = z
  .object({
    clientEventId: z.string().uuid(),
    sessionId: z.string().uuid(),
    flow: z.string().trim().min(1).max(64),
    event: z.enum(UX_EVENT_KINDS),
    fieldName: z.string().trim().min(1).max(64).nullish(),
    step: z.string().trim().min(1).max(64).nullish(),
    metadataJson: metadataSchema.nullish(),
  })
  .strict();

export const memberUxEventsRouter = router({
  /**
   * Persist a batch (<= 20) of the CALLER'S UX events. Zod-strict: unknown
   * keys, oversized strings, nested metadata, or a batch over 20 are
   * rejected wholesale (no partial acceptance of an invalid envelope).
   * Idempotent via (customerId, clientEventId) — replays report duplicates
   * and insert nothing twice.
   */
  track: protectedProcedure
    .input(
      z
        .object({ events: z.array(trackEventSchema).min(1).max(UX_EVENTS_BATCH_MAX) })
        .strict()
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const customer = await resolveMemberCustomer(d, ctx.user.id);
      if (!customer)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member profile not found",
        });

      // Cheap per-customer rate guard: PG count over the rolling hour
      // (mechanism rationale in the file header).
      const [row] = await d
        .select({ n: count() })
        .from(uxEvents)
        .where(
          and(
            eq(uxEvents.customerId, customer.id),
            gte(uxEvents.createdAt, new Date(Date.now() - 60 * 60 * 1000))
          )
        );
      if (Number(row?.n ?? 0) + input.events.length > UX_EVENTS_RATE_LIMIT_PER_HOUR) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "UX event rate limit exceeded (500/hour)",
        });
      }

      // ON CONFLICT DO NOTHING on (customerId, clientEventId) — retries of
      // the same clientEventId never double-count.
      const inserted = await d
        .insert(uxEvents)
        .values(
          input.events.map(e => ({
            customerId: customer.id,
            sessionId: e.sessionId,
            flow: e.flow,
            event: e.event,
            fieldName: e.fieldName ?? null,
            step: e.step ?? null,
            metadataJson: e.metadataJson ?? null,
            clientEventId: e.clientEventId,
          }))
        )
        .onConflictDoNothing({
          target: [uxEvents.customerId, uxEvents.clientEventId],
        })
        .returning({ id: uxEvents.id });
      return {
        accepted: inserted.length,
        duplicates: input.events.length - inserted.length,
      };
    }),

  /**
   * The CALLER'S OWN aggregate transparency view ("what we collect about
   * me"): counts grouped by flow/event over the last 30 days. Caller-scoped
   * only — no other member's data is ever read here.
   */
  mySummary: protectedProcedure.query(async ({ ctx }) => {
    const d = await db();
    const customer = await resolveMemberCustomer(d, ctx.user.id);
    // No member profile → the caller can have no events; empty (never an
    // enumeration oracle for which customer ids exist).
    if (!customer) return { days: 30, total: 0, byFlowEvent: [] };
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const rows = await d
      .select({
        flow: uxEvents.flow,
        event: uxEvents.event,
        n: count(),
      })
      .from(uxEvents)
      .where(
        and(eq(uxEvents.customerId, customer.id), gte(uxEvents.createdAt, since))
      )
      .groupBy(uxEvents.flow, uxEvents.event);
    return {
      days: 30,
      total: rows.reduce((acc, r) => acc + Number(r.n), 0),
      byFlowEvent: rows.map(r => ({
        flow: r.flow,
        event: r.event,
        count: Number(r.n),
      })),
    };
  }),

  /**
   * ADMIN-ONLY aggregate funnel: counts grouped by flow/step/event over a
   * date range. NEVER row-level data — no sessionId, no customerId, no
   * field names, no metadata; only bucket counts.
   *
   * MIN-BUCKET NOTE: results are intended for aggregate consumption where
   * each bucket represents many members. Consumers SHOULD suppress buckets
   * with count < 5 before display/export (small-bucket re-identification
   * risk). The threshold is left to the consumer because this endpoint does
   * not know the display context; it is documented here so the contract is
   * explicit.
   */
  adminFunnel: adminProcedure
    .input(
      z
        .object({
          from: z.coerce.date(),
          to: z.coerce.date(),
          flow: z.string().trim().min(1).max(64).optional(),
        })
        .strict()
        .refine(v => v.from.getTime() <= v.to.getTime(), {
          message: "from must be <= to",
        })
        .refine(v => v.to.getTime() - v.from.getTime() <= 366 * 24 * 60 * 60 * 1000, {
          message: "date range must be <= 366 days",
        })
    )
    .query(async ({ input }) => {
      const d = await db();
      const conditions = [
        gte(uxEvents.createdAt, input.from),
        sql`${uxEvents.createdAt} <= ${input.to}`,
      ];
      if (input.flow) conditions.push(eq(uxEvents.flow, input.flow));
      const rows = await d
        .select({
          flow: uxEvents.flow,
          step: uxEvents.step,
          event: uxEvents.event,
          n: count(),
        })
        .from(uxEvents)
        .where(and(...conditions))
        .groupBy(uxEvents.flow, uxEvents.step, uxEvents.event);
      return {
        from: input.from.toISOString(),
        to: input.to.toISOString(),
        buckets: rows.map(r => ({
          flow: r.flow,
          step: r.step,
          event: r.event,
          count: Number(r.n),
        })),
      };
    }),
});
