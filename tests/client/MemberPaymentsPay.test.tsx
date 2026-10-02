/**
 * MemberPaymentsPay.test.tsx — W7-B6 (2026-10-03): the Pay flow on
 * /member/payments.
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub. All rendering and state handling are real. Proves:
 *   - a real due premium row shows a Pay action;
 *   - Pay calls memberPayments.initiatePremiumPayment with ONLY identifiers
 *     (policyId, premiumId, idempotencyKey) — never an amount;
 *   - a successful initiation surfaces the REAL gateway reference and
 *     authorization URL (no fake success screen);
 *   - the honest unconfigured-gateway error is surfaced verbatim;
 *   - verify reports the server's real verdict (confirmed vs not confirmed).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberPayments from "@/pages/member/MemberPayments";
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

const DUE_ROW = {
  id: 501,
  policyId: 88,
  premiumRef: "PRE-DUE-1",
  amount: "45000.00",
  currency: "NGN",
  dueDate: "2026-11-01T00:00:00.000Z",
  gracePeriodDays: 30,
  status: "due",
  policyNumber: "POL-B",
};

function setupDue() {
  setQuery("auth.me", { data: MEMBER });
  setQuery("memberPayments.myPremiums", { data: { premiums: [], count: 0 } });
  setQuery("memberPayments.myPremiumDue", {
    data: { duePremiums: [DUE_ROW], policies: [], disclosure: "Test." },
  });
}

describe("MemberPayments Pay flow (W7-B6)", () => {
  beforeEach(() => {
    resetTrpcMock();
    setupDue();
  });
  afterEach(() => cleanup());

  it("shows a Pay action on a real due premium row", () => {
    render(<MemberPayments />);
    expect(screen.getByText("PRE-DUE-1")).toBeInTheDocument();
    expect(screen.getByText("Pay now")).toBeInTheDocument();
  });

  it("Pay initiates with identifiers only (amount is server-derived) and surfaces the real reference + authorization URL", () => {
    setMutation("memberPayments.initiatePremiumPayment", {
      data: {
        reference: "PP-POL-B-key-1",
        authorizationUrl: "https://checkout.paystack.test/abc",
        accessCode: "ac",
        amount: "45000.00",
        currency: "NGN",
        paymentId: 1,
        idempotent: false,
      },
    });
    render(<MemberPayments />);
    fireEvent.click(screen.getByText("Pay now"));

    const calls = getMutationCalls(
      "memberPayments.initiatePremiumPayment"
    ) as { policyId: number; premiumId: number; idempotencyKey: string }[];
    expect(calls).toHaveLength(1);
    expect(calls[0].policyId).toBe(88);
    expect(calls[0].premiumId).toBe(501);
    expect(calls[0].idempotencyKey).toBeTruthy();
    expect(calls[0]).not.toHaveProperty("amount");

    // Real gateway reference + authorization URL surfaced; no success claim.
    expect(screen.getByText("PP-POL-B-key-1")).toBeInTheDocument();
    const link = screen.getByText("Complete payment");
    expect(link).toHaveAttribute(
      "href",
      "https://checkout.paystack.test/abc"
    );
    expect(screen.queryByText(/credited/)).not.toBeInTheDocument();
  });

  it("surfaces the honest unconfigured-gateway error verbatim (no fake success)", () => {
    setMutation("memberPayments.initiatePremiumPayment", {
      error: {
        message:
          "Payment gateway is not configured on this deployment — premium payment is unavailable and was NOT initiated",
      },
    });
    render(<MemberPayments />);
    fireEvent.click(screen.getByText("Pay now"));
    expect(
      screen.getByText(/not configured on this deployment/)
    ).toBeInTheDocument();
    expect(screen.queryByText("Complete payment")).not.toBeInTheDocument();
  });

  it("verify reports the server's real verdict", () => {
    setMutation("memberPayments.initiatePremiumPayment", {
      data: {
        reference: "PP-POL-B-key-2",
        authorizationUrl: "https://checkout.paystack.test/def",
        accessCode: "ac",
        amount: "45000.00",
        currency: "NGN",
        paymentId: 2,
        idempotent: false,
      },
    });
    setMutation("memberPayments.verifyPremiumPayment", {
      data: { status: "success" },
    });
    render(<MemberPayments />);
    fireEvent.click(screen.getByText("Pay now"));
    fireEvent.click(screen.getByText("I've paid — verify"));
    const calls = getMutationCalls(
      "memberPayments.verifyPremiumPayment"
    ) as { reference: string }[];
    expect(calls).toEqual([{ reference: "PP-POL-B-key-2" }]);
    expect(screen.getByText(/premium has been credited/)).toBeInTheDocument();
  });

  it("verify surfaces an honest not-confirmed verdict", () => {
    setMutation("memberPayments.initiatePremiumPayment", {
      data: {
        reference: "PP-POL-B-key-3",
        authorizationUrl: "https://checkout.paystack.test/ghi",
        accessCode: "ac",
        amount: "45000.00",
        currency: "NGN",
        paymentId: 3,
        idempotent: false,
      },
    });
    setMutation("memberPayments.verifyPremiumPayment", {
      data: { status: "pending" },
    });
    render(<MemberPayments />);
    fireEvent.click(screen.getByText("Pay now"));
    fireEvent.click(screen.getByText("I've paid — verify"));
    expect(screen.getByText(/not confirmed yet/)).toBeInTheDocument();
  });
});
