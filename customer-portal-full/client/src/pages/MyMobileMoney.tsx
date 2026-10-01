/**
 * MyMobileMoney.tsx — R3 batch 3 (2026-10-01, R3-b3)
 * Member view of the caller's own mobile-money activity (route
 * /my-mobile-money). BINDING: REAL — memberMobileMoney.myTransactions /
 * mySummary / providers (server/routers/memberMobileMoney.ts,
 * protectedProcedure, phone-scoped server-side from the session). READ-ONLY:
 * cash-in/cash-out are funds mutations deferred to the reviewed funds wave —
 * this page NEVER simulates one. Provider status banner discloses
 * `configured:false` ("provider not configured — top-ups unavailable").
 * Every status/providerStatus is shown verbatim (pending_provider /
 * unknown_outcome included). NOT_FOUND/FORBIDDEN → null → disclosed
 * UnavailableState; empty/error states disclosed. No fabricated data.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Smartphone } from "lucide-react";
import {
  memberMobileMoneyApi,
  type MemberMobileMoneyTx,
} from "@/services/memberPaymentsRailsApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function statusTone(status: string): string {
  switch (status) {
    case "success":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "pending":
    case "pending_provider":
    case "unknown_outcome":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "failed":
    case "reversed":
      return "bg-red-50 text-red-700 ring-red-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

function formatNgn(amount: string | number): string {
  const n = Number(amount);
  return Number.isFinite(n) ? `₦${n.toLocaleString()}` : String(amount);
}

function ProviderBanner() {
  const providersQuery = useQuery({
    queryKey: ["memberMobileMoney", "providers"],
    queryFn: () => memberMobileMoneyApi.providers(),
    retry: 1,
  });

  if (providersQuery.isLoading)
    return <LoadingState label="Checking mobile money provider…" />;
  if (providersQuery.isError)
    return (
      <ErrorState
        message="We couldn’t check the mobile money provider status. Please try again."
        onRetry={() => providersQuery.refetch()}
      />
    );
  if (providersQuery.data === null)
    return <UnavailableState feature="Mobile money provider status" />;

  const { providers, configured } = providersQuery.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Providers</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!configured && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-600/20">
            Mobile money provider not configured on this deployment — top-ups
            and cash-outs are unavailable. Your history below is unaffected.
          </p>
        )}
        <ul className="divide-y divide-stone-100">
          {providers.map(p => (
            <li key={p.name} className="flex items-center justify-between py-2">
              <span className="text-sm font-medium text-stone-900">{p.name}</span>
              <span className="text-xs text-stone-500">
                cash-in {(p.cashInCommission * 100).toFixed(1)}% · cash-out{" "}
                {(p.cashOutCommission * 100).toFixed(1)}% commission
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function SummaryCard() {
  const summaryQuery = useQuery({
    queryKey: ["memberMobileMoney", "mySummary", 30],
    queryFn: () => memberMobileMoneyApi.mySummary({ periodDays: 30 }),
    retry: 1,
  });

  if (summaryQuery.isLoading)
    return <LoadingState label="Loading your summary…" />;
  if (summaryQuery.isError)
    return (
      <ErrorState
        message="We couldn’t load your mobile money summary. Please try again."
        onRetry={() => summaryQuery.refetch()}
      />
    );
  if (summaryQuery.data === null)
    return <UnavailableState feature="Mobile money summary" />;

  const { totalTransactions, byStatus } = summaryQuery.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Last 30 days</CardTitle>
      </CardHeader>
      <CardContent>
        {totalTransactions === 0 ? (
          <p className="text-sm text-stone-500">
            No mobile money activity in the last 30 days.
          </p>
        ) : (
          <ul className="space-y-2">
            {byStatus.map(s => (
              <li key={s.status} className="flex items-center justify-between">
                <Badge variant="outline" className={statusTone(s.status)}>
                  {s.status}
                </Badge>
                <span className="text-sm text-stone-700">
                  {s.count} · {formatNgn(s.volumeNGN)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function TransactionsList() {
  const txQuery = useQuery({
    queryKey: ["memberMobileMoney", "myTransactions"],
    queryFn: () => memberMobileMoneyApi.myTransactions(),
    retry: 1,
  });

  if (txQuery.isLoading)
    return <LoadingState label="Loading your transactions…" />;
  if (txQuery.isError)
    return (
      <ErrorState
        message="We couldn’t load your mobile money transactions. Please try again."
        onRetry={() => txQuery.refetch()}
      />
    );
  if (txQuery.data === null)
    return <UnavailableState feature="Mobile money transactions" />;
  if (txQuery.data.transactions.length === 0)
    return (
      <EmptyState
        title="No mobile money transactions yet"
        hint="When you cash in or cash out via a mobile money provider, it will appear here."
      />
    );

  return (
    <ul className="divide-y divide-stone-100">
      {txQuery.data.transactions.map((t: MemberMobileMoneyTx) => (
        <li key={t.ref} className="flex items-center justify-between gap-4 py-3">
          <div>
            <p className="text-sm font-medium text-stone-900">
              {t.type}
              {t.provider ? ` · ${t.provider}` : ""}
            </p>
            <p className="text-xs text-stone-500">
              {new Date(t.createdAt).toLocaleString()}
              {t.providerStatus ? ` · ${t.providerStatus}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm font-semibold text-stone-900">
              {formatNgn(t.amount)}
            </p>
            <Badge variant="outline" className={statusTone(t.status)}>
              {t.status}
            </Badge>
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function MyMobileMoney() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-center gap-3">
        <Smartphone className="h-6 w-6 text-stone-700" />
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Mobile Money</h1>
          <p className="text-sm text-stone-500">
            Your mobile money cash-in / cash-out history.
          </p>
        </div>
      </div>
      <ProviderBanner />
      <SummaryCard />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Transactions</CardTitle>
        </CardHeader>
        <CardContent>
          <TransactionsList />
        </CardContent>
      </Card>
    </div>
  );
}
