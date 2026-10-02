/**
 * MemberReferrals.tsx — /member/referrals (W7-B7, 2026-10-03)
 *
 * Wired to the REAL member referrals router (server/routers/memberReferrals.ts):
 *   - memberReferrals.myCode      (READ-ONLY — returns the caller's existing
 *     still-valid pending code, or null. Member-context code minting was
 *     removed server-side (2026-10-01 R3-fix): a member id mis-attributed
 *     into the agent referral program, so null is an honest "unavailable".)
 *   - memberReferrals.myReferrals (caller's referrals as referrer, paginated)
 *
 * Identity is always resolved server-side from the session; no referrerId /
 * customerId is ever accepted from input. There is NO create mutation — the
 * null-code state is disclosed honestly rather than fabricated.
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmt = (n: number | string | null | undefined, currency = "NGN") =>
  n == null
    ? "—"
    : new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(
        Number(n)
      );

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-NG") : "—";

export default function MemberReferrals() {
  const codeQuery = trpc.memberReferrals.myCode.useQuery(undefined, {
    retry: false,
  });
  const referralsQuery = trpc.memberReferrals.myReferrals.useQuery(
    { limit: 50, offset: 0 },
    { retry: false }
  );

  const [copyState, setCopyState] = useState<string | null>(null);
  const code = codeQuery.data; // { referralCode, expiresAt, existing } | null
  const referrals = referralsQuery.data?.referrals ?? [];

  const copyCode = async () => {
    if (!code?.referralCode) return;
    try {
      await navigator.clipboard.writeText(code.referralCode);
      setCopyState("Copied to clipboard.");
    } catch {
      setCopyState("Copy failed — select and copy the code manually.");
    }
  };

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Your Referral Code"
          description="Share your code with friends and family."
        >
          {codeQuery.isLoading ? (
            <MemberLoading label="Loading your referral code" />
          ) : codeQuery.isError ? (
            <MemberError message={codeQuery.error.message} />
          ) : !code ? (
            // Honest unavailable state (2026-10-03, W7-B7): the server
            // returns null when no valid member code exists; nothing is
            // minted client-side.
            <p className="text-sm text-muted-foreground py-4">
              A referral code is not available for your account yet. Referral
              codes are issued as part of the referral program — contact
              support if you believe you should have one.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <code
                className="text-lg font-mono font-bold border rounded-md px-3 py-2"
                data-testid="referral-code"
              >
                {code.referralCode}
              </code>
              <Button variant="outline" size="sm" onClick={copyCode}>
                Copy code
              </Button>
              {code.expiresAt ? (
                <span className="text-xs text-muted-foreground">
                  Valid until {fmtDate(code.expiresAt)}
                </span>
              ) : null}
              {copyState ? (
                <span role="status" className="text-xs text-muted-foreground">
                  {copyState}
                </span>
              ) : null}
            </div>
          )}
        </MemberSection>

        <MemberSection
          title="Your Referrals"
          description="People you have referred, newest first."
        >
          {referralsQuery.isLoading ? (
            <MemberLoading label="Loading your referrals" />
          ) : referralsQuery.isError ? (
            <MemberError message={referralsQuery.error.message} />
          ) : referrals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have not referred anyone yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Code</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Bonus points</TableHead>
                  <TableHead>Bonus cash</TableHead>
                  <TableHead>Activated</TableHead>
                  <TableHead>Expires</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {referrals.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">
                      {r.referralCode ?? "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === "rewarded"
                            ? "default"
                            : r.status === "expired"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {r.status ?? "—"}
                      </Badge>
                    </TableCell>
                    <TableCell>{r.bonusPoints ?? "—"}</TableCell>
                    <TableCell>{fmt(r.bonusCash)}</TableCell>
                    <TableCell>{fmtDate(r.activatedAt)}</TableCell>
                    <TableCell>{fmtDate(r.expiresAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
