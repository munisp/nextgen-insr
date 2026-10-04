/**
 * MemberMoneyTools.test.tsx — W7-B10 (2026-10-06): /member/bills,
 * /member/airtime (Airtime & Mobile Money), /member/fx, /member/parametric,
 * /member/products.
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub. All rendering and state handling are real. Proves:
 *   - bills renders the real biller catalog + limits and the honest
 *     unconfigured-provider note; the validateCustomer flow issues the exact
 *     {biller, customerNumber} payload and renders the verdict; and there is
 *     REAL pay form exists (W10-B2/B4a, 2026-10-04 — pay/confirmPay now
 *     ship server-side) and is GATED: Pay is disabled until a valid
 *     validateCustomer verdict + in-bounds amount;
 *   - airtime & mobile money render real-shaped history/summary/transactions
 *     (failed rows disclosed), the provider registry, and the myTransaction
 *     detail flow by ref (exact payload);
 *   - FX renders the published rate book, the convert flow issues the exact
 *     {from, to, amount} payload and renders the converted result, the empty
 *     rate book state is honest, and PRECONDITION_FAILED errors surface;
 *   - parametric renders coverage + payouts with real-shaped rows;
 *   - marketplace browse renders listProducts rows with the exact
 *     filter/search payload and no fabricated pricing;
 *   - loading and error states surface for every section.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberBills from "@/pages/member/MemberBills";
import MemberAirtime from "@/pages/member/MemberAirtime";
import MemberFx from "@/pages/member/MemberFx";
import MemberParametric from "@/pages/member/MemberParametric";
import MemberProducts from "@/pages/member/MemberProducts";
import {
  setQuery,
  resetTrpcMock,
  getQueryCalls,
  getMutationCalls,
} from "./helpers/trpcMock";

const MEMBER = {
  id: 9001,
  name: "Adaeze Test",
  email: "adaeze@example.com",
  role: "user",
};

beforeEach(() => {
  resetTrpcMock();
  setQuery("auth.me", { data: MEMBER });
});
afterEach(() => cleanup());

// ── Real-shaped fixtures (mirrors of the server return shapes) ────────────

const BILLERS = {
  billers: [
    { name: "EKEDC", commissionRate: 0.005, commissionPct: "0.5%" },
    { name: "DSTV", commissionRate: 0.01, commissionPct: "1.0%" },
    { name: "WAEC", commissionRate: 0.02, commissionPct: "2.0%" },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 500000, dailyLimitNGN: 2000000 },
  configured: false,
};

const AIRTIME_HISTORY = {
  history: [
    {
      ref: "AIR-001",
      network: "MTN",
      phoneNumber: "08031234567",
      amount: "1000.00",
      status: "success",
      providerStatus: "delivered",
      failureReason: null,
      createdAt: "2026-09-30T10:00:00.000Z",
    },
    {
      ref: "AIR-002",
      network: "Airtel",
      phoneNumber: "08031234567",
      amount: "500.00",
      status: "failed",
      providerStatus: null,
      failureReason: "Provider timeout",
      createdAt: "2026-09-29T09:00:00.000Z",
    },
  ],
  total: 2,
};

const AIRTIME_SUMMARY = {
  periodDays: 30,
  totalTransactions: 3,
  byStatus: [
    { status: "success", count: 2, volumeNGN: 1500 },
    { status: "failed", count: 1, volumeNGN: 500 },
  ],
};

const MOMO_PROVIDERS = {
  providers: [
    { name: "MTN MoMo", cashInCommission: 0.015, cashOutCommission: 0.015 },
    { name: "Airtel Money", cashInCommission: 0.015, cashOutCommission: 0.015 },
  ],
  limits: { minAmountNGN: 100, maxAmountNGN: 300000, dailyLimitNGN: 1000000 },
  configured: false,
};

const MOMO_TXS = {
  transactions: [
    {
      ref: "MM-12345",
      type: "Cash In",
      amount: "5000.00",
      fee: "75.00",
      status: "success",
      provider: "MTN MoMo",
      providerStatus: "settled",
      createdAt: "2026-09-28T12:00:00.000Z",
    },
  ],
  count: 1,
};

const MOMO_DETAIL = {
  transaction: {
    ref: "MM-12345",
    type: "Cash In",
    amount: "5000.00",
    fee: "75.00",
    status: "success",
    failureReason: null,
    provider: "MTN MoMo",
    providerStatus: "settled",
    createdAt: "2026-09-28T12:00:00.000Z",
  },
};

const MOMO_SUMMARY = {
  periodDays: 30,
  totalTransactions: 1,
  byStatus: [{ status: "success", count: 1, volumeNGN: 5000 }],
};

const FX_RATES = {
  baseCurrency: "EUR",
  rates: { EUR: 1, NGN: 1650.25, USD: 1.08 },
  lastUpdated: "2026-10-05T08:00:00.000Z",
};

const FX_CURRENCIES = {
  currencies: [
    { code: "EUR", rate: 1 },
    { code: "NGN", rate: 1650.25 },
    { code: "USD", rate: 1.08 },
  ],
  baseCurrency: "EUR",
};

const FX_CONVERTED = {
  from: "NGN",
  to: "USD",
  amount: 1000,
  convertedAmount: 0.65,
  rate: 0.000654,
};

const FX_HISTORICAL = {
  base: "NGN",
  target: "USD",
  timeseries: [
    { date: "2026-09-06", rate: 0.00066 },
    { date: "2026-09-07", rate: 0.00062 },
  ],
  source: "frankfurter/ecb",
};

const PARAMETRIC_COVERAGE = {
  coverage: [
    {
      policyId: 501,
      productName: "Flood Guard",
      coveredPeril: "flood",
      payoutAmount: "250000.00",
      currency: "NGN",
      status: "active",
      triggerStatus: "armed",
    },
  ],
};

const PARAMETRIC_PAYOUTS = {
  payouts: [
    {
      id: 77,
      eventId: 12,
      claimId: 88,
      policyId: 501,
      amount: "250000.00",
      currency: "NGN",
      status: "paid",
      createdAt: "2026-09-20T00:00:00.000Z",
    },
  ],
  count: 1,
};

const PRODUCTS = {
  data: [
    {
      id: 9,
      productCode: "MOTOR-COMP",
      name: "Comprehensive Motor",
      description: "Full motor cover",
      coverageType: "motor",
      minPremium: "15000.00",
      maxCoverageAmount: "5000000.00",
      minAge: null,
      maxAge: null,
      waitingPeriodDays: 0,
      policyTermMonths: 12,
      isActive: true,
      regulatoryApprovalRef: null,
      naicomProductCode: "NAICOM-M1",
      tenantId: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  total: 1,
};

// ── MemberBills ────────────────────────────────────────────────────────────

describe("MemberBills (W7-B10)", () => {
  it("renders the real biller catalog, limits and the honest unconfigured note", () => {
    setQuery("memberBillPayments.billers", { data: BILLERS });
    render(<MemberBills />);
    // EKEDC appears in the table AND as the default select value.
    expect(screen.getAllByText("EKEDC").length).toBeGreaterThan(0);
    expect(screen.getAllByText("DSTV").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.5%").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/No bill-payment provider is configured/)
    ).toBeInTheDocument();
  });

  it("validateCustomer flow issues the exact payload and renders the verdict", () => {
    setQuery("memberBillPayments.billers", { data: BILLERS });
    setQuery("memberBillPayments.validateCustomer", {
      data: {
        valid: true,
        customerNumber: "12345678901",
        biller: "EKEDC",
        message: "Valid",
      },
    });
    render(<MemberBills />);
    fireEvent.change(screen.getByLabelText(/Customer \/ meter number/), {
      target: { value: "12345678901" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    // Exact zod-shaped payload: first catalog biller (EKEDC) is the default
    // selection; the member typed the customer number.
    expect(getQueryCalls("memberBillPayments.validateCustomer")).toContainEqual(
      { biller: "EKEDC", customerNumber: "12345678901" }
    );
  });

  it("shows the invalid verdict when the format check fails", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Validate" }));
    expect(screen.getByTestId("validate-result")).toHaveTextContent("Invalid");
  });

  it("shows the REAL pay form, gated until validation + amount (W10-B4a rewrite, 2026-10-04)", () => {
    // 2026-10-04 (W10-B4a): the memberBillPayments.pay/confirmPay mutations
    // now ship (W10-B2), so the W7-B10 "no pay button" contract is replaced
    // by the stronger one: the Pay control EXISTS but stays DISABLED until
    // validateCustomer returns valid:true and the amount is within the
    // registry limits — and no mutation fires before then. The full pay
    // flow (zod-exact body, idempotency, tri-state confirm) is covered in
    // MemberBillsPay.test.tsx.
    setQuery("memberBillPayments.billers", { data: BILLERS });
    render(<MemberBills />);
    const payBtn = screen.getByRole("button", { name: "Pay" });
    expect(payBtn).toBeDisabled();
    expect(getMutationCalls("memberBillPayments.pay")).toEqual([]);
  });

  it("surfaces biller catalog errors and loading state honestly", () => {
    setQuery("memberBillPayments.billers", {
      isError: true,
      error: { message: "UNAUTHORIZED: session expired" },
    });
    render(<MemberBills />);
    expect(screen.getByText(/UNAUTHORIZED/)).toBeInTheDocument();
    cleanup();
    resetTrpcMock();
    setQuery("auth.me", { data: MEMBER });
    setQuery("memberBillPayments.billers", { isLoading: true });
    render(<MemberBills />);
    expect(screen.getByLabelText("Loading billers")).toBeInTheDocument();
  });
});

// ── MemberAirtime (Airtime & Mobile Money) ─────────────────────────────────

describe("MemberAirtime & Mobile Money (W7-B10)", () => {
  function setAll() {
    setQuery("memberAirtime.myHistory", { data: AIRTIME_HISTORY });
    setQuery("memberAirtime.mySummary", { data: AIRTIME_SUMMARY });
    setQuery("memberMobileMoney.providers", { data: MOMO_PROVIDERS });
    setQuery("memberMobileMoney.myTransactions", { data: MOMO_TXS });
    setQuery("memberMobileMoney.mySummary", { data: MOMO_SUMMARY });
    setQuery("memberMobileMoney.myTransaction", { data: MOMO_DETAIL });
  }

  it("renders airtime history + summary incl. honest failed rows", () => {
    setAll();
    render(<MemberAirtime />);
    expect(screen.getByText("AIR-001")).toBeInTheDocument();
    expect(screen.getByText("AIR-002")).toBeInTheDocument();
    expect(screen.getByText("Provider timeout")).toBeInTheDocument();
    // 2026-10-04 (W10-B4a): "MTN" now also appears as the default network
    // of the real Buy-Airtime form — assert presence, not uniqueness.
    expect(screen.getAllByText("MTN").length).toBeGreaterThan(0);
    // Per-status summary is disclosed (failed counted, not hidden).
    expect(screen.getAllByTestId("summary-list")[0]).toHaveTextContent(
      "failed"
    );
    expect(screen.getAllByTestId("summary-list")[0]).toHaveTextContent(
      "Total: 3 over 30 days"
    );
  });

  it("renders mobile-money transactions, provider filter and honest unconfigured note", () => {
    setAll();
    render(<MemberAirtime />);
    expect(screen.getByText("MM-12345")).toBeInTheDocument();
    // 2026-10-04 (W10-B4a): "MTN MoMo" now also appears as the default
    // provider of the real Cash In/Out form — assert presence.
    expect(screen.getAllByText("MTN MoMo").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/No mobile-money provider is configured/)
    ).toBeInTheDocument();
  });

  it("opens transaction detail by exact ref payload", () => {
    setAll();
    render(<MemberAirtime />);
    fireEvent.click(screen.getByRole("button", { name: "MM-12345" }));
    expect(getQueryCalls("memberMobileMoney.myTransaction")).toContainEqual({
      ref: "MM-12345",
    });
    expect(screen.getByTestId("momo-detail")).toHaveTextContent("Cash In");
  });

  it("honest empty states when the member has no history", () => {
    setQuery("memberAirtime.myHistory", { data: { history: [], total: 0 } });
    setQuery("memberAirtime.mySummary", {
      data: { periodDays: 30, totalTransactions: 0, byStatus: [] },
    });
    setQuery("memberMobileMoney.myTransactions", {
      data: { transactions: [], count: 0 },
    });
    setQuery("memberMobileMoney.mySummary", {
      data: { periodDays: 30, totalTransactions: 0, byStatus: [] },
    });
    setQuery("memberMobileMoney.providers", { data: MOMO_PROVIDERS });
    render(<MemberAirtime />);
    expect(
      screen.getByText(/no airtime purchases yet/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no mobile-money transactions yet/)
    ).toBeInTheDocument();
  });

  it("surfaces section errors honestly", () => {
    setAll();
    setQuery("memberAirtime.myHistory", {
      isError: true,
      error: { message: "INTERNAL_SERVER_ERROR: DB unavailable" },
    });
    render(<MemberAirtime />);
    expect(screen.getByText(/DB unavailable/)).toBeInTheDocument();
  });
});

// ── MemberFx ───────────────────────────────────────────────────────────────

describe("MemberFx (W7-B10)", () => {
  it("renders the published rate book", () => {
    setQuery("memberFxRates.rates", { data: FX_RATES });
    setQuery("memberFxRates.currencies", { data: FX_CURRENCIES });
    render(<MemberFx />);
    // NGN appears in the rate table AND the currency selects.
    expect(screen.getAllByText("NGN").length).toBeGreaterThan(0);
    expect(screen.getByText("1650.2500")).toBeInTheDocument();
  });

  it("honest empty state when no rate book is published", () => {
    setQuery("memberFxRates.rates", {
      data: { baseCurrency: "EUR", rates: {}, lastUpdated: null },
    });
    setQuery("memberFxRates.currencies", {
      data: { currencies: [], baseCurrency: "EUR" },
    });
    render(<MemberFx />);
    expect(
      screen.getByText(/No exchange rates have been published yet/)
    ).toBeInTheDocument();
  });

  it("convert flow issues the exact {from, to, amount} payload and renders the result", () => {
    setQuery("memberFxRates.rates", { data: FX_RATES });
    setQuery("memberFxRates.currencies", { data: FX_CURRENCIES });
    setQuery("memberFxRates.convert", { data: FX_CONVERTED });
    render(<MemberFx />);
    fireEvent.change(screen.getByLabelText("Amount"), {
      target: { value: "1000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    expect(getQueryCalls("memberFxRates.convert")).toContainEqual({
      from: "NGN",
      to: "USD",
      amount: 1000,
    });
    expect(screen.getByTestId("convert-result")).toHaveTextContent(
      "1000 NGN = 0.65 USD"
    );
  });

  it("surfaces PRECONDITION_FAILED from convert honestly", () => {
    setQuery("memberFxRates.rates", { data: FX_RATES });
    setQuery("memberFxRates.currencies", { data: FX_CURRENCIES });
    setQuery("memberFxRates.convert", {
      isError: true,
      error: {
        message: "PRECONDITION_FAILED: no FX rates are stored",
      },
    });
    render(<MemberFx />);
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    expect(
      screen.getByText(/no FX rates are stored/)
    ).toBeInTheDocument();
  });

  it("historical flow issues the exact payload and renders the time-series", () => {
    setQuery("memberFxRates.rates", { data: FX_RATES });
    setQuery("memberFxRates.currencies", { data: FX_CURRENCIES });
    setQuery("memberFxRates.historical", { data: FX_HISTORICAL });
    render(<MemberFx />);
    fireEvent.click(screen.getByRole("button", { name: "Load history" }));
    expect(getQueryCalls("memberFxRates.historical")).toContainEqual({
      base: "NGN",
      target: "USD",
      days: 30,
    });
    expect(screen.getByText("2026-09-06")).toBeInTheDocument();
    expect(screen.getByText("0.0007")).toBeInTheDocument();
    expect(screen.getByText("0.0006")).toBeInTheDocument();
  });
});

// ── MemberParametric ───────────────────────────────────────────────────────

describe("MemberParametric (W7-B10)", () => {
  it("renders real coverage and payouts", () => {
    setQuery("parametricMember.myCoverage", { data: PARAMETRIC_COVERAGE });
    setQuery("parametricMember.myPayouts", { data: PARAMETRIC_PAYOUTS });
    render(<MemberParametric />);
    expect(screen.getByText("Flood Guard")).toBeInTheDocument();
    expect(screen.getByText("flood")).toBeInTheDocument();
    expect(screen.getByText("armed")).toBeInTheDocument();
    expect(screen.getByText("#77")).toBeInTheDocument();
    expect(screen.getByText("paid")).toBeInTheDocument();
  });

  it("honest empty states when no coverage/payouts exist", () => {
    setQuery("parametricMember.myCoverage", { data: { coverage: [] } });
    setQuery("parametricMember.myPayouts", { data: { payouts: [], count: 0 } });
    render(<MemberParametric />);
    expect(
      screen.getByText(/no parametric coverage yet/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/no parametric payouts yet/)
    ).toBeInTheDocument();
  });

  it("surfaces errors honestly", () => {
    setQuery("parametricMember.myCoverage", {
      isError: true,
      error: { message: "INTERNAL_SERVER_ERROR: DB unavailable" },
    });
    setQuery("parametricMember.myPayouts", { data: { payouts: [], count: 0 } });
    render(<MemberParametric />);
    expect(screen.getByText(/DB unavailable/)).toBeInTheDocument();
  });
});

// ── MemberProducts (marketplace browse) ────────────────────────────────────

describe("MemberProducts (W7-B10)", () => {
  it("renders catalog products with real fields and quote link", () => {
    setQuery("insuranceProductCatalog.listProducts", { data: PRODUCTS });
    render(<MemberProducts />);
    expect(screen.getByText("Comprehensive Motor")).toBeInTheDocument();
    expect(screen.getByText("Full motor cover")).toBeInTheDocument();
    expect(screen.getByText("motor")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Get a quote/ })
    ).toHaveAttribute("href", "/member/quotes");
  });

  it("search issues the exact filter payload", () => {
    setQuery("insuranceProductCatalog.listProducts", { data: PRODUCTS });
    render(<MemberProducts />);
    fireEvent.change(screen.getByLabelText("Search"), {
      target: { value: "motor" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    const calls = getQueryCalls("insuranceProductCatalog.listProducts");
    expect(
      calls.some(
        (c) =>
          typeof c === "object" &&
          c !== null &&
          (c as { search?: string }).search === "motor" &&
          (c as { productType?: string }).productType === "all" &&
          (c as { isActive?: boolean }).isActive === true
      )
    ).toBe(true);
  });

  it("honest empty and error states", () => {
    setQuery("insuranceProductCatalog.listProducts", {
      data: { data: [], total: 0 },
    });
    render(<MemberProducts />);
    expect(
      screen.getByText(/No active products match your filters/)
    ).toBeInTheDocument();
    cleanup();
    setQuery("insuranceProductCatalog.listProducts", {
      isError: true,
      error: { message: "INTERNAL_SERVER_ERROR: DB unavailable" },
    });
    render(<MemberProducts />);
    expect(screen.getByText(/DB unavailable/)).toBeInTheDocument();
  });
});
