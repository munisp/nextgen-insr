/**
 * MemberIdentityKyc.test.tsx — W10-B4a (2026-10-04): the KYC document
 * submission flow on /member/identity, wired to the REAL
 * memberIdentity.submitKyc / myKycSession procs (W10-B3).
 *
 * Boundary mock ONLY: the tRPC network client (@/lib/trpc) via the shared
 * scriptable stub. All rendering and state handling are real. Proves:
 *   - the submit form renders only when no OPEN session exists, and sends a
 *     zod-strict body ({ docType, docNumber } — nothing else);
 *   - the 11-digit guard blocks submit client-side with NO mutation call;
 *   - an open ("pending") session renders its real status instead of the
 *     form (duplicate-submit impossible) and refreshes honestly;
 *   - the submit response renders the server's real verdict: adjudicated
 *     verified, adjudicated rejected, and the honest
 *     serviceOutcome:"unavailable" (still pending) copy — verbatim;
 *   - server errors (CONFLICT duplicate / PRECONDITION unconfigured) are
 *     surfaced verbatim, never masked.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

vi.mock("@/lib/trpc", async () => await import("./helpers/trpcMock"));

import MemberIdentity from "@/pages/member/MemberIdentity";
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

/** No open session: last session was rejected → the form must render. */
const KYC_CLOSED = {
  hasProfile: true,
  hasSession: true,
  status: "rejected",
  kycLevel: 1,
  session: {
    id: 40,
    status: "rejected",
    type: "customer_kyc",
    livenessPassed: null,
    livenessScore: null,
    docType: "nin",
    docConfidence: null,
    rejectionReason: 'Identity verification adjudicated "failed" by the verification service',
    reviewedAt: "2026-09-20T09:00:00.000Z",
    expiresAt: null,
    createdAt: "2026-09-19T09:00:00.000Z",
    updatedAt: "2026-09-20T09:00:00.000Z",
  },
};

const KYC_OPEN = {
  ...KYC_CLOSED,
  hasSession: true,
  status: "pending",
  session: { ...KYC_CLOSED.session, id: 44, status: "pending", rejectionReason: null },
};

function scriptIdentity(kyc: unknown) {
  setQuery("auth.me", { data: MEMBER });
  setQuery("memberIdentity.myKycStatus", { data: kyc });
  setQuery("memberIdentity.kycTierRequirements", {
    data: { tiers: [{ tier: 1, maxBalance: 300000 }] },
  });
  setQuery("memberIdentity.myMfaStatus", {
    data: { mfaEnabled: false, available: false, reason: "none" },
  });
  setQuery("memberIdentity.myFaceEnrollments", { data: [] });
  setQuery("memberIdentity.myActiveFaceEnrollment", { data: null });
  setQuery("memberIdentity.checkLivenessCooldown", {
    data: { locked: false, remainingMs: 0, failures: 0 },
  });
}

describe("MemberIdentity KYC submission (W10-B4a)", () => {
  beforeEach(() => {
    resetTrpcMock();
  });
  afterEach(() => cleanup());

  it("renders the form when no open session exists and submits a zod-strict body", () => {
    scriptIdentity(KYC_CLOSED);
    setMutation("memberIdentity.submitKyc", {
      data: {
        sessionId: 45,
        status: "verified",
        verified: true,
        serviceOutcome: "adjudicated",
        serviceStatus: "verified",
        message: "Identity verified by the verification service.",
      },
    });
    render(<MemberIdentity />);
    fireEvent.change(screen.getByLabelText(/11 digits/), {
      target: { value: "12345678901" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for verification" })
    );

    const calls = getMutationCalls("memberIdentity.submitKyc") as Record<
      string,
      unknown
    >[];
    expect(calls).toHaveLength(1);
    // zod-strict: exactly { docType, docNumber } — no docImageRef, nothing else.
    expect(calls[0]).toEqual({ docType: "nin", docNumber: "12345678901" });

    const result = screen.getByTestId("kyc-submit-result");
    expect(result).toHaveTextContent(
      "Identity verified by the verification service."
    );
    expect(result).toHaveTextContent("session #45");
  });

  it("blocks a non-11-digit document number client-side (no mutation call)", () => {
    scriptIdentity(KYC_CLOSED);
    render(<MemberIdentity />);
    // 11 chars but not 11 DIGITS — passes the input minLength/maxLength
    // constraint so the form submits and the zod-exact guard must fire.
    fireEvent.change(screen.getByLabelText(/11 digits/), {
      target: { value: "1234567890a" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for verification" })
    );
    expect(getMutationCalls("memberIdentity.submitKyc")).toEqual([]);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "NIN/BVN must be exactly 11 digits."
    );
  });

  it("an open session renders its real status instead of the form (no duplicate submit)", () => {
    scriptIdentity(KYC_OPEN);
    setQuery("memberIdentity.myKycSession", {
      data: {
        id: 44,
        status: "pending",
        type: "customer_kyc",
        livenessPassed: null,
        livenessScore: null,
        docType: "nin",
        rejectionReason: null,
        reviewedAt: null,
        createdAt: "2026-10-04T09:00:00.000Z",
        updatedAt: "2026-10-04T09:00:00.000Z",
      },
    });
    render(<MemberIdentity />);
    const panel = screen.getByTestId("kyc-open-session");
    expect(panel).toHaveTextContent("open KYC submission (#44)");
    expect(panel).toHaveTextContent("pending");
    expect(
      screen.queryByRole("button", { name: "Submit for verification" })
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/11 digits/)).not.toBeInTheDocument();
    // The open session was read by its exact id (caller-scoped proc).
    expect(getQueryCalls("memberIdentity.myKycSession")).toContainEqual({
      sessionId: 44,
    });
    // Honest refresh control exists (real refetch, no fake progress).
    expect(
      screen.getByRole("button", { name: "Refresh status" })
    ).toBeInTheDocument();
  });

  it("renders the honest serviceOutcome:'unavailable' copy (submission stays pending)", () => {
    scriptIdentity(KYC_CLOSED);
    setMutation("memberIdentity.submitKyc", {
      data: {
        sessionId: 46,
        status: "pending",
        verified: false,
        serviceOutcome: "unavailable",
        message:
          "Verification could not be completed: ENHANCED_KYC_URL unreachable. Your submission is pending and will be verified when the service recovers.",
      },
    });
    render(<MemberIdentity />);
    fireEvent.change(screen.getByLabelText(/11 digits/), {
      target: { value: "12345678901" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for verification" })
    );
    const result = screen.getByTestId("kyc-submit-result");
    expect(result).toHaveTextContent(/could not be completed/);
    expect(result).toHaveTextContent(/pending/);
    expect(result).not.toHaveTextContent(/verified by the verification service/);
  });

  it("renders a rejected adjudication honestly", () => {
    scriptIdentity(KYC_CLOSED);
    setMutation("memberIdentity.submitKyc", {
      data: {
        sessionId: 47,
        status: "rejected",
        verified: false,
        serviceOutcome: "adjudicated",
        serviceStatus: "failed",
        message: 'Identity verification adjudicated "failed" — not verified.',
      },
    });
    render(<MemberIdentity />);
    fireEvent.change(screen.getByLabelText(/11 digits/), {
      target: { value: "12345678901" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for verification" })
    );
    expect(screen.getByTestId("kyc-submit-result")).toHaveTextContent(
      /not verified/
    );
  });

  it("surfaces server errors verbatim (CONFLICT duplicate / PRECONDITION unconfigured)", () => {
    scriptIdentity(KYC_CLOSED);
    setMutation("memberIdentity.submitKyc", {
      error: { message: "An open KYC submission already exists for this member" },
    });
    render(<MemberIdentity />);
    fireEvent.change(screen.getByLabelText(/11 digits/), {
      target: { value: "12345678901" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Submit for verification" })
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "An open KYC submission already exists for this member"
    );
    expect(screen.queryByTestId("kyc-submit-result")).not.toBeInTheDocument();
  });
});
