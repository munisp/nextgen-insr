/**
 * MemberProfile.tsx — /member/profile
 *
 * Wired to REAL member-scoped data:
 *   - auth.me                    (session user, via useAuth)
 *   - memberIdentity.myKycStatus (server/routers/memberIdentity.ts — honest
 *     empty state when the session has no customer profile)
 *   - memberIdentity.myMfaStatus (real DB flag; reports MFA unavailability
 *     honestly)
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
      </div>
    </MemberLayout>
  );
}
