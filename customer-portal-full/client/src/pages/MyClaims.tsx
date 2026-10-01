/**
 * MyClaims.tsx — R3 batch 1 (2026-10-01, R3)
 * Member view of the caller's own claims on the monolith (route /my-claims).
 * BINDING: REAL — memberClaims.myClaims / memberClaims.myClaim
 * (server/routers/memberClaims.ts, protectedProcedure, claimantId-scoped).
 * NOT_FOUND/FORBIDDEN → null remains only as a defensive fallback for older
 * deployments; empty/error states are disclosed. No data is fabricated.
 *
 * NOTE: the pre-existing /claims page (Claims.tsx) reads the PORTAL's own
 * server DB, not the monolith — this page is the monolith member surface and
 * deliberately lives on a separate route (portal-server retirement is out of
 * R3 scope).
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClipboardList, FilePlus2, ChevronDown, ChevronUp } from "lucide-react";
import { memberClaimsApi } from "@/services/memberClaimsApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

// Member-facing filter subset of the claim_status pgEnum (server enum of
// record: drizzle/schema.ts claimStatusEnum).
const STATUS_FILTERS = [
  "submitted",
  "under_review",
  "approved",
  "partially_approved",
  "rejected",
  "paid",
  "closed",
  "appealed",
] as const;

function statusTone(status: string): string {
  switch (status) {
    case "approved":
    case "partially_approved":
    case "paid":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "submitted":
    case "under_review":
    case "investigation":
    case "appealed":
    case "pending_adjudication":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "rejected":
      return "bg-red-50 text-red-700 ring-red-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

function ClaimDetail({ id }: { id: number }) {
  const detail = useQuery({
    queryKey: ["memberClaims", "myClaim", id],
    queryFn: () => memberClaimsApi.myClaim({ id }),
    retry: 1,
  });

  if (detail.isLoading) return <LoadingState label="Loading claim detail…" />;
  if (detail.isError)
    return (
      <ErrorState
        message="We couldn’t load this claim. Please try again."
        onRetry={() => detail.refetch()}
      />
    );
  if (detail.data === null) return <UnavailableState feature="Claim detail" />;

  const { claim, documents } = detail.data;
  return (
    <div className="mt-3 space-y-3 border-t border-stone-100 pt-3 text-sm text-stone-700">
      <p>{claim.incidentDescription}</p>
      <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
        <div className="flex justify-between gap-4">
          <dt className="text-stone-500">Approved amount</dt>
          <dd>{claim.approvedAmount ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-stone-500">Paid amount</dt>
          <dd>{claim.paidAmount ?? "—"}</dd>
        </div>
        {claim.rejectionReason && (
          <div className="flex justify-between gap-4 md:col-span-2">
            <dt className="text-stone-500">Rejection reason</dt>
            <dd className="text-right">{claim.rejectionReason}</dd>
          </div>
        )}
      </dl>
      {documents.length > 0 && (
        <div>
          <p className="mb-1 font-medium text-stone-800">Documents</p>
          <ul className="space-y-1">
            {documents.map(doc => (
              <li key={doc.id} className="flex items-center justify-between">
                <span>{doc.fileName}</span>
                <Badge className="bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-500/20">
                  {doc.isVerified ? "verified" : "unverified"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function MyClaims() {
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const claimsQuery = useQuery({
    queryKey: ["memberClaims", "myClaims", status],
    queryFn: () => memberClaimsApi.myClaims({ status, limit: 50 }),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            My Claims
          </h1>
          <p className="text-sm text-stone-500">
            Claims you have filed against your own policies, with their live
            status.
          </p>
        </div>
        <Link
          href="/file-claim"
          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
        >
          <FilePlus2 className="h-4 w-4" aria-hidden />
          File a claim
        </Link>
      </header>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStatus(undefined)}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
            status === undefined
              ? "bg-stone-900 text-white ring-stone-900"
              : "bg-white text-stone-600 ring-stone-300"
          }`}
        >
          All
        </button>
        {STATUS_FILTERS.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
              status === s
                ? "bg-stone-900 text-white ring-stone-900"
                : "bg-white text-stone-600 ring-stone-300"
            }`}
          >
            {s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <ClipboardList className="h-5 w-5 text-amber-600" aria-hidden />
            Your claims
          </CardTitle>
        </CardHeader>
        <CardContent>
          {claimsQuery.isLoading ? (
            <LoadingState label="Loading your claims…" />
          ) : claimsQuery.isError ? (
            <ErrorState
              message="We couldn’t load your claims. Please try again."
              onRetry={() => claimsQuery.refetch()}
            />
          ) : claimsQuery.data === null ? (
            <UnavailableState feature="Claims" />
          ) : (claimsQuery.data?.claims ?? []).length === 0 ? (
            <EmptyState
              title="No claims found"
              hint={
                status
                  ? "No claims match this status filter."
                  : "Claims you file against your policies will appear here."
              }
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {claimsQuery.data!.claims.map(c => {
                const expanded = expandedId === c.id;
                return (
                  <li key={c.id} className="py-3">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-4 text-left"
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                      aria-expanded={expanded}
                    >
                      <div>
                        <p className="text-sm font-medium text-stone-900">
                          {c.claimNumber} · {c.claimType.replace(/_/g, " ")}
                        </p>
                        <p className="text-xs text-stone-500">
                          Policy {c.policyNumber} · incident{" "}
                          {new Date(c.incidentDate).toLocaleDateString()} ·
                          claimed {c.claimedAmount}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          className={`ring-1 ring-inset ${statusTone(c.status)}`}
                        >
                          {c.status.replace(/_/g, " ")}
                        </Badge>
                        {expanded ? (
                          <ChevronUp className="h-4 w-4 text-stone-400" aria-hidden />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-stone-400" aria-hidden />
                        )}
                      </div>
                    </button>
                    {expanded && <ClaimDetail id={c.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
