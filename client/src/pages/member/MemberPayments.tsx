/**
 * MemberPayments.tsx — /member/payments
 *
 * Wired to the REAL member payments router (server/routers/memberPayments.ts):
 *   - memberPayments.myPremiums    (premium payment history, real rows+count)
 *   - memberPayments.myPremiumDue  (due ledger rows + disclosure; no
 *     synthesized balances)
 *   - memberPayments.initiatePremiumPayment (W7-B6, 2026-10-03): REAL gateway
 *     initiation — amount is derived server-side from the due ledger row,
 *     the idempotency key is generated per attempt, and the response carries
 *     the gateway's real reference + authorization URL. An unconfigured
 *     gateway surfaces its honest PRECONDITION_FAILED message; there is no
 *     simulated success path.
 *   - memberPayments.verifyPremiumPayment (W7-B6): server-side verification
 *     after the member completes checkout; only a gateway-confirmed success
 *     shows as paid.
 *
 * Honest states only: loading skeletons, empty state, error card.
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

  // W7-B6 (2026-10-03): real pay flow. Per-attempt idempotency key; the
  // server derives the amount — the client sends only identifiers.
  const [payState, setPayState] = useState<{
    reference: string;
    authorizationUrl: string;
    amount: string;
    currency: string;
  } | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const verifyMutation = trpc.memberPayments.verifyPremiumPayment.useMutation({
    onSuccess: (data: { status: string }) => {
      setVerifyError(null);
      setVerifyResult(
        data.status === "success"
          ? "Payment confirmed — your premium has been credited."
          : `Payment is not confirmed yet (status: ${data.status}).`
      );
    },
    onError: (err: { message: string }) => {
      setVerifyResult(null);
      setVerifyError(err.message);
    },
  });

  const initiateMutation =
    trpc.memberPayments.initiatePremiumPayment.useMutation({
      onSuccess: (data: {
        reference: string;
        authorizationUrl: string;
        amount: string;
        currency: string;
      }) => {
        setPayError(null);
        setVerifyResult(null);
        setVerifyError(null);
        setPayState({
          reference: data.reference,
          authorizationUrl: data.authorizationUrl,
          amount: data.amount,
          currency: data.currency,
        });
      },
      onError: (err: { message: string }) => {
        setPayState(null);
        setPayError(err.message);
      },
    });

  const pay = (policyId: number, premiumId: number) => {
    setPayError(null);
    setVerifyResult(null);
    setVerifyError(null);
    initiateMutation.mutate({
      policyId,
      premiumId,
      idempotencyKey: crypto.randomUUID(),
    });
  };

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
            <>
              {payError && (
                <p
                  role="alert"
                  className="text-sm text-destructive border border-destructive/40 rounded-md p-3 mb-4"
                >
                  Payment could not be initiated: {payError}
                </p>
              )}
              {payState && (
                <div className="text-sm border rounded-md p-3 mb-4 space-y-2">
                  <p>
                    Payment initiated. Reference:{" "}
                    <span className="font-mono">{payState.reference}</span> —{" "}
                    {fmt(Number(payState.amount), payState.currency)}
                  </p>
                  <div className="flex gap-2">
                    <Button asChild size="sm">
                      <a
                        href={payState.authorizationUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Complete payment
                      </a>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        verifyMutation.mutate({
                          reference: payState.reference,
                        })
                      }
                    >
                      I've paid — verify
                    </Button>
                  </div>
                  {verifyResult && (
                    <p className="text-sm">{verifyResult}</p>
                  )}
                  {verifyError && (
                    <p role="alert" className="text-sm text-destructive">
                      Verification failed: {verifyError}
                    </p>
                  )}
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Due Date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
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
                      <TableCell>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => pay(r.policyId, r.id)}
                        >
                          Pay now
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
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
