/**
 * MyQuotes.tsx — R3 batch 5 (2026-10-01, R3-b5)
 * Member quote cart (route /my-quotes).
 * BINDING: REAL — memberQuotes.myQuoteCart / addToQuoteCart /
 * removeQuoteItem / clearQuoteCart (server/routers/memberQuotes.ts,
 * protectedProcedure; every row is bound server-side to the caller's
 * resolved customers.id — this page NEVER sends a customerId). Product
 * picker source: productCatalogApi.listProducts (active catalog products).
 * NOT_FOUND/FORBIDDEN → null is only a defensive fallback for older
 * deployments; loading/error/empty states are disclosed. No data is
 * fabricated. Binding/payment of a quote is not offered here (funds wave
 * deferred) — disclosed on the page.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShoppingCart, Trash2 } from "lucide-react";
import { memberQuotesApi } from "@/services/memberQuotesApi";
import { productCatalogApi } from "@/services/memberPoliciesApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

export default function MyQuotes() {
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState<number | null>(null);
  const [sumInsured, setSumInsured] = useState("");
  const [durationMonths, setDurationMonths] = useState("12");
  const [actionError, setActionError] = useState<string | null>(null);

  const cartQuery = useQuery({
    queryKey: ["memberQuotes", "myQuoteCart"],
    queryFn: () => memberQuotesApi.myQuoteCart(),
    retry: 1,
  });

  const productsQuery = useQuery({
    queryKey: ["productCatalog", "listProducts", "quote-cart"],
    queryFn: () => productCatalogApi.listProducts({ limit: 50 }),
    retry: 1,
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["memberQuotes"] });

  const addMutation = useMutation({
    mutationFn: () =>
      memberQuotesApi.addToQuoteCart({
        productId: productId!,
        sumInsured: Number(sumInsured),
        durationMonths: Number(durationMonths),
      }),
    onSuccess: () => {
      setActionError(null);
      setSumInsured("");
      void invalidate();
    },
    onError: error => {
      // Honest failure surface: show the server's exact reason.
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (quoteId: number) =>
      memberQuotesApi.removeQuoteItem({ quoteId }),
    onSuccess: () => {
      setActionError(null);
      void invalidate();
    },
    onError: error => {
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  const clearMutation = useMutation({
    mutationFn: () => memberQuotesApi.clearQuoteCart(),
    onSuccess: () => {
      setActionError(null);
      void invalidate();
    },
    onError: error => {
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  const currency = cartQuery.data?.currency ?? "NGN";

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          My Quotes
        </h1>
        <p className="text-sm text-stone-500">
          Products you are comparing before purchase. A quote is an estimate
          only — cover starts when a policy is bound by staff; online payment
          is not available here yet.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <ShoppingCart className="h-5 w-5 text-amber-600" aria-hidden />
            Add a product to compare
          </CardTitle>
        </CardHeader>
        <CardContent>
          {productsQuery.isLoading ? (
            <LoadingState label="Loading products…" />
          ) : productsQuery.isError ? (
            <ErrorState
              message="We couldn’t load the product catalog. Please try again."
              onRetry={() => productsQuery.refetch()}
            />
          ) : productsQuery.data === null ? (
            <UnavailableState feature="Product catalog" />
          ) : (productsQuery.data?.data ?? []).length === 0 ? (
            <EmptyState
              title="No products available"
              hint="The catalog has no active products right now."
            />
          ) : (
            <form
              className="grid grid-cols-1 items-end gap-3 md:grid-cols-4"
              onSubmit={e => {
                e.preventDefault();
                setActionError(null);
                addMutation.mutate();
              }}
            >
              <label className="text-sm text-stone-600 md:col-span-2">
                Product
                <select
                  required
                  className="mt-1 w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm"
                  value={productId ?? ""}
                  onChange={e => setProductId(Number(e.target.value))}
                >
                  <option value="" disabled>
                    Select a product
                  </option>
                  {productsQuery.data!.data.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.coverageType}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-stone-600">
                Sum insured ({currency})
                <input
                  required
                  type="number"
                  min="1"
                  step="0.01"
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  value={sumInsured}
                  onChange={e => setSumInsured(e.target.value)}
                />
              </label>
              <label className="text-sm text-stone-600">
                Duration (months)
                <input
                  required
                  type="number"
                  min="1"
                  max="120"
                  className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  value={durationMonths}
                  onChange={e => setDurationMonths(e.target.value)}
                />
              </label>
              <button
                type="submit"
                disabled={addMutation.isPending || productId == null}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 md:col-span-4 md:justify-self-start"
              >
                {addMutation.isPending ? "Adding…" : "Add to quotes"}
              </button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg text-stone-800">Your quotes</CardTitle>
          {(cartQuery.data?.count ?? 0) > 0 && (
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                clearMutation.mutate();
              }}
              disabled={clearMutation.isPending}
              className="text-sm text-stone-500 hover:text-red-600"
            >
              Clear all
            </button>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          {cartQuery.isLoading ? (
            <LoadingState label="Loading your quotes…" />
          ) : cartQuery.isError ? (
            <ErrorState
              message="We couldn’t load your quotes. Please try again."
              onRetry={() => cartQuery.refetch()}
            />
          ) : cartQuery.data === null ? (
            <UnavailableState feature="Quote cart" />
          ) : (cartQuery.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="Your quote cart is empty"
              hint="Add a product above to compare premiums."
            />
          ) : (
            <>
              <ul className="divide-y divide-stone-100">
                {cartQuery.data!.items.map(q => (
                  <li
                    key={q.id}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-stone-900">
                        {q.productName ?? `Product #${q.productId}`}
                      </p>
                      <p className="text-xs text-stone-500">
                        Sum insured {q.sumInsured ?? "—"} ·{" "}
                        {q.durationMonths ?? "—"} months
                        {q.validUntil &&
                          ` · valid until ${new Date(q.validUntil).toLocaleDateString()}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-semibold text-stone-900">
                        {q.totalPayable ?? "—"} {currency}
                      </p>
                      <button
                        type="button"
                        aria-label={`Remove quote ${q.id}`}
                        className="rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600"
                        disabled={removeMutation.isPending}
                        onClick={() => removeMutation.mutate(q.id)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="border-t border-stone-100 pt-3 text-right text-sm font-semibold text-stone-900">
                Total premium: {cartQuery.data!.totalPremium} {currency} (
                {cartQuery.data!.count}{" "}
                {cartQuery.data!.count === 1 ? "quote" : "quotes"})
              </p>
            </>
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
