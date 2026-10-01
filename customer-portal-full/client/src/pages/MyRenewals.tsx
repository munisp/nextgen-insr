/**
 * MyRenewals.tsx — R3 batch 5 (2026-10-01, R3-b5)
 * Member view of the caller's own policy renewals (route /my-renewals).
 * BINDING: REAL — memberRenewals.myRenewals / requestRenewal
 * (server/routers/memberRenewals.ts, protectedProcedure, ownership-guarded —
 * the source insuranceWorkflows.requestRenewal IDOR is closed in the member
 * variant). Renewable-policy picker: memberPolicies.myPolicies filtered to
 * active/bound (the server's INS-11 status gate is the source of truth; the
 * filter is only a UI affordance). NOT_FOUND/FORBIDDEN → null is only a
 * defensive fallback for older deployments; loading/error/empty states are
 * disclosed. No data is fabricated. Renewal PAYMENT is not offered here
 * (funds wave deferred) — the page discloses this.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCcw } from "lucide-react";
import { memberRenewalsApi } from "@/services/memberLifecycleApi";
import { memberPoliciesApi } from "@/services/memberPoliciesApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function statusTone(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "pending":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

export default function MyRenewals() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [requestedFor, setRequestedFor] = useState<number | null>(null);

  const renewalsQuery = useQuery({
    queryKey: ["memberRenewals", "myRenewals"],
    queryFn: () => memberRenewalsApi.myRenewals({ limit: 50 }),
    retry: 1,
  });

  const policiesQuery = useQuery({
    queryKey: ["memberPolicies", "myPolicies", "renewal-picker"],
    queryFn: () => memberPoliciesApi.myPolicies({ limit: 100 }),
    retry: 1,
  });

  const requestMutation = useMutation({
    mutationFn: (policyId: number) =>
      memberRenewalsApi.requestRenewal({ policyId }),
    onSuccess: (_result, policyId) => {
      setActionError(null);
      setRequestedFor(policyId);
      void queryClient.invalidateQueries({
        queryKey: ["memberRenewals", "myRenewals"],
      });
    },
    onError: error => {
      // Honest failure surface: show the server's exact reason (e.g. the
      // INS-11 status gate or the duplicate-open-renewal guard).
      setRequestedFor(null);
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  const renewablePolicies = (policiesQuery.data?.policies ?? []).filter(p =>
    ["active", "bound"].includes(p.status)
  );
  const openRenewalPolicyIds = new Set(
    (renewalsQuery.data?.renewals ?? [])
      .filter(r => r.status === "pending")
      .map(r => r.originalPolicyId)
  );

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          My Renewals
        </h1>
        <p className="text-sm text-stone-500">
          Renewal requests for your policies and their live status. Paying a
          renewal is handled by staff once the request is processed — online
          renewal payment is not available yet.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <RefreshCcw className="h-5 w-5 text-amber-600" aria-hidden />
            Your renewals
          </CardTitle>
        </CardHeader>
        <CardContent>
          {renewalsQuery.isLoading ? (
            <LoadingState label="Loading your renewals…" />
          ) : renewalsQuery.isError ? (
            <ErrorState
              message="We couldn’t load your renewals. Please try again."
              onRetry={() => renewalsQuery.refetch()}
            />
          ) : renewalsQuery.data === null ? (
            <UnavailableState feature="Policy renewals" />
          ) : (renewalsQuery.data?.renewals ?? []).length === 0 ? (
            <EmptyState
              title="No renewals yet"
              hint="Request a renewal below when a policy approaches its end date."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {renewalsQuery.data!.renewals.map(r => (
                <li
                  key={r.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      Policy {r.policyNumber}
                    </p>
                    <p className="text-xs text-stone-500">
                      Due {new Date(r.renewalDueDate).toLocaleDateString()}
                      {r.renewalPremium != null &&
                        ` · premium ${r.renewalPremium} ${r.currency}`}
                      {r.isAutoRenewal ? " · auto-renewal" : ""}
                      {r.completedAt &&
                        ` · completed ${new Date(r.completedAt).toLocaleDateString()}`}
                    </p>
                  </div>
                  <Badge className={`ring-1 ring-inset ${statusTone(r.status)}`}>
                    {r.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="text-lg text-stone-800">
            Request a renewal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {policiesQuery.isLoading ? (
            <LoadingState label="Loading your policies…" />
          ) : policiesQuery.isError ? (
            <ErrorState
              message="We couldn’t load your policies. Please try again."
              onRetry={() => policiesQuery.refetch()}
            />
          ) : policiesQuery.data === null ? (
            <UnavailableState feature="Policy renewals" />
          ) : renewablePolicies.length === 0 ? (
            <EmptyState
              title="No renewable policies"
              hint="Only active or bound policies can be renewed."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {renewablePolicies.map(p => {
                const hasOpen = openRenewalPolicyIds.has(p.id);
                const justRequested = requestedFor === p.id;
                return (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-stone-900">
                        {p.policyNumber} · {p.productName ?? p.coverageType}
                      </p>
                      <p className="text-xs text-stone-500">
                        {p.endDate
                          ? `Ends ${new Date(p.endDate).toLocaleDateString()}`
                          : "No end date on record"}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={
                        hasOpen || justRequested || requestMutation.isPending
                      }
                      onClick={() => {
                        setActionError(null);
                        requestMutation.mutate(p.id);
                      }}
                      className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {hasOpen || justRequested
                        ? "Renewal requested"
                        : requestMutation.isPending
                          ? "Requesting…"
                          : "Request renewal"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {actionError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
