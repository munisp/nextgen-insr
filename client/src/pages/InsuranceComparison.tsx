import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const PRODUCT_TYPES = ["motor", "health", "life", "property", "travel", "marine"] as const;

/**
 * Comparison engine — real quotes from the comparison-engine service
 * (comparisonRouter.getQuotes). The backend FAILS LOUD when the service is
 * unreachable; this page surfaces that error rather than a canned quote.
 */
export default function InsuranceComparison() {
  const [productType, setProductType] = useState<(typeof PRODUCT_TYPES)[number]>("motor");
  const quotes = trpc.comparison.getQuotes.useMutation();

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Insurance Comparison</h1>
      <div className="flex gap-2 items-center">
        <select
          className="border rounded px-3 py-2 bg-background"
          value={productType}
          onChange={e => setProductType(e.target.value as typeof productType)}
        >
          {PRODUCT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <Button
          disabled={quotes.isPending}
          onClick={() => quotes.mutate({ productType, riskData: {} })}
        >
          Get quotes
        </Button>
      </div>
      {quotes.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Quote request failed: {quotes.error.message}
        </CardContent></Card>
      )}
      {quotes.data && (
        <Card><CardContent className="py-4 space-y-2">
          <div className="text-sm text-muted-foreground">
            Session {quotes.data.sessionId} · expires {quotes.data.expiresAt}
          </div>
          {(quotes.data.quotes as unknown[]).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              The comparison service returned no quotes for this product type.
            </p>
          ) : (
            <pre className="text-xs overflow-auto">
              {JSON.stringify(quotes.data.quotes, null, 2)}
            </pre>
          )}
        </CardContent></Card>
      )}
    </div>
  );
}
