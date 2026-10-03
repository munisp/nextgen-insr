/**
 * MemberIdentity.test.tsx — W7-B9 (2026-10-05): /member/identity (KYC +
 * tiers + MFA + face enrollments/revoke + liveness cooldown + phone OTP)
 * and the onboarding checklist section on /member/profile.
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub. All rendering and state handling are real. The auth
 * boundary (trpc.auth.me) is scripted to an authenticated member.
 *
 * Proves:
 *   - Identity: real KYC status render, verbatim KYC/tier errors, MFA
 *     honest unavailability reason, liveness cooldown locked + unlocked
 *     states, real face-enrollment list + active enrollment;
 *   - Revoke flow: two-step inline confirm, zod-exact
 *     revokeMyFaceEnrollment payload { enrollmentId, reason }, verbatim
 *     NOT_FOUND error surfacing, client-side reason-required guard;
 *   - Phone OTP: zod-exact requestPhoneOtp { phone } and verifyPhoneOtp
 *     { phone, otp } payloads, stage transitions, verbatim mutation errors,
 *     honest {verified:false} handling;
 *   - Honest absences: NO KYC submit form/button (no backend mutation
 *     exists), NO liveness enroll button (no member-safe bridge) — only
 *     disclosures;
 *   - Profile: onboarding checklist renders stages done/current/pending
 *     exactly as memberOnboarding.myProgress returns them.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberIdentity from "@/pages/member/MemberIdentity";
import MemberProfile from "@/pages/member/MemberProfile";
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

const KYC_STATUS = {
  hasProfile: true,
  hasSession: true,
  status: "pending",
  kycLevel: 1,
  session: {
    id: 44,
    status: "pending",
    type: "individual",
    livenessPassed: true,
    livenessScore: 0.92,
    docType: "nin",
    docConfidence: 0.88,
    rejectionReason: null,
    reviewedAt: null,
    expiresAt: null,
    createdAt: "2026-09-20T09:00:00.000Z",
    updatedAt: "2026-09-20T09:00:00.000Z",
  },
};

const MFA_STATUS = {
  mfaEnabled: false,
  available: false,
  reason:
    "MFA enrollment is not implemented: this deployment has no TOTP/SMS/WebAuthn verification capability.",
};

const ENROLLMENTS = [
  {
    id: 11,
    enrollmentType: "kyc",
    embeddingVersion: "v2",
    qualityScore: 0.87,
    livenessScore: 0.9,
    isActive: true,
    createdAt: "2026-09-21T10:00:00.000Z",
    expiresAt: null,
    revokedAt: null,
    verificationBasis: "self-enrolled",
  },
  {
    id: 9,
    enrollmentType: "login",
    embeddingVersion: "v1",
    qualityScore: 0.7,
    livenessScore: 0.8,
    isActive: false,
    createdAt: "2026-08-01T10:00:00.000Z",
    expiresAt: null,
    revokedAt: "2026-09-01T10:00:00.000Z",
    verificationBasis: "self-enrolled",
  },
];

const ONBOARDING = {
  currentStage: "kyc_submission",
  stageIndex: 1,
  totalStages: 7,
  completionPercent: 29,
  stages: [
    { id: 1, name: "registration", order: 1, required: true, estimatedMinutes: 5 },
    { id: 2, name: "kyc_submission", order: 2, required: true, estimatedMinutes: 15 },
    { id: 3, name: "kyc_review", order: 3, required: true, estimatedMinutes: 60 },
    { id: 4, name: "account_setup", order: 4, required: true, estimatedMinutes: 10 },
    { id: 5, name: "training", order: 5, required: true, estimatedMinutes: 30 },
    { id: 6, name: "activation", order: 6, required: true, estimatedMinutes: 5 },
    { id: 7, name: "live", order: 7, required: true, estimatedMinutes: 0 },
  ],
  startedAt: "2026-09-01T00:00:00.000Z",
};

/** Script the full happy-path identity query set. */
function scriptIdentityQueries() {
  setQuery("memberIdentity.myKycStatus", { data: KYC_STATUS });
  setQuery("memberIdentity.kycTierRequirements", {
    data: { tiers: [{ tier: 1, maxBalance: 300000 }] },
  });
  setQuery("memberIdentity.myMfaStatus", { data: MFA_STATUS });
  setQuery("memberIdentity.myFaceEnrollments", { data: ENROLLMENTS });
  setQuery("memberIdentity.myActiveFaceEnrollment", {
    data: ENROLLMENTS[0],
  });
  setQuery("memberIdentity.checkLivenessCooldown", {
    data: { locked: false, remainingMs: 0, failures: 0 },
  });
}

beforeEach(() => {
  resetTrpcMock();
  setQuery("auth.me", { data: MEMBER });
});
afterEach(() => cleanup());

describe("MemberIdentity — KYC & tiers (W7-B9)", () => {
  it("renders the real KYC status and tier requirements", () => {
    scriptIdentityQueries();
    render(<MemberIdentity />);
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("Passed")).toBeInTheDocument();
    expect(screen.getByTestId("tier-requirements")).toHaveTextContent(
      '"maxBalance": 300000'
    );
  });

  it("shows the honest empty state when no customer profile is linked", () => {
    scriptIdentityQueries();
    setQuery("memberIdentity.myKycStatus", {
      data: {
        hasProfile: false,
        hasSession: false,
        status: "unstarted",
        kycLevel: 0,
        session: null,
      },
    });
    render(<MemberIdentity />);
    expect(
      screen.getByText(/No customer profile is linked to your account yet/)
    ).toBeInTheDocument();
  });

  it("surfaces the verbatim gateway error for tier requirements", () => {
    scriptIdentityQueries();
    setQuery("memberIdentity.kycTierRequirements", {
      isError: true,
      error: { message: "KYC enforcement gateway unreachable: ECONNREFUSED" },
    });
    render(<MemberIdentity />);
    expect(
      screen.getByText(/KYC enforcement gateway unreachable: ECONNREFUSED/)
    ).toBeInTheDocument();
  });

  it("renders the honest KYC-submission disclosure and NO submit form", () => {
    scriptIdentityQueries();
    render(<MemberIdentity />);
    expect(
      screen.getByText(/KYC submission is not available in this portal/)
    ).toBeInTheDocument();
    // No fake KYC submit control may exist.
    expect(
      screen.queryByRole("button", { name: /submit kyc/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/bvn/i)
    ).not.toBeInTheDocument();
  });
});

describe("MemberIdentity — face enrollment & liveness (W7-B9)", () => {
  it("renders enrollments, the active enrollment, and the unlocked cooldown", () => {
    scriptIdentityQueries();
    render(<MemberIdentity />);
    expect(screen.getByTestId("face-enrollment-11")).toBeInTheDocument();
    expect(screen.getByTestId("face-enrollment-9")).toHaveTextContent(
      "revoked"
    );
    expect(screen.getByText(/Enrollment #11 · quality/)).toBeInTheDocument();
    expect(
      screen.getByText(/No liveness verification lockout is active/)
    ).toBeInTheDocument();
  });

  it("renders the locked liveness cooldown state with real remaining time", () => {
    scriptIdentityQueries();
    setQuery("memberIdentity.checkLivenessCooldown", {
      data: { locked: true, remainingMs: 300000, failures: 5 },
    });
    render(<MemberIdentity />);
    expect(
      screen.getByText(/Liveness verification is temporarily locked/)
    ).toHaveTextContent("5 minute(s)");
  });

  it("shows the honest absence note and NO liveness enroll button", () => {
    scriptIdentityQueries();
    render(<MemberIdentity />);
    expect(
      screen.getByText(/New face enrollment is not offered in this portal/)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /enroll/i })
    ).not.toBeInTheDocument();
  });

  it("revokes with the two-step confirm and zod-exact payload", () => {
    scriptIdentityQueries();
    setMutation("memberIdentity.revokeMyFaceEnrollment", {
      data: { success: true, id: 11 },
    });
    render(<MemberIdentity />);
    fireEvent.click(screen.getByText("Revoke"));
    fireEvent.change(screen.getByLabelText("Reason for revocation"), {
      target: { value: "I no longer use this device" },
    });
    fireEvent.click(screen.getByText("Confirm revoke"));
    expect(
      getMutationCalls("memberIdentity.revokeMyFaceEnrollment")
    ).toEqual([{ enrollmentId: 11, reason: "I no longer use this device" }]);
  });

  it("blocks revoke without a reason (client zod-exact guard)", () => {
    scriptIdentityQueries();
    render(<MemberIdentity />);
    fireEvent.click(screen.getByText("Revoke"));
    fireEvent.click(screen.getByText("Confirm revoke"));
    expect(
      getMutationCalls("memberIdentity.revokeMyFaceEnrollment")
    ).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "A reason is required to revoke an enrollment."
    );
  });

  it("surfaces the verbatim NOT_FOUND revoke error", () => {
    scriptIdentityQueries();
    setMutation("memberIdentity.revokeMyFaceEnrollment", {
      error: { message: "Face enrollment not found" },
    });
    render(<MemberIdentity />);
    fireEvent.click(screen.getByText("Revoke"));
    fireEvent.change(screen.getByLabelText("Reason for revocation"), {
      target: { value: "Compromised" },
    });
    fireEvent.click(screen.getByText("Confirm revoke"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Face enrollment not found"
    );
  });
});

describe("MemberIdentity — MFA (W7-B9)", () => {
  it("reports MFA honestly (flag + unavailability reason)", () => {
    scriptIdentityQueries();
    render(<MemberIdentity />);
    expect(screen.getByText("Not available in this deployment")).toBeInTheDocument();
    expect(screen.getByText(/no TOTP\/SMS\/WebAuthn/)).toBeInTheDocument();
  });
});

describe("MemberIdentity — phone OTP (W7-B9)", () => {
  it("requests an OTP with the zod-exact payload and advances to verify", () => {
    scriptIdentityQueries();
    setMutation("memberPhone.requestPhoneOtp", {
      data: { success: true, message: "Verification code sent by SMS" },
    });
    render(<MemberIdentity />);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "08031234567" },
    });
    fireEvent.click(screen.getByText("Send verification code"));
    expect(getMutationCalls("memberPhone.requestPhoneOtp")).toEqual([
      { phone: "08031234567" },
    ]);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Verification code sent by SMS"
    );
    expect(screen.getByLabelText("6-digit code")).toBeInTheDocument();
  });

  it("verifies the OTP with the zod-exact payload and shows success", () => {
    scriptIdentityQueries();
    setMutation("memberPhone.requestPhoneOtp", {
      data: { success: true, message: "Verification code sent by SMS" },
    });
    setMutation("memberPhone.verifyPhoneOtp", { data: { verified: true } });
    render(<MemberIdentity />);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "08031234567" },
    });
    fireEvent.click(screen.getByText("Send verification code"));
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByText("Verify code"));
    expect(getMutationCalls("memberPhone.verifyPhoneOtp")).toEqual([
      { phone: "08031234567", otp: "123456" },
    ]);
    expect(
      screen.getByText(/Your phone number was verified successfully/)
    ).toBeInTheDocument();
  });

  it("surfaces the verbatim request error (server-side throttle)", () => {
    scriptIdentityQueries();
    setMutation("memberPhone.requestPhoneOtp", {
      error: { message: "Too many OTP requests for this phone" },
    });
    render(<MemberIdentity />);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "08031234567" },
    });
    fireEvent.click(screen.getByText("Send verification code"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Too many OTP requests for this phone"
    );
  });

  it("surfaces the verbatim verify error", () => {
    scriptIdentityQueries();
    setMutation("memberPhone.requestPhoneOtp", {
      data: { success: true, message: "Verification code sent by SMS" },
    });
    setMutation("memberPhone.verifyPhoneOtp", {
      error: { message: "Invalid or expired code" },
    });
    render(<MemberIdentity />);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "08031234567" },
    });
    fireEvent.click(screen.getByText("Send verification code"));
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "000000" },
    });
    fireEvent.click(screen.getByText("Verify code"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid or expired code"
    );
  });

  it("handles an honest {verified:false} payload without a success claim", () => {
    scriptIdentityQueries();
    setMutation("memberPhone.requestPhoneOtp", {
      data: { success: true, message: "Verification code sent by SMS" },
    });
    setMutation("memberPhone.verifyPhoneOtp", { data: { verified: false } });
    render(<MemberIdentity />);
    fireEvent.change(screen.getByLabelText("Phone number"), {
      target: { value: "08031234567" },
    });
    fireEvent.click(screen.getByText("Send verification code"));
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByText("Verify code"));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The code did not match."
    );
    expect(
      screen.queryByText(/verified successfully/)
    ).not.toBeInTheDocument();
  });
});

describe("MemberProfile — onboarding progress (W7-B9)", () => {
  it("renders the checklist done/current/pending exactly as returned", () => {
    setQuery("memberOnboarding.myProgress", { data: ONBOARDING });
    render(<MemberProfile />);
    expect(screen.getByText(/Stage 2 of 7 · 29% complete/)).toBeInTheDocument();
    const checklist = screen.getByTestId("onboarding-checklist");
    expect(checklist).toHaveTextContent("registration");
    expect(checklist).toHaveTextContent("kyc submission");
    expect(screen.getByTestId("onboarding-stage-registration")).toHaveTextContent(
      "done"
    );
    expect(
      screen.getByTestId("onboarding-stage-kyc_submission")
    ).toHaveTextContent("current");
    expect(screen.getByTestId("onboarding-stage-live")).toHaveTextContent(
      "pending"
    );
  });

  it("surfaces the verbatim onboarding error", () => {
    setQuery("memberOnboarding.myProgress", {
      isError: true,
      error: { message: "DB unavailable" },
    });
    render(<MemberProfile />);
    expect(screen.getByText(/DB unavailable/)).toBeInTheDocument();
  });
});
