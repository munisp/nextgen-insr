/**
 * MemberAirtimeVend.test.tsx — W10-B4a (2026-10-04): the real funds flows on
 * /member/airtime — memberAirtime.vend/confirmVend and
 * memberMobileMoney.cashIn/confirmCashIn/cashOut (W10-B2).
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub. All rendering and state handling are real. Proves:
 *   - vend sends a zod-exact body (network, amountNGN, idempotencyKey;
 *     phoneNumber ONLY when the member typed one — the server defaults it);
 *   - the vend idempotency key is stable per draft and rotates on edit;
 *   - the authorizationUrl handoff occurs and confirmVend renders the
 *     tri-state outcome honestly (submitted / failed+refund / unknown);
 *   - an invalid phone is blocked client-side (zod-exact guard) with NO
 *     mutation call;
 *   - cashIn uses the same two-phase pattern; cashOut is PENDING-only and
 *     surfaces the fail-closed PRECONDITION error verbatim (never hidden).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberAirtime from "@/pages/member/MemberAirtime";
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

const EMPTY_AIRTIME = {
  history: { history: [], total: 0 },
  summary: { periodDays: 30, totalTransactions: 0, byStatus: [] },
};

const MOMO_PROVIDERS = {
  providers: [
    { name: "MTN MoMo", cashInCommission: 0.015, cashOutCommission: 0.015 },
    { name: "Airtel Money", cashInCommission: 0.015, cashOutCommission: 0.015 },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 300000, dailyLimitNGN: 1000000 },
  configured: true,
};

const EMPTY_MOMO = {
  transactions: { transactions: [], count: 0 },
  summary: { periodDays: 30, totalTransactions: 0, byStatus: [] },
};

const KEY_RE = /^[A-Za-z0-9_-]{8,20}$/;

function setupBase() {
  setQuery("auth.me", { data: MEMBER });
  setQuery("memberAirtime.myHistory", { data: EMPTY_AIRTIME.history });
  setQuery("memberAirtime.mySummary", { data: EMPTY_AIRTIME.summary });
  setQuery("memberMobileMoney.providers", { data: MOMO_PROVIDERS });
  setQuery("memberMobileMoney.myTransactions", {
    data: EMPTY_MOMO.transactions,
  });
  setQuery("memberMobileMoney.mySummary", { data: EMPTY_MOMO.summary });
}

const VEND_INIT = {
  reference: "AV-1-xyz",
  authorizationUrl: "https://checkout.paystack.test/av1",
  accessCode: "ac",
  amount: "1000.00",
  currency: "NGN",
  transactionId: 21,
  status: "awaiting_payment",
  idempotent: false,
};

describe("MemberAirtime vend flow (W10-B4a)", () => {
  beforeEach(() => {
    resetTrpcMock();
    sessionStorage.clear();
    setupBase();
  });
  afterEach(() => cleanup());

  it("vend sends a zod-exact body (no phoneNumber when blank) and hands off to the authorizationUrl", () => {
    setMutation("memberAirtime.vend", { data: VEND_INIT });
    render(<MemberAirtime />);
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buy airtime" }));

    const calls = getMutationCalls("memberAirtime.vend") as Record<
      string,
      unknown
    >[];
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]).sort()).toEqual([
      "amountNGN",
      "idempotencyKey",
      "network",
    ]);
    expect(calls[0]).toMatchObject({ network: "MTN", amountNGN: 1000 });
    expect(calls[0].idempotencyKey).toMatch(KEY_RE);

    expect(screen.getByText("AV-1-xyz")).toBeInTheDocument();
    expect(screen.getByText("Complete payment")).toHaveAttribute(
      "href",
      "https://checkout.paystack.test/av1"
    );
  });

  it("vend sends the typed beneficiary phone; key is stable per draft and rotates on edit", () => {
    setMutation("memberAirtime.vend", {
      error: { message: "AIRTIME_PROVIDER_URL not configured (fail-closed)" },
    });
    render(<MemberAirtime />);
    fireEvent.change(screen.getByLabelText(/Phone \(optional\)/), {
      target: { value: "08031234567" },
    });
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "500" },
    });
    const btn = screen.getByRole("button", { name: "Buy airtime" });
    fireEvent.click(btn);
    fireEvent.click(btn);
    let calls = getMutationCalls("memberAirtime.vend") as Record<
      string,
      unknown
    >[];
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({
      network: "MTN",
      phoneNumber: "08031234567",
      amountNGN: 500,
    });
    expect(calls[0].idempotencyKey).toBe(calls[1].idempotencyKey);
    expect(
      screen.getByText(/not configured \(fail-closed\)/)
    ).toBeInTheDocument();

    // Edit the draft → new key.
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "700" },
    });
    fireEvent.click(btn);
    calls = getMutationCalls("memberAirtime.vend") as Record<string, unknown>[];
    expect(calls[2].idempotencyKey).not.toBe(calls[0].idempotencyKey);
  });

  it("an invalid phone is blocked client-side with NO mutation call", () => {
    render(<MemberAirtime />);
    fireEvent.change(screen.getByLabelText(/Phone \(optional\)/), {
      target: { value: "12345" },
    });
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "500" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buy airtime" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      /valid Nigerian phone number/
    );
    expect(getMutationCalls("memberAirtime.vend")).toEqual([]);
  });

  it("confirmVend renders each tri-state outcome honestly", () => {
    setMutation("memberAirtime.vend", { data: VEND_INIT });
    render(<MemberAirtime />);
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Buy airtime" }));

    // 1) submitted → pending fulfillment.
    setMutation("memberAirtime.confirmVend", {
      data: {
        reference: "AV-1-xyz",
        status: "pending",
        providerStatus: "submitted",
        captureStatus: "captured",
        amount: "1000.00",
        currency: "NGN",
        transactionId: 21,
        failureReason: null,
        refundStatus: null,
        idempotent: false,
      },
    });
    fireEvent.click(screen.getByText("I've paid — verify"));
    expect(getMutationCalls("memberAirtime.confirmVend")).toEqual([
      { reference: "AV-1-xyz" },
    ]);
    expect(screen.getByTestId("capture-outcome")).toHaveTextContent(
      /pending fulfillment/i
    );
    // Honest pending copy discloses non-delivery; no completion claim.
    expect(screen.getByTestId("capture-outcome")).toHaveTextContent(
      /NOT been delivered yet/i
    );
    expect(screen.getByTestId("capture-outcome")).not.toHaveTextContent(
      /completed/i
    );

    // 2) unknown_outcome → held pending.
    setMutation("memberAirtime.confirmVend", {
      data: {
        reference: "AV-1-xyz",
        status: "pending",
        providerStatus: "unknown_outcome",
        captureStatus: "captured",
        amount: "1000.00",
        currency: "NGN",
        transactionId: 21,
        failureReason: null,
        refundStatus: null,
        idempotent: false,
      },
    });
    fireEvent.click(screen.getByText("I've paid — verify"));
    expect(screen.getByTestId("capture-outcome")).toHaveTextContent(
      /held pending/i
    );

    // 3) failed + failed_refund_pending → loud.
    setMutation("memberAirtime.confirmVend", {
      data: {
        reference: "AV-1-xyz",
        status: "failed",
        providerStatus: "rejected",
        captureStatus: "captured",
        amount: "1000.00",
        currency: "NGN",
        transactionId: 21,
        failureReason: "Provider rejected the vend",
        refundStatus: "failed_refund_pending",
        idempotent: false,
      },
    });
    fireEvent.click(screen.getByText("I've paid — verify"));
    const outcome = screen.getByTestId("capture-outcome");
    expect(outcome).toHaveTextContent(/FAILED/);
    expect(outcome).toHaveTextContent("failed_refund_pending");
  });
});

describe("MemberAirtime mobile-money cash in/out (W10-B4a)", () => {
  beforeEach(() => {
    resetTrpcMock();
    sessionStorage.clear();
    setupBase();
  });
  afterEach(() => cleanup());

  it("cashIn sends a zod-exact body and uses the two-phase capture panel", () => {
    setMutation("memberMobileMoney.cashIn", {
      data: {
        reference: "CI-1-abc",
        authorizationUrl: "https://checkout.paystack.test/ci1",
        accessCode: "ac",
        amount: "2000.00",
        currency: "NGN",
        transactionId: 31,
        status: "awaiting_payment",
        idempotent: false,
      },
    });
    render(<MemberAirtime />);
    fireEvent.change(screen.getByLabelText("Cash amount (NGN)"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Cash in" }));

    const calls = getMutationCalls("memberMobileMoney.cashIn") as Record<
      string,
      unknown
    >[];
    expect(calls).toHaveLength(1);
    expect(Object.keys(calls[0]).sort()).toEqual([
      "amountNGN",
      "idempotencyKey",
      "provider",
    ]);
    expect(calls[0]).toMatchObject({ provider: "MTN MoMo", amountNGN: 2000 });
    expect(screen.getByText("Complete payment")).toHaveAttribute(
      "href",
      "https://checkout.paystack.test/ci1"
    );
  });

  it("cashOut records a PENDING provider-settled request (never a completed payout)", () => {
    setMutation("memberMobileMoney.cashOut", {
      data: {
        reference: "CO-1-def",
        status: "pending",
        providerStatus: "pending_provider",
        amount: "2000.00",
        currency: "NGN",
        transactionId: 32,
        failureReason: null,
        idempotent: false,
      },
    });
    render(<MemberAirtime />);
    fireEvent.change(screen.getByLabelText("Cash amount (NGN)"), { target: { value: "2000" } });
    fireEvent.click(screen.getByRole("button", { name: "Cash out" }));

    const calls = getMutationCalls("memberMobileMoney.cashOut") as Record<
      string,
      unknown
    >[];
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: "MTN MoMo", amountNGN: 2000 });
    const panel = screen.getByTestId("cashout-result");
    expect(panel).toHaveTextContent("CO-1-def");
    expect(panel).toHaveTextContent("pending");
    expect(panel).toHaveTextContent(/NOT a completed payout/i);
  });

  it("cashOut surfaces the fail-closed PRECONDITION error verbatim (operation not hidden)", () => {
    setMutation("memberMobileMoney.cashOut", {
      error: {
        message:
          "MOBILE_MONEY_PROVIDER_URL not configured — cash-out is unavailable (fail-closed)",
      },
    });
    render(<MemberAirtime />);
    // The Cash out button is present and attemptable.
    const btn = screen.getByRole("button", { name: "Cash out" });
    expect(btn).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Cash amount (NGN)"), { target: { value: "2000" } });
    fireEvent.click(btn);
    expect(screen.getByRole("alert")).toHaveTextContent(
      /not configured — cash-out is unavailable \(fail-closed\)/
    );
    expect(screen.queryByTestId("cashout-result")).not.toBeInTheDocument();
  });
});
