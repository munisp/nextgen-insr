/**
 * PoolMembership.tsx — Q-wave Q6 (2026-09-25)
 * Member view of P2P / takaful pool membership + surplus statements.
 * BINDING DISCLOSURE: Q3 (poolSurplus router) is planned in plan-q.md but not
 * deployed yet; bindings feature-detect and this page renders a disclosed
 * "not available yet" state until the backend lands. No data is fabricated.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, FileSpreadsheet } from "lucide-react";
import { poolSurplusApi } from "@/services/innovationApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

export default function PoolMembership() {
  const memberships = useQuery({
    queryKey: ["innovation", "pools", "memberships"],
    queryFn: () => poolSurplusApi.myMemberships(),
    retry: 1,
  });
  const statements = useQuery({
    queryKey: ["innovation", "pools", "statements"],
    queryFn: () => poolSurplusApi.myStatements({ limit: 24 }),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Pool Membership &amp; Surplus
        </h1>
        <p className="text-sm text-stone-500">
          Mutual pool memberships (P2P refund and takaful surplus modes) and
          your end-of-period surplus statements.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Users className="h-5 w-5 text-amber-600" aria-hidden />
            Your pools
          </CardTitle>
        </CardHeader>
        <CardContent>
          {memberships.isLoading ? (
            <LoadingState label="Loading your pools…" />
          ) : memberships.isError ? (
            <ErrorState
              message="We couldn’t load your pool memberships. Please try again."
              onRetry={() => memberships.refetch()}
            />
          ) : memberships.data === null ? (
            <UnavailableState feature="Pool membership" />
          ) : (memberships.data?.memberships ?? []).length === 0 ? (
            <EmptyState
              title="You’re not in any pool yet"
              hint="Pools you join will appear here with your role and status."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {memberships.data!.memberships.map(m => (
                <li
                  key={m.poolId}
                  className="rounded-xl border border-stone-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-stone-900">{m.poolName}</p>
                    <Badge className="bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-500/20">
                      {m.status}
                    </Badge>
                  </div>
                  <dl className="mt-3 space-y-1 text-sm text-stone-600">
                    <div className="flex justify-between">
                      <dt>Mode</dt>
                      <dd>
                        {m.mode === "takaful_surplus"
                          ? "Takaful surplus"
                          : "P2P refund"}
                      </dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Your role</dt>
                      <dd>{m.role}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt>Member since</dt>
                      <dd>{new Date(m.joinedAt).toLocaleDateString()}</dd>
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
            <FileSpreadsheet className="h-5 w-5 text-amber-600" aria-hidden />
            Surplus statements
          </CardTitle>
        </CardHeader>
        <CardContent>
          {statements.isLoading ? (
            <LoadingState label="Loading surplus statements…" />
          ) : statements.isError ? (
            <ErrorState
              message="We couldn’t load your surplus statements. Please try again."
              onRetry={() => statements.refetch()}
            />
          ) : statements.data === null ? (
            <UnavailableState feature="Surplus statements" />
          ) : (statements.data?.statements ?? []).length === 0 ? (
            <EmptyState
              title="No surplus statements yet"
              hint="At the end of each pool period, your surplus share and distribution status appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                    <th className="py-2 pr-4 font-medium">Period</th>
                    <th className="py-2 pr-4 font-medium">Pool</th>
                    <th className="py-2 pr-4 font-medium text-right">
                      Contributed
                    </th>
                    <th className="py-2 pr-4 font-medium text-right">
                      Surplus share
                    </th>
                    <th className="py-2 font-medium">Distribution</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {statements.data!.statements.map(st => (
                    <tr key={st.periodId}>
                      <td className="py-3 pr-4 text-stone-700">
                        {new Date(st.periodStart).toLocaleDateString()} –{" "}
                        {new Date(st.periodEnd).toLocaleDateString()}
                      </td>
                      <td className="py-3 pr-4 text-stone-700">
                        {st.poolName}
                      </td>
                      <td className="py-3 pr-4 text-right text-stone-900">
                        {st.currency} {st.contributed}
                      </td>
                      <td className="py-3 pr-4 text-right font-medium text-emerald-700">
                        {st.currency} {st.surplusShare}
                      </td>
                      <td className="py-3 text-stone-700">
                        {st.distributionStatus}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
