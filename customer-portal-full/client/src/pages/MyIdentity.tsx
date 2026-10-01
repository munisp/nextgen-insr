/**
 * MyIdentity.tsx — R3 batch 4 (2026-10-01, R3-b4)
 * Member view of the caller's own identity/KYC state on the monolith
 * (route /my-identity). BINDING: REAL — identityApi → memberIdentity router
 * (server/routers/memberIdentity.ts, protectedProcedure, caller-scoped).
 *
 * IDENTITY DOMAIN — extra-strict rules (r4/worklist-b4.md):
 *  - NO enroll/verify/document-upload UI anywhere on this page. Where no
 *    real member flow exists, a DISCLOSED "enrollment via agent/branch"
 *    notice is rendered instead — never a fake enrollment form.
 *  - Face enrollments are labelled "self-enrolled — not provider-verified"
 *    verbatim; revoke is the only mutation and requires a reason.
 *  - MFA shows the server's unavailable reason verbatim — no "Enable MFA"
 *    button (no MFA capability exists on this deployment).
 *  - NOT_FOUND/FORBIDDEN → null remains only as a defensive fallback for
 *    older deployments; empty/error states are disclosed. No data is ever
 *    fabricated.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ShieldCheck,
  Fingerprint,
  KeyRound,
  ListChecks,
  MapPin,
} from "lucide-react";
import { identityApi } from "@/services/identityApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function kycStatusTone(status: string): string {
  switch (status) {
    case "completed":
    case "liveness_passed":
    case "document_passed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "pending":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "rejected":
    case "liveness_failed":
    case "document_failed":
      return "bg-red-50 text-red-700 ring-red-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}

/** Disclosed notice shown wherever no real member self-service flow exists.
 * NEVER a fake enrollment form. */
function AgentBranchNotice({ action }: { action: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <p>
        {action} is not available in this app yet. Please visit an authorized
        agent or branch to complete it in person — your identity is verified
        by a real provider check there, never by self-declaration.
      </p>
    </div>
  );
}

function KycStatusCard() {
  const query = useQuery({
    queryKey: ["memberIdentity", "myKycStatus"],
    queryFn: () => identityApi.getMyKycStatus(),
    retry: 1,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="h-5 w-5 text-stone-500" aria-hidden />
          Identity verification (KYC)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading && <LoadingState label="Loading KYC status…" />}
        {query.isError && (
          <ErrorState
            message="We couldn’t load your identity status. Please try again."
            onRetry={() => query.refetch()}
          />
        )}
        {query.data === null && (
          <UnavailableState feature="Identity verification" />
        )}
        {query.data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge
                variant="outline"
                className={`capitalize ring-1 ${kycStatusTone(query.data.status)}`}
              >
                {query.data.status.replace(/_/g, " ")}
              </Badge>
              <span className="text-sm text-stone-600">
                Tier level: {query.data.kycLevel}
              </span>
            </div>
            {query.data.session ? (
              <dl className="grid grid-cols-1 gap-2 text-sm text-stone-700 sm:grid-cols-2">
                <div>
                  <dt className="text-stone-500">Last update</dt>
                  <dd>{formatDate(query.data.session.updatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">Liveness check</dt>
                  <dd>
                    {query.data.session.livenessPassed === null
                      ? "—"
                      : query.data.session.livenessPassed
                        ? "Passed"
                        : "Failed"}
                  </dd>
                </div>
                {query.data.session.rejectionReason && (
                  <div className="sm:col-span-2">
                    <dt className="text-stone-500">Rejection reason</dt>
                    <dd className="text-red-700">
                      {query.data.session.rejectionReason}
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="text-sm text-stone-600">
                {query.data.hasProfile
                  ? "No identity verification session has been started for your profile yet."
                  : "No customer profile is linked to this sign-in yet."}
              </p>
            )}
            {/* No real member enroll flow exists in this batch — disclosed
                notice, never a fake start-verification button. */}
            <AgentBranchNotice action="Starting or redoing identity verification" />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TierRequirementsCard() {
  const query = useQuery({
    queryKey: ["memberIdentity", "kycTierRequirements"],
    queryFn: () => identityApi.getKycTierRequirements(),
    retry: 1,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ListChecks className="h-5 w-5 text-stone-500" aria-hidden />
          What each CBN tier requires
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isLoading && <LoadingState label="Loading tier requirements…" />}
        {query.isError && (
          <EmptyState
            title="Tier requirements are temporarily unavailable"
            hint="The verification gateway could not be reached. Nothing here is estimated — please check back later."
          />
        )}
        {query.data === null && !query.isLoading && !query.isError && (
          <UnavailableState feature="Tier requirements" />
        )}
        {query.data != null && (
          <pre className="max-h-80 overflow-auto rounded-lg bg-stone-50 p-4 text-xs text-stone-700">
            {JSON.stringify(query.data, null, 2)}
          </pre>
        )}
      </CardContent>
    </Card>
  );
}

function MfaCard() {
  const query = useQuery({
    queryKey: ["memberIdentity", "myMfaStatus"],
    queryFn: () => identityApi.getMyMfaStatus(),
    retry: 1,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="h-5 w-5 text-stone-500" aria-hidden />
          Multi-factor authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {query.isLoading && <LoadingState label="Loading MFA status…" />}
        {query.isError && (
          <ErrorState
            message="We couldn’t load your MFA status. Please try again."
            onRetry={() => query.refetch()}
          />
        )}
        {query.data === null && <UnavailableState feature="MFA status" />}
        {query.data && (
          <>
            <p className="text-sm text-stone-700">
              Second factor on file:{" "}
              <span className="font-medium">
                {query.data.mfaEnabled ? "Yes" : "No"}
              </span>
            </p>
            {/* Honest reason verbatim from the server. NO "Enable MFA"
                button — no MFA capability exists on this deployment. */}
            {!query.data.available && (
              <p className="rounded-lg bg-stone-50 p-3 text-xs leading-relaxed text-stone-600">
                {query.data.reason}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FaceEnrollmentsCard() {
  const queryClient = useQueryClient();
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["memberIdentity", "myFaceEnrollments"],
    queryFn: () => identityApi.getMyFaceEnrollments(),
    retry: 1,
  });
  const revoke = useMutation({
    mutationFn: identityApi.revokeMyFaceEnrollment,
    onSuccess: () => {
      setRevokeError(null);
      queryClient.invalidateQueries({ queryKey: ["memberIdentity"] });
    },
    onError: error => {
      setRevokeError(
        error instanceof Error
          ? error.message
          : "Revocation failed. Please try again."
      );
    },
  });

  const onRevoke = (id: number) => {
    const reason = window.prompt(
      "Why are you revoking this face enrollment? (required)"
    );
    if (!reason || !reason.trim()) return;
    revoke.mutate({ enrollmentId: id, reason: reason.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Fingerprint className="h-5 w-5 text-stone-500" aria-hidden />
          Face enrollments
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.isLoading && <LoadingState label="Loading face enrollments…" />}
        {query.isError && (
          <ErrorState
            message="We couldn’t load your face enrollments. Please try again."
            onRetry={() => query.refetch()}
          />
        )}
        {query.data === null && (
          <UnavailableState feature="Face enrollments" />
        )}
        {query.data && query.data.length === 0 && (
          <EmptyState
            title="No face enrollments on your profile"
            hint="Face enrollment is completed in person with an authorized agent or at a branch."
          />
        )}
        {query.data && query.data.length > 0 && (
          <ul className="space-y-3">
            {query.data.map(row => (
              <li
                key={row.id}
                className="rounded-xl border border-stone-200 p-4 text-sm text-stone-700"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {row.enrollmentType}
                    </Badge>
                    {/* Mandatory label: these credentials are self-enrolled,
                        not provider-verified. */}
                    <span className="text-xs italic text-stone-500">
                      self-enrolled — not provider-verified
                    </span>
                  </div>
                  {row.isActive ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={revoke.isPending}
                      onClick={() => onRevoke(row.id)}
                    >
                      Revoke
                    </Button>
                  ) : (
                    <Badge variant="outline" className="text-stone-500">
                      Revoked {formatDate(row.revokedAt)}
                    </Badge>
                  )}
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-stone-500 sm:grid-cols-3">
                  <div>
                    <dt>Enrolled</dt>
                    <dd className="text-stone-700">
                      {formatDate(row.createdAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Expires</dt>
                    <dd className="text-stone-700">
                      {formatDate(row.expiresAt)}
                    </dd>
                  </div>
                  <div>
                    <dt>Model</dt>
                    <dd className="text-stone-700">{row.embeddingVersion}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        )}
        {revokeError && <ErrorState message={revokeError} />}
        {/* No enroll UI — disclosed notice only. */}
        <AgentBranchNotice action="Enrolling or re-enrolling your face" />
      </CardContent>
    </Card>
  );
}

export default function MyIdentity() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
      <header>
        <h1 className="text-xl font-semibold text-stone-800">My Identity</h1>
        <p className="mt-1 text-sm text-stone-500">
          Your live verification state on the platform — read directly from
          the identity service. Nothing on this page is estimated or
          self-declared by this app.
        </p>
      </header>
      <KycStatusCard />
      <TierRequirementsCard />
      <MfaCard />
      <FaceEnrollmentsCard />
    </div>
  );
}
