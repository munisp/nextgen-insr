/**
 * MemberPayments.tsx — /member/payments
 *
 * Wired to the REAL member payments router (server/routers/memberPayments.ts,
 * READ-ONLY by design):
 *   - memberPayments.myPremiums    (premium payment history, real rows+count)
 *   - memberPayments.myPremiumDue  (due ledger rows + disclosure; no
 *     synthesized balances)
 *
 * Honest states only: loading skeletons, empty state, error card.
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
  d ? new Date(d).toLocaleDateString("en-NG") : "—";

export default function MemberPayments() {
  const premiumsQuery = trpc.memberPayments.myPremiums.useQuery(undefined, {
    retry: false,
  });
  const dueQuery = trpc.memberPayments.myPremiumDue.useQuery(undefined, {
    retry: false,
  });

  const premiums = premiumsQuery.data?.premiums ?? [];
  const duePremiums = dueQuery.data?.duePremiums ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Premiums Due"
          description={
            dueQuery.data?.disclosure ??
            "Due premium entries recorded on the ledger."
          }
        >
          {dueQuery.isLoading ? (
            <MemberLoading label="Loading due premiums" />
          ) : dueQuery.isError ? (
            <MemberError message={dueQuery.error.message} />
          ) : duePremiums.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have no premiums currently due.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Policy #</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {duePremiums.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono">
                      {r.premiumRef ?? r.id}
                    </TableCell>
                    <TableCell className="font-mono">
                      {r.policyNumber ?? "—"}
                    </TableCell>
                    <TableCell>
                      {fmt(Number(r.amount ?? 0), r.currency ?? "NGN")}
                    </TableCell>
                    <TableCell>{fmtDate(r.dueDate)}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{r.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </MemberSection>

        <MemberSection
          title="Payment History"
          description="Premium payments recorded on your account."
        >
          {premiumsQuery.isLoading ? (
            <MemberLoading label="Loading payment history" />
          ) : premiumsQuery.isError ? (
            <MemberError message={premiumsQuery.error.message} />
          ) : premiums.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No premium payments have been recorded on your account yet.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Paid</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {premiums.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono">
                        {r.premiumRef ?? r.id}
                      </TableCell>
                      <TableCell className="font-mono">
                        {r.policyNumber ?? "—"}
                      </TableCell>
                      <TableCell>
                        {fmt(Number(r.amount ?? 0), r.currency ?? "NGN")}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{r.status}</Badge>
                      </TableCell>
                      <TableCell>{r.paymentMethod ?? "—"}</TableCell>
                      <TableCell>{fmtDate(r.paidDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-sm text-muted-foreground pt-4">
                {premiumsQuery.data?.count ?? premiums.length} payment record(s)
                on your account.
              </p>
            </>
          )}
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
