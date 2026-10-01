/**
 * FileClaim.tsx — R3 batch 1 (2026-10-01, R3)
 * Member claim-filing form on the monolith (route /file-claim).
 * BINDING: REAL — the policy picker is fed by memberClaims.myPoliciesPicker
 * (the caller's ACTIVE policies only — never a hardcoded/fabricated list) and
 * submission goes to memberClaims.fileClaim, which re-verifies ownership
 * server-side and delegates to the one real implementation
 * (insuranceWorkflows.fileClaim: incident-window checks, sum-insured bound,
 * AB-7 duplicate/doc-hash dedup). Failure reasons (duplicate claim, lapsed
 * window, amount over sum insured) are surfaced verbatim from the server —
 * no simulated success.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FilePlus2 } from "lucide-react";
import { memberClaimsApi } from "@/services/memberClaimsApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

// Member-facing claim-type choices. The server validates shape only
// (claimType is a free varchar(64) column); these labels mirror the NAICOM
// categories used elsewhere in the portal.
const CLAIM_TYPES = [
  "motor_comprehensive",
  "motor_third_party",
  "fire_burglary",
  "marine_cargo",
  "life_death",
  "life_disability",
  "health_outpatient",
  "health_inpatient",
  "professional_indemnity",
  "public_liability",
] as const;

export default function FileClaim() {
  const [, navigate] = useLocation();
  const [policyId, setPolicyId] = useState<number | null>(null);
  const [claimType, setClaimType] = useState<string>("");
  const [incidentDate, setIncidentDate] = useState<string>("");
  const [claimedAmount, setClaimedAmount] = useState<string>("");
  const [incidentDescription, setIncidentDescription] = useState<string>("");
  const [documentRefs, setDocumentRefs] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const picker = useQuery({
    queryKey: ["memberClaims", "myPoliciesPicker"],
    queryFn: () => memberClaimsApi.myPoliciesPicker(),
    retry: 1,
  });

  const fileMutation = useMutation({
    mutationFn: () =>
      memberClaimsApi.fileClaim({
        policyId: policyId!,
        claimType,
        incidentDate,
        claimedAmount: Number(claimedAmount),
        incidentDescription,
        documents: documentRefs
          .split("\n")
          .map(s => s.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      navigate("/my-claims");
    },
    onError: error => {
      // Honest failure surface: show the server's exact reason (duplicate
      // claim, policy not active, amount over sum insured, …).
      setSubmitError(
        error instanceof Error ? error.message : "Claim submission failed"
      );
    },
  });

  const selectedPolicy = picker.data?.policies.find(p => p.id === policyId);
  const canSubmit =
    policyId !== null &&
    claimType !== "" &&
    incidentDate !== "" &&
    Number(claimedAmount) > 0 &&
    incidentDescription.trim().length > 0 &&
    !fileMutation.isPending;

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          File a Claim
        </h1>
        <p className="text-sm text-stone-500">
          Submit a claim against one of your active policies. The amount is
          checked against your policy's sum insured when you submit.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <FilePlus2 className="h-5 w-5 text-amber-600" aria-hidden />
            Claim details
          </CardTitle>
        </CardHeader>
        <CardContent>
          {picker.isLoading ? (
            <LoadingState label="Loading your active policies…" />
          ) : picker.isError ? (
            <ErrorState
              message="We couldn’t load your policies. Please try again."
              onRetry={() => picker.refetch()}
            />
          ) : picker.data === null ? (
            <UnavailableState feature="Claim filing" />
          ) : picker.data.policies.length === 0 ? (
            <EmptyState
              title="No active policies"
              hint="You need an active policy before you can file a claim."
            />
          ) : (
            <form
              className="space-y-5"
              onSubmit={e => {
                e.preventDefault();
                setSubmitError(null);
                fileMutation.mutate();
              }}
            >
              <div>
                <label
                  htmlFor="policy"
                  className="mb-1 block text-sm font-medium text-stone-700"
                >
                  Policy
                </label>
                <select
                  id="policy"
                  required
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  value={policyId ?? ""}
                  onChange={e =>
                    setPolicyId(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="" disabled>
                    Select one of your active policies
                  </option>
                  {picker.data.policies.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.productName} · {p.policyNumber} · sum insured{" "}
                      {p.sumInsured}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="claimType"
                  className="mb-1 block text-sm font-medium text-stone-700"
                >
                  Claim type
                </label>
                <select
                  id="claimType"
                  required
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  value={claimType}
                  onChange={e => setClaimType(e.target.value)}
                >
                  <option value="" disabled>
                    Select a claim type
                  </option>
                  {CLAIM_TYPES.map(t => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="incidentDate"
                  className="mb-1 block text-sm font-medium text-stone-700"
                >
                  Incident date
                </label>
                <input
                  id="incidentDate"
                  type="date"
                  required
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  value={incidentDate}
                  onChange={e => setIncidentDate(e.target.value)}
                />
              </div>

              <div>
                <label
                  htmlFor="claimedAmount"
                  className="mb-1 block text-sm font-medium text-stone-700"
                >
                  Claimed amount
                  {selectedPolicy
                    ? ` (sum insured: ${selectedPolicy.sumInsured})`
                    : ""}
                </label>
                <input
                  id="claimedAmount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  value={claimedAmount}
                  onChange={e => setClaimedAmount(e.target.value)}
                />
              </div>

              <div>
                <label
                  htmlFor="incidentDescription"
                  className="mb-1 block text-sm font-medium text-stone-700"
                >
                  What happened?
                </label>
                <textarea
                  id="incidentDescription"
                  required
                  rows={4}
                  maxLength={4000}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  value={incidentDescription}
                  onChange={e => setIncidentDescription(e.target.value)}
                />
              </div>

              <div>
                <label
                  htmlFor="documents"
                  className="mb-1 block text-sm font-medium text-stone-700"
                >
                  Supporting document references (optional, one per line)
                </label>
                <textarea
                  id="documents"
                  rows={2}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  placeholder="URLs or references from your document uploads"
                  value={documentRefs}
                  onChange={e => setDocumentRefs(e.target.value)}
                />
              </div>

              {submitError && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {submitError}
                </p>
              )}

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {fileMutation.isPending ? "Submitting…" : "Submit claim"}
                </button>
                <Link
                  href="/my-claims"
                  className="text-sm text-stone-500 hover:text-stone-700"
                >
                  Cancel
                </Link>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
