/**
 * PayPremium.tsx — R3 batch 2 (2026-10-01, R3-b2)
 * Member premium-payment page (route /pay-premium). Shows REAL payable
 * figures from memberPayments.myPremiumDue (server-derived only — recorded
 * due ledger rows and recorded annual premiums; never client-entered or
 * synthesized amounts).
 *
 * DISCLOSED LIMITATION (honest, no fake pay button): the member online
 * premium-payment rail is NOT enabled on this deployment. The underlying
 * premiumTopUp.topUp funds path is gated by the `premium_collect` role that
 * member accounts do not hold, and it lacks a caller→policy ownership check;
 * enabling it for members is a separately reviewed security wave. Until then
 * this page tells the member exactly how to pay (agent / USSD) and simulates
 * nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Info, Landmark } from "lucide-react";
import { paymentsApi } from "@/services/paymentsApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function statusTone(status: string): string {
  switch (status) {
    case "active":
    case "bound":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "lapsed":
      return "bg-red-50 text-red-700 ring-red-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

export default function PayPremium() {
  const dueQuery = useQuery({
    queryKey: ["memberPayments", "myPremiumDue"],
    queryFn: () => paymentsApi.myPremiumDue(),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Pay a Premium
        </h1>
        <p className="text-sm text-stone-500">
          Premiums payable on your policies, with the recorded amounts.
        </p>
      </header>

      {/* Disclosed payment-unavailable notice — honest, no fake pay button. */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" aria-hidden />
        <div className="space-y-1">
          <p className="text-sm font-medium text-stone-800">
            Online premium payment is coming soon
          </p>
          <p className="text-xs text-stone-600">
            Paying your premium online isn’t available yet. To pay today,
            please contact your agent or use our USSD service. The amounts
            below are the real figures recorded on your policies — nothing
            here is estimated or simulated.
          </p>
        </div>
      </div>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Landmark className="h-5 w-5 text-amber-600" aria-hidden />
            Your payable premiums
          </CardTitle>
        </CardHeader>
        <CardContent>
          {dueQuery.isLoading ? (
            <LoadingState label="Loading payable premiums…" />
          ) : dueQuery.isError ? (
            <ErrorState
              message="We couldn’t load your payable premiums. Please try again."
              onRetry={() => dueQuery.refetch()}
            />
          ) : dueQuery.data === null ? (
            <UnavailableState feature="Premium payments" />
          ) : (
            <div className="space-y-6">
              {dueQuery.data.duePremiums.length > 0 && (
                <section>
                  <h2 className="mb-2 text-sm font-semibold text-stone-800">
                    Premiums currently due
                  </h2>
                  <ul className="divide-y divide-stone-100">
                    {dueQuery.data.duePremiums.map(p => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-4 py-3"
                      >
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
                        <p className="text-sm font-semibold text-stone-900">
                          {p.currency} {p.amount}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {dueQuery.data.policies.length === 0 &&
              dueQuery.data.duePremiums.length === 0 ? (
                <EmptyState
                  title="No payable policies"
                  hint="When one of your policies has a premium to pay, it will appear here."
                />
              ) : (
                <section>
                  <h2 className="mb-2 text-sm font-semibold text-stone-800">
                    Your policies — recorded annual premium
                  </h2>
                  <ul className="divide-y divide-stone-100">
                    {dueQuery.data.policies.map(p => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-stone-900">
                            {p.policyNumber}
                            {p.productName ? ` · ${p.productName}` : ""}
                          </p>
                          <p className="text-xs text-stone-500">
                            {p.renewalDate
                              ? `renews ${new Date(p.renewalDate).toLocaleDateString()}`
                              : "no renewal date recorded"}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-stone-900">
                            {p.currency} {p.annualPremium}
                            <span className="text-xs font-normal text-stone-500">
                              {" "}
                              / year
                            </span>
                          </p>
                          <Badge
                            className={`ring-1 ring-inset ${statusTone(p.status)}`}
                          >
                            {p.status}
                          </Badge>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <p className="text-xs text-stone-500">{dueQuery.data.disclosure}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-stone-500">
        Your full premium history is on the{" "}
        <Link href="/my-premiums" className="text-amber-700 underline">
          My Premiums
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
