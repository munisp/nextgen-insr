/**
 * Omnibox.test.tsx — 2026-10-25 (W11-B4b): member omnibox client surface
 * over the W11-B4a memberIntent router (parseIntent / resolvePayeeHint).
 *
 * Matrix (funds-critical):
 *   - ready airtime intent → summary card → Continue navigates to
 *     /member/airtime with the one-shot prefill stash; NO payment endpoint
 *     is ever called and nothing is auto-submitted.
 *   - ready bill intent → Continue navigates to /member/bills with stash.
 *   - clarification → the question renders inline, no navigation.
 *   - unsupported → honest message + what IS supported, no navigation.
 *   - parse error → fail-closed message, no navigation.
 *   - Prefill consumption: MemberBills/MemberAirtime land the parsed values
 *     in normal form state (amount included) with Pay/Buy still locked
 *     behind the normal validate + submit path.
 *   - Endpoint discipline: the ONLY tRPC calls the omnibox flow makes are
 *     memberIntent.parseIntent and memberUxEvents.track (ux tracking).
 *   - Instrumentation: omnibox_opened / intent_parsed (type only) /
 *     prefill_applied (rail only) / clarify_shown — scrubbed metadata.
 *
 * Boundary mock ONLY: @/lib/trpc via the shared scriptable stub;
 * sessionStorage/crypto are the real happy-dom APIs. uxTrack flushes
 * through the stubbed memberUxEvents.track mutation (harness wires the
 * REAL useUxTracking).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import { ReactNode } from "react";
import { Omnibox } from "@/pages/member/Omnibox";
import MemberBills from "@/pages/member/MemberBills";
import MemberAirtime from "@/pages/member/MemberAirtime";
import { flushUxQueue, useUxTracking } from "@/lib/uxTrack";
import {
  stashOmniboxPrefill,
  takeOmniboxPrefill,
  hasOmniboxPrefill,
} from "@/pages/member/omniboxPrefill";
import {
  setQuery,
  setMutation,
  getMutationCalls,
  resetTrpcMock,
} from "./helpers/trpcMock";

const MEMBER = {
  id: 9001,
  name: "Adaeze Test",
  email: "adaeze@example.com",
  role: "user",
};

const BILLERS = {
  billers: [
    { name: "EKEDC", commissionRate: 0.005, commissionPct: "0.5%" },
    { name: "IKEDC", commissionRate: 0.005, commissionPct: "0.5%" },
    { name: "DSTV", commissionRate: 0.01, commissionPct: "1.0%" },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 2000000 },
  configured: true,
};

const MOMO_PROVIDERS = {
  providers: [
    { name: "MTN MoMo" },
    { name: "Airtel Money" },
    { name: "Glo Xtra" },
    { name: "9PSB" },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 300000, dailyLimitNGN: 1000000 },
  configured: true,
};

/** Harness wiring the REAL useUxTracking so trackEvent flushes through the
 *  stubbed memberUxEvents.track mutation (same convention as
 *  MemberInsights.test.tsx). */
function UxHarness({ children }: { children: ReactNode }) {
  useUxTracking();
  return <>{children}</>;
}

function renderOmnibox() {
  return render(
    <UxHarness>
      <Omnibox />
    </UxHarness>
  );
}

/** All ux events flushed so far (cumulative — the queue is module-global). */
async function trackedEvents() {
  let found: Array<{ flow: string; event: string; metadataJson?: Record<string, unknown> }> = [];
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await flushUxQueue();
    });
    const calls = getMutationCalls("memberUxEvents.track") as {
      events: Array<{ flow: string; event: string; metadataJson?: Record<string, unknown> }>;
    }[];
    found = calls.flatMap(c => c.events);
  }
  return found;
}

function typeAndGo(text: string) {
  fireEvent.change(screen.getByLabelText("Omnibox request"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByTestId("omnibox-submit"));
}

/** Every mutation path the app called other than ux tracking. */
function nonTrackingMutationPaths(): string[] {
  // The mock records per-path; enumerate the known funds/parse paths.
  const paths = [
    "memberIntent.parseIntent",
    "memberBillPayments.pay",
    "memberBillPayments.confirmPay",
    "memberAirtime.vend",
    "memberAirtime.confirmVend",
    "memberMobileMoney.cashIn",
    "memberMobileMoney.cashOut",
    "memberMobileMoney.confirmCashIn",
    "memberClaims.fileClaim",
    "memberRenewals.requestRenewal",
  ];
  return paths.filter(p => getMutationCalls(p).length > 0);
}

beforeEach(() => {
  resetTrpcMock();
  sessionStorage.clear();
  localStorage.clear();
  window.history.replaceState(null, "", "/member/bills");
  // Drain any leftover one-shot stash (the module slot is module-global).
  takeOmniboxPrefill("bill");
  takeOmniboxPrefill("airtime");
  takeOmniboxPrefill("momo");
  setQuery("auth.me", { data: MEMBER });
  setQuery("memberBillPayments.billers", { data: BILLERS });
  setQuery("memberMobileMoney.providers", { data: MOMO_PROVIDERS });
});
afterEach(() => cleanup());

describe("Omnibox (W11-B4b) — ready intents", () => {
  it("ready airtime intent renders the summary card; Continue navigates to /member/airtime with the prefill stash and never calls a payment endpoint", () => {
    setMutation("memberIntent.parseIntent", {
      data: {
        result: {
          status: "ready",
          intent: {
            flow: "airtime_vend",
            network: "MTN",
            phone: "08031234567",
            amountNGN: 2000,
          },
        },
        payee: null,
      },
    });
    renderOmnibox();
    typeAndGo("buy ₦2,000 MTN airtime for 08031234567");

    // The parse call went ONLY to memberIntent.parseIntent with the raw text.
    expect(getMutationCalls("memberIntent.parseIntent")).toEqual([
      { text: "buy ₦2,000 MTN airtime for 08031234567" },
    ]);

    const card = screen.getByTestId("omnibox-ready");
    expect(card).toHaveTextContent("Buy ₦2,000.00 MTN airtime for 08031234567");
    expect(card).toHaveTextContent("Nothing is paid yet");

    // No navigation happened yet.
    expect(window.location.pathname).toBe("/member/bills");

    fireEvent.click(screen.getByTestId("omnibox-continue"));
    expect(window.location.pathname).toBe("/member/airtime");
    // The one-shot stash holds the parsed values for the airtime form.
    expect(hasOmniboxPrefill("airtime")).toBe(true);
    const stash = takeOmniboxPrefill("airtime");
    expect(stash).toEqual({
      rail: "airtime",
      network: "MTN",
      phone: "08031234567",
      amountNGN: 2000,
    });
    // NEVER a payment call — only the parse.
    expect(nonTrackingMutationPaths()).toEqual(["memberIntent.parseIntent"]);
  });

  it("ready bill intent navigates to /member/bills with the bill stash", () => {
    setMutation("memberIntent.parseIntent", {
      data: {
        result: {
          status: "ready",
          intent: {
            flow: "bill_pay",
            billerCode: "IKEDC",
            customerNumber: "12345678901",
            amountNGN: 5000,
          },
        },
        payee: { payeeId: "p1", label: "Home meter" },
      },
    });
    renderOmnibox();
    typeAndGo("pay ikeja electric meter 12345678901 ₦5,000");

    const card = screen.getByTestId("omnibox-ready");
    expect(card).toHaveTextContent(
      "Pay ₦5,000.00 to IKEDC for customer 12345678901"
    );
    expect(card).toHaveTextContent("Matches your saved payee: Home meter");

    fireEvent.click(screen.getByTestId("omnibox-continue"));
    expect(window.location.pathname).toBe("/member/bills");
    expect(takeOmniboxPrefill("bill")).toEqual({
      rail: "bill",
      billerCode: "IKEDC",
      customerNumber: "12345678901",
      amountNGN: 5000,
    });
    expect(nonTrackingMutationPaths()).toEqual(["memberIntent.parseIntent"]);
  });

  it("ready momo cash-in intent navigates to /member/airtime with the momo stash", () => {
    setMutation("memberIntent.parseIntent", {
      data: {
        result: {
          status: "ready",
          intent: { flow: "momo_cash_in", provider: "MTN MoMo", amountNGN: 10000 },
        },
        payee: null,
      },
    });
    renderOmnibox();
    typeAndGo("fund my mtn momo wallet with ₦10,000");

    expect(screen.getByTestId("omnibox-ready")).toHaveTextContent(
      "Cash in ₦10,000.00 to your MTN MoMo wallet"
    );
    fireEvent.click(screen.getByTestId("omnibox-continue"));
    expect(window.location.pathname).toBe("/member/airtime");
    expect(takeOmniboxPrefill("momo")).toEqual({
      rail: "momo",
      provider: "MTN MoMo",
      amountNGN: 10000,
    });
    expect(nonTrackingMutationPaths()).toEqual(["memberIntent.parseIntent"]);
  });

  it("navigate intent routes without any stash or payment call", () => {
    setMutation("memberIntent.parseIntent", {
      data: {
        result: {
          status: "ready",
          intent: { flow: "navigate", target: "claims_file" },
        },
        payee: null,
      },
    });
    renderOmnibox();
    typeAndGo("file a claim");
    fireEvent.click(screen.getByTestId("omnibox-continue"));
    expect(window.location.pathname).toBe("/member/claims");
    expect(hasOmniboxPrefill("bill")).toBe(false);
    expect(hasOmniboxPrefill("airtime")).toBe(false);
    expect(hasOmniboxPrefill("momo")).toBe(false);
    expect(nonTrackingMutationPaths()).toEqual(["memberIntent.parseIntent"]);
  });
});

describe("Omnibox (W11-B4b) — clarification / unsupported / error", () => {
  it("clarification renders the question inline with option chips and never navigates or guesses", async () => {
    setMutation("memberIntent.parseIntent", {
      data: {
        result: {
          status: "clarification",
          flow: "airtime_vend",
          missing: ["network"],
          partial: { phone: "08031234567", amountNGN: 2000 },
          reason: "missing_fields",
        },
        payee: null,
      },
    });
    renderOmnibox();
    typeAndGo("buy ₦2,000 airtime for 08031234567");

    const box = screen.getByTestId("omnibox-clarify");
    expect(box).toHaveTextContent("I need a bit more detail");
    expect(box).toHaveTextContent("the network");
    // Partials are honestly shown (the member's own typed values).
    expect(box).toHaveTextContent("phone = 08031234567");
    // Option chips append to the input for an explicit resubmit — never
    // an auto-pick.
    fireEvent.click(screen.getByTestId("omnibox-chip-MTN"));
    expect(screen.getByLabelText("Omnibox request")).toHaveValue(
      "buy ₦2,000 airtime for 08031234567 MTN"
    );
    // No navigation, no ready card.
    expect(window.location.pathname).toBe("/member/bills");
    expect(screen.queryByTestId("omnibox-ready")).not.toBeInTheDocument();
    expect(nonTrackingMutationPaths()).toEqual(["memberIntent.parseIntent"]);

    const events = await trackedEvents();
    expect(
      events.some(
        e => e.event === "clarify_shown" && e.metadataJson?.flow === "airtime_vend"
      )
    ).toBe(true);
  });

  it("unsupported renders the honest refusal plus what IS supported; no navigation", () => {
    setMutation("memberIntent.parseIntent", {
      data: {
        result: { status: "unsupported", reason: "data_bundle_not_supported" },
        payee: null,
      },
    });
    renderOmnibox();
    typeAndGo("buy 1gb data");

    const box = screen.getByTestId("omnibox-unsupported");
    expect(box).toHaveTextContent("Data bundles aren't supported");
    expect(box).toHaveTextContent("Supported: buy airtime");
    expect(window.location.pathname).toBe("/member/bills");
    expect(nonTrackingMutationPaths()).toEqual(["memberIntent.parseIntent"]);
  });

  it("parse error fails closed: honest message, no navigation, no prefill", () => {
    setMutation("memberIntent.parseIntent", {
      error: { message: "TOO_MANY_REQUESTS" },
    });
    renderOmnibox();
    typeAndGo("buy ₦2,000 MTN airtime for 08031234567");

    expect(screen.getByTestId("omnibox-error")).toHaveTextContent(
      "couldn't read that right now"
    );
    expect(window.location.pathname).toBe("/member/bills");
    expect(hasOmniboxPrefill("airtime")).toBe(false);
    expect(nonTrackingMutationPaths()).toEqual(["memberIntent.parseIntent"]);
  });
});

describe("Omnibox (W11-B4b) — instrumentation discipline", () => {
  it("tracks omnibox_opened / intent_parsed (type only) / prefill_applied (rail only) with scrubbed metadata", async () => {
    setMutation("memberIntent.parseIntent", {
      data: {
        result: {
          status: "ready",
          intent: {
            flow: "airtime_vend",
            network: "MTN",
            phone: "08031234567",
            amountNGN: 2000,
          },
        },
        payee: null,
      },
    });
    renderOmnibox();
    fireEvent.focus(screen.getByLabelText("Omnibox request"));
    typeAndGo("buy ₦2,000 MTN airtime for 08031234567");
    fireEvent.click(screen.getByTestId("omnibox-continue"));

    const events = await trackedEvents();
    const opened = events.filter(e => e.event === "omnibox_opened");
    expect(opened.length).toBeGreaterThanOrEqual(1);
    expect(opened[0].flow).toBe("member-omnibox");

    const parsed = events.filter(e => e.event === "intent_parsed");
    expect(parsed.length).toBeGreaterThanOrEqual(1);
    // Metadata carries the intent TYPE only — no text, amounts, identifiers.
    expect(parsed[0].metadataJson).toEqual({ intentType: "ready" });

    const applied = events.filter(e => e.event === "prefill_applied");
    expect(applied.length).toBeGreaterThanOrEqual(1);
    expect(applied[0].metadataJson).toEqual({ rail: "airtime" });

    // Scrub sweep: no event metadata may carry the raw text / amount / phone.
    for (const e of events) {
      const blob = JSON.stringify(e.metadataJson ?? {});
      expect(blob).not.toContain("08031234567");
      expect(blob).not.toContain("2,000");
      expect(blob).not.toContain("2000");
      expect(blob).not.toContain("MTN airtime");
    }
  });
});

describe("Omnibox (W11-B4b) — prefill consumption (PREFILL-ONLY)", () => {
  it("MemberBills lands the stashed bill draft in normal form state; Pay stays locked behind Validate and nothing is auto-submitted", () => {
    stashOmniboxPrefill({
      rail: "bill",
      billerCode: "EKEDC",
      customerNumber: "12345678901",
      amountNGN: 5000,
    });
    render(<MemberBills />);

    expect(screen.getByLabelText(/Customer \/ meter number/)).toHaveValue(
      "12345678901"
    );
    expect(screen.getByLabelText("Amount (NGN)")).toHaveValue("5000");
    // Honest provenance copy for the omnibox source.
    expect(screen.getByTestId("prefill-hint")).toHaveTextContent(
      "Prefilled from your omnibox request"
    );
    // The stash was consumed exactly once.
    expect(hasOmniboxPrefill("bill")).toBe(false);
    // NOT auto-submitted: no validate query fired with the prefilled draft
    // (validateCustomer only fires after the member taps Validate), Pay is
    // disabled, and no payment mutation was called.
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
    expect(getMutationCalls("memberBillPayments.pay")).toEqual([]);
    expect(getMutationCalls("memberBillPayments.confirmPay")).toEqual([]);
  });

  it("MemberAirtime lands the stashed airtime draft; Buy stays locked behind the normal submit", () => {
    stashOmniboxPrefill({
      rail: "airtime",
      network: "Glo",
      phone: "08051234567",
      amountNGN: 1500,
    });
    render(<MemberAirtime />);

    expect(screen.getByLabelText("Phone (optional)")).toHaveValue("08051234567");
    expect(screen.getByLabelText("Amount (NGN)")).toHaveValue("1500");
    expect(screen.getByTestId("prefill-hint-airtime")).toHaveTextContent(
      "Prefilled from your omnibox request"
    );
    expect(hasOmniboxPrefill("airtime")).toBe(false);
    expect(getMutationCalls("memberAirtime.vend")).toEqual([]);
  });

  it("MemberAirtime momo section lands the stashed cash-in draft; no cash-in is auto-submitted", () => {
    stashOmniboxPrefill({
      rail: "momo",
      provider: "MTN MoMo",
      amountNGN: 10000,
    });
    render(<MemberAirtime />);

    expect(screen.getByLabelText("Cash amount (NGN)")).toHaveValue("10000");
    expect(screen.getByTestId("prefill-hint-momo")).toHaveTextContent(
      "Prefilled from your omnibox request"
    );
    expect(hasOmniboxPrefill("momo")).toBe(false);
    expect(getMutationCalls("memberMobileMoney.cashIn")).toEqual([]);
    expect(getMutationCalls("memberMobileMoney.cashOut")).toEqual([]);
  });
});
