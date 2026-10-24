/**
 * Omnibox.tsx — 2026-10-25 (W11-B4b): natural-language omnibox on the
 * member portal shell, consuming the W11-B4a server surface
 * (server/routers/memberIntent.ts — parseIntent / resolvePayeeHint).
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PREFILL-ONLY (funds-critical): the omnibox NEVER executes a payment. │
 * │ A `ready` intent renders a confirmation card; the explicit Continue  │
 * │ CTA navigates to the EXISTING validated flow (MemberBills /          │
 * │ MemberAirtime / claims / renewals) with the parsed values prefilled  │
 * │ into the normal form state (omniboxPrefill.ts one-shot handoff). The │
 * │ member reviews and taps the normal Pay/Buy button — every existing   │
 * │ guard still runs on submit (validation, bounds, the W11-B3b anomaly  │
 * │ soft-confirm gate, the real two-phase capture). No auto-submit, no   │
 * │ new endpoint, no guard bypass.                                       │
 * │                                                                      │
 * │ clarify  → the question/options render INLINE (conversation-style);  │
 * │            the parser's partials are shown, never guessed.           │
 * │ unsupported → an honest refusal plus what IS supported.              │
 * │ parse error → fail-closed message; NO navigation.                    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Instrumentation (client/src/lib/uxTrack.ts): omnibox_opened (first
 * focus), intent_parsed (metadata: intent TYPE only), prefill_applied
 * (metadata: rail only), clarify_shown (metadata: flow + missing COUNT
 * only). Raw text, amounts, and identifiers are NEVER tracked.
 *
 * The only server call made here is memberIntent.parseIntent (a parse-only
 * mutation; it writes nothing funds-side). Meter/phone/amount values are
 * sent to NO other endpoint — they flow only into the existing forms.
 */
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { trackEvent } from "@/lib/uxTrack";
import { stashOmniboxPrefill } from "./omniboxPrefill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Sparkles } from "lucide-react";

/** 2026-10-25 (W11-B4b): instrumentation flow name for this surface. */
const UX_FLOW = "member-omnibox";

// ── Server contract types — INFERRED from the tRPC mutation, never
// hand-written in parallel (2026-10-25 CI fix): if the server contract
// (memberIntent.ts / memberIntentParser.ts) changes, this file fails to
// compile instead of silently drifting.
type ParseResponse = Awaited<
  ReturnType<
    ReturnType<typeof trpc.memberIntent.parseIntent.useMutation>["mutateAsync"]
  >
>;
type ParseResultView = ParseResponse["result"];
type MemberIntentView = Extract<ParseResultView, { status: "ready" }>["intent"];
type ClarificationView = Extract<ParseResultView, { status: "clarification" }>;

type OmniboxState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; intent: MemberIntentView; payeeLabel: string | null }
  | ({ phase: "clarify" } & Pick<
      ClarificationView,
      "flow" | "missing" | "partial" | "reason"
    >)
  | { phase: "unsupported"; reason: string }
  | { phase: "error" };

const fmtNgn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(n);

/** Human summary line for the ready-intent confirmation card. */
export function intentSummary(intent: MemberIntentView): string {
  switch (intent.flow) {
    case "airtime_vend":
      return `Buy ${fmtNgn(intent.amountNGN)} ${intent.network} airtime for ${intent.phone}`;
    case "bill_pay":
      return `Pay ${fmtNgn(intent.amountNGN)} to ${intent.billerCode} for customer ${intent.customerNumber}`;
    case "momo_cash_in":
      return `Cash in ${fmtNgn(intent.amountNGN)} to your ${intent.provider} wallet`;
    case "navigate":
      return intent.target === "claims_file"
        ? "File a claim"
        : "Renew a policy";
  }
}

/** CTA label per flow — always an explicit "Continue"-style action. */
function continueLabel(intent: MemberIntentView): string {
  switch (intent.flow) {
    case "airtime_vend":
      return "Continue to airtime";
    case "bill_pay":
      return "Continue to bill payment";
    case "momo_cash_in":
      return "Continue to cash-in";
    case "navigate":
      return intent.target === "claims_file"
        ? "Go to claims"
        : "Go to renewals";
  }
}

const MISSING_LABELS: Record<string, string> = {
  amount: "the amount",
  phone: "the phone number",
  network: "the network (MTN, Glo, Airtel or 9mobile)",
  biller: "the biller (e.g. Ikeja Electric, DSTV)",
  customerNumber: "the customer / meter number",
  provider: "the provider (MTN MoMo, Airtel Money, Glo Xtra or 9PSB)",
};

/** Honest clarification prompt from the parser's reason + missing fields. */
function clarifyQuestion(reason: string, missing: string[]): string {
  switch (reason) {
    case "ambiguous_amounts":
      return "I found more than one amount in that — please rephrase with a single amount.";
    case "amount_out_of_bounds":
      return "That amount is outside the allowed range for this payment — please enter an in-range amount.";
    case "ambiguous_phones":
      return "I found more than one phone number — please rephrase with a single phone number.";
    case "conflicting_networks":
      return "You named two different networks — please tell me which one.";
    case "conflicting_billers":
      return "You named two different billers — please tell me which one.";
    case "conflicting_providers":
      return "You named two different providers — please tell me which one.";
    case "ambiguous_customer_numbers":
      return "I found more than one customer / meter number — please rephrase with a single number.";
    default:
      return missing.length > 0
        ? `I need a bit more detail: ${missing.map(m => MISSING_LABELS[m] ?? m).join(", ")}.`
        : "I need a bit more detail — please rephrase.";
  }
}

/** Honest unsupported message — names what IS supported, never guesses. */
function unsupportedMessage(reason: string): string {
  switch (reason) {
    case "empty_input":
      return "Type a request first — for example “buy ₦2,000 MTN airtime for 08031234567”.";
    case "data_bundle_not_supported":
      return "Data bundles aren't supported here — the airtime flow vends airtime credit only.";
    case "bank_transfer_not_supported":
      return "Bank transfers aren't supported here.";
    case "momo_cash_out_not_supported":
      return "Wallet cash-out isn't supported from the omnibox.";
    default:
      return reason.startsWith("provider_not_supported:")
        ? `That provider (${reason.slice("provider_not_supported:".length).replace(/_/g, " ")}) isn't supported here.`
        : "I couldn't turn that into a supported action.";
  }
}

const SUPPORTED_NOTE =
  "Supported: buy airtime (MTN / Glo / Airtel / 9mobile), pay a bill (e.g. Ikeja Electric, DSTV), cash in to a mobile-money wallet (MTN MoMo / Airtel Money / Glo Xtra / 9PSB), file a claim, or renew a policy.";

export function Omnibox() {
  const [, navigate] = useLocation();
  const [text, setText] = useState("");
  const [state, setState] = useState<OmniboxState>({ phase: "idle" });
  // omnibox_opened fires once per mount on FIRST focus (the member engaging
  // the box), not on every render.
  const openedTracked = useRef(false);

  const parseMutation = trpc.memberIntent.parseIntent.useMutation({
    onSuccess: (data: ParseResponse) => {
      const result = data.result;
      // intent_parsed: the intent TYPE only — never the raw text, amount,
      // or any identifier (metadata scrub rules).
      trackEvent(UX_FLOW, "intent_parsed", {
        metadata: { intentType: result.status },
      });
      if (result.status === "ready") {
        setState({
          phase: "ready",
          intent: result.intent,
          payeeLabel: data.payee?.label ?? null,
        });
      } else if (result.status === "clarification") {
        // clarify_shown: flow + missing COUNT only — never the values.
        trackEvent(UX_FLOW, "clarify_shown", {
          metadata: { flow: result.flow ?? "none", missingCount: result.missing.length },
        });
        setState({
          phase: "clarify",
          flow: result.flow,
          missing: result.missing,
          partial: result.partial,
          reason: result.reason,
        });
      } else {
        setState({ phase: "unsupported", reason: result.reason });
      }
    },
    onError: () => {
      // FAIL-CLOSED: a parse failure shows an honest error and NEVER
      // navigates or prefills anything.
      setState({ phase: "error" });
    },
  });

  const onFirstFocus = () => {
    if (openedTracked.current) return;
    openedTracked.current = true;
    trackEvent(UX_FLOW, "omnibox_opened");
  };

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || parseMutation.isPending) return;
    setState({ phase: "loading" });
    parseMutation.mutate({ text: trimmed });
  };

  /**
   * Continue = stash the parsed values for the target form and navigate.
   * The payment is NOT executed here — the member reviews the prefilled
   * form and taps the normal Pay/Buy button (all guards re-run on submit).
   */
  const onContinue = (intent: MemberIntentView) => {
    switch (intent.flow) {
      case "airtime_vend":
        stashOmniboxPrefill({
          rail: "airtime",
          network: intent.network,
          phone: intent.phone,
          amountNGN: intent.amountNGN,
        });
        trackEvent(UX_FLOW, "prefill_applied", { metadata: { rail: "airtime" } });
        navigate("/member/airtime");
        return;
      case "bill_pay":
        stashOmniboxPrefill({
          rail: "bill",
          billerCode: intent.billerCode,
          customerNumber: intent.customerNumber,
          amountNGN: intent.amountNGN,
        });
        trackEvent(UX_FLOW, "prefill_applied", { metadata: { rail: "bill" } });
        navigate("/member/bills");
        return;
      case "momo_cash_in":
        stashOmniboxPrefill({
          rail: "momo",
          provider: intent.provider,
          amountNGN: intent.amountNGN,
        });
        trackEvent(UX_FLOW, "prefill_applied", { metadata: { rail: "momo" } });
        navigate("/member/airtime");
        return;
      case "navigate":
        // Navigation intent only — no payload is fabricated or carried.
        navigate(
          intent.target === "claims_file" ? "/member/claims" : "/member/renewals"
        );
        return;
    }
  };

  /** Option chip for a clarification: appends the choice to the input for
   *  the member to review and RE-SUBMIT explicitly — never an auto-guess. */
  const optionChips: string[] =
    state.phase === "clarify"
      ? state.missing.includes("network")
        ? ["MTN", "Glo", "Airtel", "9mobile"]
        : state.missing.includes("provider")
          ? ["MTN MoMo", "Airtel Money", "Glo Xtra", "9PSB"]
          : []
      : [];

  return (
    <Card data-testid="omnibox">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" /> Tell me what you need
        </CardTitle>
        <CardDescription>
          Plain words, e.g. “buy ₦2,000 MTN airtime for 08031234567” or “pay
          Ikeja Electric meter 12345678901 ₦5,000”. Nothing is paid from here
          — you always review and confirm on the normal form.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex gap-2"
        >
          <Input
            aria-label="Omnibox request"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={onFirstFocus}
            maxLength={280}
            placeholder="What would you like to do?"
            disabled={parseMutation.isPending}
          />
          <Button
            type="submit"
            disabled={!text.trim() || parseMutation.isPending}
            data-testid="omnibox-submit"
          >
            {parseMutation.isPending ? "Reading…" : "Go"}
          </Button>
        </form>

        {state.phase === "ready" ? (
          <div
            className="text-sm border rounded-md p-3 space-y-2"
            data-testid="omnibox-ready"
          >
            <p className="font-medium">{intentSummary(state.intent)}</p>
            {state.payeeLabel ? (
              <p className="text-xs text-muted-foreground">
                Matches your saved payee: {state.payeeLabel}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Nothing is paid yet — Continue opens the normal form with these
              details prefilled for your review.
            </p>
            <Button
              size="sm"
              onClick={() => onContinue(state.intent)}
              data-testid="omnibox-continue"
            >
              {continueLabel(state.intent)}
            </Button>
          </div>
        ) : null}

        {state.phase === "clarify" ? (
          <div
            className="text-sm border rounded-md p-3 space-y-2"
            data-testid="omnibox-clarify"
            role="status"
          >
            <p>{clarifyQuestion(state.reason, state.missing)}</p>
            {Object.keys(state.partial).length > 0 ? (
              <p className="text-xs text-muted-foreground">
                I got:{" "}
                {Object.entries(state.partial)
                  .map(([k, v]) => `${k} = ${String(v)}`)
                  .join(", ")}
              </p>
            ) : null}
            {optionChips.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {optionChips.map(opt => (
                  <Button
                    key={opt}
                    size="sm"
                    variant="outline"
                    onClick={() => setText(t => `${t.trim()} ${opt}`.trim())}
                    data-testid={`omnibox-chip-${opt}`}
                  >
                    {opt}
                  </Button>
                ))}
              </div>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Edit your request above and tap Go again.
            </p>
          </div>
        ) : null}

        {state.phase === "unsupported" ? (
          <div
            className="text-sm border rounded-md p-3 space-y-1"
            data-testid="omnibox-unsupported"
            role="status"
          >
            <p>{unsupportedMessage(state.reason)}</p>
            <p className="text-xs text-muted-foreground">{SUPPORTED_NOTE}</p>
          </div>
        ) : null}

        {state.phase === "error" ? (
          <p
            className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
            data-testid="omnibox-error"
            role="alert"
          >
            Sorry, I couldn't read that right now. Please use the normal
            forms below — nothing was sent or paid.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
