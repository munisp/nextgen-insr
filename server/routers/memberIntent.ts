/**
 * memberIntent.ts — W11-B4a (2026-10-24): deterministic NL intent parser
 * surface for the member funds/claims omnibox (member-intelligence program,
 * Phase 4a). Mounted as `memberIntent`.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ EXECUTION BOUNDARY (loud): this router PARSES ONLY. There is no      │
 * │ `execute` proc and none may be added here without a fresh reviewed   │
 * │ funds wave. The returned intent is a PROPOSAL; the client drives the │
 * │ normal validated mutations (memberAirtime.vend / memberBillPayments. │
 * │ pay / memberMobileMoney.cashIn / memberClaims.fileClaim /            │
 * │ memberRenewals.requestRenewal) with prefilled values, which re-run   │
 * │ every server-side guard (session identity, KYC, limits, idempotency, │
 * │ real capture). Parsing NEVER moves money, NEVER writes funds rows,   │
 * │ and NEVER bypasses a confirmation step.                              │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Parser: server/lib/memberIntentParser.ts — pure regex/dictionary, NO LLM.
 * The parser output contract is fail-closed: ready | clarification |
 * unsupported; it never guesses amounts/payees and never infers network
 * from phone prefix (ported numbers).
 *
 * Enrichment (server-side, caller-scoped): when a parsed `ready` intent's
 * identifiers match a row in the CALLER'S OWN payee_directory (the
 * HMAC-SHA256 naturalKey blind index — encryptPii random IVs make
 * ciphertext unmatchable, server/lib/memberPayees.ts), the response carries
 * `payee: {payeeId, label}` for one-tap confirm. Momo matches on
 * (provider, caller's session-resolved phone) — the wallet number the
 * cashIn rail actually uses. Cross-member rows are unreachable: the query
 * predicate includes customerId = resolveMemberCustomer(ctx.user.id).
 *
 * Rate limit (mechanism choice, documented): enhancedRateLimiter's
 * checkRateLimit sliding-window bucket, key `member-intent:<userId>`, 60
 * parses/hour. Chosen over a PG count on ux_events because this surface
 * writes NO rows of its own (a parse stores nothing — the raw text is
 * never persisted, so nothing personal can leak from telemetry), and
 * manufacturing ux_events rows just to count them would pollute the
 * analytics vocabulary (UX_EVENT_KINDS). A parse is a pure, cheap,
 * read-only computation, so an in-process bucket's restart-reset is
 * fail-SOFT in the safe direction (the parser executes nothing).
 *
 * Fail-closed: no DB → INTERNAL_SERVER_ERROR; unauthenticated →
 * UNAUTHORIZED (protectedProcedure); unknown member profile → parse still
 * runs but with NO payee enrichment (there is no caller scope to match
 * against — never a global payee search).
 */
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { payeeDirectory } from "../../drizzle/schema";
import { checkRateLimit } from "../lib/enhancedRateLimiter";
import { resolveMemberCustomer } from "../lib/memberFunds";
import type { DrizzleDb } from "../lib/memberGuards";
import {
  parseMemberIntent,
  resolveBillerAlias,
  type ParseResult,
} from "../lib/memberIntentParser";
import { decryptPayeeRow, payeeNaturalKey, type PayeeRail } from "../lib/memberPayees";
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

/** 60 parses per member per rolling hour (see header for the mechanism). */
const PARSE_RATE_LIMIT = {
  endpoint: "memberIntent.parseIntent",
  windowMs: 60 * 60 * 1000,
  maxRequests: 60,
};

function enforceParseRateLimit(userId: number | string): void {
  const { allowed } = checkRateLimit(`member-intent:${userId}`, PARSE_RATE_LIMIT);
  if (!allowed) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "Parse rate limit exceeded (60/hour) — try again later",
    });
  }
}

/**
 * Map a parsed ready-intent onto the caller's payee_directory natural key.
 * Returns null when the intent cannot map (navigate) or the tuple is
 * incomplete (payeeNaturalKey fail-closed null).
 */
function intentNaturalKey(
  intent: Extract<ParseResult, { status: "ready" }>["intent"],
  callerPhone: string | null
): { rail: PayeeRail; key: string } | null {
  let rail: PayeeRail;
  let identifiers: Parameters<typeof payeeNaturalKey>[1];
  switch (intent.flow) {
    case "airtime_vend":
      rail = "airtime";
      identifiers = { network: intent.network, phone: intent.phone };
      break;
    case "bill_pay":
      rail = "bill";
      identifiers = {
        billerCode: intent.billerCode,
        meterNumber: intent.customerNumber,
      };
      break;
    case "momo_cash_in":
      // The cashIn rail's wallet is the caller's session-resolved phone
      // (memberFunds recordPayeeForCapture: dispatch.customerPhone).
      rail = "momo";
      identifiers = { provider: intent.provider, walletNumber: callerPhone };
      break;
    default:
      return null; // navigate: no payee concept
  }
  const key = payeeNaturalKey(rail, identifiers);
  return key ? { rail, key } : null;
}

export const memberIntentRouter = router({
  /**
   * Parse one omnibox string into a structured intent proposal, enriched
   * with a caller-scoped payee match for one-tap confirm. NEVER executes.
   */
  parseIntent: protectedProcedure
    .input(z.object({ text: z.string().trim().min(1).max(280) }).strict())
    .mutation(async ({ input, ctx }) => {
      enforceParseRateLimit(ctx.user.id);
      const result = parseMemberIntent(input.text);
      if (result.status !== "ready") {
        // clarification / unsupported pass through verbatim — no enrichment.
        return { result, payee: null };
      }
      const d = await db();
      const customer = await resolveMemberCustomer(d, ctx.user.id);
      if (!customer) {
        // No member profile → no caller scope → honestly no enrichment
        // (a global payee search would be an enumeration oracle).
        return { result, payee: null };
      }
      const nk = intentNaturalKey(result.intent, customer.phone ?? null);
      if (!nk) return { result, payee: null };
      const [row] = await d
        .select()
        .from(payeeDirectory)
        .where(
          and(
            eq(payeeDirectory.customerId, customer.id),
            eq(payeeDirectory.rail, nk.rail),
            eq(payeeDirectory.naturalKey, nk.key)
          )
        )
        .limit(1);
      if (!row) return { result, payee: null };
      const decrypted = decryptPayeeRow(row);
      // One-tap confirm payload: id + label only — the identifiers are
      // already in the intent the member just typed (no PII re-disclosure).
      return { result, payee: { payeeId: decrypted.id, label: decrypted.label } };
    }),

  /**
   * Alias hint for the omnibox's biller autocomplete: resolve a free-text
   * biller mention to the canonical registry code (same alias table the
   * parser uses, memberIntentParser.ts BILLER_ALIASES). Pure lookup — no
   * DB, no payee data; returns { billerCode: null } on a miss, never a
   * nearest-guess.
   */
  resolvePayeeHint: protectedProcedure
    .input(z.object({ billerText: z.string().trim().min(1).max(120) }).strict())
    .query(({ input }) => ({ billerCode: resolveBillerAlias(input.billerText) })),
});
