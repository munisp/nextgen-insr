/**
 * insightsGuards.tsx — 2026-10-24 (W11-B3b): Phase 3 member-intelligence
 * UX guards shared by the member funds surfaces (MemberBills, MemberAirtime)
 * over the W11-B3a server surface (server/routers/memberInsights.ts):
 *
 *   useAmountAnomalyGate(rail)
 *     Soft-confirm before Pay/Buy: after the form's own validation passes,
 *     the draft is checked against memberInsights.amountAnomalyCheck. An
 *     anomalous verdict renders an INLINE soft-confirm ("₦X is N× your usual
 *     payment to this payee — confirm?") that requires one explicit extra
 *     tap before the mutation fires. anomalous:false AND any check error
 *     proceed normally.
 *     ⚠ THIS IS A UX-ONLY SIGNAL, NOT A SECURITY GATE (2026-10-24): it must
 *     never block a payment, never hard-fail, and is not a fraud decision —
 *     the server-side anomaly evaluation is deliberately fail-closed
 *     (insufficient history → anomalous:false).
 *
 *   useRecurringPrompt(rail)
 *     After a TERMINAL confirm outcome, if the just-paid payee appears in
 *     memberInsights.recurringCandidates, a one-time inline prompt ("This
 *     looks like a monthly payment — we'll remind you next month") is shown;
 *     dismissible and session-scoped (sessionStorage; W11-B3a ships no
 *     server prompt state).
 *     JOIN NOTE (2026-10-24): the recurring candidate's naturalKey is a
 *     server-side keyed HMAC blind index (server/lib/memberPayees.ts) — the
 *     client CANNOT recompute it. The only honest client-side join from a
 *     completed payment to a candidate is rail + exact average amount
 *     (averageAmountKobo), which is what maybePrompt() uses.
 *
 * Boundary mock note: tests stub ONLY @/lib/trpc; sessionStorage is the
 * real happy-dom API.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { trackEvent } from "@/lib/uxTrack";
import { Button } from "@/components/ui/button";
import type { PayeeRail } from "./RecentPayeePicker";

/** 2026-10-24 (W11-B3b): instrumentation flow name for insights UX guards. */
const UX_FLOW = "member-insights";

const fmtNgnFromKobo = (kobo: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    kobo / 100
  );

/** Rail-specific identifier tuple for amountAnomalyCheck (zod-exact subset
 *  of the server input; empty/absent identifiers fail closed server-side). */
export interface AnomalyIdentifiers {
  billerCode?: string;
  meterNumber?: string;
  network?: string;
  phone?: string;
  provider?: string;
  walletNumber?: string;
}

interface AnomalyRequest {
  identifiers: AnomalyIdentifiers;
  amountKobo: number;
}

export interface AnomalyGate {
  /** Run the soft-confirm check; `proceed` fires immediately on a
   *  non-anomalous/error verdict, or after the explicit confirm tap. */
  check: (
    identifiers: AnomalyIdentifiers,
    amountKobo: number,
    proceed: () => void
  ) => void;
  /** Render into the page — the inline soft-confirm dialog or null. */
  dialog: React.ReactNode;
  /** True while the check query is in flight. */
  checking: boolean;
}

export function useAmountAnomalyGate(rail: PayeeRail): AnomalyGate {
  const [request, setRequest] = useState<AnomalyRequest | null>(null);
  const [softConfirm, setSoftConfirm] = useState<{
    amountKobo: number;
    multiple: number | null;
  } | null>(null);
  // The proceed callback lives in a ref — it must NEVER be part of the query
  // input (tRPC serializes the input into the query key).
  const pendingProceed = useRef<(() => void) | null>(null);

  const query = trpc.memberInsights.amountAnomalyCheck.useQuery(
    request
      ? { rail, identifiers: request.identifiers, amountKobo: request.amountKobo }
      : // Disabled placeholder input (enabled gate below) — zod-exact shape,
        // never sent.
        { rail, identifiers: {}, amountKobo: 1 },
    { enabled: request !== null, retry: false }
  );

  useEffect(() => {
    if (!request) return;
    const proceed = pendingProceed.current;
    // Error → proceed normally (UX-only signal, never blocks; dated header).
    if (query.isError) {
      console.warn(
        "memberInsights.amountAnomalyCheck failed; proceeding without soft-confirm:",
        query.error.message
      );
      setRequest(null);
      pendingProceed.current = null;
      proceed?.();
      return;
    }
    const data = query.data as
      | { anomalous: boolean; multiple: number | null }
      | undefined;
    if (!data) {
      // A SETTLED query without a verdict (e.g. an empty/odd response body)
      // must not hang the payment — proceed like a non-anomalous verdict.
      // In flight (isLoading) → keep waiting.
      if (query.isLoading) return;
      setRequest(null);
      pendingProceed.current = null;
      proceed?.();
      return;
    }
    if (data.anomalous) {
      setSoftConfirm({ amountKobo: request.amountKobo, multiple: data.multiple });
      setRequest(null);
      // pendingProceed stays armed until the explicit confirm tap.
    } else {
      setRequest(null);
      pendingProceed.current = null;
      proceed?.();
    }
  }, [request, query.data, query.isError, query.error]);

  const check: AnomalyGate["check"] = (identifiers, amountKobo, proceed) => {
    setSoftConfirm(null);
    pendingProceed.current = proceed;
    setRequest({ identifiers, amountKobo });
  };

  const confirm = () => {
    const proceed = pendingProceed.current;
    setSoftConfirm(null);
    pendingProceed.current = null;
    trackEvent(UX_FLOW, "recommendation_accepted", {
      metadata: { action: "anomaly_soft_confirm" },
    });
    proceed?.();
  };
  const cancel = () => {
    // Cancelling simply closes the dialog — the member may edit the draft or
    // tap Pay again. The payment is NOT silently aborted or auto-submitted.
    setSoftConfirm(null);
    pendingProceed.current = null;
  };

  const dialog = softConfirm ? (
    <div
      role="alertdialog"
      aria-label="Confirm unusual amount"
      data-testid="anomaly-soft-confirm"
      className="text-sm border border-amber-300 bg-amber-50 rounded-md p-3 space-y-2"
    >
      <p>
        {fmtNgnFromKobo(softConfirm.amountKobo)} is{" "}
        {softConfirm.multiple != null ? `${softConfirm.multiple}×` : "more than"}{" "}
        your usual payment to this payee — confirm?
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={confirm} data-testid="anomaly-confirm">
          Confirm amount
        </Button>
        <Button size="sm" variant="outline" onClick={cancel}>
          Go back
        </Button>
      </div>
    </div>
  ) : null;

  return { check, dialog, checking: request !== null };
}

// ── Recurring-payment prompt ──────────────────────────────────────────────

/** sessionStorage scope: prompts already shown this browser session. */
const RECURRING_SHOWN_KEY = "recurring-prompt-shown";

function recurringShown(rail: PayeeRail): boolean {
  try {
    const raw = sessionStorage.getItem(RECURRING_SHOWN_KEY);
    const arr: unknown[] = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) && arr.includes(rail);
  } catch {
    return false;
  }
}

function markRecurringShown(rail: PayeeRail): void {
  try {
    const raw = sessionStorage.getItem(RECURRING_SHOWN_KEY);
    const arr: unknown[] = raw ? JSON.parse(raw) : [];
    const next = Array.isArray(arr) ? [...new Set([...arr, rail])] : [rail];
    sessionStorage.setItem(RECURRING_SHOWN_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — prompt is best-effort UX */
  }
}

interface RecurringCandidateView {
  naturalKey: string;
  rail: PayeeRail;
  cadenceDays: number;
  averageAmountKobo: number;
  dueSoon: boolean;
}

export interface RecurringPrompt {
  /** Call at the TERMINAL confirm moment with the paid amount (NGN). */
  maybePrompt: (amountNGN: number) => void;
  /** Render into the page — the inline prompt or null. */
  node: React.ReactNode;
}

export function useRecurringPrompt(rail: PayeeRail): RecurringPrompt {
  const query = trpc.memberInsights.recurringCandidates.useQuery(undefined, {
    retry: false,
  });
  const [prompt, setPrompt] = useState<{ cadenceDays: number } | null>(null);

  const maybePrompt = (amountNGN: number) => {
    if (prompt || recurringShown(rail)) return; // once per session per rail
    const data = query.data as
      | { candidates?: RecurringCandidateView[] }
      | undefined;
    // Error/empty → no prompt (detections only, never fabricated).
    if (!data?.candidates) return;
    const amountKobo = Math.round(amountNGN * 100);
    // rail + exact average amount join (header JOIN NOTE — the naturalKey
    // blind index is not client-computable).
    const match = data.candidates.find(
      c => c.rail === rail && c.averageAmountKobo === amountKobo
    );
    if (!match) return;
    markRecurringShown(rail);
    trackEvent(UX_FLOW, "recommendation_accepted", {
      metadata: { action: "recurring_prompt_shown" },
    });
    setPrompt({ cadenceDays: match.cadenceDays });
  };

  const dismiss = () => {
    trackEvent(UX_FLOW, "recommendation_dismissed", {
      metadata: { action: "recurring_prompt" },
    });
    setPrompt(null);
  };

  const node = prompt ? (
    <div
      role="status"
      data-testid="recurring-prompt"
      className="text-sm border rounded-md p-3 flex items-start justify-between gap-2"
    >
      <p>
        This looks like a monthly payment (every ~{prompt.cadenceDays} days) —
        we'll remind you next month.
      </p>
      <Button size="sm" variant="outline" onClick={dismiss}>
        Dismiss
      </Button>
    </div>
  ) : null;

  return { maybePrompt, node };
}
