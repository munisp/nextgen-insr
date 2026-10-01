/**
 * MyAirtime.tsx — R3 batch 3 (2026-10-01, R3-b3)
 * Member view of the caller's own airtime history (route /my-airtime).
 * BINDING: REAL — memberAirtime.myHistory / mySummary
 * (server/routers/memberAirtime.ts, protectedProcedure, phone-scoped
 * server-side from the session). READ-ONLY: vending is a funds mutation
 * deferred to the reviewed funds wave — this page NEVER simulates a vend.
 * Every status/providerStatus/failureReason is shown verbatim. NOT_FOUND/
 * FORBIDDEN → null → disclosed UnavailableState; empty/error states
 * disclosed. No fabricated data.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone } from "lucide-react";
import {
  memberAirtimeApi,
  type MemberAirtimeRow,
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

function SummaryCard() {
  const summaryQuery = useQuery({
    queryKey: ["memberAirtime", "mySummary", 30],
    queryFn: () => memberAirtimeApi.mySummary({ periodDays: 30 }),
    retry: 1,
  });

  if (summaryQuery.isLoading)
    return <LoadingState label="Loading your summary…" />;
  if (summaryQuery.isError)
    return (
      <ErrorState
        message="We couldn’t load your airtime summary. Please try again."
        onRetry={() => summaryQuery.refetch()}
      />
    );
  if (summaryQuery.data === null)
    return <UnavailableState feature="Airtime summary" />;

  const { totalTransactions, byStatus } = summaryQuery.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Last 30 days</CardTitle>
      </CardHeader>
      <CardContent>
        {totalTransactions === 0 ? (
          <p className="text-sm text-stone-500">
            No airtime purchases in the last 30 days.
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

function HistoryList() {
  const historyQuery = useQuery({
    queryKey: ["memberAirtime", "myHistory"],
    queryFn: () => memberAirtimeApi.myHistory(),
    retry: 1,
  });

  if (historyQuery.isLoading)
    return <LoadingState label="Loading your airtime history…" />;
  if (historyQuery.isError)
    return (
      <ErrorState
        message="We couldn’t load your airtime history. Please try again."
        onRetry={() => historyQuery.refetch()}
      />
    );
  if (historyQuery.data === null)
    return <UnavailableState feature="Airtime history" />;
  if (historyQuery.data.history.length === 0)
    return (
      <EmptyState
        title="No airtime purchases yet"
        hint="When you buy airtime for your registered phone number, it will appear here."
      />
    );

  return (
    <ul className="divide-y divide-stone-100">
      {historyQuery.data.history.map((t: MemberAirtimeRow) => (
        <li key={t.ref} className="flex items-center justify-between gap-4 py-3">
          <div>
            <p className="text-sm font-medium text-stone-900">
              {t.network ?? "Airtime"}
              {t.phoneNumber ? ` · ${t.phoneNumber}` : ""}
            </p>
            <p className="text-xs text-stone-500">
              {new Date(t.createdAt).toLocaleString()}
              {t.providerStatus ? ` · ${t.providerStatus}` : ""}
              {t.failureReason ? ` · ${t.failureReason}` : ""}
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

export default function MyAirtime() {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-center gap-3">
        <Phone className="h-6 w-6 text-stone-700" />
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Airtime</h1>
          <p className="text-sm text-stone-500">
            Your airtime purchase history.
          </p>
        </div>
      </div>
      <SummaryCard />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          <HistoryList />
        </CardContent>
      </Card>
    </div>
  );
}
