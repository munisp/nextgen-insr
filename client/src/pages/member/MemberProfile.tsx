/**
 * MemberProfile.tsx — /member/profile
 *
 * Wired to REAL member-scoped data:
 *   - auth.me                    (session user, via useAuth)
 *   - memberIdentity.myKycStatus (server/routers/memberIdentity.ts — honest
 *     empty state when the session has no customer profile)
 *   - memberIdentity.myMfaStatus (real DB flag; reports MFA unavailability
 *     honestly)
 *   - memberOnboarding.myProgress (server/routers/memberOnboarding.ts —
 *     READ-ONLY checklist as returned; no completion action exists — legacy
 *     complete endpoint 501s and was not ported; 2026-10-05, W7-B9)
 *
 * Honest states only: loading skeletons, empty state, error card.
 */
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

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

export default function MemberProfile() {
  const { user, logout } = useAuth();

  const kycQuery = trpc.memberIdentity.myKycStatus.useQuery(undefined, {
    retry: false,
  });
  const mfaQuery = trpc.memberIdentity.myMfaStatus.useQuery(undefined, {
    retry: false,
  });
  // 2026-10-05 (W7-B9): onboarding pipeline checklist — read-only, rendered
  // exactly as memberOnboarding.myProgress returns it.
  const onboardingQuery = trpc.memberOnboarding.myProgress.useQuery(
    undefined,
    { retry: false }
  );

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection title="Account" description="Your signed-in identity.">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" value={user?.name} />
            <Field label="Email" value={user?.email} />
            <Field label="Role" value={user?.role} />
          </div>
          <div className="pt-4">
            <Button variant="outline" size="sm" onClick={() => logout()}>
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </Button>
          </div>
        </MemberSection>

        <MemberSection
          title="Identity Verification (KYC)"
          description="Verification status recorded for your customer profile."
        >
          {kycQuery.isLoading ? (
            <MemberLoading label="Loading KYC status" />
          ) : kycQuery.isError ? (
            <MemberError message={kycQuery.error.message} />
          ) : !kycQuery.data?.hasProfile ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No customer profile is linked to your account yet, so no KYC
              status is available.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Status"
                value={
                  <Badge variant="secondary">{kycQuery.data.status}</Badge>
                }
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
                    label="Submitted"
                    value={
                      kycQuery.data.session.createdAt
                        ? new Date(
                            kycQuery.data.session.createdAt
                          ).toLocaleDateString("en-NG")
                        : "—"
                    }
                  />
                </>
              ) : (
                <Field label="Session" value="No KYC session started" />
              )}
            </div>
          )}
        </MemberSection>

        <MemberSection
          title="Security"
          description="Multi-factor authentication status."
        >
          {mfaQuery.isLoading ? (
            <MemberLoading label="Loading security status" />
          ) : mfaQuery.isError ? (
            <MemberError message={mfaQuery.error.message} />
          ) : (
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
          )}
        </MemberSection>

        <MemberSection
          title="Onboarding Progress"
          description="Where you are in the onboarding pipeline."
        >
          {onboardingQuery.isLoading ? (
            <MemberLoading label="Loading onboarding progress" />
          ) : onboardingQuery.isError ? (
            <MemberError message={onboardingQuery.error.message} />
          ) : !onboardingQuery.data ? null : (
            (() => {
              const prog = onboardingQuery.data;
              if (!prog) return null;
              return (
            <div className="space-y-3">
              <p className="text-sm">
                Stage {prog.stageIndex + 1} of{" "}
                {prog.totalStages} ·{" "}
                {prog.completionPercent}% complete
              </p>
              <ol className="space-y-1" data-testid="onboarding-checklist">
                {prog.stages.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 text-sm"
                    data-testid={`onboarding-stage-${s.name}`}
                  >
                    <Badge
                      variant={
                        s.order - 1 < prog.stageIndex
                          ? "default"
                          : s.order - 1 === prog.stageIndex
                            ? "secondary"
                            : "outline"
                      }
                    >
                      {s.order - 1 < prog.stageIndex
                        ? "done"
                        : s.order - 1 === prog.stageIndex
                          ? "current"
                          : "pending"}
                    </Badge>
                    <span>{s.name.replace(/_/g, " ")}</span>
                    {s.estimatedMinutes > 0 ? (
                      <span className="text-xs text-muted-foreground">
                        ~{s.estimatedMinutes} min
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
              );
            })()
          )}
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
