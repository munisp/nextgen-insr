/**
 * MyLoyalty.tsx — R3 batch 1 (2026-10-01, R3)
 * Member view of their real loyalty points balance + ledger history.
 * BINDING: REAL — memberLoyalty.myBalance / myHistory (member-scoped
 * read-only router; the agent `loyalty` program and the IDOR-exposed
 * `customerLoyaltyProgram` are deliberately NOT used).
 * NOT_FOUND/FORBIDDEN → null is the defensive fallback for older deployments;
 * null renders the disclosed "not available" state. No points are fabricated.
 * There is intentionally NO redeem UI — no member-safe reward catalog exists
 * on the backend (fail-closed, 2026-10-01 R3).
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Star, History } from "lucide-react";
import { loyaltyApi } from "@/services/loyaltyApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function typeTone(type: string): string {
  switch (type) {
    case "earned":
    case "bonus":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "redeemed":
      return "bg-sky-50 text-sky-700 ring-sky-600/20";
    case "penalty":
      return "bg-red-50 text-red-700 ring-red-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

export default function MyLoyalty() {
  const balance = useQuery({
    queryKey: ["r3", "loyalty", "balance"],
    queryFn: () => loyaltyApi.myBalance(),
    retry: 1,
  });
  const history = useQuery({
    queryKey: ["r3", "loyalty", "history"],
    queryFn: () => loyaltyApi.myHistory({ limit: 50 }),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          My Loyalty Points
        </h1>
        <p className="text-sm text-stone-500">
          Points you earn on your policy activity. Redemption is not yet
          available in this app — your balance below is the real ledger total.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Star className="h-5 w-5 text-amber-600" aria-hidden />
            Points balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balance.isLoading ? (
            <LoadingState label="Loading your points balance…" />
          ) : balance.isError ? (
            <ErrorState
              message="We couldn’t load your points balance. Please try again."
              onRetry={() => balance.refetch()}
            />
          ) : balance.data === null ? (
            <UnavailableState feature="Loyalty points" />
          ) : (
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-stone-200 bg-white p-4">
                <dt className="text-xs uppercase tracking-wide text-stone-500">
                  Available
                </dt>
                <dd className="mt-1 text-2xl font-bold text-stone-900">
                  {balance.data!.balance.toLocaleString()} pts
                </dd>
              </div>
              <div className="rounded-xl border border-stone-200 bg-white p-4">
                <dt className="text-xs uppercase tracking-wide text-stone-500">
                  Earned
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-emerald-700">
                  {balance.data!.earned.toLocaleString()} pts
                </dd>
              </div>
              <div className="rounded-xl border border-stone-200 bg-white p-4">
                <dt className="text-xs uppercase tracking-wide text-stone-500">
                  Redeemed
                </dt>
                <dd className="mt-1 text-2xl font-semibold text-sky-700">
                  {balance.data!.redeemed.toLocaleString()} pts
                </dd>
              </div>
            </dl>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <History className="h-5 w-5 text-amber-600" aria-hidden />
            Points history
          </CardTitle>
        </CardHeader>
        <CardContent>
          {history.isLoading ? (
            <LoadingState label="Loading your points history…" />
          ) : history.isError ? (
            <ErrorState
              message="We couldn’t load your points history. Please try again."
              onRetry={() => history.refetch()}
            />
          ) : history.data === null ? (
            <UnavailableState feature="Loyalty points history" />
          ) : history.data.history.length === 0 ? (
            <EmptyState
              title="No loyalty activity yet"
              hint="Points you earn from policy activity will appear here."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {history.data.history.map(h => (
                <li
                  key={h.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {h.description ?? h.type}
                    </p>
                    <p className="text-xs text-stone-500">
                      {new Date(h.createdAt).toLocaleDateString()} · balance
                      after: {h.balanceAfter.toLocaleString()} pts
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-semibold ${
                        h.points >= 0 ? "text-emerald-700" : "text-sky-700"
                      }`}
                    >
                      {h.points >= 0 ? "+" : ""}
                      {h.points.toLocaleString()} pts
                    </span>
                    <Badge className={`ring-1 ring-inset ${typeTone(h.type)}`}>
                      {h.type}
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
