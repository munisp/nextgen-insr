/**
 * MemberPolicyServicing.test.tsx — policy servicing pages tests (W7-B5).
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub (same boundary as MemberPages/MemberAuth). All rendering,
 * guard logic, form validation and state handling are real. The auth
 * boundary (trpc.auth.me) is scripted to an authenticated member except in
 * the guard tests.
 *
 * Proves:
 *   - MemberPolicyDetail renders real-shaped myPolicy data and surfaces
 *     NOT_FOUND honestly.
 *   - MemberRenewals renders myRenewals rows; requestRenewal success and
 *     server-error (CONFLICT) flows; exact input shape sent.
 *   - MemberBeneficiaries lists per-policy rows; upsert add success; server
 *     validation error (minor requires guardian) surfaced; remove requires
 *     the inline confirm before the mutation fires.
 *   - MemberEndorsements renders rows; requestEndorsement success and
 *     error flows; exact input shape sent.
 *   - Anonymous sessions are bounced to /member/login, never servicing
 *     content.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import { Route } from "wouter";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberPolicyDetail from "@/pages/member/MemberPolicyDetail";
import MemberRenewals from "@/pages/member/MemberRenewals";
import MemberBeneficiaries from "@/pages/member/MemberBeneficiaries";
import MemberEndorsements from "@/pages/member/MemberEndorsements";
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

const POLICY_ROW = {
  id: 42,
  policyNumber: "POL-2026-00042",
  status: "active",
  coverageType: "motor",
  sumInsured: "5000000",
  annualPremium: "125000",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2027-01-01T00:00:00.000Z",
  renewalDate: "2027-01-01T00:00:00.000Z",
  createdAt: "2025-12-15T00:00:00.000Z",
  productId: 3,
  productName: "Motor Comprehensive",
  currency: "NGN",
};

function authenticate() {
  setQuery("auth.me", { data: MEMBER });
}

function setLocation(url: string) {
  window.history.pushState({}, "", url);
}

// MemberPolicyDetail reads :id via wouter useParams, which only resolves
// inside a matched <Route> — wrap renders in the real route pattern.
function renderPolicyDetail() {
  return render(
    <Route path="/member/policies/:id">
      <MemberPolicyDetail />
    </Route>
  );
}

beforeEach(() => {
  resetTrpcMock();
  authenticate();
  setLocation("/member/policies");
});
afterEach(() => cleanup());

describe("MemberPolicyDetail", () => {
  it("renders the full real-shaped policy view", () => {
    setLocation("/member/policies/42");
    setQuery("memberPolicies.myPolicy", {
      data: {
        ...POLICY_ROW,
        certificateNumber: "CERT-0042",
        productDescription: "Comprehensive motor cover.",
      },
    });
    renderPolicyDetail();
    expect(screen.getByText("POL-2026-00042")).toBeInTheDocument();
    expect(screen.getByText("Motor Comprehensive")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("CERT-0042")).toBeInTheDocument();
    expect(
      screen.getByText("Comprehensive motor cover.")
    ).toBeInTheDocument();
    // Servicing links to the W7-B5 pages carry the policy id.
    const servicingNav = screen.getByRole("navigation", {
      name: "Policy servicing",
    });
    expect(
      within(servicingNav).getByRole("link", { name: "Beneficiaries" })
    ).toHaveAttribute("href", "/member/beneficiaries?policy=42");
  });

  it("surfaces NOT_FOUND honestly", () => {
    setLocation("/member/policies/999");
    setQuery("memberPolicies.myPolicy", {
      isError: true,
      error: { message: "Policy not found" },
    });
    renderPolicyDetail();
    expect(screen.getByText("Policy not found")).toBeInTheDocument();
  });

  it("rejects a malformed id without calling the server shape", () => {
    setLocation("/member/policies/abc");
    renderPolicyDetail();
    expect(
      screen.getByText("Invalid policy id in the address.")
    ).toBeInTheDocument();
  });

  it("anonymous session bounces to /member/login, never policy content", () => {
    setQuery("auth.me", { data: null });
    setLocation("/member/policies/42");
    renderPolicyDetail();
    // useAuth redirect is in flight — the route no longer matches and no
    // member content may ever be painted.
    expect(window.location.pathname).toBe("/member/login");
    expect(screen.queryByText("Policy Details")).not.toBeInTheDocument();
    expect(screen.queryByText("POL-2026-00042")).not.toBeInTheDocument();
  });
});

describe("MemberRenewals", () => {
  const RENEWAL = {
    id: 7,
    originalPolicyId: 42,
    policyNumber: "POL-2026-00042",
    status: "pending",
    renewalDueDate: "2027-01-01T00:00:00.000Z",
    renewalPremium: "125000",
    isAutoRenewal: false,
    completedAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    currency: "NGN",
  };

  it("renders real renewal rows and the count", () => {
    setQuery("memberRenewals.myRenewals", {
      data: { renewals: [RENEWAL], count: 1 },
    });
    render(<MemberRenewals />);
    expect(screen.getByText("POL-2026-00042")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("1 renewal on your account.")).toBeInTheDocument();
  });

  it("honest empty state with no fabricated rows", () => {
    setQuery("memberRenewals.myRenewals", {
      data: { renewals: [], count: 0 },
    });
    render(<MemberRenewals />);
    expect(screen.getByText(/You have no renewals yet/)).toBeInTheDocument();
  });

  it("requestRenewal success sends the exact server input shape", () => {
    setQuery("memberRenewals.myRenewals", {
      data: { renewals: [], count: 0 },
    });
    setQuery("memberPolicies.myPolicies", {
      data: { policies: [POLICY_ROW], count: 1 },
    });
    setMutation("memberRenewals.requestRenewal", {
      data: { renewal: RENEWAL },
    });
    render(<MemberRenewals />);
    fireEvent.change(screen.getByLabelText("Policy"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request renewal" }));
    expect(getMutationCalls("memberRenewals.requestRenewal")).toEqual([
      { policyId: 42, isAutoRenewal: false },
    ]);
    // Form cleared on success — the honest confirmation path.
    expect(screen.getByLabelText("Policy")).toHaveValue("");
  });

  it("server CONFLICT error is surfaced verbatim", () => {
    setQuery("memberRenewals.myRenewals", {
      data: { renewals: [], count: 0 },
    });
    setQuery("memberPolicies.myPolicies", {
      data: { policies: [POLICY_ROW], count: 1 },
    });
    setMutation("memberRenewals.requestRenewal", {
      error: { message: "An open renewal already exists for this policy" },
    });
    render(<MemberRenewals />);
    fireEvent.change(screen.getByLabelText("Policy"), {
      target: { value: "42" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Request renewal" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "An open renewal already exists for this policy"
    );
  });

  it("?policy=42 preselects the picker", () => {
    setLocation("/member/renewals?policy=42");
    setQuery("memberPolicies.myPolicies", {
      data: { policies: [POLICY_ROW], count: 1 },
    });
    render(<MemberRenewals />);
    expect(screen.getByLabelText("Policy")).toHaveValue("42");
  });
});

describe("MemberBeneficiaries", () => {
  const BEN = {
    id: 11,
    policyId: 42,
    name: "Chidi Okoro",
    relationship: "spouse",
    percentage: "60",
    dateOfBirth: "1990-04-02T00:00:00.000Z",
    isMinor: false,
    guardianName: null,
    nationalId: "***42",
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-10T00:00:00.000Z",
  };

  function renderSelected() {
    setQuery("memberPolicies.myPolicies", {
      data: { policies: [POLICY_ROW], count: 1 },
    });
    render(<MemberBeneficiaries />);
    fireEvent.change(screen.getByLabelText("Policy"), {
      target: { value: "42" },
    });
  }

  it("prompts for a policy before listing (no fabricated rows)", () => {
    setQuery("memberPolicies.myPolicies", {
      data: { policies: [POLICY_ROW], count: 1 },
    });
    render(<MemberBeneficiaries />);
    expect(
      screen.getByText(/Select a policy to view its beneficiaries/)
    ).toBeInTheDocument();
  });

  it("renders real beneficiary rows for the selected policy", () => {
    setQuery("memberBeneficiaries.myBeneficiaries", {
      data: { items: [BEN] },
    });
    renderSelected();
    expect(screen.getByText("Chidi Okoro")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    // nationalId arrives masked from the server and is shown as-is.
    expect(screen.getByText("***42")).toBeInTheDocument();
  });

  it("upsert success sends the exact server input shape", () => {
    setQuery("memberBeneficiaries.myBeneficiaries", {
      data: { items: [] },
    });
    setMutation("memberBeneficiaries.upsertBeneficiary", {
      data: { success: true, beneficiaryId: 12 },
    });
    renderSelected();
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Ada Lovelace" },
    });
    fireEvent.change(screen.getByLabelText("Relationship"), {
      target: { value: "daughter" },
    });
    fireEvent.change(screen.getByLabelText("Percentage (%)"), {
      target: { value: "40" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add beneficiary" }));
    expect(getMutationCalls("memberBeneficiaries.upsertBeneficiary")).toEqual([
      {
        policyId: 42,
        name: "Ada Lovelace",
        relationship: "daughter",
        percentage: 40,
        isMinor: false,
      },
    ]);
  });

  it("server validation error (minor requires guardian) is surfaced", () => {
    setQuery("memberBeneficiaries.myBeneficiaries", {
      data: { items: [] },
    });
    setMutation("memberBeneficiaries.upsertBeneficiary", {
      error: { message: "A minor beneficiary requires a guardianName" },
    });
    renderSelected();
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Baby Okoro" },
    });
    fireEvent.change(screen.getByLabelText("Relationship"), {
      target: { value: "son" },
    });
    fireEvent.change(screen.getByLabelText("Percentage (%)"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add beneficiary" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A minor beneficiary requires a guardianName"
    );
  });

  it("client-side minor rule blocks submission before the server", () => {
    setQuery("memberBeneficiaries.myBeneficiaries", {
      data: { items: [] },
    });
    renderSelected();
    fireEvent.change(screen.getByLabelText("Full name"), {
      target: { value: "Baby Okoro" },
    });
    fireEvent.change(screen.getByLabelText("Relationship"), {
      target: { value: "son" },
    });
    fireEvent.change(screen.getByLabelText("Percentage (%)"), {
      target: { value: "20" },
    });
    fireEvent.click(screen.getByLabelText("Beneficiary is a minor"));
    fireEvent.click(screen.getByRole("button", { name: "Add beneficiary" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A minor beneficiary requires a guardian name."
    );
    expect(getMutationCalls("memberBeneficiaries.upsertBeneficiary")).toEqual(
      []
    );
  });

  it("remove fires only after the inline confirm", () => {
    setQuery("memberBeneficiaries.myBeneficiaries", {
      data: { items: [BEN] },
    });
    setMutation("memberBeneficiaries.removeBeneficiary", {
      data: { success: true },
    });
    renderSelected();
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(getMutationCalls("memberBeneficiaries.removeBeneficiary")).toEqual(
      []
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm remove" }));
    expect(getMutationCalls("memberBeneficiaries.removeBeneficiary")).toEqual([
      { policyId: 42, beneficiaryId: 11 },
    ]);
  });
});

describe("MemberEndorsements", () => {
  const ENDORSEMENT = {
    id: 5,
    endorsementNumber: "END-1717000000000-42",
    policyId: 42,
    policyNumber: "POL-2026-00042",
    type: "modification",
    effectiveDate: "2026-10-15T00:00:00.000Z",
    description: "Change of vehicle",
    premiumAdjustment: "15000",
    sumInsuredAdjustment: "0",
    approvedAt: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    currency: "NGN",
  };

  it("renders real endorsement rows and the count", () => {
    setQuery("memberEndorsements.myEndorsements", {
      data: { endorsements: [ENDORSEMENT], count: 1 },
    });
    render(<MemberEndorsements />);
    expect(
      screen.getByText("END-1717000000000-42")
    ).toBeInTheDocument();
    expect(screen.getAllByText("modification").length).toBeGreaterThan(0);
    expect(
      screen.getByText("1 endorsement on your account.")
    ).toBeInTheDocument();
  });

  it("honest empty state with no fabricated rows", () => {
    setQuery("memberEndorsements.myEndorsements", {
      data: { endorsements: [], count: 0 },
    });
    render(<MemberEndorsements />);
    expect(
      screen.getByText(/You have no endorsements yet/)
    ).toBeInTheDocument();
  });

  it("requestEndorsement success sends the exact server input shape", () => {
    setQuery("memberEndorsements.myEndorsements", {
      data: { endorsements: [], count: 0 },
    });
    setQuery("memberPolicies.myPolicies", {
      data: { policies: [POLICY_ROW], count: 1 },
    });
    setMutation("memberEndorsements.requestEndorsement", {
      data: { endorsement: ENDORSEMENT, endorsementNumber: "END-X" },
    });
    render(<MemberEndorsements />);
    fireEvent.change(screen.getByLabelText("Policy"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "extension" },
    });
    fireEvent.change(screen.getByLabelText("Effective date"), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Extend cover by 3 months" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Request endorsement" })
    );
    expect(getMutationCalls("memberEndorsements.requestEndorsement")).toEqual([
      {
        policyId: 42,
        type: "extension",
        effectiveDate: "2026-11-01",
        description: "Extend cover by 3 months",
      },
    ]);
  });

  it("server NOT_FOUND error is surfaced verbatim", () => {
    setQuery("memberEndorsements.myEndorsements", {
      data: { endorsements: [], count: 0 },
    });
    setQuery("memberPolicies.myPolicies", {
      data: { policies: [POLICY_ROW], count: 1 },
    });
    setMutation("memberEndorsements.requestEndorsement", {
      error: { message: "Policy not found" },
    });
    render(<MemberEndorsements />);
    fireEvent.change(screen.getByLabelText("Policy"), {
      target: { value: "42" },
    });
    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "modification" },
    });
    fireEvent.change(screen.getByLabelText("Effective date"), {
      target: { value: "2026-11-01" },
    });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Change address" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Request endorsement" })
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Policy not found");
  });

  it("anonymous session renders the redirect state, never servicing content", () => {
    setQuery("auth.me", { data: null });
    render(<MemberEndorsements />);
    expect(screen.getByLabelText("Redirecting to sign in")).toBeInTheDocument();
    expect(screen.queryByText("My Endorsements")).not.toBeInTheDocument();
  });
});
