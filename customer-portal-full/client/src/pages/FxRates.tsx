/**
 * FxRates.tsx — R3 batch 3 (2026-10-01, R3-b3)
 * Member FX rates page, bound to the MONOLITH memberFxRates router
 * (server/routers/memberFxRates.ts) via services/memberBillsFxApi.ts.
 *
 * READ-ONLY by design: live rates from the stored EUR-base rate book
 * (systemConfig key `fx_rates`), a converter, and real Frankfurter/ECB
 * history. When the rates table is empty the page renders a disclosed
 * "rates not available yet" state — never fabricated fixture rates. The
 * converter maps PRECONDITION_FAILED to the same disclosed state (the
 * binding resolves it to null). Rate-book mutations (updateRates/refresh)
 * are admin-deferred and never called here.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ArrowLeftRight } from "lucide-react";
import { memberFxRatesApi } from "@/services/memberBillsFxApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

export default function FxRates() {
  const ratesQuery = useQuery({
    queryKey: ["r3-b3", "memberFxRates", "rates"],
    queryFn: () => memberFxRatesApi.rates(),
    retry: 1,
  });

  const historyQuery = useQuery({
    queryKey: ["r3-b3", "memberFxRates", "historical", "NGN", "USD", 30],
    queryFn: () =>
      memberFxRatesApi.historical({ base: "NGN", target: "USD", days: 30 }),
    retry: 1,
  });

  // Converter form state.
  const codes = useMemo(
    () => Object.keys(ratesQuery.data?.rates ?? {}).sort(),
    [ratesQuery.data]
  );
  const [from, setFrom] = useState("USD");
  const [to, setTo] = useState("NGN");
  const [amount, setAmount] = useState("100");
  const [conversionRequest, setConversionRequest] = useState<{
    from: string;
    to: string;
    amount: number;
  } | null>(null);

  const convertQuery = useQuery({
    queryKey: ["r3-b3", "memberFxRates", "convert", conversionRequest],
    queryFn: () =>
      conversionRequest
        ? memberFxRatesApi.convert(conversionRequest)
        : Promise.resolve(null),
    enabled: conversionRequest !== null,
    retry: 0,
  });

  const r = ratesQuery.data;
  const bookEmpty = r !== null && r !== undefined && Object.keys(r.rates).length === 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="flex items-center gap-3">
        <ArrowLeftRight className="h-6 w-6 text-stone-500" aria-hidden />
        <div>
          <h1 className="text-xl font-semibold text-stone-900">FX Rates</h1>
          <p className="text-sm text-stone-500">
            Published exchange rates (base {r?.baseCurrency ?? "EUR"}) and
            converter.
          </p>
        </div>
      </div>

      {ratesQuery.isLoading ? (
        <LoadingState label="Loading rates…" />
      ) : ratesQuery.isError ? (
        <ErrorState
          message="We couldn’t load FX rates. Please try again."
          onRetry={() => ratesQuery.refetch()}
        />
      ) : r === null || r === undefined ? (
        <UnavailableState feature="FX rates" />
      ) : bookEmpty ? (
        // Disclosed unavailable state: no stored rate book — never fixtures.
        <EmptyState
          title="FX rates are not available yet"
          hint="No rates have been published on this deployment. Rates appear here once the rate book is refreshed."
        />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Rates per 1 {r.baseCurrency}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid grid-cols-2 gap-x-8 gap-y-1 sm:grid-cols-3">
                {Object.entries(r.rates)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([code, rate]) => (
                    <li
                      key={code}
                      className="flex items-center justify-between gap-3 py-1 text-sm"
                    >
                      <span className="font-medium text-stone-900">{code}</span>
                      <span className="text-stone-600">{rate}</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-3 text-xs text-stone-500">
                Last updated:{" "}
                {r.lastUpdated ? new Date(r.lastUpdated).toLocaleString() : "—"}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Convert</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                className="flex flex-col gap-3 sm:flex-row"
                onSubmit={e => {
                  e.preventDefault();
                  const amt = Number(amount);
                  if (from && to && Number.isFinite(amt) && amt > 0) {
                    setConversionRequest({ from, to, amount: amt });
                  }
                }}
              >
                <Input
                  type="number"
                  min="0"
                  step="any"
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  aria-label="Amount"
                />
                <select
                  className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm text-stone-900"
                  value={from}
                  onChange={e => setFrom(e.target.value)}
                  aria-label="From currency"
                >
                  {codes.map(code => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <select
                  className="h-9 rounded-md border border-stone-200 bg-white px-3 text-sm text-stone-900"
                  value={to}
                  onChange={e => setTo(e.target.value)}
                  aria-label="To currency"
                >
                  {codes.map(code => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="h-9 rounded-md border border-stone-200 px-4 text-sm font-medium text-stone-700 hover:bg-stone-50"
                >
                  Convert
                </button>
              </form>
              {conversionRequest && (
                <div className="mt-3">
                  {convertQuery.isLoading ? (
                    <LoadingState label="Converting…" />
                  ) : convertQuery.isError ? (
                    <ErrorState message="We couldn’t convert right now. Please try again." />
                  ) : convertQuery.data === null ||
                    convertQuery.data === undefined ? (
                    <EmptyState
                      title="Conversion unavailable"
                      hint="Rates not refreshed yet, or the selected currency is not published."
                    />
                  ) : (
                    <p className="text-sm text-stone-700">
                      {convertQuery.data.amount} {convertQuery.data.from} ={" "}
                      <span className="font-semibold text-stone-900">
                        {convertQuery.data.convertedAmount.toLocaleString()}{" "}
                        {convertQuery.data.to}
                      </span>{" "}
                      <span className="text-xs text-stone-500">
                        (rate {convertQuery.data.rate.toPrecision(6)})
                      </span>
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                NGN/USD — last 30 days (ECB via Frankfurter)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {historyQuery.isLoading ? (
                <LoadingState label="Loading history…" />
              ) : historyQuery.isError ? (
                <ErrorState
                  message="Historical rates are unavailable right now. Please try again."
                  onRetry={() => historyQuery.refetch()}
                />
              ) : historyQuery.data === null || historyQuery.data === undefined ? (
                <UnavailableState feature="Historical FX rates" />
              ) : historyQuery.data.timeseries.length === 0 ? (
                <EmptyState title="No historical rates published for this period" />
              ) : (
                <ul className="divide-y divide-stone-100">
                  {historyQuery.data.timeseries.slice(-10).map(point => (
                    <li
                      key={point.date}
                      className="flex items-center justify-between py-1 text-sm"
                    >
                      <span className="text-stone-600">{point.date}</span>
                      <span className="font-medium text-stone-900">
                        {point.rate}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
