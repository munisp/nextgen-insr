/**
 * omniboxPrefill.ts — 2026-10-25 (W11-B4b): ONE-SHOT prefill handoff from
 * the member omnibox (Omnibox.tsx) to the existing validated funds forms
 * (MemberBills / MemberAirtime).
 *
 * PREFILL-ONLY CONTRACT (funds-critical):
 *   - The omnibox NEVER executes a payment. A `ready` intent becomes a
 *     navigation to the normal flow screen with the parsed values prefilled
 *     into the EXISTING form state — the member reviews and taps the normal
 *     Pay/Buy button, which re-runs every existing guard (validation,
 *     amount bounds, the W11-B3b anomaly soft-confirm gate, the real
 *     two-phase capture). Nothing here bypasses, weakens, or auto-submits
 *     any of that.
 *   - The parsed AMOUNT is prefilled (the member typed it; hiding it would
 *     be dishonest), but it is treated exactly like a payee prefill: plain
 *     form state, still editable, still gated by the normal submit path.
 *   - One-shot: a stash is consumed exactly once by the matching rail's
 *     form and then removed — a stale stash can never leak into a later,
 *     unrelated draft.
 *
 * Mechanism: the portal uses wouter (no location.state), so the handoff is
 * a module-level slot (survives in-SPA navigation, which is the only path
 * the omnibox uses) with a sessionStorage backup (survives a full page
 * load between stash and consume). Same storage discipline as
 * memberFundsIntent.tsx.
 */

/** The prefilled draft, keyed by the rail the target form owns. */
export type OmniboxPrefill =
  | {
      rail: "bill";
      billerCode: string;
      customerNumber: string;
      amountNGN: number;
    }
  | {
      rail: "airtime";
      network: string;
      phone: string;
      amountNGN: number;
    }
  | { rail: "momo"; provider: string; amountNGN: number };

export type OmniboxRail = OmniboxPrefill["rail"];

const STORE_KEY = "member-omnibox-prefill";

/** In-memory slot — the primary handoff for in-SPA navigation. */
let memorySlot: OmniboxPrefill | null = null;

/** Stash a parsed draft for the target flow. Overwrites any previous stash
 *  (a newer intent supersedes; the older one was never consumed). */
export function stashOmniboxPrefill(prefill: OmniboxPrefill): void {
  memorySlot = prefill;
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(prefill));
  } catch {
    /* storage unavailable — the in-memory slot still covers in-SPA use */
  }
}

/**
 * Consume the stash for `rail`: returns the draft and clears it (both
 * stores) ONLY when the stashed rail matches — a bill stash is never
 * consumed by the airtime form and vice versa. Returns null when there is
 * nothing for this rail.
 */
export function takeOmniboxPrefill(rail: OmniboxRail): OmniboxPrefill | null {
  let stashed: OmniboxPrefill | null = memorySlot;
  if (!stashed) {
    try {
      const raw = sessionStorage.getItem(STORE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as OmniboxPrefill | null;
        if (parsed && typeof parsed === "object" && "rail" in parsed) {
          stashed = parsed;
        }
      }
    } catch {
      stashed = null;
    }
  }
  if (!stashed || stashed.rail !== rail) return null;
  memorySlot = null;
  try {
    sessionStorage.removeItem(STORE_KEY);
  } catch {
    /* best-effort clear; the in-memory slot is already gone */
  }
  return stashed;
}

/** Test/diagnostic helper: true when a stash is pending for `rail`. */
export function hasOmniboxPrefill(rail: OmniboxRail): boolean {
  if (memorySlot?.rail === rail) return true;
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as OmniboxPrefill | null;
    return parsed?.rail === rail;
  } catch {
    return false;
  }
}
