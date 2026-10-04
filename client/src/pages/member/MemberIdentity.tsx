/**
 * MemberIdentity.tsx — /member/identity (W7-B9, 2026-10-05)
 *
 * DESIGN DECISION (2026-10-05, W7-B9): identity & security is its OWN page
 * (not folded into MemberProfile) — MemberProfile already carries the
 * account/KYC-summary read-only surface; this page adds the actionable
 * identity surface (face-enrollment revoke, phone OTP verify) and the
 * detailed KYC/MFA/cooldown state. Phone verification is a SECTION here
 * (not a separate page) — it is an identity-ownership proof, so it belongs
 * beside KYC and face enrollment; nav stays compact.
 *
 * Wired to REAL member-scoped backends only:
 *   - memberIdentity.myKycStatus            (server/routers/memberIdentity.ts:118)
 *   - memberIdentity.kycTierRequirements    (:192 — static CBN tier reference
 *     via the KYC enforcement gateway; fail-closed when the gateway is down)
 *   - memberIdentity.myMfaStatus            (:177 — honest unavailability)
 *   - memberIdentity.myFaceEnrollments      (:224 — caller's own rows)
 *   - memberIdentity.myActiveFaceEnrollment (:238)
 *   - memberIdentity.revokeMyFaceEnrollment (:271 — caller-scoped, NOT_FOUND
 *     on foreign ids)
 *   - memberIdentity.checkLivenessCooldown  (:325 — {locked, remainingMs,
 *     failures} from the real in-process cooldown store)
 *   - memberPhone.requestPhoneOtp           (server/routers/memberPhone.ts:93)
 *   - memberPhone.verifyPhoneOtp            (:107)
 *
 * HONEST ABSENCES (2026-10-05, W7-B9; updated 2026-10-04 W10-B4a):
 *   - KYC SUBMIT: NOW WIRED (W10-B3/B4a) to the real memberIdentity.submitKyc
 *     mutation — REAL NIN/BVN verification via the enhanced-kyc-kyb service,
 *     status transitions only on the service's adjudication, an open
 *     ("pending") session renders its real status (myKycSession) instead of
 *     a duplicate form, and a service outage renders the honest
 *     "unavailable / still pending" message verbatim.
 *   - LIVENESS/FACE ENROLLMENT UI: the member-safe server bridge now exists
 *     (W10-B3 startFaceEnrollment/submitFaceEnrollmentFrame) but the
 *     camera/liveness frame-capture UX is a SEPARATE batch — this page keeps
 *     the honest note and adds NO enroll button (no fake capture).
 *     kyc.startLiveness (server/routers/kyc.ts:311) is AGENT-scoped
 *     (requireAgent → `agent-<id>` keys); faceEnrollment.enroll/verify store
 *     self-attested embeddings ("fabricated identity", memberIdentity.ts:11-14,
 *     never wrapped); biometricAuth.fullVerification is IDOR-deferred
 *     (memberIdentity.ts:19-21). The Python liveness-detection services are
 *     not bridged to any member tRPC procedure. So this page renders an
 *     honest note, not an enroll button.
 *   - OTP timers: the OTP API returns {success, message} / {verified} only —
 *     no cooldown fields — so no client-side countdown is fabricated; the
 *     per-phone throttle lives server-side in phoneOwnership.
 *
 * Server error messages are surfaced verbatim; inputs are zod-exact.
 */
import { useState } from "react";

import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-NG") : "—";

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="text-sm">{value ?? "—"}</span>
    </div>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
    >
      {message}
    </p>
  );
}

interface KycStatusData {
  hasProfile: boolean;
  hasSession: boolean;
  status: string;
  session: { id: number; status: string } | null;
}

interface SubmitKycResult {
  sessionId: number;
  status: string;
  verified: boolean;
  serviceOutcome: "adjudicated" | "unavailable";
  serviceStatus?: string | null;
  message: string;
}

/**
 * KYC document submission (W10-B3 server / W10-B4a client, 2026-10-04):
 * memberIdentity.submitKyc — REAL NIN/BVN verification via the
 * enhanced-kyc-kyb service. An OPEN ("pending") session renders its real
 * status instead of a duplicate form (the server would reject a duplicate
 * with CONFLICT anyway); "Refresh" re-reads the truth (myKycSession +
 * myKycStatus) — no fake progress. The submit response message is the
 * server's verbatim wording, including the honest "service unavailable,
 * still pending" outcome.
 */
function KycSubmitSection({
  kyc,
  onChanged,
}: {
  kyc: KycStatusData;
  onChanged: () => void;
}) {
  const [docType, setDocType] = useState<"nin" | "bvn">("nin");
  const [docNumber, setDocNumber] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitKycResult | null>(null);

  const openSession =
    kyc.session && kyc.session.status === "pending" ? kyc.session : null;

  // Real per-session read for the open submission (caller-scoped, PII-safe).
  const sessionQuery = trpc.memberIdentity.myKycSession.useQuery(
    { sessionId: openSession?.id ?? 0 },
    { enabled: openSession !== null, retry: false }
  );

  const submitMutation = trpc.memberIdentity.submitKyc.useMutation({
    onSuccess: (data: SubmitKycResult) => {
      setSubmitError(null);
      setResult(data);
      setDocNumber("");
      onChanged();
    },
    onError: (err: { message: string }) => {
      setResult(null);
      setSubmitError(err.message);
    },
  });

  if (openSession) {
    const live = sessionQuery.data;
    return (
      <div
        className="text-sm border rounded-md p-3 space-y-2"
        data-testid="kyc-open-session"
      >
        <p>
          You have an open KYC submission (#{openSession.id}) — status:{" "}
          <Badge variant="secondary">
            {live?.status ?? openSession.status}
          </Badge>
          . A duplicate submission is not allowed while it is open.
        </p>
        {live?.rejectionReason ? (
          <p className="text-muted-foreground">{live.rejectionReason}</p>
        ) : null}
        {sessionQuery.isError ? (
          <p role="alert" className="text-destructive">
            {sessionQuery.error?.message}
          </p>
        ) : null}
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            sessionQuery.refetch();
            onChanged();
          }}
        >
          Refresh status
        </Button>
      </div>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitError(null);
    setResult(null);
    // zod-exact client guard: NIN/BVN exactly 11 digits (server enforces).
    if (!/^\d{11}$/.test(docNumber.trim())) {
      setFormError("NIN/BVN must be exactly 11 digits.");
      return;
    }
    // zod-strict payload: { docType, docNumber } only — no docImageRef
    // unless the member supplied one (no upload flow in this batch).
    submitMutation.mutate({ docType, docNumber: docNumber.trim() });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-4 max-w-lg">
      {formError ? <FormError message={formError} /> : null}
      {submitError ? <FormError message={submitError} /> : null}
      {result ? (
        <p
          role={result.verified ? "status" : "alert"}
          data-testid="kyc-submit-result"
          className={`text-sm border rounded-md p-3 ${
            result.verified
              ? ""
              : result.serviceOutcome === "unavailable"
                ? ""
                : "text-destructive border-destructive/40"
          }`}
        >
          {result.message} (session #{result.sessionId}, status:{" "}
          {result.status})
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="kyc-doc-type">Document type</Label>
          <Select
            value={docType}
            onValueChange={(v) => setDocType(v as "nin" | "bvn")}
          >
            <SelectTrigger id="kyc-doc-type">
              <SelectValue placeholder="Document type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="nin">NIN</SelectItem>
              <SelectItem value="bvn">BVN</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="kyc-doc-number">
            {docType === "nin" ? "NIN" : "BVN"} (11 digits)
          </Label>
          <Input
            id="kyc-doc-number"
            inputMode="numeric"
            value={docNumber}
            onChange={(e) => setDocNumber(e.target.value)}
            minLength={11}
            maxLength={11}
            placeholder="12345678901"
            required
          />
        </div>
      </div>
      <Button type="submit" disabled={submitMutation.isPending}>
        {submitMutation.isPending ? "Submitting…" : "Submit for verification"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Your document number is verified against the real identity service
        and stored encrypted; the result — verified, rejected, or still
        pending — is reported exactly as the service adjudicates it.
      </p>
    </form>
  );
}

/** KYC status + static CBN tier requirements (read-only). */
function KycSection() {
  const kycQuery = trpc.memberIdentity.myKycStatus.useQuery(undefined, {
    retry: false,
  });
  const tiersQuery = trpc.memberIdentity.kycTierRequirements.useQuery(
    undefined,
    { retry: false }
  );

  return (
    <div className="space-y-6">
      {kycQuery.isLoading ? (
        <MemberLoading label="Loading KYC status" />
      ) : kycQuery.isError ? (
        <MemberError message={kycQuery.error.message} />
      ) : !kycQuery.data?.hasProfile ? (
        <p className="text-sm text-muted-foreground py-6 text-center">
          No customer profile is linked to your account yet, so no KYC status
          is available.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Status"
            value={<Badge variant="secondary">{kycQuery.data.status}</Badge>}
          />
          <Field label="KYC level" value={kycQuery.data.kycLevel} />
          {kycQuery.data.session ? (
            <>
              <Field
                label="Session type"
                value={kycQuery.data.session.type ?? "—"}
              />
              <Field
                label="Liveness"
                value={
                  kycQuery.data.session.livenessPassed == null
                    ? "—"
                    : kycQuery.data.session.livenessPassed
                      ? "Passed"
                      : "Not passed"
                }
              />
              <Field
                label="Rejection reason"
                value={kycQuery.data.session.rejectionReason ?? "—"}
              />
              <Field
                label="Submitted"
                value={fmtDate(kycQuery.data.session.createdAt)}
              />
            </>
          ) : (
            <Field label="Session" value="No KYC session started" />
          )}
        </div>
      )}

      <div className="space-y-2">
        <h3 className="text-sm font-medium">CBN tier requirements</h3>
        {tiersQuery.isLoading ? (
          <MemberLoading label="Loading tier requirements" />
        ) : tiersQuery.isError ? (
          // Fail-closed backend (gateway down → INTERNAL_SERVER_ERROR);
          // surface verbatim, never fabricate tier copy.
          <MemberError message={tiersQuery.error.message} />
        ) : (
          <pre
            className="text-xs border rounded-md p-3 overflow-x-auto whitespace-pre-wrap"
            data-testid="tier-requirements"
          >
            {JSON.stringify(tiersQuery.data, null, 2)}
          </pre>
        )}
      </div>

      {/* 2026-10-04 (W10-B4a): the real submitKyc flow replaces the W7-B9
          disclosure — open sessions render their status; otherwise the
          submission form. Only shown when a customer profile exists. */}
      {kycQuery.data && kycQuery.data.hasProfile ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Submit identity document</h3>
          <KycSubmitSection
            kyc={kycQuery.data}
            onChanged={() => kycQuery.refetch()}
          />
        </div>
      ) : null}
    </div>
  );
}

/** MFA status — real DB flag + honest deployment capability statement. */
function MfaSection() {
  const mfaQuery = trpc.memberIdentity.myMfaStatus.useQuery(undefined, {
    retry: false,
  });

  if (mfaQuery.isLoading) return <MemberLoading label="Loading MFA status" />;
  if (mfaQuery.isError) return <MemberError message={mfaQuery.error.message} />;
  return (
    <div className="space-y-3">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="MFA enabled"
          value={mfaQuery.data?.mfaEnabled ? "Yes" : "No"}
        />
        <Field
          label="MFA enrollment"
          value={
            mfaQuery.data?.available
              ? "Available"
              : "Not available in this deployment"
          }
        />
      </div>
      {mfaQuery.data?.reason ? (
        <p className="text-xs text-muted-foreground">{mfaQuery.data.reason}</p>
      ) : null}
    </div>
  );
}

/** Face enrollments: list, active enrollment, caller-scoped revoke. */
function FaceEnrollmentSection() {
  const [confirmRevokeId, setConfirmRevokeId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [revokeError, setRevokeError] = useState<string | null>(null);

  const listQuery = trpc.memberIdentity.myFaceEnrollments.useQuery(undefined, {
    retry: false,
  });
  const activeQuery = trpc.memberIdentity.myActiveFaceEnrollment.useQuery(
    { enrollmentType: "kyc" },
    { retry: false }
  );
  const cooldownQuery = trpc.memberIdentity.checkLivenessCooldown.useQuery(
    undefined,
    { retry: false }
  );

  const revokeMutation =
    trpc.memberIdentity.revokeMyFaceEnrollment.useMutation({
      onSuccess: () => {
        setConfirmRevokeId(null);
        setReason("");
        setRevokeError(null);
        listQuery.refetch();
        activeQuery.refetch();
      },
      onError: (err: { message: string }) => setRevokeError(err.message),
    });

  const submitRevoke = (enrollmentId: number) => {
    setRevokeError(null);
    if (!reason.trim()) {
      setRevokeError("A reason is required to revoke an enrollment.");
      return;
    }
    // zod-exact: { enrollmentId: int>0, reason: 1..500 }
    revokeMutation.mutate({ enrollmentId, reason: reason.trim() });
  };

  const enrollments = listQuery.data ?? [];
  const cooldown = cooldownQuery.data;

  return (
    <div className="space-y-4">
      {cooldownQuery.isLoading ? (
        <MemberLoading label="Loading liveness cooldown" />
      ) : cooldownQuery.isError ? (
        <MemberError message={cooldownQuery.error.message} />
      ) : cooldown?.locked ? (
        <p
          role="status"
          className="text-sm border border-destructive/40 rounded-md p-3"
        >
          Liveness verification is temporarily locked after repeated failed
          attempts. Try again in approximately{" "}
          {Math.ceil((cooldown.remainingMs ?? 0) / 60000)} minute(s).
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          No liveness verification lockout is active on your account
          {cooldown?.failures
            ? ` (${cooldown.failures} recent failed attempt(s) recorded).`
            : "."}
        </p>
      )}

      <div className="space-y-1">
        <h3 className="text-sm font-medium">Active enrollment (KYC)</h3>
        {activeQuery.isLoading ? (
          <MemberLoading label="Loading active enrollment" />
        ) : activeQuery.isError ? (
          <MemberError message={activeQuery.error.message} />
        ) : !activeQuery.data ? (
          <p className="text-sm text-muted-foreground">
            No active KYC face enrollment.
          </p>
        ) : (
          <p className="text-sm">
            Enrollment #{activeQuery.data.id} · quality{" "}
            {activeQuery.data.qualityScore ?? "—"} · enrolled{" "}
            {fmtDate(activeQuery.data.createdAt)} · basis:{" "}
            {activeQuery.data.verificationBasis}
          </p>
        )}
      </div>

      {listQuery.isLoading ? (
        <MemberLoading label="Loading face enrollments" />
      ) : listQuery.isError ? (
        <MemberError message={listQuery.error.message} />
      ) : enrollments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          You have no face enrollments.
        </p>
      ) : (
        <ul className="space-y-2">
          {enrollments.map((e) => (
            <li
              key={e.id}
              className="border rounded-md p-3 text-sm space-y-2"
              data-testid={`face-enrollment-${e.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  Enrollment #{e.id} · {e.enrollmentType}
                </span>
                <Badge variant={e.isActive ? "default" : "secondary"}>
                  {e.isActive ? "active" : "revoked"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Enrolled {fmtDate(e.createdAt)} · expires {fmtDate(e.expiresAt)}{" "}
                · basis: {e.verificationBasis}
                {e.revokedAt ? ` · revoked ${fmtDate(e.revokedAt)}` : ""}
              </p>
              {e.isActive ? (
                confirmRevokeId === e.id ? (
                  <div className="space-y-2">
                    {revokeError && <FormError message={revokeError} />}
                    <div className="space-y-1">
                      <Label htmlFor={`revoke-reason-${e.id}`}>
                        Reason for revocation
                      </Label>
                      <Input
                        id={`revoke-reason-${e.id}`}
                        value={reason}
                        onChange={(ev) => setReason(ev.target.value)}
                        maxLength={500}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={revokeMutation.isPending}
                        onClick={() => submitRevoke(e.id)}
                      >
                        Confirm revoke
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setConfirmRevokeId(null);
                          setReason("");
                          setRevokeError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmRevokeId(e.id);
                      setReason("");
                      setRevokeError(null);
                    }}
                  >
                    Revoke
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {/* 2026-10-04 (W10-B4a): honest absence — the member-safe liveness
          bridge exists server-side (W10-B3) but the camera/liveness
          frame-capture UX ships via the mobile app in a separate batch.
          Note, not a button — no fake enrollment flow. */}
      <p className="text-sm text-muted-foreground border rounded-md p-3">
        New face enrollment is not offered in this portal: the secure
        liveness capture flow is coming via the mobile app — self-declared
        scores are not accepted as identity proof. Contact support if you
        need to re-enroll.
      </p>
    </div>
  );
}

/** Phone ownership verification: requestPhoneOtp → verifyPhoneOtp. */
function PhoneVerificationSection() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"request" | "verify" | "verified">(
    "request"
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const requestMutation = trpc.memberPhone.requestPhoneOtp.useMutation({
    onSuccess: (data: { message?: string } | undefined) => {
      setFormError(null);
      setStatusMessage(data?.message ?? "Verification code sent by SMS");
      setStage("verify");
    },
    onError: (err: { message: string }) => {
      setStatusMessage(null);
      setFormError(err.message);
    },
  });

  const verifyMutation = trpc.memberPhone.verifyPhoneOtp.useMutation({
    onSuccess: (data: { verified?: boolean } | undefined) => {
      if (data?.verified) {
        setFormError(null);
        setStatusMessage(null);
        setStage("verified");
      } else {
        // Honest {verified:false} payload — surfaced as-is.
        setFormError("The code did not match. Check the SMS and try again.");
      }
    },
    onError: (err: { message: string }) => setFormError(err.message),
  });

  const submitRequest = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setStatusMessage(null);
    const trimmed = phone.trim();
    // zod-exact client guard: phone 10..15 chars (server enforces).
    if (trimmed.length < 10 || trimmed.length > 15) {
      setFormError("Phone number must be 10–15 digits.");
      return;
    }
    requestMutation.mutate({ phone: trimmed });
  };

  const submitVerify = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    // zod-exact: otp exactly 6 chars.
    if (otp.trim().length !== 6) {
      setFormError("Enter the 6-digit code from the SMS.");
      return;
    }
    verifyMutation.mutate({ phone: phone.trim(), otp: otp.trim() });
  };

  return (
    <div className="space-y-4 max-w-lg">
      {formError && <FormError message={formError} />}
      {statusMessage && (
        <p role="status" className="text-sm border rounded-md p-3">
          {statusMessage}
        </p>
      )}
      {stage === "verified" ? (
        <p role="status" className="text-sm border rounded-md p-3">
          Your phone number was verified successfully.
        </p>
      ) : stage === "request" ? (
        <form onSubmit={submitRequest} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone-number">Phone number</Label>
            <Input
              id="phone-number"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="e.g. 08031234567"
              minLength={10}
              maxLength={15}
              required
            />
          </div>
          {/* No client-side resend countdown: the API returns no cooldown
              fields — throttling is enforced server-side (2026-10-05, W7-B9). */}
          <Button type="submit" disabled={requestMutation.isPending}>
            {requestMutation.isPending ? "Sending…" : "Send verification code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={submitVerify} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="phone-otp">6-digit code</Label>
            <Input
              id="phone-otp"
              value={otp}
              onChange={(e) => setOtp(e.target.value)}
              minLength={6}
              maxLength={6}
              required
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={verifyMutation.isPending}>
              {verifyMutation.isPending ? "Verifying…" : "Verify code"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setStage("request");
                setOtp("");
                setFormError(null);
                setStatusMessage(null);
              }}
            >
              Use a different number
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function MemberIdentity() {
  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Identity Verification (KYC)"
          description="Your verification status and the CBN tier requirements."
        >
          <KycSection />
        </MemberSection>

        <MemberSection
          title="Face Enrollment & Liveness"
          description="Your enrolled face credentials and liveness lockout state."
        >
          <FaceEnrollmentSection />
        </MemberSection>

        <MemberSection
          title="Phone Verification"
          description="Prove ownership of your phone number with an SMS code."
        >
          <PhoneVerificationSection />
        </MemberSection>

        <MemberSection
          title="Multi-Factor Authentication"
          description="Second-factor status for your account."
        >
          <MfaSection />
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
