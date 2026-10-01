/**
 * MySavings.tsx — R3 batch 2 (2026-10-01, R3-b2)
 * Member view of their real savings position + transaction history.
 * BINDING: REAL — memberSavings.mySummary / myTransactions (member-scoped
 * read-only router; the domain `savingsProducts` router is deliberately NOT
 * used — its deposit/withdraw write fabricated success rows with no rail
 * leg and its listAccounts is an unscoped IDOR).
 * Every figure on this page comes from the live response; the balance is
 * settled-only (status="success" Cash In − Cash Out). NOT_FOUND/FORBIDDEN →
 * null is the defensive fallback for older deployments (and members without
 * a savings profile); null renders a disclosed state, never a zero balance.
 * There is intentionally NO deposit/withdraw UI — funding goes through
 * `/wallet` (rail-verified).
 */
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PiggyBank, History, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { savingsApi } from "@/services/savingsApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function fmt(amount: number | string, currency = "NGN"): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
  }).format(n);
}

function statusTone(status: string): string {
  switch (status) {
    case "success":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "pending":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "failed":
    case "reversed":
      return "bg-red-50 text-red-700 ring-red-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

export default function MySavings() {
  const summary = useQuery({
    queryKey: ["r3-b2", "savings", "summary"],
    queryFn: () => savingsApi.mySummary(),
    retry: 1,
  });
  const transactions = useQuery({
    queryKey: ["r3-b2", "savings", "transactions"],
    queryFn: () => savingsApi.myTransactions({ limit: 50 }),
    retry: 1,
  });
  // Used only to choose the honest empty state when the savings surface
  // resolves to null: no customer profile → offer account opening instead of
  // the deployment-unavailable state.
  const account = useQuery({
    queryKey: ["r3-b2", "savings", "account"],
    queryFn: () => savingsApi.myAccount(),
    retry: 1,
  });

  const noProfile =
    account.data != null && account.data.account === null;

  const summaryBody = summary.isLoading ? (
    <LoadingState label="Loading your savings summary…" />
  ) : summary.isError ? (
    <ErrorState
      message="We couldn’t load your savings summary. Please try again."
      onRetry={() => summary.refetch()}
    />
  ) : summary.data === null ? (
    noProfile ? (
      <EmptyState
        title="You don’t have a savings account yet"
        hint="Open one from your account page to start saving."
      />
    ) : (
      <UnavailableState feature="Savings" />
    )
  ) : (
    <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <dt className="text-xs uppercase tracking-wide text-stone-500">
          Settled balance
        </dt>
        <dd className="mt-1 text-2xl font-bold text-stone-900">
          {fmt(summary.data.balance, summary.data.currency)}
        </dd>
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <dt className="text-xs uppercase tracking-wide text-stone-500">
          Total deposits (settled)
        </dt>
        <dd className="mt-1 text-2xl font-semibold text-emerald-700">
          {fmt(summary.data.totalIn, summary.data.currency)}
        </dd>
      </div>
      <div className="rounded-xl border border-stone-200 bg-white p-4">
        <dt className="text-xs uppercase tracking-wide text-stone-500">
          Total withdrawals (settled)
        </dt>
        <dd className="mt-1 text-2xl font-semibold text-sky-700">
          {fmt(summary.data.totalOut, summary.data.currency)}
        </dd>
      </div>
    </dl>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          My Savings
        </h1>
        <p className="text-sm text-stone-500">
          Your real savings position. Only settled (successful) transactions
          count toward the balance. To fund your account, use{" "}
          <Link href="/wallet" className="text-amber-700 underline">
            Wallet
          </Link>
          .
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <PiggyBank className="h-5 w-5 text-amber-600" aria-hidden />
            Savings summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          {summaryBody}
          {noProfile && summary.data === null && !summary.isLoading && (
            <p className="mt-3 text-xs text-stone-500">
              <Link href="/my-account" className="text-amber-700 underline">
                Go to My Account to open a savings account
              </Link>
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <History className="h-5 w-5 text-amber-600" aria-hidden />
            Transactions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.isLoading ? (
            <LoadingState label="Loading your transactions…" />
          ) : transactions.isError ? (
            <ErrorState
              message="We couldn’t load your transactions. Please try again."
              onRetry={() => transactions.refetch()}
            />
          ) : transactions.data === null ? (
            noProfile ? (
              <EmptyState
                title="No transactions"
                hint="You don’t have a savings account yet, so there is no activity to show."
              />
            ) : (
              <UnavailableState feature="Savings transactions" />
            )
          ) : transactions.data.transactions.length === 0 ? (
            <EmptyState
              title="No transactions yet"
              hint="Your deposits and withdrawals will appear here once you have activity."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {transactions.data.transactions.map(t => (
                <li
                  key={t.id}
                  className="flex items-center justify-between py-3"
                >
                  <div className="flex items-center gap-3">
                    {t.type === "Cash In" ? (
                      <ArrowDownLeft
                        className="h-4 w-4 text-emerald-600"
                        aria-hidden
                      />
                    ) : (
                      <ArrowUpRight
                        className="h-4 w-4 text-sky-600"
                        aria-hidden
                      />
                    )}
                    <div>
                      <p className="text-sm font-medium text-stone-900">
                        {t.type}
                        {t.channel ? ` · ${t.channel}` : ""}
                      </p>
                      <p className="text-xs text-stone-500">
                        {new Date(t.createdAt).toLocaleString()} · ref {t.ref}
                        {t.status === "failed" && t.failureReason
                          ? ` · ${t.failureReason}`
                          : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-semibold ${
                        t.type === "Cash In"
                          ? "text-emerald-700"
                          : "text-sky-700"
                      }`}
                    >
                      {t.type === "Cash In" ? "+" : "−"}
                      {fmt(t.amount, t.currency)}
                    </span>
                    <Badge className={`ring-1 ring-inset ${statusTone(t.status)}`}>
                      {t.status}
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
