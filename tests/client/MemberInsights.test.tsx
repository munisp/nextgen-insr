/**
 * MemberInsights.test.tsx — 2026-10-24 (W11-B3b): Phase 3 client surfaces
 * over the W11-B3a memberInsights router:
 *   - NextActionsPanel (MemberLayout): top-3 ranked render, explain text,
 *     per-type CTA hrefs, recommendation_accepted / _dismissed /
 *     _dismissed_forever tracking, sessionStorage + localStorage dismissal,
 *     empty → hidden, error → silent degrade.
 *   - Anomaly soft-confirm gate (MemberBills Pay, MemberAirtime Buy): an
 *     anomalous verdict requires the explicit extra tap before the funds
 *     mutation fires; anomalous:false and check errors proceed normally.
 *   - Recurring-payment prompt at the terminal confirm moment, once per
 *     session per rail.
 *
 * Boundary mock ONLY: @/lib/trpc via the shared scriptable stub;
 * sessionStorage/localStorage/crypto are the real happy-dom APIs. uxTrack
 * flushes through the stubbed memberUxEvents.track mutation (the REAL
 * wiring registered by MemberLayout's useUxTracking).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberBills from "@/pages/member/MemberBills";
import MemberAirtime from "@/pages/member/MemberAirtime";
import { flushUxQueue } from "@/lib/uxTrack";
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
    { name: "DSTV", commissionRate: 0.01, commissionPct: "1.0%" },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 2000000 },
  configured: true,
};

const ACTIONS = [
  {
    type: "policy_renewal_due",
    priority: 100,
    explain: "Policy POL-1 renews on 2026-11-01 (within 14 days).",
    payload: { policyId: 77 },
  },
  {
    type: "failed_refund_pending",
    priority: 90,
    explain: "Payment BP-1 was captured but the provider rejected fulfillment — a manual refund is pending with operations.",
    payload: { transactionId: 11, reference: "BP-1" },
  },
  {
    type: "recurring_bill_due",
    priority: 70,
    explain: "Your recurring bill payment (every ~30 days, ~₦5,000) looks due around 2026-11-05.",
    payload: { naturalKey: "nk1", rail: "bill" },
  },
  {
    type: "kyc_incomplete",
    priority: 40,
    explain: "Your identity verification is not complete — finish KYC to unlock higher limits.",
    payload: {},
  },
];

function setupBillsDraft() {
  setQuery("memberBillPayments.billers", { data: BILLERS });
  setQuery("memberBillPayments.validateCustomer", {
    data: {
      valid: true,
      customerNumber: "12345678901",
      biller: "EKEDC",
      message: "Valid",
    },
  });
}

/** Fill + validate so the Pay button is armed. */
function preparePayable() {
  fireEvent.change(screen.getByLabelText(/Customer \/ meter number/), {
    target: { value: "12345678901" },
  });
  fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
    target: { value: "5000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Validate" }));
}

/** Events of one kind flushed to memberUxEvents.track. The CTA click also
 *  navigates (wouter), which schedules a React update that can remount the
 *  page under act() — so flush up to 3 times and collect across ALL flushes
 *  (the assertion stays exact: exactly one event of the kind). */
async function trackedEvents(kind: string) {
  let found: Array<{ flow: string; event: string; metadataJson?: Record<string, unknown> }> = [];
  for (let i = 0; i < 3; i++) {
    await act(async () => {
      await flushUxQueue();
    });
    const calls = getMutationCalls("memberUxEvents.track") as {
      events: Array<{ flow: string; event: string; metadataJson?: Record<string, unknown> }>;
    }[];
    found = calls.flatMap(c => c.events).filter(e => e.event === kind);
    if (found.length > 0) break;
  }
  return found;
}

describe("NextActionsPanel (W11-B3b)", () => {
  beforeEach(() => {
    resetTrpcMock();
    sessionStorage.clear();
    localStorage.clear();
    setQuery("auth.me", { data: MEMBER });
    setupBillsDraft();
  });
  afterEach(() => cleanup());

  it("renders the top 3 ranked actions with explain text and per-type CTA hrefs; the 4th is hidden", () => {
    setQuery("memberInsights.nextBestActions", { data: { actions: ACTIONS } });
    render(<MemberBills />);

    const panel = screen.getByTestId("next-actions");
    expect(panel).toBeInTheDocument();
    // Rank order preserved (server sorts by priority desc).
    expect(screen.getByTestId("nba-policy_renewal_due")).toBeInTheDocument();
    expect(screen.getByTestId("nba-failed_refund_pending")).toBeInTheDocument();
    expect(screen.getByTestId("nba-recurring_bill_due")).toBeInTheDocument();
    // Top-3 cap: the lowest-priority action is NOT rendered.
    expect(screen.queryByTestId("nba-kyc_incomplete")).not.toBeInTheDocument();
    // Explain text rendered verbatim.
    expect(
      screen.getByText(/Policy POL-1 renews on 2026-11-01/)
    ).toBeInTheDocument();
    // CTA deep links: renewal carries the policyId to the renewals flow.
    expect(screen.getByRole("link", { name: "Review renewal" })).toHaveAttribute(
      "href",
      "/member/renewals?policyId=77"
    );
    expect(
      screen.getByRole("link", { name: "View payment issue" })
    ).toHaveAttribute("href", "/member/disputes");
    expect(screen.getByRole("link", { name: "Pay now" })).toHaveAttribute(
      "href",
      "/member/bills"
    );
  });

  it("routes the recurring CTA to the airtime page when the candidate rail is airtime", () => {
    setQuery("memberInsights.nextBestActions", {
      data: {
        actions: [
          {
            type: "recurring_bill_due",
            priority: 70,
            explain: "Your recurring airtime payment looks due.",
            payload: { naturalKey: "nk2", rail: "airtime" },
          },
        ],
      },
    });
    render(<MemberBills />);
    expect(screen.getByRole("link", { name: "Pay now" })).toHaveAttribute(
      "href",
      "/member/airtime"
    );
  });

  it("CTA click tracks recommendation_accepted via uxTrack", async () => {
    setQuery("memberInsights.nextBestActions", {
      data: { actions: [ACTIONS[3]] }, // kyc_incomplete → /member/identity
    });
    render(<MemberBills />);
    fireEvent.click(screen.getByRole("link", { name: "Complete KYC" }));
    const accepted = await trackedEvents("recommendation_accepted");
    expect(accepted).toHaveLength(1);
    expect(accepted[0].flow).toBe("member-insights");
    expect(accepted[0].metadataJson).toEqual({ action: "kyc_incomplete" });
  });

  it("Dismiss hides the action for the session (sessionStorage) and tracks recommendation_dismissed; a fresh render stays dismissed", async () => {
    setQuery("memberInsights.nextBestActions", {
      data: { actions: [ACTIONS[3]] },
    });
    const first = render(<MemberBills />);
    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss suggestion kyc_incomplete" })
    );
    expect(screen.queryByTestId("nba-kyc_incomplete")).not.toBeInTheDocument();
    const dismissed = await trackedEvents("recommendation_dismissed");
    expect(dismissed).toHaveLength(1);
    first.unmount();

    // Fresh mount in the SAME session → still dismissed.
    render(<MemberBills />);
    expect(screen.queryByTestId("next-actions")).not.toBeInTheDocument();
  });

  it("the X button is a device-local dismiss-forever (localStorage) and tracks recommendation_dismissed_forever", async () => {
    setQuery("memberInsights.nextBestActions", {
      data: { actions: [ACTIONS[3]] },
    });
    const first = render(<MemberBills />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Never show suggestion kyc_incomplete again",
      })
    );
    expect(screen.queryByTestId("nba-kyc_incomplete")).not.toBeInTheDocument();
    const forever = await trackedEvents("recommendation_dismissed_forever");
    expect(forever).toHaveLength(1);
    first.unmount();

    // Even with the SESSION store cleared, the forever flag holds.
    sessionStorage.clear();
    render(<MemberBills />);
    expect(screen.queryByTestId("next-actions")).not.toBeInTheDocument();
  });

  it("a scrambled server array still renders in documented priority order (W13-B defensive sort)", () => {
    // verify-w11b3b Finding 2: the panel must not trust server array order.
    setQuery("memberInsights.nextBestActions", {
      data: { actions: [ACTIONS[3], ACTIONS[2], ACTIONS[1], ACTIONS[0]] },
    });
    render(<MemberBills />);

    const order = screen
      .getAllByRole("listitem")
      .map(li => li.getAttribute("data-testid"));
    expect(order).toEqual([
      "nba-policy_renewal_due",
      "nba-failed_refund_pending",
      "nba-recurring_bill_due",
    ]);
    // Top-3 cap applies AFTER the sort: kyc (40) stays hidden.
    expect(screen.queryByTestId("nba-kyc_incomplete")).not.toBeInTheDocument();
  });

  it("an UNKNOWN future action type is hidden fail-closed — no crash, the routable actions still render (W13-B)", () => {
    setQuery("memberInsights.nextBestActions", {
      data: {
        actions: [
          {
            type: "some_future_action_type", // not in the known union
            priority: 500, // even outranking everything
            explain: "A suggestion this client cannot route.",
            payload: {},
          },
          ACTIONS[0], // policy_renewal_due
        ],
      },
    });
    render(<MemberBills />);

    const panel = screen.getByTestId("next-actions");
    expect(panel).toBeInTheDocument();
    // The unroutable suggestion is hidden — not dead-clickable.
    expect(
      screen.queryByText("A suggestion this client cannot route.")
    ).not.toBeInTheDocument();
    // The known action renders normally.
    expect(screen.getByTestId("nba-policy_renewal_due")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Review renewal" })).toHaveAttribute(
      "href",
      "/member/renewals?policyId=77"
    );
  });

  it("empty actions hide the panel entirely; an error degrades silently", () => {
    setQuery("memberInsights.nextBestActions", { data: { actions: [] } });
    const { unmount } = render(<MemberBills />);
    expect(screen.queryByTestId("next-actions")).not.toBeInTheDocument();
    unmount();

    resetTrpcMock();
    setQuery("auth.me", { data: MEMBER });
    setupBillsDraft();
    setQuery("memberInsights.nextBestActions", {
      isError: true,
      error: { message: "DB unavailable" },
    });
    render(<MemberBills />);
    expect(screen.queryByTestId("next-actions")).not.toBeInTheDocument();
    // The page itself still renders (suggestions never block the portal).
    expect(screen.getByRole("button", { name: "Pay" })).toBeInTheDocument();
  });
});

describe("Anomaly soft-confirm gate — MemberBills (W11-B3b)", () => {
  beforeEach(() => {
    resetTrpcMock();
    sessionStorage.clear();
    localStorage.clear();
    setQuery("auth.me", { data: MEMBER });
    setupBillsDraft();
  });
  afterEach(() => cleanup());

  it("an anomalous verdict holds the payment until the explicit confirm tap", () => {
    setQuery("memberInsights.amountAnomalyCheck", {
      data: { anomalous: true, multiple: 4.2, reason: "exceeds_historical_multiple" },
    });
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-9-xyz",
        authorizationUrl: "https://checkout.paystack.test/bp9",
        amount: "5000.00",
        currency: "NGN",
        idempotent: false,
      },
    });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));

    // The soft-confirm appears and the funds mutation has NOT fired.
    const dialog = screen.getByTestId("anomaly-soft-confirm");
    expect(dialog).toHaveTextContent("₦5,000.00 is 4.2× your usual payment");
    expect(getMutationCalls("memberBillPayments.pay")).toHaveLength(0);

    // Explicit extra tap → exactly one pay call.
    fireEvent.click(screen.getByTestId("anomaly-confirm"));
    expect(getMutationCalls("memberBillPayments.pay")).toHaveLength(1);
    expect(screen.queryByTestId("anomaly-soft-confirm")).not.toBeInTheDocument();
  });

  it("Pay is disabled with a visible Checking… state while the anomaly check is in flight (no multi-tap dispatch)", () => {
    // verify-w11b3b Finding 1 / W13-B: rapid Pay taps must not multi-dispatch.
    setQuery("memberInsights.amountAnomalyCheck", { isLoading: true });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));

    // Honest busy state: disabled + labeled; further taps are no-ops.
    const busy = screen.getByRole("button", { name: "Checking…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    fireEvent.click(busy);
    expect(getMutationCalls("memberBillPayments.pay")).toHaveLength(0);
  });

  it("Go back closes the dialog without paying", () => {
    setQuery("memberInsights.amountAnomalyCheck", {
      data: { anomalous: true, multiple: 4.2, reason: "exceeds_historical_multiple" },
    });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    expect(screen.queryByTestId("anomaly-soft-confirm")).not.toBeInTheDocument();
    expect(getMutationCalls("memberBillPayments.pay")).toHaveLength(0);
  });

  it("anomalous:false proceeds straight to pay (no dialog)", () => {
    setQuery("memberInsights.amountAnomalyCheck", {
      data: { anomalous: false, multiple: 1.1, reason: "within_historical_range" },
    });
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-10-abc",
        authorizationUrl: "https://checkout.paystack.test/bp10",
        amount: "5000.00",
        currency: "NGN",
        idempotent: false,
      },
    });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(screen.queryByTestId("anomaly-soft-confirm")).not.toBeInTheDocument();
    expect(getMutationCalls("memberBillPayments.pay")).toHaveLength(1);
  });

  it("a check error degrades silently and proceeds to pay", () => {
    setQuery("memberInsights.amountAnomalyCheck", {
      isError: true,
      error: { message: "DB unavailable" },
    });
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-11-def",
        authorizationUrl: "https://checkout.paystack.test/bp11",
        amount: "5000.00",
        currency: "NGN",
        idempotent: false,
      },
    });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    expect(screen.queryByTestId("anomaly-soft-confirm")).not.toBeInTheDocument();
    expect(getMutationCalls("memberBillPayments.pay")).toHaveLength(1);
  });

  it("a terminal confirm surfaces the recurring prompt when the payee matches a candidate (once per session)", () => {
    setQuery("memberInsights.recurringCandidates", {
      data: {
        candidates: [
          {
            naturalKey: "nk1",
            rail: "bill",
            occurrences: 3,
            cadenceDays: 30,
            averageAmountKobo: 500000, // ₦5,000 — matches the paid amount
            dueSoon: true,
          },
        ],
        state: "detections_only",
      },
    });
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-12-ghi",
        authorizationUrl: "https://checkout.paystack.test/bp12",
        amount: "5000.00",
        currency: "NGN",
        idempotent: false,
      },
    });
    setMutation("memberBillPayments.confirmPay", {
      data: {
        reference: "BP-12-ghi",
        status: "success",
        providerStatus: "success",
        amount: "5000.00",
        currency: "NGN",
      },
    });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    fireEvent.click(
      screen.getByRole("button", { name: "I've paid — verify" })
    );
    const prompt = screen.getByTestId("recurring-prompt");
    expect(prompt).toHaveTextContent("This looks like a monthly payment");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("recurring-prompt")).not.toBeInTheDocument();
  });

  it("once per session per rail: a SECOND terminal confirm must NOT re-prompt (regression for the once-guard, verify-w11b3b Finding 3)", () => {
    setQuery("memberInsights.recurringCandidates", {
      data: {
        candidates: [
          {
            naturalKey: "nk1",
            rail: "bill",
            occurrences: 3,
            cadenceDays: 30,
            averageAmountKobo: 500000, // ₦5,000 — matches the paid amount
            dueSoon: true,
          },
        ],
        state: "detections_only",
      },
    });
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-14-mno",
        authorizationUrl: "https://checkout.paystack.test/bp14",
        amount: "5000.00",
        currency: "NGN",
        idempotent: false,
      },
    });
    setMutation("memberBillPayments.confirmPay", {
      data: {
        reference: "BP-14-mno",
        status: "success",
        providerStatus: "success",
        amount: "5000.00",
        currency: "NGN",
      },
    });
    render(<MemberBills />);

    // First terminal confirm → prompt shows once; dismiss it.
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    fireEvent.click(
      screen.getByRole("button", { name: "I've paid — verify" })
    );
    expect(screen.getByTestId("recurring-prompt")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("recurring-prompt")).not.toBeInTheDocument();

    // Second full payment in the SAME session → terminal confirm must NOT
    // re-show the prompt (the rail is already marked shown in
    // sessionStorage). Removing the once-guard in insightsGuards.tsx turns
    // this RED.
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    fireEvent.click(
      screen.getByRole("button", { name: "I've paid — verify" })
    );
    expect(getMutationCalls("memberBillPayments.confirmPay")).toHaveLength(2);
    expect(screen.queryByTestId("recurring-prompt")).not.toBeInTheDocument();
  });

  it("no prompt when the paid amount does not match any candidate", () => {
    setQuery("memberInsights.recurringCandidates", {
      data: {
        candidates: [
          {
            naturalKey: "nk9",
            rail: "bill",
            occurrences: 3,
            cadenceDays: 30,
            averageAmountKobo: 999900, // ₦9,999 — does NOT match ₦5,000
            dueSoon: true,
          },
        ],
        state: "detections_only",
      },
    });
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-13-jkl",
        authorizationUrl: "https://checkout.paystack.test/bp13",
        amount: "5000.00",
        currency: "NGN",
        idempotent: false,
      },
    });
    setMutation("memberBillPayments.confirmPay", {
      data: {
        reference: "BP-13-jkl",
        status: "success",
        providerStatus: "success",
        amount: "5000.00",
        currency: "NGN",
      },
    });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    fireEvent.click(
      screen.getByRole("button", { name: "I've paid — verify" })
    );
    expect(screen.queryByTestId("recurring-prompt")).not.toBeInTheDocument();
  });
});

describe("Anomaly soft-confirm gate — MemberAirtime (W11-B3b)", () => {
  beforeEach(() => {
    resetTrpcMock();
    sessionStorage.clear();
    localStorage.clear();
    setQuery("auth.me", { data: MEMBER });
    // Buy section only needs the history/summary queries to settle empty.
  });
  afterEach(() => cleanup());

  function prepareVendable() {
    fireEvent.change(screen.getByLabelText("Phone (optional)"), {
      target: { value: "08031234567" },
    });
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "1000" },
    });
  }

  it("an anomalous verdict holds the vend until the explicit confirm tap", () => {
    setQuery("memberInsights.amountAnomalyCheck", {
      data: { anomalous: true, multiple: 6.5, reason: "exceeds_historical_multiple" },
    });
    setMutation("memberAirtime.vend", {
      data: {
        reference: "AV-1-abc",
        authorizationUrl: "https://checkout.paystack.test/av1",
        amount: "1000.00",
        currency: "NGN",
        idempotent: false,
      },
    });
    render(<MemberAirtime />);
    prepareVendable();
    fireEvent.click(screen.getByRole("button", { name: "Buy airtime" }));

    expect(screen.getByTestId("anomaly-soft-confirm")).toHaveTextContent(
      "₦1,000.00 is 6.5× your usual payment"
    );
    expect(getMutationCalls("memberAirtime.vend")).toHaveLength(0);
    fireEvent.click(screen.getByTestId("anomaly-confirm"));
    expect(getMutationCalls("memberAirtime.vend")).toHaveLength(1);
  });

  it("Buy airtime is disabled with a visible Checking… state while the anomaly check is in flight (no multi-tap dispatch)", () => {
    // verify-w11b3b Finding 1 / W13-B.
    setQuery("memberInsights.amountAnomalyCheck", { isLoading: true });
    render(<MemberAirtime />);
    prepareVendable();
    fireEvent.click(screen.getByRole("button", { name: "Buy airtime" }));

    const busy = screen.getByRole("button", { name: "Checking…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    expect(getMutationCalls("memberAirtime.vend")).toHaveLength(0);
  });

  it("anomalous:false proceeds straight to vend (no dialog)", () => {
    setQuery("memberInsights.amountAnomalyCheck", {
      data: { anomalous: false, multiple: 1.0, reason: "within_historical_range" },
    });
    setMutation("memberAirtime.vend", {
      data: {
        reference: "AV-2-def",
        authorizationUrl: "https://checkout.paystack.test/av2",
        amount: "1000.00",
        currency: "NGN",
        idempotent: false,
      },
    });
    render(<MemberAirtime />);
    prepareVendable();
    fireEvent.click(screen.getByRole("button", { name: "Buy airtime" }));
    expect(screen.queryByTestId("anomaly-soft-confirm")).not.toBeInTheDocument();
    expect(getMutationCalls("memberAirtime.vend")).toHaveLength(1);
  });
});
