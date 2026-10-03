/**
 * MemberAirtime.tsx — /member/airtime "Airtime & Mobile Money"
 * (W7-B10, 2026-10-06)
 *
 * One combined page for both phone-scoped money rails (documented choice —
 * the two real backends share the same caller-phone scoping and by-status
 * summary shape, and both are strictly read-only, so one page with two
 * sections is clearer than two near-identical pages):
 *
 *   Airtime (server/routers/memberAirtime.ts):
 *     - memberAirtime.myHistory  (paginated, newest first, ALL statuses
 *                                 verbatim incl. failed/pending)
 *     - memberAirtime.mySummary  (per-status counts + volumes over N days)
 *   Mobile money (server/routers/memberMobileMoney.ts):
 *     - memberMobileMoney.myTransactions (paginated, optional provider filter)
 *     - memberMobileMoney.myTransaction  (detail by ref — click a row)
 *     - memberMobileMoney.mySummary      (per-status counts + volumes)
 *     - memberMobileMoney.providers      (registry + honest `configured` flag)
 *
 * ALL READ-ONLY: neither router exposes any mutation (no airtime purchase,
 * no cash-in/out) — those are funds operations deferred to the reviewed
 * funds wave, so no purchase/transfer UI exists here and none is faked.
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

const fmt = (n: number, currency = "NGN") =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(n);

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-NG") : "—";

function statusVariant(status: string | null | undefined) {
  switch (status) {
    case "success":
      return "default" as const;
    case "pending":
    case "pending_provider":
      return "secondary" as const;
    default:
      return "destructive" as const;
  }
}

function SummaryList({
  summary,
}: {
  summary: {
    periodDays: number;
    totalTransactions: number;
    byStatus: Array<{ status: string; count: number; volumeNGN: number }>;
  };
}) {
  if (summary.byStatus.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No transactions in the last {summary.periodDays} days.
      </p>
    );
  }
  return (
    <ul className="text-sm space-y-1" data-testid="summary-list">
      {summary.byStatus.map((s) => (
        <li key={s.status} className="flex items-center gap-2">
          <Badge variant={statusVariant(s.status)}>{s.status}</Badge>
          <span>
            {s.count} transaction{s.count === 1 ? "" : "s"} ·{" "}
            {fmt(s.volumeNGN)}
          </span>
        </li>
      ))}
      <li className="text-muted-foreground pt-1">
        Total: {summary.totalTransactions} over {summary.periodDays} days
      </li>
    </ul>
  );
}

export default function MemberAirtime() {
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<string>("all");

  // ── Airtime ────────────────────────────────────────────────────────────
  const airtimeHistory = trpc.memberAirtime.myHistory.useQuery(
    { limit: 20, offset: 0 },
    { retry: false }
  );
  const airtimeSummary = trpc.memberAirtime.mySummary.useQuery(
    { periodDays: 30 },
    { retry: false }
  );

  // ── Mobile money ───────────────────────────────────────────────────────
  const momoProviders = trpc.memberMobileMoney.providers.useQuery(undefined, {
    retry: false,
  });
  const momoTx = trpc.memberMobileMoney.myTransactions.useQuery(
    {
      limit: 20,
      offset: 0,
      ...(providerFilter !== "all"
        ? {
            provider: providerFilter as
              | "MTN MoMo"
              | "Airtel Money"
              | "Glo Xtra"
              | "9PSB",
          }
        : {}),
    },
    { retry: false }
  );
  const momoSummary = trpc.memberMobileMoney.mySummary.useQuery(
    { periodDays: 30 },
    { retry: false }
  );
  const momoDetail = trpc.memberMobileMoney.myTransaction.useQuery(
    { ref: selectedRef ?? "" },
    { enabled: selectedRef !== null, retry: false }
  );

  const providers = momoProviders.data?.providers ?? [];
  const detail = selectedRef ? momoDetail.data?.transaction : undefined;

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Airtime Summary"
          description="Per-status totals for your airtime purchases over the last 30 days — pending and failed rows are counted honestly."
        >
          {airtimeSummary.isLoading ? (
            <MemberLoading label="Loading airtime summary" />
          ) : airtimeSummary.isError ? (
            <MemberError message={airtimeSummary.error.message} />
          ) : airtimeSummary.data ? (
            <SummaryList summary={airtimeSummary.data} />
          ) : null}
        </MemberSection>

        <MemberSection
          title="Airtime History"
          description="Your airtime purchases, newest first."
        >
          {airtimeHistory.isLoading ? (
            <MemberLoading label="Loading airtime history" />
          ) : airtimeHistory.isError ? (
            <MemberError message={airtimeHistory.error.message} />
          ) : (airtimeHistory.data?.history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have no airtime purchases yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Network</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(airtimeHistory.data?.history ?? []).map((h) => (
                  <TableRow key={h.ref}>
                    <TableCell className="font-mono text-xs">{h.ref}</TableCell>
                    <TableCell>{h.network ?? "—"}</TableCell>
                    <TableCell>{h.phoneNumber ?? "—"}</TableCell>
                    <TableCell>{fmt(Number(h.amount ?? 0))}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(h.status)}>
                        {h.status ?? "unknown"}
                      </Badge>
                      {h.failureReason ? (
                        <span className="block text-xs text-muted-foreground mt-1">
                          {h.failureReason}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>{fmtDate(h.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </MemberSection>

        <MemberSection
          title="Mobile Money Summary"
          description="Per-status totals for your mobile-money transactions over the last 30 days."
        >
          {momoSummary.isLoading ? (
            <MemberLoading label="Loading mobile money summary" />
          ) : momoSummary.isError ? (
            <MemberError message={momoSummary.error.message} />
          ) : momoSummary.data ? (
            <SummaryList summary={momoSummary.data} />
          ) : null}
        </MemberSection>

        <MemberSection
          title="Mobile Money Transactions"
          description="Newest first — select a row to view its detail."
        >
          {momoProviders.data && !momoProviders.data.configured ? (
            <p className="text-sm text-muted-foreground border rounded-md p-3 mb-4">
              No mobile-money provider is configured on this deployment, so new
              cash-ins and cash-outs are unavailable.
            </p>
          ) : null}
          {providers.length > 0 ? (
            <div className="mb-4 max-w-xs">
              <Select value={providerFilter} onValueChange={setProviderFilter}>
                <SelectTrigger aria-label="Provider filter">
                  <SelectValue placeholder="All providers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All providers</SelectItem>
                  {providers.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {momoTx.isLoading ? (
            <MemberLoading label="Loading mobile money transactions" />
          ) : momoTx.isError ? (
            <MemberError message={momoTx.error.message} />
          ) : (momoTx.data?.transactions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              You have no mobile-money transactions yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Fee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(momoTx.data?.transactions ?? []).map((t) => (
                  <TableRow key={t.ref}>
                    <TableCell>
                      <Button
                        variant="link"
                        className="font-mono text-xs p-0 h-auto"
                        onClick={() => setSelectedRef(t.ref)}
                      >
                        {t.ref}
                      </Button>
                    </TableCell>
                    <TableCell>{t.type ?? "—"}</TableCell>
                    <TableCell>{t.provider ?? "—"}</TableCell>
                    <TableCell>{fmt(Number(t.amount ?? 0))}</TableCell>
                    <TableCell>{fmt(Number(t.fee ?? 0))}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(t.status)}>
                        {t.status ?? "unknown"}
                      </Badge>
                    </TableCell>
                    <TableCell>{fmtDate(t.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </MemberSection>

        {selectedRef ? (
          <MemberSection
            title={`Transaction ${selectedRef}`}
            description="Mobile-money transaction detail."
          >
            {momoDetail.isLoading ? (
              <MemberLoading label="Loading transaction detail" />
            ) : momoDetail.isError ? (
              <MemberError message={momoDetail.error.message} />
            ) : detail ? (
              <dl
                className="grid grid-cols-2 gap-2 text-sm"
                data-testid="momo-detail"
              >
                <dt className="text-muted-foreground">Type</dt>
                <dd>{detail.type ?? "—"}</dd>
                <dt className="text-muted-foreground">Provider</dt>
                <dd>{detail.provider ?? "—"}</dd>
                <dt className="text-muted-foreground">Amount</dt>
                <dd>{fmt(Number(detail.amount ?? 0))}</dd>
                <dt className="text-muted-foreground">Fee</dt>
                <dd>{fmt(Number(detail.fee ?? 0))}</dd>
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <Badge variant={statusVariant(detail.status)}>
                    {detail.status ?? "unknown"}
                  </Badge>
                </dd>
                {detail.failureReason ? (
                  <>
                    <dt className="text-muted-foreground">Failure reason</dt>
                    <dd>{detail.failureReason}</dd>
                  </>
                ) : null}
                <dt className="text-muted-foreground">Date</dt>
                <dd>{fmtDate(detail.createdAt)}</dd>
              </dl>
            ) : null}
          </MemberSection>
        ) : null}

        {/* 2026-10-06 (W7-B10): honest read-only note — neither router has
            any purchase/cash-in/cash-out mutation (funds wave). */}
        <p className="text-sm text-muted-foreground border rounded-md p-3">
          Buying airtime or moving money is not available in this portal yet —
          this page shows your history and status only.
        </p>
      </div>
    </MemberLayout>
  );
}
