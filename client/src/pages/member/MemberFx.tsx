/**
 * MemberFx.tsx — /member/fx (W7-B10, 2026-10-06)
 *
 * Wired to the REAL read-only member FX surface
 * (server/routers/memberFxRates.ts):
 *   - memberFxRates.rates      (published EUR-base rate book; empty map +
 *                               null timestamp when none — never fabricated)
 *   - memberFxRates.convert    (EUR-base conversion over the stored book;
 *                               fails loud PRECONDITION_FAILED on missing/
 *                               malformed book — surfaced honestly)
 *   - memberFxRates.currencies (codes derived from the stored book)
 *   - memberFxRates.historical (real Frankfurter/ECB time-series)
 *
 * READ-ONLY: the base router's updateRates/refresh mutations are broken
 * authz and flagged for the funds wave — they are never exposed or called
 * here, so no rate-editing UI exists.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-NG") : "—";

export default function MemberFx() {
  const [from, setFrom] = useState<string>("NGN");
  const [to, setTo] = useState<string>("USD");
  const [amount, setAmount] = useState<string>("1000");
  const [convertReq, setConvertReq] = useState<{
    from: string;
    to: string;
    amount: number;
  } | null>(null);
  const [histBase, setHistBase] = useState<string>("NGN");
  const [histTarget, setHistTarget] = useState<string>("USD");
  const [histReq, setHistReq] = useState<{
    base: string;
    target: string;
    days: number;
  } | null>(null);

  const ratesQuery = trpc.memberFxRates.rates.useQuery(undefined, {
    retry: false,
  });
  const currenciesQuery = trpc.memberFxRates.currencies.useQuery(undefined, {
    retry: false,
  });
  const convertQuery = trpc.memberFxRates.convert.useQuery(
    convertReq ?? { from: "NGN", to: "USD", amount: 1 },
    { enabled: convertReq !== null, retry: false }
  );
  const historicalQuery = trpc.memberFxRates.historical.useQuery(
    histReq ?? { base: "NGN", target: "USD", days: 30 },
    { enabled: histReq !== null, retry: false }
  );

  const rates = ratesQuery.data?.rates ?? {};
  const rateEntries = Object.entries(rates).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const currencies = currenciesQuery.data?.currencies ?? [];
  const codes = currencies.map((c) => c.code);

  const onConvert = () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0 || !from || !to) return;
    setConvertReq({ from, to, amount: n });
  };
  const onLoadHistorical = () => {
    if (!histBase || !histTarget) return;
    setHistReq({ base: histBase, target: histTarget, days: 30 });
  };

  const CurrencySelect = ({
    id,
    value,
    onChange,
  }: {
    id: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id}>
        <SelectValue placeholder="Currency" />
      </SelectTrigger>
      <SelectContent>
        {(codes.length > 0 ? codes : ["EUR", "NGN", "USD"]).map((c) => (
          <SelectItem key={c} value={c}>
            {c}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Exchange Rates"
          description="The published rate book (units per 1 EUR). When no rates have been published the table is empty — we never show fixture rates."
        >
          {ratesQuery.isLoading ? (
            <MemberLoading label="Loading exchange rates" />
          ) : ratesQuery.isError ? (
            <MemberError message={ratesQuery.error.message} />
          ) : rateEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No exchange rates have been published yet.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-3">
                Base: {ratesQuery.data?.baseCurrency ?? "EUR"} · Last updated:{" "}
                {fmtDate(ratesQuery.data?.lastUpdated)}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Currency</TableHead>
                    <TableHead>Rate (per 1 EUR)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rateEntries.map(([code, rate]) => (
                    <TableRow key={code}>
                      <TableCell className="font-medium">{code}</TableCell>
                      <TableCell>{Number(rate).toFixed(4)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </MemberSection>

        <MemberSection
          title="Convert"
          description="Conversion over the published rate book. If no usable rates are stored the error is shown honestly."
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="fx-from">From</Label>
              <CurrencySelect id="fx-from" value={from} onChange={setFrom} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-to">To</Label>
              <CurrencySelect id="fx-to" value={to} onChange={setTo} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-amount">Amount</Label>
              <Input
                id="fx-amount"
                type="number"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <Button className="mt-4" onClick={onConvert}>
            Convert
          </Button>
          {convertReq ? (
            <div className="mt-4" data-testid="convert-result">
              {convertQuery.isLoading ? (
                <MemberLoading label="Converting" />
              ) : convertQuery.isError ? (
                <MemberError message={convertQuery.error.message} />
              ) : convertQuery.data ? (
                <p className="text-sm">
                  <Badge variant="secondary">
                    {convertQuery.data.amount} {convertQuery.data.from} ={" "}
                    {convertQuery.data.convertedAmount.toFixed(2)}{" "}
                    {convertQuery.data.to}
                  </Badge>{" "}
                  <span className="text-muted-foreground">
                    rate {convertQuery.data.rate.toFixed(6)}
                  </span>
                </p>
              ) : null}
            </div>
          ) : null}
        </MemberSection>

        <MemberSection
          title="Historical Rates"
          description="Real ECB time-series (via Frankfurter) for the last 30 days."
        >
          <div className="grid gap-4 sm:grid-cols-2 max-w-md">
            <div className="space-y-2">
              <Label htmlFor="fx-hist-base">Base</Label>
              <CurrencySelect
                id="fx-hist-base"
                value={histBase}
                onChange={setHistBase}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="fx-hist-target">Target</Label>
              <CurrencySelect
                id="fx-hist-target"
                value={histTarget}
                onChange={setHistTarget}
              />
            </div>
          </div>
          <Button className="mt-4" variant="outline" onClick={onLoadHistorical}>
            Load history
          </Button>
          {histReq ? (
            <div className="mt-4">
              {historicalQuery.isLoading ? (
                <MemberLoading label="Loading historical rates" />
              ) : historicalQuery.isError ? (
                <MemberError message={historicalQuery.error.message} />
              ) : (historicalQuery.data?.timeseries ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground py-4">
                  No historical data returned for this pair.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>
                        {historicalQuery.data?.base} →{" "}
                        {historicalQuery.data?.target}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(historicalQuery.data?.timeseries ?? []).map((t) => (
                      <TableRow key={t.date}>
                        <TableCell>{t.date}</TableCell>
                        <TableCell>{Number(t.rate).toFixed(4)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          ) : null}
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
