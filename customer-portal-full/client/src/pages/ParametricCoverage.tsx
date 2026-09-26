/**
 * ParametricCoverage.tsx — Q-wave Q6 (2026-09-25)
 * Member view of parametric coverage status + payout history.
 * BINDING DISCLOSURE: the Q2 backend (parametricEngine router) currently
 * ships admin-only procedures; the member procedures bound here are
 * forward-looking and feature-detected — this page renders a disclosed
 * "not available yet" state until they are deployed. No data is fabricated.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CloudSun, Banknote } from "lucide-react";
import { parametricMemberApi } from "@/services/innovationApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function statusTone(status: string): string {
  switch (status) {
    case "active":
    case "paid":
    case "settled":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "pending":
    case "processing":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

export default function ParametricCoverage() {
  const coverage = useQuery({
    queryKey: ["innovation", "parametric", "coverage"],
    queryFn: () => parametricMemberApi.myCoverage(),
    retry: 1,
  });
  const payouts = useQuery({
    queryKey: ["innovation", "parametric", "payouts"],
    queryFn: () => parametricMemberApi.myPayouts({ limit: 50 }),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Parametric Coverage
        </h1>
        <p className="text-sm text-stone-500">
          Weather and event-triggered covers that pay out automatically when a
          verified trigger fires — no claim form required.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <CloudSun className="h-5 w-5 text-amber-600" aria-hidden />
            Your coverage
          </CardTitle>
        </CardHeader>
        <CardContent>
          {coverage.isLoading ? (
            <LoadingState label="Checking your parametric coverage…" />
          ) : coverage.isError ? (
            <ErrorState
              message="We couldn’t load your coverage. Please try again."
              onRetry={() => coverage.refetch()}
            />
          ) : coverage.data === null ? (
            <UnavailableState feature="Parametric coverage" />
          ) : (coverage.data?.coverage ?? []).length === 0 ? (
            <EmptyState
              title="No parametric covers on your account"
              hint="Parametric products you buy will appear here with their live trigger status."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {coverage.data!.coverage.map(c => (
                <li
                  key={c.policyId}
                  className="rounded-xl border border-stone-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-stone-900">
                        {c.productName}
                      </p>
                      <p className="mt-0.5 text-xs text-stone-500">
                        Peril: {c.coveredPeril}
                      </p>
                    </div>
                    <Badge
                      className={`ring-1 ring-inset ${statusTone(c.status)}`}
                    >
                      {c.status}
                    </Badge>
                  </div>
                  <dl className="mt-3 space-y-1 text-sm text-stone-600">
                    <div className="flex justify-between">
                      <dt>Automatic payout</dt>
                      <dd className="font-medium text-stone-900">
                        {c.currency} {c.payoutAmount}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Trigger status</dt>
                      <dd>{c.triggerStatus ?? "—"}</dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Banknote className="h-5 w-5 text-amber-600" aria-hidden />
            Payout history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {payouts.isLoading ? (
            <LoadingState label="Loading payout history…" />
          ) : payouts.isError ? (
            <ErrorState
              message="We couldn’t load payout history. Please try again."
              onRetry={() => payouts.refetch()}
            />
          ) : payouts.data === null ? (
            <UnavailableState feature="Parametric payout history" />
          ) : (payouts.data?.payouts ?? []).length === 0 ? (
            <EmptyState
              title="No payouts yet"
              hint="When a trigger fires for one of your covers, the automatic payout is recorded here."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {payouts.data!.payouts.map(p => (
                <li
                  key={p.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {p.currency} {p.amount}
                    </p>
                    <p className="text-xs text-stone-500">
                      Policy #{p.policyId} ·{" "}
                      {p.paidAt
                        ? `Paid ${new Date(p.paidAt).toLocaleDateString()}`
                        : `Initiated ${new Date(p.createdAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <Badge
                    className={`ring-1 ring-inset ${statusTone(p.status)}`}
                  >
                    {p.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
