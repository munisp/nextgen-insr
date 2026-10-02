/**
 * MemberWalletSavings.test.tsx — W7-B7 (2026-10-03): /member/wallet,
 * /member/savings, /member/loyalty, /member/referrals.
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub. All rendering and state handling are real. Proves:
 *   - wallet renders the real settled balance + full transaction history
 *     (failed rows shown honestly), honest empty/error states, and NO top-up
 *     initiation UI (customerWalletSystem.topUp requires an already-settled
 *     rail leg the member cannot initiate — documented in the page header);
 *   - savings renders summary/account/transactions with real-shaped data,
 *     the openMyAccount flow when no account exists (zod-exact input,
 *     success + CONFLICT error paths), and no contribute/withdraw UI;
 *   - loyalty renders balance/history with no redeem UI;
 *   - referrals renders the code (copy) + list, and the honest null-code
 *     unavailable state.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberWallet from "@/pages/member/MemberWallet";
import MemberSavings from "@/pages/member/MemberSavings";
import MemberLoyalty from "@/pages/member/MemberLoyalty";
import MemberReferrals from "@/pages/member/MemberReferrals";
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

const ACCOUNT = {
  id: 42,
  firstName: "Adaeze",
  lastName: "Test",
  status: "active",
  kycLevel: 2,
  createdAt: "2026-01-15T00:00:00.000Z",
};

const WALLET_TX = [
  {
    id: 11,
    ref: "WTOP-abc123",
    type: "Cash In",
    amount: "25000.00",
    currency: "NGN",
    status: "success",
    failureReason: null,
    createdAt: "2026-09-30T10:00:00.000Z",
  },
  {
    id: 12,
    ref: "WTOP-fail9",
    type: "Cash In",
    amount: "10000.00",
    currency: "NGN",
    status: "failed",
    failureReason: "Rail settlement timeout",
    createdAt: "2026-09-29T09:00:00.000Z",
  },
];

describe("MemberWallet (W7-B7)", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("auth.me", { data: MEMBER });
  });
  afterEach(() => cleanup());

  it("renders the real settled balance and full transaction history (failed rows shown)", () => {
    setQuery("customerWalletSystem.getBalance", {
      data: { customerId: 42, balance: 15000, currency: "NGN" },
    });
    setQuery("customerWalletSystem.getTransactions", {
      data: { transactions: WALLET_TX, total: 2 },
    });
    render(<MemberWallet />);
    expect(screen.getByTestId("wallet-balance")).toHaveTextContent("15,000.00");
    expect(screen.getByText("WTOP-abc123")).toBeInTheDocument();
    // Failed rows are not hidden from history.
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText("Rail settlement timeout")).toBeInTheDocument();
  });

  it("shows the honest empty state when there are no transactions", () => {
    setQuery("customerWalletSystem.getBalance", {
      data: { customerId: 42, balance: 0, currency: "NGN" },
    });
    setQuery("customerWalletSystem.getTransactions", {
      data: { transactions: [], total: 0 },
    });
    render(<MemberWallet />);
    expect(
      screen.getByText(/no wallet transactions yet/i)
    ).toBeInTheDocument();
  });

  it("surfaces the real error when the balance query fails", () => {
    setQuery("customerWalletSystem.getBalance", {
      isError: true,
      error: { message: "Customer profile not found for session user" },
    });
    render(<MemberWallet />);
    expect(
      screen.getByText(/Customer profile not found for session user/)
    ).toBeInTheDocument();
  });

  it("has NO top-up initiation UI — only the honest funding note", () => {
    setQuery("customerWalletSystem.getBalance", {
      data: { customerId: 42, balance: 0, currency: "NGN" },
    });
    render(<MemberWallet />);
    expect(
      screen.getByText(/Wallet top-up is not available in this portal yet/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/^top up$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /top/i })).toBeNull();
  });
});

describe("MemberSavings (W7-B7)", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("auth.me", { data: MEMBER });
  });
  afterEach(() => cleanup());

  function setupWithAccount() {
    setQuery("memberSavings.myAccount", { data: { account: ACCOUNT } });
    setQuery("memberSavings.mySummary", {
      data: {
        customerId: 42,
        balance: 120000,
        totalIn: 150000,
        totalOut: 30000,
        settledTransactions: 5,
        currency: "NGN",
      },
    });
    setQuery("memberSavings.myTransactions", {
      data: { transactions: WALLET_TX, count: 2 },
    });
  }

  it("renders account, settled summary and transactions with real-shaped data", () => {
    setupWithAccount();
    render(<MemberSavings />);
    expect(screen.getAllByText(/Adaeze/).length).toBeGreaterThan(0);
    expect(screen.getByTestId("savings-balance")).toHaveTextContent(
      "120,000.00"
    );
    expect(screen.getByText("WTOP-abc123")).toBeInTheDocument();
  });

  it("shows the honest empty state for an account with no transactions", () => {
    setQuery("memberSavings.myAccount", { data: { account: ACCOUNT } });
    setQuery("memberSavings.mySummary", {
      data: {
        customerId: 42,
        balance: 0,
        totalIn: 0,
        totalOut: 0,
        settledTransactions: 0,
        currency: "NGN",
      },
    });
    setQuery("memberSavings.myTransactions", {
      data: { transactions: [], count: 0 },
    });
    render(<MemberSavings />);
    expect(
      screen.getByText(/no savings transactions yet/i)
    ).toBeInTheDocument();
  });

  it("surfaces the real error when the summary query fails", () => {
    setQuery("memberSavings.myAccount", { data: { account: ACCOUNT } });
    setQuery("memberSavings.mySummary", {
      isError: true,
      error: { message: "DB unavailable" },
    });
    render(<MemberSavings />);
    expect(screen.getByText(/DB unavailable/)).toBeInTheDocument();
  });

  it("renders the open-account form when no account exists and submits zod-exact input", () => {
    setQuery("memberSavings.myAccount", { data: { account: null } });
    setMutation("memberSavings.openMyAccount", {
      data: { success: true, account: ACCOUNT },
    });
    render(<MemberSavings />);
    fireEvent.change(screen.getByLabelText(/phone number/i), {
      target: { value: "08012345678" },
    });
    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: "adaeze@example.com" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /open savings account/i })
    );
    const calls = getMutationCalls("memberSavings.openMyAccount");
    expect(calls).toHaveLength(1);
    // Only schema fields — names/identity are derived server-side.
    expect(calls[0]).toEqual({
      phone: "08012345678",
      email: "adaeze@example.com",
    });
  });

  it("omits blank optional fields and surfaces the real CONFLICT error", () => {
    setQuery("memberSavings.myAccount", { data: { account: null } });
    setMutation("memberSavings.openMyAccount", {
      error: { message: "This phone number is already registered to an account" },
    });
    render(<MemberSavings />);
    fireEvent.change(screen.getByLabelText(/phone number/i), {
      target: { value: "08012345678" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /open savings account/i })
    );
    expect(getMutationCalls("memberSavings.openMyAccount")[0]).toEqual({
      phone: "08012345678",
    });
    expect(
      screen.getByText(/already registered to an account/)
    ).toBeInTheDocument();
  });

  it("has NO contribute/withdraw UI — only the honest funding note", () => {
    setupWithAccount();
    render(<MemberSavings />);
    expect(
      screen.getByText(/Deposits and withdrawals are not available/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /withdraw/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /deposit/i })).toBeNull();
  });
});

describe("MemberLoyalty (W7-B7)", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("auth.me", { data: MEMBER });
  });
  afterEach(() => cleanup());

  it("renders the real balance and history", () => {
    setQuery("memberLoyalty.myBalance", {
      data: { customerId: 42, earned: 500, redeemed: 125, balance: 375 },
    });
    setQuery("memberLoyalty.myHistory", {
      data: {
        history: [
          {
            id: 7,
            type: "earned",
            points: 250,
            description: "Premium payment reward",
            balanceAfter: 500,
            createdAt: "2026-09-20T00:00:00.000Z",
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      },
    });
    render(<MemberLoyalty />);
    expect(screen.getByTestId("loyalty-balance")).toHaveTextContent("375 pts");
    expect(screen.getByText("Premium payment reward")).toBeInTheDocument();
  });

  it("shows the honest empty state and surfaces errors", () => {
    setQuery("memberLoyalty.myBalance", {
      data: { customerId: 42, earned: 0, redeemed: 0, balance: 0 },
    });
    setQuery("memberLoyalty.myHistory", {
      data: { history: [], total: 0, limit: 50, offset: 0 },
    });
    render(<MemberLoyalty />);
    expect(screen.getByText(/no loyalty activity yet/i)).toBeInTheDocument();
    cleanup();

    resetTrpcMock();
    setQuery("auth.me", { data: MEMBER });
    setQuery("memberLoyalty.myBalance", {
      isError: true,
      error: { message: "DB unavailable" },
    });
    render(<MemberLoyalty />);
    expect(screen.getByText(/DB unavailable/)).toBeInTheDocument();
  });

  it("has NO redeem UI — only the honest note", () => {
    render(<MemberLoyalty />);
    expect(
      screen.getByText(/Points redemption is not available/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /redeem/i })).toBeNull();
  });
});

describe("MemberReferrals (W7-B7)", () => {
  beforeEach(() => {
    resetTrpcMock();
    setQuery("auth.me", { data: MEMBER });
  });
  afterEach(() => cleanup());

  it("renders the real code with copy and the referrals list", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    setQuery("memberReferrals.myCode", {
      data: {
        referralCode: "REF-ADAEZE-1",
        expiresAt: "2026-12-31T00:00:00.000Z",
        existing: true,
      },
    });
    setQuery("memberReferrals.myReferrals", {
      data: {
        referrals: [
          {
            id: 3,
            referralCode: "REF-ADAEZE-1",
            refereeCode: "CUST-777",
            status: "rewarded",
            bonusPoints: 100,
            bonusCash: "500.00",
            activatedAt: "2026-08-01T00:00:00.000Z",
            rewardedAt: "2026-08-05T00:00:00.000Z",
            expiresAt: "2026-12-31T00:00:00.000Z",
          },
        ],
        total: 1,
        limit: 50,
        offset: 0,
      },
    });
    render(<MemberReferrals />);
    expect(screen.getByTestId("referral-code")).toHaveTextContent(
      "REF-ADAEZE-1"
    );
    expect(screen.getByText("rewarded")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /copy code/i }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("REF-ADAEZE-1")
    );
  });

  it("shows the honest unavailable state when the server returns null (no minting)", () => {
    setQuery("memberReferrals.myCode", { data: null });
    setQuery("memberReferrals.myReferrals", {
      data: { referrals: [], total: 0, limit: 50, offset: 0 },
    });
    render(<MemberReferrals />);
    expect(
      screen.getByText(/referral code is not available for your account yet/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/have not referred anyone yet/i)
    ).toBeInTheDocument();
    // No create/generate action exists.
    expect(
      screen.queryByRole("button", { name: /generate|create/i })
    ).toBeNull();
  });

  it("surfaces the real error when the referrals query fails", () => {
    setQuery("memberReferrals.myCode", { data: null });
    setQuery("memberReferrals.myReferrals", {
      isError: true,
      error: { message: "DB unavailable" },
    });
    render(<MemberReferrals />);
    expect(screen.getByText(/DB unavailable/)).toBeInTheDocument();
  });
});
