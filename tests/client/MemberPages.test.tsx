/**
 * MemberPages.test.tsx — smoke tests for the /member/* portal pages (W7-B1).
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub. All rendering, guard logic and state handling are real.
 * The auth boundary (trpc.auth.me) is scripted to an authenticated member.
 *
 * Proves each page renders loading / honest-empty / error states with real
 * data wiring and no fabricated rows.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberQuotes from "@/pages/member/MemberQuotes";
import MemberPolicies from "@/pages/member/MemberPolicies";
import MemberClaims from "@/pages/member/MemberClaims";
import MemberPayments from "@/pages/member/MemberPayments";
import MemberProfile from "@/pages/member/MemberProfile";
import { setQuery, resetTrpcMock } from "./helpers/trpcMock";

const MEMBER = {
  id: 9001,
  name: "Adaeze Test",
  email: "adaeze@example.com",
  role: "user",
};

function authenticate() {
  setQuery("auth.me", { data: MEMBER });
}

describe("Member pages (client)", () => {
  beforeEach(() => {
    resetTrpcMock();
    authenticate();
  });
  afterEach(() => cleanup());

  it("MemberQuotes: honest empty cart, no fabricated rows", () => {
    setQuery("memberQuotes.myQuoteCart", {
      data: { items: [], subTotal: 0, totalPremium: 0, count: 0, currency: "NGN" },
    });
    setQuery("memberQuotes.quoteSummary", {
      data: { count: 0, totalPremium: 0, currency: "NGN" },
    });
    setQuery("insuranceProductCatalog.listProducts", {
      data: { data: [], total: 0 },
    });
    render(<MemberQuotes />);
    expect(screen.getByText("Quote Cart")).toBeInTheDocument();
    expect(
      screen.getByText(/Your quote cart is empty/)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No insurance products are currently available/)
    ).toBeInTheDocument();
  });

  it("MemberQuotes: real cart rows render from server data", () => {
    setQuery("memberQuotes.myQuoteCart", {
      data: {
        items: [
          {
            id: 7,
            productId: 3,
            productName: "Motor Comprehensive",
            productType: "motor",
            sumInsured: "5000000",
            premiumAmount: "125000",
            stampDuty: "50",
            totalPayable: "125050",
            durationMonths: 12,
            coverageType: "motor",
            status: "pending",
            validUntil: null,
            createdAt: new Date("2026-01-15").toISOString(),
          },
        ],
        subTotal: 125000,
        totalPremium: 125000,
        count: 1,
        currency: "NGN",
      },
    });
    setQuery("memberQuotes.quoteSummary", {
      data: { count: 1, totalPremium: 125000, currency: "NGN" },
    });
    setQuery("insuranceProductCatalog.listProducts", {
      data: { data: [], total: 0 },
    });
    render(<MemberQuotes />);
    expect(screen.getByText("Motor Comprehensive")).toBeInTheDocument();
    expect(screen.getByText(/1 item\(s\)/)).toBeInTheDocument();
  });

  it("MemberQuotes: error state shows the server message, no fake cart", () => {
    setQuery("memberQuotes.myQuoteCart", {
      isError: true,
      error: { message: "DB unavailable" },
    });
    setQuery("insuranceProductCatalog.listProducts", {
      data: { data: [], total: 0 },
    });
    render(<MemberQuotes />);
    expect(screen.getByText("Unable to load data")).toBeInTheDocument();
    expect(screen.getByText("DB unavailable")).toBeInTheDocument();
  });

  it("MemberPolicies: honest empty state", () => {
    setQuery("memberPolicies.myPolicies", { data: { policies: [], count: 0 } });
    render(<MemberPolicies />);
    expect(screen.getByText("My Policies")).toBeInTheDocument();
    expect(screen.getByText(/no policies yet/)).toBeInTheDocument();
  });

  it("MemberPolicies: real rows render", () => {
    setQuery("memberPolicies.myPolicies", {
      data: {
        policies: [
          {
            id: 11,
            policyNumber: "POL-0001",
            status: "active",
            coverageType: "motor",
            sumInsured: "5000000",
            annualPremium: "125000",
            startDate: "2026-01-01",
            endDate: "2027-01-01",
            renewalDate: null,
            createdAt: "2026-01-01",
            productId: 3,
            productName: "Motor Comprehensive",
            currency: "NGN",
          },
        ],
        count: 1,
      },
    });
    render(<MemberPolicies />);
    expect(screen.getByText("POL-0001")).toBeInTheDocument();
    expect(screen.getByText("Motor Comprehensive")).toBeInTheDocument();
  });

  it("MemberClaims: honest empty states for list and picker", () => {
    setQuery("memberClaims.myClaims", { data: { claims: [], count: 0 } });
    setQuery("memberClaims.myPoliciesPicker", { data: { policies: [] } });
    render(<MemberClaims />);
    expect(screen.getByText("My Claims")).toBeInTheDocument();
    expect(screen.getByText(/not filed any claims/)).toBeInTheDocument();
    expect(
      screen.getByText(/no active policies to claim against/)
    ).toBeInTheDocument();
  });

  it("MemberClaims: error state surfaces server message", () => {
    setQuery("memberClaims.myClaims", {
      isError: true,
      error: { message: "DB unavailable" },
    });
    setQuery("memberClaims.myPoliciesPicker", { data: { policies: [] } });
    render(<MemberClaims />);
    expect(screen.getByText("Unable to load data")).toBeInTheDocument();
  });

  it("MemberPayments: honest empty history and due states", () => {
    setQuery("memberPayments.myPremiums", { data: { premiums: [], count: 0 } });
    setQuery("memberPayments.myPremiumDue", {
      data: { duePremiums: [], policies: [], disclosure: "Test disclosure." },
    });
    render(<MemberPayments />);
    expect(screen.getByText("Payment History")).toBeInTheDocument();
    expect(
      screen.getByText(/No premium payments have been recorded/)
    ).toBeInTheDocument();
    expect(screen.getByText(/no premiums currently due/)).toBeInTheDocument();
  });

  it("MemberProfile: renders session user and honest no-profile KYC state", () => {
    setQuery("memberIdentity.myKycStatus", {
      data: {
        hasProfile: false,
        hasSession: false,
        status: "unstarted",
        kycLevel: 0,
        session: null,
      },
    });
    setQuery("memberIdentity.myMfaStatus", {
      data: { mfaEnabled: false, available: false },
    });
    render(<MemberProfile />);
    expect(screen.getByText("adaeze@example.com")).toBeInTheDocument();
    expect(screen.getByText(/No customer profile is linked/)).toBeInTheDocument();
    expect(
      screen.getByText("Not available in this deployment")
    ).toBeInTheDocument();
  });

  it("unauthenticated sessions see no member content", () => {
    resetTrpcMock(); // auth.me returns undefined data (anonymous)
    setQuery("memberPolicies.myPolicies", { data: { policies: [], count: 0 } });
    render(<MemberPolicies />);
    expect(screen.queryByText("My Policies")).toBeNull();
    expect(screen.queryByText("Member Portal")).toBeNull();
  });
});
