/**
 * MemberPayeePrefill.test.tsx — W11-B1b (2026-10-05): web prefill UX over
 * the W11-B1a payee directory + claims prefill APIs.
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub; sessionStorage/crypto are the real happy-dom APIs. The
 * stub values mirror the REAL superjson-revived payloads (lastUsedAt as a
 * Date, exactly as the transformer revives it client-side). Proves:
 *   - the picker lists recent payees with a truthful provenance line
 *     ("last paid ₦X · <date>") and passes the rail filter to the server
 *     (mutant probe: the exact useQuery input {rail} is asserted);
 *   - selecting a payee prefills the rail's identifier fields and ALWAYS
 *     clears the amount — nothing is silently carried into a submit;
 *   - remove calls memberPayees.remove with the payee id;
 *   - list errors degrade silently (form fully usable, no picker);
 *   - claims prefill populates a read-only panel on policy select and a
 *     NOT_FOUND degrades silently.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberBills from "@/pages/member/MemberBills";
import MemberAirtime from "@/pages/member/MemberAirtime";
import MemberClaims from "@/pages/member/MemberClaims";
import {
  setQuery,
  setMutation,
  getMutationCalls,
  getQueryCalls,
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

const BILL_PAYEES = {
  payees: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      rail: "bill",
      label: "Home meter",
      billerCode: "EKEDC",
      meterNumber: "12345678901",
      network: null,
      phone: null,
      provider: null,
      walletNumber: null,
      lastAmountKobo: 500000, // ₦5,000.00
      useCount: 3,
      lastUsedAt: new Date("2026-09-20T10:00:00Z"), // superjson-revived Date
      createdAt: new Date("2026-08-01T00:00:00Z"),
      updatedAt: new Date("2026-09-20T10:00:00Z"),
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      rail: "bill",
      label: "DSTV subscription",
      billerCode: "DSTV",
      meterNumber: "9988776655",
      network: null,
      phone: null,
      provider: null,
      walletNumber: null,
      lastAmountKobo: null,
      useCount: 1,
      lastUsedAt: null,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      updatedAt: new Date("2026-07-01T00:00:00Z"),
    },
  ],
};

const AIRTIME_PAYEES = {
  payees: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      rail: "airtime",
      label: "Mum's MTN",
      billerCode: null,
      meterNumber: null,
      network: "MTN",
      phone: "08031234567",
      provider: null,
      walletNumber: null,
      lastAmountKobo: 100000, // ₦1,000.00
      useCount: 5,
      lastUsedAt: new Date("2026-09-25T08:30:00Z"),
      createdAt: new Date("2026-06-01T00:00:00Z"),
      updatedAt: new Date("2026-09-25T08:30:00Z"),
    },
  ],
};

const MOMO_PAYEES = {
  payees: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      rail: "momo",
      label: "My MoMo wallet",
      billerCode: null,
      meterNumber: null,
      network: null,
      phone: null,
      provider: "MTN MoMo",
      walletNumber: "08099887766",
      lastAmountKobo: 2000000,
      useCount: 2,
      lastUsedAt: new Date("2026-09-18T12:00:00Z"),
      createdAt: new Date("2026-05-01T00:00:00Z"),
      updatedAt: new Date("2026-09-18T12:00:00Z"),
    },
  ],
};

describe("RecentPayeePicker on /member/bills (W11-B1b)", () => {
  beforeEach(() => {
    resetTrpcMock();
    sessionStorage.clear();
    setQuery("auth.me", { data: MEMBER });
    setQuery("memberBillPayments.billers", { data: BILLERS });
  });
  afterEach(() => cleanup());

  it("renders recent payees with provenance and queries with the bill rail filter", () => {
    setQuery("memberPayees.list", { data: BILL_PAYEES });
    render(<MemberBills />);

    const picker = screen.getByTestId("recent-payees");
    expect(picker).toHaveTextContent("Home meter");
    expect(picker).toHaveTextContent("EKEDC · 12345678901");
    // Provenance: last amount + date (superjson-revived Date formats fine).
    expect(picker).toHaveTextContent(/last paid ₦5,000\.00 · /);
    // No amount → no fabricated provenance line for the second payee.
    expect(picker).toHaveTextContent("DSTV subscription");
    expect(
      screen.getByTestId(
        "payee-chip-22222222-2222-4222-8222-222222222222"
      )
    ).not.toHaveTextContent(/last paid/);

    // Mutant probe: the rail filter must be sent to the server.
    const calls = getQueryCalls("memberPayees.list") as { rail?: string }[];
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]).toEqual({ rail: "bill" });
  });

  it("selecting a payee prefills meter+biller but leaves the amount EMPTY", () => {
    setQuery("memberPayees.list", { data: BILL_PAYEES });
    render(<MemberBills />);

    // The member already typed an amount — selecting a payee must clear it.
    const amountInput = screen.getByLabelText("Amount (NGN)");
    fireEvent.change(amountInput, { target: { value: "5000" } });
    expect(amountInput).toHaveValue("5000");

    fireEvent.click(
      screen.getByTestId("payee-chip-11111111-1111-4111-8111-111111111111")
    );

    expect(screen.getByLabelText(/Customer \/ meter number/)).toHaveValue(
      "12345678901"
    );
    // Amount is NEVER prefilled/carried over.
    expect(amountInput).toHaveValue("");
    // Provenance hint is shown.
    expect(screen.getByTestId("prefill-hint")).toHaveTextContent(
      /Prefilled from your recent payments \(Home meter\)/
    );
    // No payment was initiated — prefill never submits.
    expect(getMutationCalls("memberBillPayments.pay")).toEqual([]);
  });

  it("remove calls memberPayees.remove with the payee id", () => {
    setQuery("memberPayees.list", { data: BILL_PAYEES });
    render(<MemberBills />);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove payee Home meter" })
    );
    expect(getMutationCalls("memberPayees.remove")).toEqual([
      { id: "11111111-1111-4111-8111-111111111111" },
    ]);
  });

  it("empty directory renders the honest note; list error degrades silently", () => {
    setQuery("memberPayees.list", { data: { payees: [] } });
    const { unmount } = render(<MemberBills />);
    expect(
      screen.getByTestId("recent-payees-empty")
    ).toHaveTextContent(/recent payees will appear here/);
    unmount();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setQuery("memberPayees.list", {
      isError: true,
      error: { message: "DB unavailable" },
    });
    render(<MemberBills />);
    // No picker, no note — but the form is fully usable.
    expect(screen.queryByTestId("recent-payees")).not.toBeInTheDocument();
    expect(screen.queryByTestId("recent-payees-empty")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Amount (NGN)")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Validate" })
    ).toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("RecentPayeePicker on /member/airtime (W11-B1b)", () => {
  beforeEach(() => {
    resetTrpcMock();
    sessionStorage.clear();
    setQuery("auth.me", { data: MEMBER });
    setQuery("memberMobileMoney.providers", {
      data: {
        providers: [{ name: "MTN MoMo" }, { name: "Airtel Money" }],
        limits: { minAmountNGN: 100, maxAmountNGN: 300000, dailyLimitNGN: 1000000 },
        configured: true,
      },
    });
  });
  afterEach(() => cleanup());

  it("airtime payee prefills network+phone and clears the amount", () => {
    setQuery("memberPayees.list", { data: AIRTIME_PAYEES });
    render(<MemberAirtime />);

    const amountInput = screen.getByLabelText("Amount (NGN)");
    fireEvent.change(amountInput, { target: { value: "1000" } });
    // The trpcMock stub returns the same registration for every rail input,
    // so both pickers on this page render the chip; [0] is the Buy Airtime
    // section (it renders before Cash In / Cash Out in the DOM).
    fireEvent.click(
      screen.getAllByTestId("payee-chip-33333333-3333-4333-8333-333333333333")[0]
    );

    expect(screen.getByLabelText("Phone (optional)")).toHaveValue(
      "08031234567"
    );
    // The network select now shows the prefilled network.
    expect(screen.getByLabelText("Network")).toHaveTextContent("MTN");
    // Amount cleared; provenance hint shown; nothing submitted.
    expect(amountInput).toHaveValue("");
    expect(screen.getByTestId("prefill-hint-airtime")).toHaveTextContent(
      /Prefilled from your recent payments \(Mum's MTN\)/
    );
    expect(getMutationCalls("memberAirtime.vend")).toEqual([]);

    // Mutant probe: both pickers on this page pass their rail filters.
    const rails = (getQueryCalls("memberPayees.list") as { rail?: string }[]).map(
      (c) => c.rail
    );
    expect(rails).toContain("airtime");
    expect(rails).toContain("momo");
    expect(rails).not.toContain("bill");
  });

  it("momo payee prefills the provider and clears the amount", () => {
    setQuery("memberPayees.list", { data: MOMO_PAYEES });
    render(<MemberAirtime />);

    const amountInput = screen.getByLabelText("Cash amount (NGN)");
    fireEvent.change(amountInput, { target: { value: "2000" } });
    // [1] is the Cash In / Cash Out (momo) section's copy of the chip.
    fireEvent.click(
      screen.getAllByTestId("payee-chip-44444444-4444-4444-8444-444444444444")[1]
    );

    expect(screen.getByLabelText("Provider")).toHaveTextContent("MTN MoMo");
    expect(amountInput).toHaveValue("");
    expect(screen.getByTestId("prefill-hint-momo")).toHaveTextContent(
      /Prefilled from your recent payments \(My MoMo wallet\)/
    );
    expect(getMutationCalls("memberMobileMoney.cashIn")).toEqual([]);
    expect(getMutationCalls("memberMobileMoney.cashOut")).toEqual([]);
  });
});

describe("Claims prefill on /member/claims (W11-B1b)", () => {
  const PICKER = {
    policies: [
      {
        id: 7,
        policyNumber: "POL-0007",
        productName: "Motor Comprehensive",
        sumInsured: "5000000.00",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        status: "active",
      },
    ],
  };
  const PREFILL = {
    policy: {
      id: 7,
      policyNumber: "POL-0007",
      status: "active",
      coverageType: "Comprehensive",
      sumInsured: "5000000.00",
      annualPremium: "250000.00",
      startDate: new Date("2026-01-01T00:00:00Z"),
      endDate: new Date("2026-12-31T00:00:00Z"),
      assetDetails: { plateNumber: "LAG-123-XY" },
      productName: "Motor Comprehensive",
      productCode: "MTR-COMP",
    },
    member: {
      firstName: "Adaeze",
      lastName: "Test",
      email: "adaeze@example.com",
      phone: "08031234567",
    },
    lastClaim: {
      claimNumber: "CLM-2026-0001",
      status: "approved",
      claimType: "Accident",
      claimedAmount: "150000.00",
      incidentDate: "2026-03-04",
      createdAt: new Date("2026-03-05T00:00:00Z"),
    },
  };

  beforeEach(() => {
    resetTrpcMock();
    setQuery("auth.me", { data: MEMBER });
    setQuery("memberClaims.myPoliciesPicker", { data: PICKER });
  });
  afterEach(() => cleanup());

  /** Radix Select: open with ArrowDown, then dispatch the pointer sequence
   *  radix items select on (happy-dom has no real pointer dispatch). */
  function selectPolicy(label: RegExp | string) {
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const option = screen.getAllByRole("option").find(
      (el) => label instanceof RegExp ? label.test(el.textContent ?? "") : el.textContent === label
    );
    if (!option) throw new Error("policy option not found");
    fireEvent.pointerDown(option);
    fireEvent.pointerUp(option);
    fireEvent.click(option);
  }

  it("selecting a policy fetches getClaimPrefill and renders the read-only panel", () => {
    setQuery("memberClaims.getClaimPrefill", { data: PREFILL });
    render(<MemberClaims />);
    selectPolicy(/POL-0007/);

    const calls = getQueryCalls("memberClaims.getClaimPrefill") as {
      policyId: number;
    }[];
    expect(calls).toContainEqual({ policyId: 7 });

    const panel = screen.getByTestId("claim-prefill");
    expect(panel).toHaveTextContent(
      /Prefilled from your policy and member records/
    );
    expect(panel).toHaveTextContent("POL-0007");
    expect(panel).toHaveTextContent("Motor Comprehensive");
    expect(panel).toHaveTextContent("Comprehensive");
    expect(panel).toHaveTextContent("Adaeze Test");
    expect(panel).toHaveTextContent("adaeze@example.com");
    expect(panel).toHaveTextContent(/LAG-123-XY/);
    expect(panel).toHaveTextContent(/CLM-2026-0001/);
    // The editable fields stay member-controlled (not prefilled).
    expect(screen.getByLabelText("Claim type")).toHaveValue("");
    expect(getMutationCalls("memberClaims.fileClaim")).toEqual([]);
  });

  it("NOT_FOUND on prefill degrades silently — the form stays usable", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setQuery("memberClaims.getClaimPrefill", {
      isError: true,
      error: { message: "Policy not found" },
    });
    render(<MemberClaims />);
    selectPolicy(/POL-0007/);

    expect(screen.queryByTestId("claim-prefill")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Claim type")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "File claim" })
    ).toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
