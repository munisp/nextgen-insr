/**
 * MyPremiums.tsx — R3 batch 2 (2026-10-01, R3-b2)
 * Member view of the caller's own premium ledger (route /my-premiums).
 * BINDING: REAL — memberPayments.myPremiums / memberPayments.myPremiumDue
 * (server/routers/memberPayments.ts, protectedProcedure, dual-identity
 * caller-scoped). Every ledger status is shown verbatim (paid, due, failed —
 * no cosmetic filtering). NOT_FOUND/FORBIDDEN → null remains only as a
 * defensive fallback for older deployments; empty/error states are
 * disclosed. No data is fabricated.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ReceiptText, CalendarClock } from "lucide-react";
import { paymentsApi } from "@/services/paymentsApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function statusTone(status: string): string {
  switch (status) {
    case "paid":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "due":
    case "pending":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "failed":
    case "cancelled":
      return "bg-red-50 text-red-700 ring-red-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

function DueSection() {
  const dueQuery = useQuery({
    queryKey: ["memberPayments", "myPremiumDue"],
    queryFn: () => paymentsApi.myPremiumDue(),
    retry: 1,
  });

  if (dueQuery.isLoading)
    return <LoadingState label="Loading premiums due…" />;
  if (dueQuery.isError)
    return (
      <ErrorState
        message="We couldn’t load your premiums due. Please try again."
        onRetry={() => dueQuery.refetch()}
      />
    );
  if (dueQuery.data === null) return <UnavailableState feature="Premiums due" />;

  const { duePremiums, disclosure } = dueQuery.data;
  return (
    <>
      {duePremiums.length === 0 ? (
        <EmptyState
          title="No premiums due"
          hint="When a premium on one of your policies comes due, it will appear here."
        />
      ) : (
        <ul className="divide-y divide-stone-100">
          {duePremiums.map(p => (
            <li key={p.id} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-stone-900">
                  {p.policyNumber ?? `Policy #${p.policyId}`}
                </p>
                <p className="text-xs text-stone-500">
                  due {new Date(p.dueDate).toLocaleDateString()}
                  {p.gracePeriodDays != null
                    ? ` · ${p.gracePeriodDays}-day grace period`
                    : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-stone-900">
                  {p.currency} {p.amount}
                </p>
                <Badge className={`ring-1 ring-inset ${statusTone(p.status)}`}>
                  {p.status}
                </Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-stone-500">{disclosure}</p>
    </>
  );
}

export default function MyPremiums() {
  const historyQuery = useQuery({
    queryKey: ["memberPayments", "myPremiums"],
    queryFn: () => paymentsApi.myPremiums({ limit: 50 }),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            My Premiums
          </h1>
          <p className="text-sm text-stone-500">
            Premiums due on your policies and your full premium payment
            history.
          </p>
        </div>
        <Link
          href="/pay-premium"
          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
        >
          Pay a premium
        </Link>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <CalendarClock className="h-5 w-5 text-amber-600" aria-hidden />
            Premiums due
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DueSection />
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <ReceiptText className="h-5 w-5 text-amber-600" aria-hidden />
            Payment history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading ? (
            <LoadingState label="Loading your premium history…" />
          ) : historyQuery.isError ? (
            <ErrorState
              message="We couldn’t load your premium history. Please try again."
              onRetry={() => historyQuery.refetch()}
            />
          ) : historyQuery.data === null ? (
            <UnavailableState feature="Premium history" />
          ) : historyQuery.data.premiums.length === 0 ? (
            <EmptyState
              title="No premium payments yet"
              hint="Premium payments recorded against your policies will appear here."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {historyQuery.data.premiums.map(p => (
                <li key={p.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {p.policyNumber ?? `Policy #${p.policyId}`}
                    </p>
                    <p className="text-xs text-stone-500">
                      ref {p.premiumRef}
                      {p.paymentMethod ? ` · ${p.paymentMethod.replace(/_/g, " ")}` : ""}
                      {p.paidDate
                        ? ` · paid ${new Date(p.paidDate).toLocaleDateString()}`
                        : ` · due ${new Date(p.dueDate).toLocaleDateString()}`}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-stone-900">
                      {p.currency} {p.amount}
                    </p>
                    <Badge className={`ring-1 ring-inset ${statusTone(p.status)}`}>
                      {p.status}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
