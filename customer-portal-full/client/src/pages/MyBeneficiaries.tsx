/**
 * MyBeneficiaries.tsx — R3 batch 5 (2026-10-01, R3-b5)
 * Member view of beneficiaries on the caller's OWN policies
 * (route /my-beneficiaries).
 * BINDING: REAL — memberBeneficiaries.myBeneficiaries / upsertBeneficiary /
 * removeBeneficiary (server/routers/memberBeneficiaries.ts,
 * protectedProcedure, dual-space ownership-checked). Policy picker source:
 * memberPolicies.myPolicies (caller-scoped). NOT_FOUND/FORBIDDEN → null is
 * only a defensive fallback for older deployments; loading/error/empty
 * states are disclosed. No data is fabricated. Beneficiary nationalId
 * arrives masked from the server and is displayed as-is.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, UserPlus, Trash2 } from "lucide-react";
import { memberBeneficiariesApi } from "@/services/memberLifecycleApi";
import { memberPoliciesApi } from "@/services/memberPoliciesApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

export default function MyBeneficiaries() {
  const queryClient = useQueryClient();
  const [policyId, setPolicyId] = useState<number | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [percentage, setPercentage] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [guardianName, setGuardianName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const policiesQuery = useQuery({
    queryKey: ["memberPolicies", "myPolicies", "beneficiary-picker"],
    queryFn: () => memberPoliciesApi.myPolicies({ limit: 100 }),
    retry: 1,
  });

  const selectedPolicyId =
    policyId ?? policiesQuery.data?.policies[0]?.id ?? null;

  const beneficiariesQuery = useQuery({
    queryKey: ["memberBeneficiaries", "myBeneficiaries", selectedPolicyId],
    queryFn: () =>
      memberBeneficiariesApi.myBeneficiaries({ policyId: selectedPolicyId! }),
    enabled: selectedPolicyId != null,
    retry: 1,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: ["memberBeneficiaries", "myBeneficiaries", selectedPolicyId],
    });

  const addMutation = useMutation({
    mutationFn: () =>
      memberBeneficiariesApi.upsertBeneficiary({
        policyId: selectedPolicyId!,
        name: name.trim(),
        relationship: relationship.trim(),
        percentage: Number(percentage),
        dateOfBirth: dateOfBirth || undefined,
        guardianName: guardianName.trim() || undefined,
      }),
    onSuccess: () => {
      setActionError(null);
      setShowForm(false);
      setName("");
      setRelationship("");
      setPercentage("");
      setDateOfBirth("");
      setGuardianName("");
      void invalidate();
    },
    onError: error => {
      // Honest failure surface: show the server's exact reason (e.g. the
      // 100%-sum or guardian validation message).
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (beneficiaryId: number) =>
      memberBeneficiariesApi.removeBeneficiary({
        policyId: selectedPolicyId!,
        beneficiaryId,
      }),
    onSuccess: () => {
      setActionError(null);
      void invalidate();
    },
    onError: error => {
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          My Beneficiaries
        </h1>
        <p className="text-sm text-stone-500">
          The people nominated to receive benefits on each of your policies.
          Shares across a policy may not exceed 100%.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Users className="h-5 w-5 text-amber-600" aria-hidden />
            Beneficiaries by policy
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {policiesQuery.isLoading ? (
            <LoadingState label="Loading your policies…" />
          ) : policiesQuery.isError ? (
            <ErrorState
              message="We couldn’t load your policies. Please try again."
              onRetry={() => policiesQuery.refetch()}
            />
          ) : policiesQuery.data === null ? (
            <UnavailableState feature="Beneficiaries" />
          ) : (policiesQuery.data?.policies ?? []).length === 0 ? (
            <EmptyState
              title="No policies yet"
              hint="Beneficiaries can be nominated once you have a policy."
            />
          ) : (
            <>
              <label className="block text-sm text-stone-600">
                Policy
                <select
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                  value={selectedPolicyId ?? ""}
                  onChange={e => setPolicyId(Number(e.target.value))}
                >
                  {policiesQuery.data!.policies.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.policyNumber} · {p.productName ?? p.coverageType} ·{" "}
                      {p.status}
                    </option>
                  ))}
                </select>
              </label>

              {beneficiariesQuery.isLoading ? (
                <LoadingState label="Loading beneficiaries…" />
              ) : beneficiariesQuery.isError ? (
                <ErrorState
                  message="We couldn’t load beneficiaries for this policy. Please try again."
                  onRetry={() => beneficiariesQuery.refetch()}
                />
              ) : beneficiariesQuery.data === null ? (
                <UnavailableState feature="Beneficiaries" />
              ) : (
                <>
                  {(beneficiariesQuery.data?.items ?? []).length === 0 ? (
                    <EmptyState
                      title="No beneficiaries on this policy"
                      hint="Nominate someone below."
                    />
                  ) : (
                    <ul className="divide-y divide-stone-100">
                      {beneficiariesQuery.data!.items.map(b => (
                        <li
                          key={b.id}
                          className="flex items-center justify-between gap-4 py-3"
                        >
                          <div>
                            <p className="text-sm font-medium text-stone-900">
                              {b.name} · {b.relationship}
                            </p>
                            <p className="text-xs text-stone-500">
                              {Number(b.percentage)}% share
                              {b.dateOfBirth &&
                                ` · born ${new Date(b.dateOfBirth).toLocaleDateString()}`}
                              {b.isMinor &&
                                b.guardianName &&
                                ` · guardian ${b.guardianName}`}
                              {b.nationalId && ` · ID ${b.nationalId}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-2">
                            {b.isMinor ? (
                              <Badge className="bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20">
                                minor
                              </Badge>
                            ) : null}
                            <button
                              type="button"
                              aria-label={`Remove ${b.name}`}
                              className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
                              disabled={removeMutation.isPending}
                              onClick={() => removeMutation.mutate(b.id)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}

                  {actionError && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                      {actionError}
                    </p>
                  )}

                  {showForm ? (
                    <form
                      className="space-y-3 rounded-lg border border-stone-200 p-4"
                      onSubmit={e => {
                        e.preventDefault();
                        setActionError(null);
                        addMutation.mutate();
                      }}
                    >
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <label className="text-sm text-stone-600">
                          Full name
                          <input
                            required
                            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                            value={name}
                            onChange={e => setName(e.target.value)}
                          />
                        </label>
                        <label className="text-sm text-stone-600">
                          Relationship
                          <input
                            required
                            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                            value={relationship}
                            onChange={e => setRelationship(e.target.value)}
                            placeholder="spouse, child, parent…"
                          />
                        </label>
                        <label className="text-sm text-stone-600">
                          Share (%)
                          <input
                            required
                            type="number"
                            min="0.01"
                            max="100"
                            step="0.01"
                            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                            value={percentage}
                            onChange={e => setPercentage(e.target.value)}
                          />
                        </label>
                        <label className="text-sm text-stone-600">
                          Date of birth (optional)
                          <input
                            type="date"
                            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                            value={dateOfBirth}
                            onChange={e => setDateOfBirth(e.target.value)}
                          />
                        </label>
                        <label className="text-sm text-stone-600 md:col-span-2">
                          Guardian name (required if the beneficiary is a minor)
                          <input
                            className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                            value={guardianName}
                            onChange={e => setGuardianName(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="submit"
                          disabled={addMutation.isPending}
                          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {addMutation.isPending ? "Saving…" : "Save beneficiary"}
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
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowForm(true)}
                      className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
                    >
                      <UserPlus className="h-4 w-4" aria-hidden />
                      Add a beneficiary
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
