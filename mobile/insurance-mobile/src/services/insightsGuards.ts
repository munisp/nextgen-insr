/**
 * insightsGuards.ts — 2026-10-24 (W11-B3b): Phase 3 member-intelligence UX
 * guards shared by the mobile funds screens (BillsScreen, AirtimeScreen),
 * mirroring the web client/src/pages/member/insightsGuards.tsx over the same
 * W11-B3a surface (memberInsights via insightsApi):
 *
 *   checkAmountAnomaly()
 *     Soft-confirm check before Pay/Buy. Returns the server verdict, or null
 *     on ANY error — callers proceed normally on null/anomalous:false.
 *     ⚠ UX-ONLY SIGNAL, NOT A SECURITY GATE (2026-10-24): it never blocks a
 *     payment and is not a fraud decision; the server fails closed
 *     (insufficient history → anomalous:false).
 *
 *   findRecurringMatch() / markRecurringPromptShown() /
 *   recurringPromptAlreadyShown()
 *     After a TERMINAL confirm, shows the "monthly payment" prompt at most
 *     ONCE PER APP SESSION per rail (module-level Set — dies with the app
 *     process; W11-B3a ships no server prompt state).
 *     JOIN NOTE (2026-10-24): the candidate naturalKey is a server-side
 *     keyed-HMAC blind index (server/lib/memberPayees.ts) — the client
 *     CANNOT recompute it, so the only honest join from a completed payment
 *     to a candidate is rail + exact average amount (averageAmountKobo).
 */
import {
  insightsApi,
  type AmountAnomalyResult,
  type RecurringCandidateView,
} from './api';

export type InsightsRail = 'bill' | 'airtime' | 'momo';

export interface AnomalyIdentifiers {
  billerCode?: string;
  meterNumber?: string;
  network?: string;
  phone?: string;
  provider?: string;
  walletNumber?: string;
}

/** Soft-confirm check; null on error (caller proceeds normally). */
export async function checkAmountAnomaly(
  rail: InsightsRail,
  identifiers: AnomalyIdentifiers,
  amountKobo: number,
): Promise<AmountAnomalyResult | null> {
  try {
    return await insightsApi.amountAnomalyCheck({ rail, identifiers, amountKobo });
  } catch (err) {
    console.warn('memberInsights.amountAnomalyCheck failed; proceeding without soft-confirm:', err);
    return null;
  }
}

/** App-session-scoped "prompt already shown" flags (per rail). */
const promptShown = new Set<InsightsRail>();

export function recurringPromptAlreadyShown(rail: InsightsRail): boolean {
  return promptShown.has(rail);
}

export function markRecurringPromptShown(rail: InsightsRail): void {
  promptShown.add(rail);
}

/** rail + exact average-amount join (header JOIN NOTE). */
export function findRecurringMatch(
  candidates: RecurringCandidateView[] | undefined,
  rail: InsightsRail,
  amountNGN: number,
): RecurringCandidateView | null {
  if (!candidates) return null;
  const amountKobo = Math.round(amountNGN * 100);
  return (
    candidates.find((c) => c.rail === rail && c.averageAmountKobo === amountKobo) ?? null
  );
}
