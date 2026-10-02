/**
 * MemberPolicies.tsx — /member/policies
 *
 * Wired to the REAL member policies router (server/routers/memberPolicies.ts):
 *   - memberPolicies.myPolicies (caller-scoped list + real count)
 *
 * Honest states only: loading skeletons, empty state, error card.
 */
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
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

const fmtNgn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    n
  );

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-NG") : "—";

export default function MemberPolicies() {
  const policiesQuery = trpc.memberPolicies.myPolicies.useQuery(undefined, {
    retry: false,
  });

  const policies = policiesQuery.data?.policies ?? [];

  return (
    <MemberLayout>
      <MemberSection
        title="My Policies"
        description="Policies held under your account."
      >
        {policiesQuery.isLoading ? (
          <MemberLoading label="Loading your policies" />
        ) : policiesQuery.isError ? (
          <MemberError message={policiesQuery.error.message} />
        ) : policies.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            You have no policies yet.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Policy #</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Sum Insured</TableHead>
                  <TableHead>Annual Premium</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>End</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {policies.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono">
                      <Link
                        href={`/member/policies/${p.id}`}
                        className="underline underline-offset-2"
                      >
                        {p.policyNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{p.productName ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{p.status}</Badge>
                    </TableCell>
                    <TableCell>{fmtNgn(Number(p.sumInsured ?? 0))}</TableCell>
                    <TableCell>
                      {fmtNgn(Number(p.annualPremium ?? 0))}
                    </TableCell>
                    <TableCell>{fmtDate(p.startDate)}</TableCell>
                    <TableCell>{fmtDate(p.endDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <p className="text-sm text-muted-foreground pt-4">
              {policiesQuery.data?.count ?? policies.length} polic
              {policiesQuery.data?.count === 1 ? "y" : "ies"} on your account.
            </p>
          </>
        )}
      </MemberSection>
    </MemberLayout>
  );
}
