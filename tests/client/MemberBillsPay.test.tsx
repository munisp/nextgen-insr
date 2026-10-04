/**
 * MemberBillsPay.test.tsx — W10-B4a (2026-10-04): the real Pay flow on
 * /member/bills, wired to memberBillPayments.pay + confirmPay (W10-B2).
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub; sessionStorage/crypto are the real happy-dom APIs. All
 * rendering and state handling are real. Proves:
 *   - Pay calls memberBillPayments.pay with a zod-exact body (biller,
 *     customerNumber, meterType, amountNGN, idempotencyKey) — NO computed
 *     fields beyond the member's intent (the client never computes prices);
 *   - idempotency-key stability: same draft → same key across retries;
 *     editing the draft → new key; a terminal confirm outcome retires the
 *     key so the next identical draft gets a fresh one;
 *   - the authorizationUrl handoff renders the real reference + link
 *     (MemberPayments pattern), never a fake success screen;
 *   - confirmPay renders each tri-state outcome honestly (submitted =
 *     pending fulfillment, failed+refund_pending = loud, unknown_outcome =
 *     held pending);
 *   - an invalid validateCustomer verdict BLOCKS the Pay button;
 *   - server errors (fail-closed PRECONDITION etc.) surface verbatim.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberBills from "@/pages/member/MemberBills";
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

const KEY_RE = /^[A-Za-z0-9_-]{8,20}$/;

function setupValidDraft() {
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

/** Fill the form, validate, and arm the Pay button. */
function preparePayable() {
  fireEvent.change(screen.getByLabelText(/Customer \/ meter number/), {
    target: { value: "12345678901" },
  });
  fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
    target: { value: "5000" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Validate" }));
}

describe("MemberBills Pay flow (W10-B4a)", () => {
  beforeEach(() => {
    resetTrpcMock();
    sessionStorage.clear();
    setQuery("auth.me", { data: MEMBER });
  });
  afterEach(() => cleanup());

  it("Pay sends a zod-exact body (no computed fields) and surfaces the real reference + authorizationUrl", () => {
    setupValidDraft();
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-1-abc",
        authorizationUrl: "https://checkout.paystack.test/bp1",
        accessCode: "ac",
        amount: "5000.00",
        currency: "NGN",
        transactionId: 11,
        status: "awaiting_payment",
        idempotent: false,
      },
    });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));

    const calls = getMutationCalls("memberBillPayments.pay") as Record<
      string,
      unknown
    >[];
    expect(calls).toHaveLength(1);
    // Exactly the server zod keys — nothing else (no price/fee fields).
    expect(Object.keys(calls[0]).sort()).toEqual([
      "amountNGN",
      "biller",
      "customerNumber",
      "idempotencyKey",
      "meterType",
    ]);
    expect(calls[0]).toMatchObject({
      biller: "EKEDC",
      customerNumber: "12345678901",
      meterType: "prepaid",
      amountNGN: 5000,
    });
    expect(calls[0].idempotencyKey).toMatch(KEY_RE);

    // Real handoff: reference + authorizationUrl link; no success claim.
    expect(screen.getByText("BP-1-abc")).toBeInTheDocument();
    expect(screen.getByText("Complete payment")).toHaveAttribute(
      "href",
      "https://checkout.paystack.test/bp1"
    );
    expect(screen.queryByText(/delivered/i)).not.toBeInTheDocument();
  });

  it("idempotency key is stable per draft, rotates on edit, and retires on a terminal confirm", () => {
    setupValidDraft();
    // Initiation fails (e.g. gateway down) so the member can retry.
    setMutation("memberBillPayments.pay", {
      error: {
        message:
          "Payment gateway is not configured on this deployment — bill payment is unavailable (fail-closed)",
      },
    });
    render(<MemberBills />);
    preparePayable();
    const payBtn = screen.getByRole("button", { name: "Pay" });
    fireEvent.click(payBtn);
    fireEvent.click(payBtn); // retry of the SAME draft
    let calls = getMutationCalls("memberBillPayments.pay") as {
      idempotencyKey: string;
    }[];
    expect(calls).toHaveLength(2);
    expect(calls[0].idempotencyKey).toBe(calls[1].idempotencyKey);

    // The honest fail-closed error surfaced verbatim.
    expect(
      screen.getByText(/not configured on this deployment/)
    ).toBeInTheDocument();

    // Editing the intent mints a NEW key (payload-hash binding).
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "6000" },
    });
    fireEvent.click(payBtn);
    calls = getMutationCalls("memberBillPayments.pay") as {
      idempotencyKey: string;
    }[];
    expect(calls).toHaveLength(3);
    expect(calls[2].idempotencyKey).not.toBe(calls[0].idempotencyKey);
  });

  it("terminal confirm outcome retires the key (next identical draft gets a fresh key)", () => {
    setupValidDraft();
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-1-retire",
        authorizationUrl: "https://checkout.paystack.test/retire",
        accessCode: "ac",
        amount: "5000.00",
        currency: "NGN",
        transactionId: 12,
        status: "awaiting_payment",
        idempotent: false,
      },
    });
    // Provider REJECTED after capture → failed + refund pending (terminal).
    setMutation("memberBillPayments.confirmPay", {
      data: {
        reference: "BP-1-retire",
        status: "failed",
        providerStatus: "rejected",
        captureStatus: "captured",
        amount: "5000.00",
        currency: "NGN",
        transactionId: 12,
        failureReason: "Provider rejected the meter number",
        refundStatus: "failed_refund_pending",
        idempotent: false,
      },
    });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    fireEvent.click(screen.getByText("I've paid — verify"));

    // Loud failure + refund-pending disclosure.
    const outcome = screen.getByTestId("capture-outcome");
    expect(outcome).toHaveTextContent(/FAILED/);
    expect(outcome).toHaveTextContent("Provider rejected the meter number");
    expect(outcome).toHaveTextContent("failed_refund_pending");

    // Key retired → the identical draft is a NEW intent with a fresh key.
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    const calls = getMutationCalls("memberBillPayments.pay") as {
      idempotencyKey: string;
    }[];
    expect(calls).toHaveLength(2);
    expect(calls[1].idempotencyKey).not.toBe(calls[0].idempotencyKey);
  });

  it("confirm renders 'submitted' as pending fulfillment (never delivered)", () => {
    setupValidDraft();
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-1-sub",
        authorizationUrl: "https://checkout.paystack.test/sub",
        accessCode: "ac",
        amount: "5000.00",
        currency: "NGN",
        transactionId: 13,
        status: "awaiting_payment",
        idempotent: false,
      },
    });
    setMutation("memberBillPayments.confirmPay", {
      data: {
        reference: "BP-1-sub",
        status: "pending",
        providerStatus: "submitted",
        captureStatus: "captured",
        amount: "5000.00",
        currency: "NGN",
        transactionId: 13,
        failureReason: null,
        refundStatus: null,
        idempotent: false,
      },
    });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    fireEvent.click(screen.getByText("I've paid — verify"));

    const confirmCalls = getMutationCalls(
      "memberBillPayments.confirmPay"
    ) as { reference: string }[];
    expect(confirmCalls).toEqual([{ reference: "BP-1-sub" }]);
    const outcome = screen.getByTestId("capture-outcome");
    expect(outcome).toHaveTextContent(/pending fulfillment/i);
    expect(outcome).toHaveTextContent(/NOT been delivered yet/i);
    expect(outcome).not.toHaveTextContent(/completed/i);
  });

  it("confirm renders unknown_outcome honestly (held pending, do-not-retry)", () => {
    setupValidDraft();
    setMutation("memberBillPayments.pay", {
      data: {
        reference: "BP-1-unk",
        authorizationUrl: "https://checkout.paystack.test/unk",
        accessCode: "ac",
        amount: "5000.00",
        currency: "NGN",
        transactionId: 14,
        status: "awaiting_payment",
        idempotent: false,
      },
    });
    setMutation("memberBillPayments.confirmPay", {
      data: {
        reference: "BP-1-unk",
        status: "pending",
        providerStatus: "unknown_outcome",
        captureStatus: "captured",
        amount: "5000.00",
        currency: "NGN",
        transactionId: 14,
        failureReason: null,
        refundStatus: null,
        idempotent: false,
      },
    });
    render(<MemberBills />);
    preparePayable();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    fireEvent.click(screen.getByText("I've paid — verify"));
    const outcome = screen.getByTestId("capture-outcome");
    expect(outcome).toHaveTextContent(/outcome is/i);
    expect(outcome).toHaveTextContent(/held pending/i);
    expect(outcome).toHaveTextContent(/do NOT pay again/i);
  });

  it("an invalid validateCustomer verdict BLOCKS the Pay button", () => {
    setQuery("memberBillPayments.billers", { data: BILLERS });
    setQuery("memberBillPayments.validateCustomer", {
      data: {
        valid: false,
        customerNumber: "12",
        biller: "EKEDC",
        message: "Invalid customer number",
      },
    });
    render(<MemberBills />);
    fireEvent.change(screen.getByLabelText(/Customer \/ meter number/), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "5000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect(screen.getByTestId("validate-result")).toHaveTextContent("Invalid");
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
    expect(getMutationCalls("memberBillPayments.pay")).toEqual([]);
  });

  it("out-of-bounds amount keeps Pay disabled (client never fights the zod boundary)", () => {
    setupValidDraft();
    render(<MemberBills />);
    fireEvent.change(screen.getByLabelText(/Customer \/ meter number/), {
      target: { value: "12345678901" },
    });
    fireEvent.change(screen.getByLabelText("Amount (NGN)"), {
      target: { value: "50" }, // below the ₦100 registry minimum
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect(screen.getByRole("button", { name: "Pay" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(/whole amount between/);
    expect(getMutationCalls("memberBillPayments.pay")).toEqual([]);
  });
});
