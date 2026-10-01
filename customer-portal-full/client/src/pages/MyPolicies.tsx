/**
 * MyPolicies.tsx — R3 batch 1 (2026-10-01, R3)
 * Member's own policies, bound to the MONOLITH memberPolicies router
 * (server/routers/memberPolicies.ts) via services/memberPoliciesApi.ts.
 * Identity is resolved server-side (customers.keycloakSub = session user) —
 * the page never sends a customerId. NOT_FOUND/FORBIDDEN → null remains
 * only as a defensive fallback for older deployments; every figure rendered
 * comes from a real proc response — nothing is fabricated.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText, ShieldCheck } from "lucide-react";
import {
  memberPoliciesApi,
  type MemberPolicyDetail,
} from "@/services/memberPoliciesApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function formatNgn(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "—";
  return `₦${n.toLocaleString()}`;
}

function formatDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString() : "—";
}

function statusBadge(status: string): string {
  if (status === "active") return "bg-emerald-100 text-emerald-800";
  if (status === "cancelled" || status === "lapsed" || status === "expired")
    return "bg-red-100 text-red-700";
  return "bg-stone-100 text-stone-700";
}

function PolicyDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useQuery({
    queryKey: ["r3", "memberPolicies", "myPolicy", id],
    queryFn: () => memberPoliciesApi.myPolicy(id),
    retry: 1,
  });

  const d: MemberPolicyDetail | null | undefined = detail.data;
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
      {detail.isLoading ? (
        <LoadingState label="Loading policy…" />
      ) : detail.isError ? (
        <ErrorState
          message="We couldn’t load this policy. Please try again."
          onRetry={() => detail.refetch()}
        />
      ) : d === null ? (
        <UnavailableState feature="Policy detail" />
      ) : !d ? null : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-stone-900">
              {d.productName ?? `Product #${d.productId}`} · {d.policyNumber}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="text-xs text-stone-500 underline"
            >
              Close
            </button>
          </div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm text-stone-600 sm:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt>Status</dt>
              <dd className="font-medium capitalize text-stone-900">
                {d.status}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Sum insured</dt>
              <dd className="font-medium text-stone-900">
                {formatNgn(d.sumInsured)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Annual premium</dt>
              <dd className="font-medium text-stone-900">
                {formatNgn(d.annualPremium)}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Coverage</dt>
              <dd className="font-medium capitalize text-stone-900">
                {d.coverageType}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Start</dt>
              <dd>{formatDate(d.startDate)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>End</dt>
              <dd>{formatDate(d.endDate)}</dd>
            </div>
            {d.certificateNumber && (
              <div className="flex justify-between gap-4">
                <dt>Certificate</dt>
                <dd>{d.certificateNumber}</dd>
              </div>
            )}
          </dl>
          {d.productDescription && (
            <p className="pt-1 text-xs text-stone-500">{d.productDescription}</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function MyPolicies() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const list = useQuery({
    queryKey: ["r3", "memberPolicies", "myPolicies"],
    queryFn: () => memberPoliciesApi.myPolicies({ limit: 100 }),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          My Policies
        </h1>
        <p className="text-sm text-stone-500">
          Your insurance policies, served live from the platform. Only
          policies registered to your account are shown.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <ShieldCheck className="h-5 w-5 text-amber-600" aria-hidden />
            Policies
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {list.isLoading ? (
            <LoadingState label="Loading your policies…" />
          ) : list.isError ? (
            <ErrorState
              message="We couldn’t load your policies. Please try again."
              onRetry={() => list.refetch()}
            />
          ) : list.data === null ? (
            <UnavailableState feature="My policies" />
          ) : (list.data?.policies ?? []).length === 0 ? (
            // Disclosed empty state — the member genuinely has no policies.
            <EmptyState
              title="No policies yet"
              hint="Policies you purchase will appear here. Browse the product catalog to get started."
            />
          ) : (
            <>
              <p className="text-xs text-stone-500">
                {list.data!.count}{" "}
                {list.data!.count === 1 ? "policy" : "policies"} on your
                account
              </p>
              <ul className="divide-y divide-stone-100">
                {list.data!.policies.map(p => (
                  <li key={p.id} className="py-3">
                    <button
                      type="button"
                      onClick={() =>
                        setSelectedId(prev => (prev === p.id ? null : p.id))
                      }
                      className="flex w-full items-center justify-between gap-4 text-left"
                    >
                      <div className="flex items-center gap-3">
                        <FileText
                          className="h-4 w-4 text-stone-400"
                          aria-hidden
                        />
                        <div>
                          <p className="text-sm font-medium text-stone-900">
                            {p.productName ?? `Product #${p.productId}`}
                          </p>
                          <p className="text-xs text-stone-500">
                            {p.policyNumber} · renews {formatDate(p.renewalDate)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="whitespace-nowrap text-sm font-medium text-stone-900">
                          {formatNgn(p.annualPremium)}/yr
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${statusBadge(p.status)}`}
                        >
                          {p.status}
                        </span>
                      </div>
                    </button>
                    {selectedId === p.id && (
                      <div className="mt-3">
                        <PolicyDetail
                          id={p.id}
                          onClose={() => setSelectedId(null)}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
