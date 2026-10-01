/**
 * MyReferrals.tsx — R3 batch 1 (2026-10-01, R3)
 * Member view of their real referral code + referral list.
 * BINDING: REAL — memberReferrals.myReferrals / myCode (member-scoped; the
 * agent `referrals` program and the IDOR-exposed `referralProgramDedicated`
 * list/generateLink are deliberately NOT used) + referralProgramDedicated
 * .tiers (static read-only reward config).
 * The referral code shown is ALWAYS a real persisted code read server-side
 * (memberReferrals.myCode). 2026-10-01 (R3-fix): myCode is read-only —
 * member-context minting was removed (referrals.referrer_agent_id FKs to
 * agents.id) — so members without an agent-side code see the disclosed
 * "not available" state; no code is ever fabricated here.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gift, Users, Copy } from "lucide-react";
import { useState } from "react";
import { referralsApi } from "@/services/loyaltyApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function statusTone(status: string): string {
  switch (status) {
    case "rewarded":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "activated":
      return "bg-sky-50 text-sky-700 ring-sky-600/20";
    case "pending":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

export default function MyReferrals() {
  const [copied, setCopied] = useState(false);

  const referrals = useQuery({
    queryKey: ["r3", "referrals", "list"],
    queryFn: () => referralsApi.myReferrals({ limit: 50 }),
    retry: 1,
  });
  const tiers = useQuery({
    queryKey: ["r3", "referrals", "tiers"],
    queryFn: () => referralsApi.tiers(),
    retry: 1,
  });
  // 2026-10-01 (R3-fix): myCode is now a read-only query — the server no
  // longer mints member codes. Fetched on demand ("Reveal my code"), not on
  // page load; null → disclosed unavailable state.
  const code = useQuery({
    queryKey: ["r3", "referrals", "code"],
    queryFn: () => referralsApi.myCode(),
    enabled: false,
    retry: 1,
  });

  const revealedCode = code.data ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          My Referrals
        </h1>
        <p className="text-sm text-stone-500">
          Invite friends and family. When they join with your code and stay
          active, you earn the rewards below.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Gift className="h-5 w-5 text-amber-600" aria-hidden />
            Your referral code
          </CardTitle>
        </CardHeader>
        <CardContent>
          {code.isFetching ? (
            <LoadingState label="Getting your referral code…" />
          ) : code.isError ? (
            <ErrorState
              message="We couldn’t get your referral code. Please try again."
              onRetry={() => void code.refetch()}
            />
          ) : !code.isFetched ? (
            <div className="space-y-3">
              <p className="text-sm text-stone-600">
                If you have a referral code on your account it is shown here,
                with its expiry date.
              </p>
              <Button onClick={() => void code.refetch()}>Reveal my code</Button>
            </div>
          ) : (
            // 2026-10-01 (R3-fix): myCode resolves to null when the backend
            // is unavailable (unavailableAsNull) OR no valid code exists for
            // the caller — disclose, never fabricate a code.
            <UnavailableStateGuard result={revealedCode}>
              {(c) => (
                <div className="flex flex-wrap items-center gap-3">
                  <code className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-2 text-lg font-bold tracking-widest text-stone-900">
                    {c.referralCode}
                  </code>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      void navigator.clipboard?.writeText(c.referralCode);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                  >
                    <Copy className="mr-1 h-4 w-4" aria-hidden />
                    {copied ? "Copied" : "Copy"}
                  </Button>
                  {c.expiresAt && (
                    <p className="text-xs text-stone-500">
                      Valid until{" "}
                      {new Date(c.expiresAt).toLocaleDateString()}
                    </p>
                  )}
                </div>
              )}
            </UnavailableStateGuard>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Users className="h-5 w-5 text-amber-600" aria-hidden />
            Your referrals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {referrals.isLoading ? (
            <LoadingState label="Loading your referrals…" />
          ) : referrals.isError ? (
            <ErrorState
              message="We couldn’t load your referrals. Please try again."
              onRetry={() => referrals.refetch()}
            />
          ) : referrals.data === null ? (
            <UnavailableState feature="Referral tracking" />
          ) : referrals.data.referrals.length === 0 ? (
            <EmptyState
              title="No referrals yet"
              hint="Share your code — people who join with it will appear here with their status."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {referrals.data.referrals.map(r => (
                <li
                  key={r.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      Code {r.referralCode}
                    </p>
                    <p className="text-xs text-stone-500">
                      Started {new Date(r.createdAt).toLocaleDateString()}
                      {r.rewardedAt
                        ? ` · rewarded ${new Date(r.rewardedAt).toLocaleDateString()}`
                        : ""}
                      {" · bonus "}
                      {r.bonusPoints.toLocaleString()} pts + ₦
                      {Number(r.bonusCash).toLocaleString()}
                    </p>
                  </div>
                  <Badge className={`ring-1 ring-inset ${statusTone(r.status)}`}>
                    {r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="text-lg text-stone-800">Reward tiers</CardTitle>
        </CardHeader>
        <CardContent>
          {tiers.isLoading ? (
            <LoadingState label="Loading reward tiers…" />
          ) : tiers.isError ? (
            <ErrorState
              message="We couldn’t load the reward tiers. Please try again."
              onRetry={() => tiers.refetch()}
            />
          ) : tiers.data === null ? (
            <UnavailableState feature="Referral reward tiers" />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {tiers.data.tiers.map((t, i) => (
                <li
                  key={i}
                  className="rounded-xl border border-stone-200 bg-white p-4"
                >
                  <p className="font-semibold text-stone-900">
                    {t.min}–{t.max === Infinity ? "∞" : t.max} referrals / month
                  </p>
                  <p className="mt-1 text-sm text-stone-600">
                    ₦{t.perReferral.toLocaleString()} per referral
                    {t.revShare > 0
                      ? ` + ${(t.revShare * 100).toFixed(0)}% revenue share (${t.revShareMonths} mo)`
                      : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Renders children when the code is real; discloses unavailability on null. */
function UnavailableStateGuard({
  result,
  children,
}: {
  result: import("@/services/loyaltyApi").ReferralCodeResult | null;
  children: (c: import("@/services/loyaltyApi").ReferralCodeResult) => JSX.Element;
}) {
  if (result === null) return <UnavailableState feature="Referral codes" />;
  return <>{children(result)}</>;
}
