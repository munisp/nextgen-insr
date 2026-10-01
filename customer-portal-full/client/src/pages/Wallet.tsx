/**
 * Wallet.tsx — R3 batch 1 (2026-10-01, R3)
 * Member wallet view bound to the MONOLITH router `customerWalletSystem`
 * (server/routers/customerWalletSystem.ts — already session-scoped and
 * member-safe; wallet owner resolved server-side via customers.keycloakSub).
 *
 * Honesty contract (funds path = fail-closed):
 *  - Every naira figure rendered here comes from a live response — balance
 *    is the server-computed settled-only figure, transaction amounts are the
 *    stored numeric strings rendered verbatim. Nothing is fabricated.
 *  - topUp credits ONLY against a verified settled rail leg (server-side
 *    PAY-4 check). The form therefore asks for the real rail reference from
 *    an actual bank transfer; there is no "simulate" path. If the rail flow
 *    isn't configured on this deployment (no settled reference can exist),
 *    the disclosed notice below is shown instead of a fake top-up.
 *  - topUp responses (success / transactionId / idempotent replay) and
 *    failures (PRECONDITION_FAILED, CONFLICT, any server message) are
 *    surfaced exactly as returned — never a fake success.
 *
 * NOT_FOUND/FORBIDDEN → null remains only as a defensive fallback for older
 * deployments (disclosed UnavailableState).
 */
import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  CheckCircle2,
  Wallet as WalletIcon,
} from "lucide-react";
import { walletApi, type WalletTopUpResult } from "@/services/walletApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

/** Render a stored numeric string / server number exactly as returned. */
function formatNaira(amount: string | number): string {
  const n = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(n)) return String(amount); // honest fallback, never invented
  return n.toLocaleString("en-NG", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusTone(status: string): string {
  switch (status) {
    case "success":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "pending":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    default:
      return "bg-red-50 text-red-700 ring-red-600/20";
  }
}

/** Client-side idempotency key for one logical top-up request (8..64 chars per server schema). */
function newIdempotencyKey(): string {
  return `wtop-${crypto.randomUUID()}`;
}

export default function Wallet() {
  const queryClient = useQueryClient();

  const balance = useQuery({
    queryKey: ["r3", "wallet", "balance"],
    queryFn: () => walletApi.getBalance(),
    retry: 1,
  });
  const transactions = useQuery({
    queryKey: ["r3", "wallet", "transactions"],
    queryFn: () => walletApi.getTransactions({ limit: 50 }),
    retry: 1,
  });

  // Top-up form — real rail flow only. The reference must come from an
  // actual settled bank transfer; this client never invents one.
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState("");
  const [railReference, setRailReference] = useState("");
  // One key per logical request: retries of the same submission reuse it so
  // the server idempotency layer binds one durable credit to this attempt.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [result, setResult] = useState<WalletTopUpResult | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const topUp = useMutation({
    mutationFn: () =>
      walletApi.topUp({
        amount: Number(amount),
        source: source.trim(),
        railReference: railReference.trim(),
        idempotencyKey,
      }),
    onSuccess: data => {
      setFailure(null);
      setResult(data); // real rail response, rendered verbatim
      queryClient.invalidateQueries({ queryKey: ["r3", "wallet"] });
    },
    onError: error => {
      setResult(null);
      // Honest error path: surface the server's exact refusal (e.g.
      // PRECONDITION_FAILED when the rail leg isn't settled, CONFLICT on
      // idempotency mismatch) — never converted into a success.
      setFailure(
        error instanceof Error
          ? error.message
          : "Top-up failed for an unknown reason."
      );
    },
  });

  const parsedAmount = Number(amount);
  const formValid =
    Number.isFinite(parsedAmount) &&
    parsedAmount > 0 &&
    source.trim().length >= 1 &&
    railReference.trim().length >= 8 &&
    railReference.trim().length <= 64;

  const submitTopUp = (e: FormEvent) => {
    e.preventDefault();
    if (!formValid || topUp.isPending) return;
    topUp.mutate();
  };

  const resetForm = () => {
    setAmount("");
    setSource("");
    setRailReference("");
    setResult(null);
    setFailure(null);
    setIdempotencyKey(newIdempotencyKey()); // new logical request → new key
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Wallet
        </h1>
        <p className="text-sm text-stone-500">
          Your wallet balance and transaction history, as recorded on your
          account. Only settled payments count toward the balance.
        </p>
      </header>

      {/* Balance — live server-computed figure only */}
      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <WalletIcon className="h-5 w-5 text-amber-600" aria-hidden />
            Balance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balance.isLoading ? (
            <LoadingState label="Loading your balance…" />
          ) : balance.isError ? (
            <ErrorState
              message="We couldn’t load your wallet balance. Please try again."
              onRetry={() => balance.refetch()}
            />
          ) : balance.data === null ? (
            <UnavailableState feature="Wallet" />
          ) : (
            <p className="text-3xl font-bold tracking-tight text-stone-900">
              ₦{formatNaira(balance.data!.balance)}
              <span className="ml-2 text-sm font-normal text-stone-500">
                {balance.data!.currency}
              </span>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Top-up — real rail flow only */}
      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="text-lg text-stone-800">
            Top up your wallet
          </CardTitle>
        </CardHeader>
        <CardContent>
          {result ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-6 py-8">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" aria-hidden />
                <p className="text-sm font-medium text-emerald-800">
                  Top-up credited{result.idempotent ? " (already processed)" : ""}
                </p>
              </div>
              <dl className="space-y-1 text-sm text-stone-700">
                <div className="flex gap-2">
                  <dt className="text-stone-500">Amount:</dt>
                  <dd className="font-medium">₦{formatNaira(result.amount)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-stone-500">Transaction reference:</dt>
                  <dd className="font-mono">{result.transactionId}</dd>
                </div>
              </dl>
              <Button variant="outline" size="sm" onClick={resetForm}>
                Make another top-up
              </Button>
            </div>
          ) : (
            <form onSubmit={submitTopUp} className="space-y-4">
              {/* Disclosed precondition — top-up is only possible against a
                  settled inbound transfer (server enforces fail-closed). */}
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                <AlertCircle
                  className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
                  aria-hidden
                />
                <p className="text-xs text-stone-600">
                  Top-up requires a settled bank transfer reference. First
                  transfer funds to your designated wallet account; once the
                  transfer is confirmed, enter its payment reference below. If
                  bank transfers aren’t enabled for your account, top-up is
                  temporarily unavailable — this form cannot create a payment
                  on its own.
                </p>
              </div>

              {failure && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
                  <p className="text-sm text-red-700">{failure}</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="wallet-topup-amount">Amount (₦)</Label>
                  <Input
                    id="wallet-topup-amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wallet-topup-source">Funding source</Label>
                  <Input
                    id="wallet-topup-source"
                    placeholder="e.g. GTBank transfer"
                    value={source}
                    onChange={e => setSource(e.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wallet-topup-ref">
                  Bank transfer reference
                </Label>
                <Input
                  id="wallet-topup-ref"
                  placeholder="Reference from your confirmed transfer"
                  value={railReference}
                  onChange={e => setRailReference(e.target.value)}
                  required
                  minLength={8}
                  maxLength={64}
                />
                <p className="text-xs text-stone-500">
                  The amount must match the confirmed transfer exactly,
                  otherwise the top-up is refused.
                </p>
              </div>
              <Button
                type="submit"
                disabled={!formValid || topUp.isPending}
                className="bg-amber-600 text-white hover:bg-amber-700"
              >
                {topUp.isPending ? "Verifying transfer…" : "Top up"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {/* Transaction history — full history, every status shown honestly */}
      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="text-lg text-stone-800">
            Transaction history
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
            <UnavailableState feature="Wallet transactions" />
          ) : (transactions.data?.transactions ?? []).length === 0 ? (
            <EmptyState
              title="No transactions yet"
              hint="Wallet top-ups and payments you make will appear here."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {transactions.data!.transactions.map(tx => {
                const credit = tx.type === "Cash In";
                return (
                  <li
                    key={tx.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {credit ? (
                        <ArrowDownLeft
                          className="h-4 w-4 shrink-0 text-emerald-600"
                          aria-hidden
                        />
                      ) : (
                        <ArrowUpRight
                          className="h-4 w-4 shrink-0 text-stone-500"
                          aria-hidden
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-stone-800">
                          {tx.type}
                          {tx.channel ? ` · ${tx.channel}` : ""}
                        </p>
                        <p className="truncate font-mono text-xs text-stone-500">
                          {tx.ref}
                        </p>
                        {tx.failureReason && (
                          <p className="text-xs text-red-600">
                            {tx.failureReason}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <p
                        className={`text-sm font-semibold ${
                          credit ? "text-emerald-700" : "text-stone-900"
                        }`}
                      >
                        {credit ? "+" : "−"}
                        {tx.currency === "NGN" ? "₦" : `${tx.currency} `}
                        {formatNaira(tx.amount)}
                      </p>
                      <div className="flex items-center gap-2">
                        <Badge
                          className={`ring-1 ring-inset ${statusTone(tx.status)}`}
                        >
                          {tx.status}
                        </Badge>
                        <span className="text-xs text-stone-400">
                          {tx.createdAt
                            ? new Date(tx.createdAt).toLocaleDateString("en-NG")
                            : ""}
                        </span>
                      </div>
                    </div>
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
