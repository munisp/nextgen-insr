/**
 * MyDisputes.tsx — R3 batch 2 (2026-10-01, R3-b2)
 * Member view of the caller's own disputes on the monolith (route
 * /my-disputes), plus the file-dispute form (worklist: the form lives in the
 * list page; on success it navigates to the new dispute's detail page).
 * BINDING: REAL — memberDisputes.myDisputes / memberDisputes.fileDispute
 * (server/routers/memberDisputes.ts, protectedProcedure, agentId-scoped,
 * transaction ownership verified server-side).
 *
 * Disputes are GREENFIELD in the PWA (no pre-existing page). NOT_FOUND/
 * FORBIDDEN → null remains only as a defensive fallback for older
 * deployments; empty/error states are disclosed. The fabricated
 * customerDisputePortal.getStats constants are never rendered. Failure
 * reasons (e.g. "Transaction not found") are surfaced verbatim — no
 * simulated success.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Gavel, FilePlus2, ChevronRight } from "lucide-react";
import { memberDisputesApi } from "@/services/memberDisputesApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

// Member-facing filter subset — mirrors DISPUTE_STATUSES in
// server/routers/memberDisputes.ts.
const STATUS_FILTERS = [
  "open",
  "investigating",
  "escalated",
  "resolved",
  "closed",
] as const;

function statusTone(status: string): string {
  switch (status) {
    case "resolved":
    case "closed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "open":
    case "investigating":
    case "escalated":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

function FileDisputeForm() {
  const [, navigate] = useLocation();
  const [transactionId, setTransactionId] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [amount, setAmount] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const fileMutation = useMutation({
    mutationFn: () =>
      memberDisputesApi.fileDispute({
        transactionId: Number(transactionId),
        reason: reason.trim(),
        description: description.trim(),
        amount: Number(amount),
      }),
    onSuccess: result => {
      if (result) navigate(`/my-disputes/${result.id}`);
    },
    onError: error => {
      // Honest failure surface: show the server's exact reason (e.g. the
      // disputed transaction is not the caller's → "Transaction not found").
      setSubmitError(
        error instanceof Error ? error.message : "Dispute submission failed"
      );
    },
  });

  const canSubmit =
    Number(transactionId) > 0 &&
    reason.trim().length > 0 &&
    description.trim().length > 0 &&
    Number(amount) > 0 &&
    !fileMutation.isPending;

  return (
    <Card className="border-stone-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
          <FilePlus2 className="h-5 w-5 text-amber-600" aria-hidden />
          File a dispute
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={e => {
            e.preventDefault();
            setSubmitError(null);
            if (canSubmit) fileMutation.mutate();
          }}
        >
          <p className="text-xs text-stone-500">
            Enter the ID of one of your own transactions. Ownership is verified
            when you submit — you can only dispute transactions that belong to
            you.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block text-stone-600">Transaction ID</span>
              <input
                type="number"
                min={1}
                value={transactionId}
                onChange={e => setTransactionId(e.target.value)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                placeholder="e.g. 10234"
                required
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-stone-600">Disputed amount</span>
              <input
                type="number"
                min={0.01}
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                placeholder="0.00"
                required
              />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block text-stone-600">Reason</span>
            <input
              type="text"
              maxLength={256}
              value={reason}
              onChange={e => setReason(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              placeholder="Short summary, e.g. Double charge"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-stone-600">Description</span>
            <textarea
              maxLength={4000}
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
              placeholder="Describe what happened…"
              required
            />
          </label>
          {submitError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
              {submitError}
            </p>
          )}
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {fileMutation.isPending ? "Submitting…" : "Submit dispute"}
          </button>
        </form>
      </CardContent>
    </Card>
  );
}

export default function MyDisputes() {
  const [status, setStatus] = useState<string | undefined>(undefined);
  const [showForm, setShowForm] = useState(false);
  const queryClient = useQueryClient();

  const disputesQuery = useQuery({
    queryKey: ["memberDisputes", "myDisputes", status],
    queryFn: () => memberDisputesApi.myDisputes({ status, limit: 50 }),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            My Disputes
          </h1>
          <p className="text-sm text-stone-500">
            Disputes you have filed on your own transactions, with their live
            status.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(v => !v)}
          className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
        >
          <FilePlus2 className="h-4 w-4" aria-hidden />
          {showForm ? "Hide form" : "File a dispute"}
        </button>
      </header>

      {showForm && (
        <div
          onSubmitCapture={() => {
            // Refresh the list after any form submit attempt settles; the
            // success path navigates to the detail page anyway.
            void queryClient.invalidateQueries({
              queryKey: ["memberDisputes", "myDisputes"],
            });
          }}
        >
          <FileDisputeForm />
        </div>
      )}

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
            {s}
          </button>
        ))}
      </div>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Gavel className="h-5 w-5 text-amber-600" aria-hidden />
            Your disputes
          </CardTitle>
        </CardHeader>
        <CardContent>
          {disputesQuery.isLoading ? (
            <LoadingState label="Loading your disputes…" />
          ) : disputesQuery.isError ? (
            <ErrorState
              message="We couldn’t load your disputes. Please try again."
              onRetry={() => disputesQuery.refetch()}
            />
          ) : disputesQuery.data === null ? (
            <UnavailableState feature="Disputes" />
          ) : (disputesQuery.data?.disputes ?? []).length === 0 ? (
            <EmptyState
              title="No disputes found"
              hint={
                status
                  ? "No disputes match this status filter."
                  : "Disputes you file on your transactions will appear here."
              }
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {disputesQuery.data!.disputes.map(d => (
                <li key={d.id}>
                  <Link
                    href={`/my-disputes/${d.id}`}
                    className="flex items-center justify-between gap-4 py-3 text-left"
                  >
                    <div>
                      <p className="text-sm font-medium text-stone-900">
                        {d.ref}
                        {d.reason ? ` · ${d.reason}` : ""}
                      </p>
                      <p className="text-xs text-stone-500">
                        {d.transactionRef
                          ? `Transaction ${d.transactionRef} · `
                          : ""}
                        filed {new Date(d.createdAt).toLocaleDateString()}
                        {d.amount ? ` · ${d.amount}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        className={`ring-1 ring-inset ${statusTone(d.status)}`}
                      >
                        {d.status}
                      </Badge>
                      <ChevronRight
                        className="h-4 w-4 text-stone-400"
                        aria-hidden
                      />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
