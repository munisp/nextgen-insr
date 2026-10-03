/**
 * MemberParametric.tsx — /member/parametric (W7-B10, 2026-10-06)
 *
 * Wired to the REAL member-scoped parametric surface
 * (server/routers/parametricMember.ts):
 *   - parametricMember.myCoverage (the caller's policies riding on an ACTIVE
 *     parametric product mapping, plus trigger state)
 *   - parametricMember.myPayouts  (parametric_payout_settlements rows whose
 *     claim belongs to the caller — claim-scoped IDOR guard server-side)
 *
 * READ-ONLY: there are no mutations at all on this router — trigger CRUD,
 * manual readings and payout evaluation live on the admin-only
 * parametricEngine router and are never exposed here, so no
 * payout-triggering UI exists and none is faked.
 */
import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmt = (n: number, currency = "NGN") =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(n);

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-NG") : "—";

function statusVariant(status: string | null | undefined) {
  switch (status) {
    case "active":
    case "paid":
    case "success":
      return "default" as const;
    case "pending":
    case "triggered":
      return "secondary" as const;
    default:
      return "destructive" as const;
  }
}

export default function MemberParametric() {
  const coverageQuery = trpc.parametricMember.myCoverage.useQuery(undefined, {
    retry: false,
  });
  const payoutsQuery = trpc.parametricMember.myPayouts.useQuery(
    { limit: 50, offset: 0 },
    { retry: false }
  );

  const coverage = coverageQuery.data?.coverage ?? [];
  const payouts = payoutsQuery.data?.payouts ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Parametric Coverage"
          description="Your policies backed by an active parametric product — payouts are automatic when the trigger fires; there is nothing to claim manually."
        >
          {coverageQuery.isLoading ? (
            <MemberLoading label="Loading parametric coverage" />
          ) : coverageQuery.isError ? (
            <MemberError message={coverageQuery.error.message} />
          ) : coverage.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have no parametric coverage yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Covered peril</TableHead>
                  <TableHead>Payout</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Trigger</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {coverage.map((c) => (
                  <TableRow key={c.policyId}>
                    <TableCell>#{c.policyId}</TableCell>
                    <TableCell>{c.productName ?? "—"}</TableCell>
                    <TableCell>{c.coveredPeril ?? "—"}</TableCell>
                    <TableCell>
                      {fmt(Number(c.payoutAmount ?? 0), c.currency ?? "NGN")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(c.status)}>
                        {c.status ?? "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell>{c.triggerStatus ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </MemberSection>

        <MemberSection
          title="Parametric Payouts"
          description="Automatic settlements paid (or pending) on your parametric claims."
        >
          {payoutsQuery.isLoading ? (
            <MemberLoading label="Loading parametric payouts" />
          ) : payoutsQuery.isError ? (
            <MemberError message={payoutsQuery.error.message} />
          ) : payouts.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have no parametric payouts yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Payout</TableHead>
                  <TableHead>Policy</TableHead>
                  <TableHead>Claim</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payouts.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell>#{p.id}</TableCell>
                    <TableCell>#{p.policyId}</TableCell>
                    <TableCell>#{p.claimId}</TableCell>
                    <TableCell>#{p.eventId}</TableCell>
                    <TableCell>
                      {fmt(Number(p.amount ?? 0), p.currency ?? "NGN")}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(p.status)}>
                        {p.status ?? "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell>{fmtDate(p.createdAt)}</TableCell>
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
