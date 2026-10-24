/**
 * memberBillScan.ts — W11-B4c-1 (2026-10-25): OCR bill-photo intake for the
 * member bill/airtime flows (member-intelligence program, Phase 4c).
 * Mounted as `memberBillScan`.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ EXECUTION BOUNDARY (loud): this router EXTRACTS ONLY. It NEVER       │
 * │ persists the image (in-memory processing, discarded), NEVER writes   │
 * │ a funds/payment row, and NEVER calls any payment mutation. The       │
 * │ returned `prefill` is a PROPOSAL shaped exactly like the             │
 * │ memberIntent bill intent prefill so the client can feed the existing │
 * │ onPayeeSelect prefill path; the member then drives the normal        │
 * │ validated mutation (memberBillPayments.pay / memberAirtime.vend),    │
 * │ which re-runs every server-side guard.                               │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * HONEST FAIL-CLOSED contract (mirrors ocrAdapter.ts / kyc.ts:488-600):
 *   - Provider NOT configured      → { status:"unavailable",    mode:"manual_entry" }.
 *   - Provider error/timeout       → { status:"error",          mode:"manual_entry" }.
 *   - confidence < 0.6 (or absent) → { status:"low_confidence", mode:"manual_entry" }.
 *   - Success                      → { status:"ok", mode:"prefill", prefill, confidence }.
 * Fields are never fabricated: an unread biller/meter/amount is simply
 * OMITTED from prefill; amounts are never guessed.
 *
 * Biller matching reuses resolveBillerAlias from memberIntentParser.ts —
 * the SAME alias table the omnibox parser uses (no divergent duplicate).
 *
 * PII DISCIPLINE: the extracted customerNumber (meter/smartcard) is never
 * logged and never persisted. The only DB write is ONE privacy-minimal
 * ux_events telemetry row per scan attempt (flow "bill_scan", event
 * "completed", metadata {rail, outcome status} only — no identifiers).
 *
 * RATE LIMIT (mechanism choice, documented): PG-count over the caller's
 * OWN bill_scan telemetry rows in the rolling hour, capped at 30 — the
 * exact memberUxEvents pattern. Chosen over the in-process bucket used by
 * memberIntent because a scan attempt is a real (expensive, image-carrying)
 * operation whose limit state must be as durable as the attempts it limits;
 * the telemetry row exists anyway for the funnel, so counting it is cheap
 * and index-friendly (ux_events_customer_flow_created_idx). Counted BEFORE
 * insert so rejected scans consume no budget.
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; unauthenticated →
 * UNAUTHORIZED (protectedProcedure); no member profile → NOT_FOUND.
 */
import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, count, eq, gte } from "drizzle-orm";
import { z } from "zod";

import { uxEvents } from "../../drizzle/schema";
import { resolveMemberCustomer } from "../lib/memberFunds";
import type { DrizzleDb } from "../lib/memberGuards";
import { resolveBillerAlias } from "../lib/memberIntentParser";
import { extractBillFields, isOcrConfigured } from "../lib/ocrAdapter";
import { protectedProcedure, router } from "../_core/trpc";
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

/** Max scans per member per rolling hour (see header for the mechanism). */
export const BILL_SCAN_RATE_LIMIT_PER_HOUR = 30;
/** Fail-closed confidence floor (same discipline as kyc.ts:488-600). */
export const BILL_SCAN_MIN_CONFIDENCE = 0.6;
/** Telemetry flow name — counted for the rate limit, no PII. */
const SCAN_FLOW = "bill_scan";

/**
 * ~10 MB of binary is ~13.6 MB of base64; 14M chars is the honest ceiling.
 * The charset regex rejects malformed base64 at the boundary (never decoded).
 */
const imageSchema = z
  .string()
  .min(100)
  .max(14_000_000)
  .regex(/^[A-Za-z0-9+/=\r\n]+$/, "imageBase64 is not valid base64");

const scanInputSchema = z
  .object({
    imageBase64: imageSchema,
    rail: z.enum(["bill", "airtime"]),
  })
  .strict();

export type BillScanResponse = {
  status: "ok" | "unavailable" | "low_confidence" | "error";
  mode: "prefill" | "manual_entry";
  prefill?: {
    billerCode?: string;
    customerNumber?: string;
    amountKobo?: number;
  };
  confidence?: number;
  message: string;
};

export const memberBillScanRouter = router({
  /**
   * Scan a bill photo and return a prefill PROPOSAL. Never persists the
   * image, never writes funds rows, never calls a payment mutation.
   */
  parse: protectedProcedure
    .input(scanInputSchema)
    .mutation(async ({ input, ctx }): Promise<BillScanResponse> => {
      const d = await db();
      const customer = await resolveMemberCustomer(d, ctx.user.id);
      if (!customer)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Member profile not found",
        });

      // PG-count rate guard over the caller's own bill_scan telemetry rows
      // in the rolling hour (memberUxEvents pattern; counted BEFORE insert).
      const [row] = await d
        .select({ n: count() })
        .from(uxEvents)
        .where(
          and(
            eq(uxEvents.customerId, customer.id),
            eq(uxEvents.flow, SCAN_FLOW),
            gte(uxEvents.createdAt, new Date(Date.now() - 60 * 60 * 1000))
          )
        );
      if (Number(row?.n ?? 0) >= BILL_SCAN_RATE_LIMIT_PER_HOUR) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "Bill-scan rate limit exceeded (30/hour) — try again later",
        });
      }

      // Privacy-minimal telemetry row (doubles as the rate-limit ledger):
      // flow/rail/outcome ONLY — never the image, meter number, or amount.
      const recordOutcome = async (outcome: BillScanResponse["status"]) => {
        await d.insert(uxEvents).values({
          customerId: customer.id,
          sessionId: randomUUID(),
          flow: SCAN_FLOW,
          event: "completed",
          metadataJson: { rail: input.rail, outcome },
          clientEventId: randomUUID(),
        });
      };

      if (!isOcrConfigured()) {
        await recordOutcome("unavailable");
        return {
          status: "unavailable",
          mode: "manual_entry",
          message:
            "Bill scanning is not configured on this deployment (OCR_PROVIDER_URL/OCR_API_KEY unset). Please enter the bill details manually — this is a disclosed fallback, not an OCR result.",
        };
      }

      // In-memory extraction; the image is discarded after this call. The
      // adapter catches provider errors/timeouts into the disclosed fallback.
      const ocr = await extractBillFields({
        imageBase64: input.imageBase64,
        rail: input.rail,
      });
      if (ocr.status !== "completed") {
        await recordOutcome("error");
        return {
          status: "error",
          mode: "manual_entry",
          message: `${ocr.reason} No fields were extracted or guessed.`,
        };
      }

      const { fields } = ocr;
      const confidence = fields.confidence ?? 0;
      if (confidence < BILL_SCAN_MIN_CONFIDENCE) {
        await recordOutcome("low_confidence");
        return {
          status: "low_confidence",
          mode: "manual_entry",
          confidence,
          message:
            `Scan confidence ${confidence.toFixed(2)} is below the ${BILL_SCAN_MIN_CONFIDENCE} threshold — ` +
            "please enter the bill details manually. No fields were guessed.",
        };
      }

      // Prefill assembly — omit anything unread/unresolvable; never guess.
      const prefill: NonNullable<BillScanResponse["prefill"]> = {};
      if (fields.biller) {
        // Same alias table as the omnibox parser (no divergent logic);
        // a miss means NO billerCode — never a nearest-guess.
        const code = resolveBillerAlias(fields.biller);
        if (code) prefill.billerCode = code;
      }
      if (fields.customerNumber) prefill.customerNumber = fields.customerNumber;
      if (fields.amountKobo !== undefined) prefill.amountKobo = fields.amountKobo;

      await recordOutcome("ok");
      return {
        status: "ok",
        mode: "prefill",
        prefill,
        confidence,
        message:
          "Bill scanned — review the prefilled details before paying. Nothing has been paid or saved.",
      };
    }),
});
