/**
 * MemberRenewals.tsx — /member/renewals (W7-B5, 2026-10-02)
 *
 * Wired to the REAL member renewals router (server/routers/memberRenewals.ts):
 *   - memberRenewals.myRenewals     (caller-scoped list + real count)
 *   - memberRenewals.requestRenewal (mutation; ownership-guarded server-side)
 * Policy picker source: memberPolicies.myPolicies (the caller's own
 * policies). The server enforces ownership, the active/bound status gate and
 * the one-open-renewal duplicate guard — its errors are surfaced verbatim.
 *
 * Optional ?policy=<id> preselects the picker (linked from
 * MemberPolicyDetail). Honest states only: no fabricated rows.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmtNgn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    n
  );

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-NG") : "—";

/** Preselected policy id from ?policy=<positive int>, else null. */
function preselectedPolicyId(): number | null {
  const raw = new URLSearchParams(window.location.search).get("policy");
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default function MemberRenewals() {
  const utils = trpc.useUtils();
  const [policyId, setPolicyId] = useState<string>(
    preselectedPolicyId()?.toString() ?? ""
  );
  const [isAutoRenewal, setIsAutoRenewal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const renewalsQuery = trpc.memberRenewals.myRenewals.useQuery(undefined, {
    retry: false,
  });
  const pickerQuery = trpc.memberPolicies.myPolicies.useQuery(undefined, {
    retry: false,
  });

  const requestMutation = trpc.memberRenewals.requestRenewal.useMutation({
    onSuccess: () => {
      setFormError(null);
      setPolicyId("");
      setIsAutoRenewal(false);
      toast.success("Renewal requested");
      utils.memberRenewals.myRenewals.invalidate();
    },
    onError: (err) => {
      setFormError(err.message);
      toast.error(err.message);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const pid = Number(policyId);
    if (!Number.isInteger(pid) || pid <= 0) {
      setFormError("Select the policy to renew.");
      return;
    }
    // Input shape = server zod schema exactly
    // (memberRenewals.requestRenewal: { policyId, isAutoRenewal? }).
    requestMutation.mutate({ policyId: pid, isAutoRenewal });
  };

  const renewals = renewalsQuery.data?.renewals ?? [];
  const myPolicies = pickerQuery.data?.policies ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="My Renewals"
          description="Renewal requests for policies on your account."
        >
          {renewalsQuery.isLoading ? (
            <MemberLoading label="Loading your renewals" />
          ) : renewalsQuery.isError ? (
            <MemberError message={renewalsQuery.error.message} />
          ) : renewals.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have no renewals yet.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Renewal premium</TableHead>
                    <TableHead>Auto-renew</TableHead>
                    <TableHead>Completed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {renewals.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">
                        {r.policyNumber}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{r.status}</Badge>
                      </TableCell>
                      <TableCell>{fmtDate(r.renewalDueDate)}</TableCell>
                      <TableCell>
                        {fmtNgn(Number(r.renewalPremium ?? 0))}
                      </TableCell>
                      <TableCell>{r.isAutoRenewal ? "Yes" : "No"}</TableCell>
                      <TableCell>{fmtDate(r.completedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-sm text-muted-foreground pt-4">
                {renewalsQuery.data?.count ?? renewals.length} renewal
                {renewalsQuery.data?.count === 1 ? "" : "s"} on your account.
              </p>
            </>
          )}
        </MemberSection>

        <MemberSection
          title="Request a Renewal"
          description="Request renewal of one of your active policies."
        >
          <form onSubmit={submit} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="renewal-policy">Policy</Label>
              {pickerQuery.isLoading ? (
                <MemberLoading label="Loading your policies" />
              ) : pickerQuery.isError ? (
                <MemberError message={pickerQuery.error.message} />
              ) : (
                <select
                  id="renewal-policy"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={policyId}
                  onChange={(e) => setPolicyId(e.target.value)}
                >
                  <option value="">Select a policy…</option>
                  {myPolicies.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.policyNumber} — {p.productName ?? "policy"} (
                      {p.status})
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="auto-renewal"
                checked={isAutoRenewal}
                onCheckedChange={(v) => setIsAutoRenewal(v === true)}
              />
              <Label htmlFor="auto-renewal">Renew automatically</Label>
            </div>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <Button type="submit" disabled={requestMutation.isPending}>
              {requestMutation.isPending ? "Requesting…" : "Request renewal"}
            </Button>
          </form>
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
