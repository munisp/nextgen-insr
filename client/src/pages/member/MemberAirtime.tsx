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
 * Funds mutations (W10-B2/B4a, 2026-10-04): this page also wires the REAL
 * member funds rails on the same two-phase capture discipline as
 * MemberPayments / MemberBills:
 *   - memberAirtime.vend + confirmVend       (₦50–₦50,000; Paystack capture
 *     → authorizationUrl handoff → tri-state confirm; beneficiary phone
 *     optional — the server defaults it to the member's registered number)
 *   - memberMobileMoney.cashIn + confirmCashIn (₦100–₦300,000; same pattern)
 *   - memberMobileMoney.cashOut (honest v1: PENDING provider-debit request
 *     only — there is NO capture leg, and the server FAILS CLOSED with
 *     PRECONDITION_FAILED when the provider URL is unset; the error is
 *     surfaced verbatim, never hidden)
 * Idempotency keys are stable per draft and retired on terminal outcomes
 * (memberFundsIntent.tsx). No success state is ever fabricated.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import {
  MemberCapturePanel,
  intentIdempotencyKey,
  isTerminalConfirmation,
  retireIntentKey,
  type CaptureConfirmationView,
  type CaptureInitiationView,
} from "./memberFundsIntent";
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

// ── Funds rails (W10-B4a, 2026-10-04) ─────────────────────────────────────
// Server zod boundary copies (memberAirtime.ts:90-94): the client displays
// these bounds; the server enforces them.
const NETWORKS = ["MTN", "Glo", "Airtel", "9mobile"] as const;
const VEND_MIN_NGN = 50;
const VEND_MAX_NGN = 50_000;
const NIGERIAN_PHONE = /^(0|\+234)[789][01]\d{8}$/;
const VEND_IDEM_SCOPE = "member-airtime-vend";
const CASHIN_IDEM_SCOPE = "member-momo-cashin";
const CASHOUT_IDEM_SCOPE = "member-momo-cashout";

interface CashOutResultView {
  reference: string;
  status: string;
  providerStatus: string;
  amount?: string;
  currency?: string;
  failureReason?: string | null;
  idempotent?: boolean;
}

/** Buy-airtime form: vend (capture) → authorizationUrl → confirmVend. */
function BuyAirtimeSection() {
  const [network, setNetwork] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [vendState, setVendState] = useState<CaptureInitiationView | null>(
    null
  );
  const [vendError, setVendError] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<CaptureConfirmationView | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  const confirmMutation = trpc.memberAirtime.confirmVend.useMutation({
    onSuccess: (data: CaptureConfirmationView) => {
      setConfirmError(null);
      setConfirmation(data);
      if (isTerminalConfirmation(data)) retireIntentKey(VEND_IDEM_SCOPE);
    },
    onError: (err: { message: string }) => {
      setConfirmation(null);
      setConfirmError(err.message);
    },
  });

  const vendMutation = trpc.memberAirtime.vend.useMutation({
    onSuccess: (data: CaptureInitiationView) => {
      setVendError(null);
      setConfirmation(null);
      setConfirmError(null);
      setVendState(data);
    },
    onError: (err: { message: string }) => {
      setVendState(null);
      setVendError(err.message);
    },
  });

  const chosenNetwork = network || NETWORKS[0];
  const amountNGN = Number(amount);
  const amountInBounds =
    Number.isInteger(amountNGN) &&
    amountNGN >= VEND_MIN_NGN &&
    amountNGN <= VEND_MAX_NGN;

  const onVend = () => {
    setFormError(null);
    setVendError(null);
    setConfirmation(null);
    setConfirmError(null);
    const trimmedPhone = phone.trim();
    // zod-exact client guards (server enforces the same rules).
    if (!amountInBounds) {
      setFormError(
        `Enter a whole amount between ₦${VEND_MIN_NGN} and ₦${VEND_MAX_NGN.toLocaleString()}.`
      );
      return;
    }
    if (trimmedPhone && !NIGERIAN_PHONE.test(trimmedPhone)) {
      setFormError("Enter a valid Nigerian phone number (e.g. 08031234567).");
      return;
    }
    // The beneficiary phone defaults server-side to the member's own
    // registered number; an empty field sends NO phoneNumber.
    const beneficiary = trimmedPhone || null;
    const intent = {
      network: chosenNetwork,
      phoneNumber: beneficiary,
      amountNGN,
    };
    vendMutation.mutate({
      network: chosenNetwork as (typeof NETWORKS)[number],
      ...(beneficiary ? { phoneNumber: beneficiary } : {}),
      amountNGN,
      idempotencyKey: intentIdempotencyKey(
        VEND_IDEM_SCOPE,
        JSON.stringify(intent)
      ),
    });
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="vend-network">Network</Label>
          <Select value={chosenNetwork} onValueChange={setNetwork}>
            <SelectTrigger id="vend-network">
              <SelectValue placeholder="Network" />
            </SelectTrigger>
            <SelectContent>
              {NETWORKS.map((n) => (
                <SelectItem key={n} value={n}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vend-phone">Phone (optional)</Label>
          <Input
            id="vend-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Defaults to your number"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="vend-amount">Amount (NGN)</Label>
          <Input
            id="vend-amount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`${VEND_MIN_NGN} – ${VEND_MAX_NGN.toLocaleString()}`}
          />
        </div>
      </div>
      {formError ? (
        <p
          role="alert"
          className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
        >
          {formError}
        </p>
      ) : null}
      {vendError ? (
        <p
          role="alert"
          className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
        >
          Airtime purchase could not be initiated: {vendError}
        </p>
      ) : null}
      <Button
        onClick={onVend}
        disabled={!amountInBounds || vendMutation.isPending}
      >
        {vendMutation.isPending ? "Initiating…" : "Buy airtime"}
      </Button>
      {vendState ? (
        <MemberCapturePanel
          initiation={vendState}
          label="airtime purchase"
          confirming={confirmMutation.isPending}
          confirmation={confirmation}
          confirmError={confirmError}
          onVerify={() =>
            confirmMutation.mutate({ reference: vendState.reference })
          }
        />
      ) : null}
    </div>
  );
}

/** Mobile-money cash-in (two-phase) and cash-out (PENDING-only honest v1). */
function MomoCashSection({
  providers,
  limits,
}: {
  providers: Array<{ name: string }>;
  limits:
    | { minAmountNGN: number; maxAmountNGN: number; dailyLimitNGN: number }
    | undefined;
}) {
  const [provider, setProvider] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [cashInState, setCashInState] = useState<CaptureInitiationView | null>(
    null
  );
  const [cashInError, setCashInError] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<CaptureConfirmationView | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [cashOutResult, setCashOutResult] = useState<CashOutResultView | null>(
    null
  );
  const [cashOutError, setCashOutError] = useState<string | null>(null);

  const confirmMutation = trpc.memberMobileMoney.confirmCashIn.useMutation({
    onSuccess: (data: CaptureConfirmationView) => {
      setConfirmError(null);
      setConfirmation(data);
      if (isTerminalConfirmation(data)) retireIntentKey(CASHIN_IDEM_SCOPE);
    },
    onError: (err: { message: string }) => {
      setConfirmation(null);
      setConfirmError(err.message);
    },
  });

  const cashInMutation = trpc.memberMobileMoney.cashIn.useMutation({
    onSuccess: (data: CaptureInitiationView) => {
      setCashInError(null);
      setConfirmation(null);
      setConfirmError(null);
      setCashInState(data);
    },
    onError: (err: { message: string }) => {
      setCashInState(null);
      setCashInError(err.message);
    },
  });

  const cashOutMutation = trpc.memberMobileMoney.cashOut.useMutation({
    onSuccess: (data: CashOutResultView) => {
      setCashOutError(null);
      setCashOutResult(data);
      if (isTerminalConfirmation(data)) retireIntentKey(CASHOUT_IDEM_SCOPE);
    },
    onError: (err: { message: string }) => {
      setCashOutResult(null);
      setCashOutError(err.message);
    },
  });

  const chosenProvider = provider || (providers[0]?.name ?? "");
  const amountNGN = Number(amount);
  const amountInBounds =
    Number.isInteger(amountNGN) &&
    limits !== undefined &&
    amountNGN >= limits.minAmountNGN &&
    amountNGN <= limits.maxAmountNGN;

  const guard = (): boolean => {
    setFormError(null);
    if (!chosenProvider) {
      setFormError("No mobile-money provider is available.");
      return false;
    }
    if (!amountInBounds) {
      setFormError(
        limits
          ? `Enter a whole amount between ${fmt(limits.minAmountNGN)} and ${fmt(limits.maxAmountNGN)}.`
          : "Amount limits are unavailable."
      );
      return false;
    }
    return true;
  };

  const onCashIn = () => {
    setCashInError(null);
    setConfirmation(null);
    setConfirmError(null);
    if (!guard()) return;
    const intent = { provider: chosenProvider, amountNGN };
    cashInMutation.mutate({
      provider: chosenProvider as "MTN MoMo" | "Airtel Money" | "Glo Xtra" | "9PSB",
      amountNGN,
      idempotencyKey: intentIdempotencyKey(
        CASHIN_IDEM_SCOPE,
        JSON.stringify(intent)
      ),
    });
  };

  const onCashOut = () => {
    setCashOutError(null);
    setCashOutResult(null);
    if (!guard()) return;
    const intent = { provider: chosenProvider, amountNGN };
    cashOutMutation.mutate({
      provider: chosenProvider as "MTN MoMo" | "Airtel Money" | "Glo Xtra" | "9PSB",
      amountNGN,
      idempotencyKey: intentIdempotencyKey(
        CASHOUT_IDEM_SCOPE,
        JSON.stringify(intent)
      ),
    });
  };

  return (
    <div className="space-y-4 max-w-lg">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="momo-provider">Provider</Label>
          <Select value={chosenProvider} onValueChange={setProvider}>
            <SelectTrigger id="momo-provider">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              {providers.map((p) => (
                <SelectItem key={p.name} value={p.name}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="momo-amount">Cash amount (NGN)</Label>
          <Input
            id="momo-amount"
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={
              limits
                ? `${limits.minAmountNGN} – ${limits.maxAmountNGN.toLocaleString()}`
                : "Amount"
            }
          />
        </div>
      </div>
      {formError ? (
        <p
          role="alert"
          className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
        >
          {formError}
        </p>
      ) : null}
      {cashInError ? (
        <p
          role="alert"
          className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
        >
          Cash-in could not be initiated: {cashInError}
        </p>
      ) : null}
      {cashOutError ? (
        <p
          role="alert"
          className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
        >
          Cash-out was not recorded: {cashOutError}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button
          onClick={onCashIn}
          disabled={!amountInBounds || cashInMutation.isPending}
        >
          {cashInMutation.isPending ? "Initiating…" : "Cash in"}
        </Button>
        {/* Cash-out stays ATTEMPTABLE with the honest server verdict — a
            PRECONDITION_FAILED ("provider not configured") is surfaced
            verbatim above rather than hiding the operation (2026-10-04,
            W10-B4a). */}
        <Button
          variant="outline"
          onClick={onCashOut}
          disabled={!amountInBounds || cashOutMutation.isPending}
        >
          {cashOutMutation.isPending ? "Requesting…" : "Cash out"}
        </Button>
      </div>
      {cashInState ? (
        <MemberCapturePanel
          initiation={cashInState}
          label="cash-in"
          confirming={confirmMutation.isPending}
          confirmation={confirmation}
          confirmError={confirmError}
          onVerify={() =>
            confirmMutation.mutate({ reference: cashInState.reference })
          }
        />
      ) : null}
      {cashOutResult ? (
        <div
          className="text-sm border rounded-md p-3 space-y-1"
          data-testid="cashout-result"
        >
          <p>
            Cash-out request recorded. Reference:{" "}
            <span className="font-mono">{cashOutResult.reference}</span>
          </p>
          <p>
            Status:{" "}
            <Badge variant="secondary">{cashOutResult.status}</Badge>{" "}
            <span className="text-muted-foreground">
              provider: {cashOutResult.providerStatus} — settlement is
              entirely provider-side; this is NOT a completed payout.
            </span>
          </p>
          {cashOutResult.failureReason ? (
            <p className="text-destructive">{cashOutResult.failureReason}</p>
          ) : null}
        </div>
      ) : null}
    </div>
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
          title="Buy Airtime"
          description="Pay by card/bank; the airtime is vended only after your payment is verified — never instantly. Leave the phone empty to top up your own registered number."
        >
          <BuyAirtimeSection />
        </MemberSection>

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
          title="Cash In / Cash Out"
          description="Cash in by card/bank (credited after your payment is verified). Cash out is a provider-settled request — it is recorded as pending and is never a completed payout here."
        >
          {momoProviders.isLoading ? (
            <MemberLoading label="Loading providers" />
          ) : momoProviders.isError ? (
            <MemberError message={momoProviders.error.message} />
          ) : (
            <MomoCashSection
              providers={providers}
              limits={momoProviders.data?.limits}
            />
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

        {/* 2026-10-04 (W10-B4a): fulfillment is NEVER synchronous — every
            purchase/cash-in above is confirmed in a second step and renders
            the real tri-state outcome (submitted / failed+refund /
            unknown). */}
        <p className="text-sm text-muted-foreground border rounded-md p-3">
          New purchases and cash movements appear in your history after the
          provider settles them; a &quot;pending&quot; status is normal and is
          resolved automatically.
        </p>
      </div>
    </MemberLayout>
  );
}
