/**
 * MyEndorsements.tsx — R3 batch 5 (2026-10-01, R3-b5)
 * Member view of the caller's own policy endorsements (route
 * /my-endorsements).
 * BINDING: REAL — memberEndorsements.myEndorsements / requestEndorsement
 * (server/routers/memberEndorsements.ts, protectedProcedure,
 * ownership-guarded — the source insuranceWorkflows.requestEndorsement IDOR
 * is closed in the member variant). NOT_FOUND/FORBIDDEN → null is only a
 * defensive fallback for older deployments; loading/error/empty states are
 * disclosed. No data is fabricated. An endorsement REQUEST records the
 * proposed changes for staff review — it does not change cover or charge
 * any premium by itself (disclosed on the page).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileEdit, FilePlus2 } from "lucide-react";
import {
  memberEndorsementsApi,
  type EndorsementType,
} from "@/services/memberLifecycleApi";
import { memberPoliciesApi } from "@/services/memberPoliciesApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

const ENDORSEMENT_TYPES: EndorsementType[] = [
  "addition",
  "deletion",
  "modification",
  "extension",
  "reduction",
  "cancellation",
  "reinstatement",
];

export default function MyEndorsements() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [policyId, setPolicyId] = useState<number | null>(null);
  const [type, setType] = useState<EndorsementType>("modification");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [description, setDescription] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const endorsementsQuery = useQuery({
    queryKey: ["memberEndorsements", "myEndorsements"],
    queryFn: () => memberEndorsementsApi.myEndorsements({ limit: 50 }),
    retry: 1,
  });

  const policiesQuery = useQuery({
    queryKey: ["memberPolicies", "myPolicies", "endorsement-picker"],
    queryFn: () => memberPoliciesApi.myPolicies({ limit: 100 }),
    retry: 1,
  });

  const requestMutation = useMutation({
    mutationFn: () =>
      memberEndorsementsApi.requestEndorsement({
        policyId: policyId!,
        type,
        effectiveDate,
        description: description.trim(),
      }),
    onSuccess: () => {
      setActionError(null);
      setShowForm(false);
      setDescription("");
      setEffectiveDate("");
      void queryClient.invalidateQueries({
        queryKey: ["memberEndorsements", "myEndorsements"],
      });
    },
    onError: error => {
      // Honest failure surface: show the server's exact reason.
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            My Endorsements
          </h1>
          <p className="text-sm text-stone-500">
            Requested changes to your policies. An endorsement takes effect
            only after staff review and approval — submitting a request does
            not change your cover or charge any premium.
          </p>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            <FilePlus2 className="h-4 w-4" aria-hidden />
            Request an endorsement
          </button>
        )}
      </header>

      {showForm && (
        <Card className="border-stone-200">
          <CardHeader>
            <CardTitle className="text-lg text-stone-800">
              New endorsement request
            </CardTitle>
          </CardHeader>
          <CardContent>
            {policiesQuery.isLoading ? (
              <LoadingState label="Loading your policies…" />
            ) : policiesQuery.isError ? (
              <ErrorState
                message="We couldn’t load your policies. Please try again."
                onRetry={() => policiesQuery.refetch()}
              />
            ) : policiesQuery.data === null ? (
              <UnavailableState feature="Endorsements" />
            ) : (policiesQuery.data?.policies ?? []).length === 0 ? (
              <EmptyState
                title="No policies yet"
                hint="Endorsements apply to an existing policy."
              />
            ) : (
              <form
                className="space-y-3"
                onSubmit={e => {
                  e.preventDefault();
                  setActionError(null);
                  requestMutation.mutate();
                }}
              >
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="text-sm text-stone-600">
                    Policy
                    <select
                      required
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      value={policyId ?? ""}
                      onChange={e => setPolicyId(Number(e.target.value))}
                    >
                      <option value="" disabled>
                        Select a policy
                      </option>
                      {policiesQuery.data!.policies.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.policyNumber} · {p.productName ?? p.coverageType}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-stone-600">
                    Change type
                    <select
                      className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                      value={type}
                      onChange={e => setType(e.target.value as EndorsementType)}
                    >
                      {ENDORSEMENT_TYPES.map(t => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm text-stone-600">
                    Effective date
                    <input
                      required
                      type="date"
                      className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                      value={effectiveDate}
                      onChange={e => setEffectiveDate(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block text-sm text-stone-600">
                  Describe the change
                  <textarea
                    required
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                  />
                </label>
                {actionError && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                    {actionError}
                  </p>
                )}
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={requestMutation.isPending || policyId == null}
                    className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {requestMutation.isPending
                      ? "Submitting…"
                      : "Submit request"}
                  </button>
                  <button
                    type="button"
                    className="rounded-lg px-4 py-2 text-sm text-stone-600 hover:bg-stone-100"
                    onClick={() => setShowForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <FileEdit className="h-5 w-5 text-amber-600" aria-hidden />
            Your endorsement requests
          </CardTitle>
        </CardHeader>
        <CardContent>
          {endorsementsQuery.isLoading ? (
            <LoadingState label="Loading your endorsements…" />
          ) : endorsementsQuery.isError ? (
            <ErrorState
              message="We couldn’t load your endorsements. Please try again."
              onRetry={() => endorsementsQuery.refetch()}
            />
          ) : endorsementsQuery.data === null ? (
            <UnavailableState feature="Endorsements" />
          ) : (endorsementsQuery.data?.endorsements ?? []).length === 0 ? (
            <EmptyState
              title="No endorsements yet"
              hint="Changes you request on your policies will appear here."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {endorsementsQuery.data!.endorsements.map(e => (
                <li key={e.id} className="py-3">
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-sm font-medium text-stone-900">
                      {e.endorsementNumber} · {e.type}
                    </p>
                    <Badge
                      className={`ring-1 ring-inset ${
                        e.approvedAt
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
                          : "bg-amber-50 text-amber-700 ring-amber-600/20"
                      }`}
                    >
                      {e.approvedAt ? "approved" : "pending review"}
                    </Badge>
                  </div>
                  <p className="text-xs text-stone-500">
                    Policy {e.policyNumber} · effective{" "}
                    {new Date(e.effectiveDate).toLocaleDateString()}
                    {Number(e.premiumAdjustment ?? 0) !== 0 &&
                      ` · proposed premium adjustment ${e.premiumAdjustment} ${e.currency}`}
                  </p>
                  <p className="mt-1 text-sm text-stone-700">{e.description}</p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
