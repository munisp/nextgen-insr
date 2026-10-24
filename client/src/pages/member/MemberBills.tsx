/**
 * MemberBills.tsx — /member/bills (W7-B10, 2026-10-06; pay flow W10-B4a,
 * 2026-10-04)
 *
 * Wired to the REAL member bill-payments surface
 * (server/routers/memberBillPayments.ts):
 *   - memberBillPayments.billers          (biller catalog: commission rates,
 *                                          platform limits, honest provider
 *                                          `configured` flag)
 *   - memberBillPayments.validateCustomer (format-only customer-number check
 *                                          — electricity 10-13 digits, TV
 *                                          10-12 digits, else >= 5 chars)
 *   - memberBillPayments.pay              (W10-B2 capture phase: REAL Paystack
 *                                          initiation — the member enters the
 *                                          amount within the registry limits;
 *                                          the client NEVER computes prices)
 *   - memberBillPayments.confirmPay       (W10-B2 post-capture phase: tri-state
 *                                          outcome — submitted / failed +
 *                                          refund_pending / unknown_outcome,
 *                                          NEVER a synchronous "delivered")
 *
 * Pay-flow discipline (2026-10-04, W10-B4a):
 *   - The Pay button stays disabled until validateCustomer returned
 *     valid:true for the CURRENT biller + customer number and the amount is
 *     an integer within the server-displayed registry limits.
 *   - The idempotency key is stable per draft (sessionStorage, fingerprinted
 *     on biller+customerNumber+meterType+amountNGN — exactly the fields the
 *     server payload-hash binds), minted fresh on any edit, and retired on a
 *     terminal confirm outcome (memberFundsIntent.tsx).
 *   - The authorizationUrl handoff mirrors MemberPayments (target=_blank
 *     link + explicit "I've paid — verify"), never a fake success screen.
 */
import { useEffect, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
// 2026-10-24 (W11-B2c): UX instrumentation (fail-silent, field NAMES only).
import { trackEvent } from "@/lib/uxTrack";
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
import {
  RecentPayeePicker,
  type RecentPayee,
} from "./RecentPayeePicker";
// 2026-10-25 (W11-B4c-2): OCR "Scan a bill" intake (memberBillScan.parse).
// PREFILL-ONLY — Apply feeds the extracted identifiers through the SAME
// onPayeeSelect path below (amount always cleared, validation/pay reset);
// the scanned amount is only an explicit suggestion chip.
import { ScanBillButton, SCAN_PREFILL_LABEL } from "./ScanBillButton";
// 2026-10-24 (W11-B3b): anomaly soft-confirm + recurring-payment prompt
// (memberInsights.amountAnomalyCheck / recurringCandidates). The anomaly
// check is a UX-ONLY signal, never a security gate — anomalous:false or a
// check error proceeds normally (see insightsGuards.tsx header).
import { useAmountAnomalyGate, useRecurringPrompt } from "./insightsGuards";
// 2026-10-25 (W11-B4b): one-shot omnibox prefill handoff (PREFILL-ONLY —
// the parsed draft lands in normal form state; the member still validates
// and taps Pay, and the anomaly gate still runs on submit).
import { takeOmniboxPrefill } from "./omniboxPrefill";
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

const fmtNgn = (n: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(
    n
  );

// Registry copy (memberBillPayments.ts:79, 2026-10-04 W10-B4a) — electricity
// billers take a meterType; the server registry is the source of truth.
const ELECTRICITY_BILLERS = [
  "EKEDC",
  "IKEDC",
  "AEDC",
  "PHED",
  "BEDC",
  "EEDC",
  "JED",
  "KEDCO",
];

/** sessionStorage scope for the bill-pay draft idempotency key. */
const IDEM_SCOPE = "member-bill-pay";

/** 2026-10-24 (W11-B2c): instrumentation flow name for this surface. */
const UX_FLOW = "member-bills";

export default function MemberBills() {
  // 2026-10-24 (W11-B2c): form_started once per page mount.
  useEffect(() => {
    trackEvent(UX_FLOW, "form_started");
  }, []);
  // prefill_overridden fires at most once per prefilled draft; a new payee
  // select re-arms it.
  const overrideTracked = useRef(false);
  const [biller, setBiller] = useState<string>("");
  const [customerNumber, setCustomerNumber] = useState<string>("");
  // Submitted validation params — the query only fires after Validate.
  const [check, setCheck] = useState<{
    biller: string;
    customerNumber: string;
  } | null>(null);

  // ── Pay flow state (W10-B4a, 2026-10-04) ───────────────────────────────
  const [amount, setAmount] = useState<string>("");
  const [meterType, setMeterType] = useState<"prepaid" | "postpaid">("prepaid");
  const [payState, setPayState] = useState<CaptureInitiationView | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<CaptureConfirmationView | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  // 2026-10-05 (W11-B1b): provenance label when the draft was prefilled from
  // the payee directory (the amount is always cleared, never carried over).
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);

  // 2026-10-24 (W11-B3b): Phase 3 insights guards (UX-only).
  const anomalyGate = useAmountAnomalyGate("bill");
  const recurringPrompt = useRecurringPrompt("bill");

  // 2026-10-25 (W11-B4b): consume a one-shot omnibox prefill (PREFILL-ONLY).
  // The parsed biller/meter/amount land in the NORMAL form state; Pay stays
  // locked until the member validates and taps Pay, and the anomaly
  // soft-confirm gate still runs on submit — nothing is auto-submitted.
  useEffect(() => {
    const prefill = takeOmniboxPrefill("bill");
    if (!prefill || prefill.rail !== "bill") return;
    setBiller(prefill.billerCode);
    setCustomerNumber(prefill.customerNumber);
    setAmount(String(prefill.amountNGN));
    setCheck(null);
    setPayState(null);
    setPayError(null);
    setConfirmation(null);
    setConfirmError(null);
    setPrefilledFrom("omnibox");
    overrideTracked.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const billersQuery = trpc.memberBillPayments.billers.useQuery(undefined, {
    retry: false,
  });
  const validateQuery = trpc.memberBillPayments.validateCustomer.useQuery(
    check ?? { biller: "__none__", customerNumber: "__none__" },
    { enabled: check !== null, retry: false }
  );

  const confirmMutation = trpc.memberBillPayments.confirmPay.useMutation({
    onSuccess: (data: CaptureConfirmationView) => {
      setConfirmError(null);
      setConfirmation(data);
      // 2026-10-24 (W11-B2c): a terminal confirm outcome completes the flow.
      if (isTerminalConfirmation(data)) trackEvent(UX_FLOW, "completed");
      // Terminal outcome → retire the draft key (a fresh intent needs a new
      // key; a non-terminal outcome keeps it so retrying confirm is safe).
      if (isTerminalConfirmation(data)) retireIntentKey(IDEM_SCOPE);
      // 2026-10-24 (W11-B3b): recurring-payment prompt at the completed
      // moment (once per session; rail + average-amount join — the
      // naturalKey is a server-side blind index, not client-computable).
      if (isTerminalConfirmation(data) && data.amount != null) {
        recurringPrompt.maybePrompt(Number(data.amount));
      }
    },
    onError: (err: { message: string }) => {
      setConfirmation(null);
      setConfirmError(err.message);
    },
  });

  const payMutation = trpc.memberBillPayments.pay.useMutation({
    onSuccess: (data: CaptureInitiationView) => {
      setPayError(null);
      setConfirmation(null);
      setConfirmError(null);
      setPayState({
        reference: data.reference,
        authorizationUrl: data.authorizationUrl,
        amount: data.amount,
        currency: data.currency,
        idempotent: data.idempotent,
      });
    },
    onError: (err: { message: string }) => {
      setPayState(null);
      setPayError(err.message);
    },
  });

  const billers = billersQuery.data?.billers ?? [];
  const limits = billersQuery.data?.limits;
  const configured = billersQuery.data?.configured ?? false;
  const result = check ? validateQuery.data : undefined;
  // Default the selection to the first catalog biller when the member has
  // not picked one explicitly.
  const chosenBiller = biller || (billers[0]?.name ?? "");
  const isElectricity = ELECTRICITY_BILLERS.includes(chosenBiller);

  const onValidate = () => {
    if (!chosenBiller || !customerNumber.trim()) return;
    setPayState(null);
    setPayError(null);
    setConfirmation(null);
    setConfirmError(null);
    setCheck({ biller: chosenBiller, customerNumber: customerNumber.trim() });
  };

  // 2026-10-05 (W11-B1b): payee-directory prefill. Only the identifier
  // fields are carried over (biller + meter number); the amount is ALWAYS
  // cleared so the member confirms it explicitly. The new field values flow
  // into the idempotency fingerprint at Pay time, so a prefilled-then-edited
  // draft is a NEW intent with a fresh key (memberFundsIntent.tsx) — no
  // special handling needed here.
  const onPayeeSelect = (p: RecentPayee) => {
    if (p.billerCode && billers.some((b) => b.name === p.billerCode)) {
      setBiller(p.billerCode);
    }
    if (p.meterNumber) setCustomerNumber(p.meterNumber);
    setAmount("");
    // The previous validation no longer matches the new draft — re-lock Pay.
    setCheck(null);
    setPayState(null);
    setPayError(null);
    setConfirmation(null);
    setConfirmError(null);
    setPrefilledFrom(p.label);
    // 2026-10-24 (W11-B2c): prefill accepted; re-arm the once-per-draft
    // override probe (the member editing a prefilled IDENTIFIER field next).
    overrideTracked.current = false;
    trackEvent(UX_FLOW, "prefill_accepted", {
      metadata: { rail: "bill", hasMeterNumber: Boolean(p.meterNumber) },
    });
  };

  // 2026-10-24 (W11-B2c): an edit of a prefilled identifier field after a
  // payee select — tracked ONCE per draft, field NAME only, never the value.
  const trackPrefillOverride = (fieldName: "biller" | "customerNumber") => {
    if (!prefilledFrom || overrideTracked.current) return;
    overrideTracked.current = true;
    trackEvent(UX_FLOW, "prefill_overridden", { fieldName });
  };

  const onCustomerNumberChange = (value: string) => {
    trackPrefillOverride("customerNumber");
    setCustomerNumber(value);
  };

  const onBillerChange = (value: string) => {
    trackPrefillOverride("biller");
    setBiller(value);
  };

  // Pay is gated on a valid format check for the CURRENT draft (editing the
  // biller/customer number after validating re-locks the button) and an
  // integer amount within the registry limits.
  const amountNGN = Number(amount);
  const amountInBounds =
    Number.isInteger(amountNGN) &&
    limits !== undefined &&
    amountNGN >= limits.minAmountNGN &&
    amountNGN <= limits.maxAmountNGN;
  const validationCurrent =
    result?.valid === true &&
    check !== null &&
    check.biller === chosenBiller &&
    check.customerNumber === customerNumber.trim();
  const canPay =
    validationCurrent && amountInBounds && !payMutation.isPending;

  const onPay = () => {
    if (!canPay || !check) return;
    setPayError(null);
    setConfirmation(null);
    setConfirmError(null);
    const doPay = () => {
      // Idempotency fingerprint = exactly the funds-relevant fields the server
      // payload-hash binds (memberBillPayments.pay idemPayload).
      const intent = {
        biller: check.biller,
        customerNumber: check.customerNumber,
        meterType: isElectricity ? meterType : null,
        amountNGN,
      };
      payMutation.mutate({
        // The biller came from the server catalog select, so it is always a
        // registry member; the cast only satisfies the zod-enum input type.
        biller: check.biller as Parameters<typeof payMutation.mutate>[0]["biller"],
        customerNumber: check.customerNumber,
        ...(isElectricity ? { meterType } : {}),
        amountNGN,
        idempotencyKey: intentIdempotencyKey(
          IDEM_SCOPE,
          JSON.stringify(intent)
        ),
      });
    };
    // 2026-10-24 (W11-B3b): anomaly soft-confirm AFTER validation passes,
    // BEFORE pay fires. UX-only signal — a non-anomalous verdict or a check
    // error proceeds straight to doPay; an anomalous verdict requires the
    // explicit extra tap on the inline dialog.
    anomalyGate.check(
      { billerCode: check.biller, meterNumber: check.customerNumber },
      Math.round(amountNGN * 100),
      doPay
    );
  };

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Billers"
          description="Supported billers, the commission the agent rail applies, and platform limits."
        >
          {billersQuery.isLoading ? (
            <MemberLoading label="Loading billers" />
          ) : billersQuery.isError ? (
            <MemberError message={billersQuery.error.message} />
          ) : (
            <>
              {!configured ? (
                <p className="text-sm text-muted-foreground border rounded-md p-3 mb-4">
                  No bill-payment provider is configured on this deployment, so
                  live bill payment is unavailable.
                </p>
              ) : null}
              {limits ? (
                <p className="text-sm text-muted-foreground mb-4">
                  Limits: {fmtNgn(limits.minAmountNGN)} –{" "}
                  {fmtNgn(limits.maxAmountNGN)} per payment,{" "}
                  {fmtNgn(limits.dailyLimitNGN)} daily.
                </p>
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Biller</TableHead>
                    <TableHead>Commission</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {billers.map((b) => (
                    <TableRow key={b.name}>
                      <TableCell className="font-medium">{b.name}</TableCell>
                      <TableCell>{b.commissionPct}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </MemberSection>

        <MemberSection
          title="Pay a Bill"
          description="Check the customer number, enter an amount within the limits, and pay by card/bank via the secure checkout. Fulfillment is confirmed after your payment is verified — never instantly."
        >
          <div className="mb-4 space-y-3">
            <RecentPayeePicker rail="bill" onSelect={onPayeeSelect} />
            <ScanBillButton
              rail="bill"
              onApply={onPayeeSelect}
              onAmountSuggestion={(ngn) => setAmount(String(ngn))}
            />
          </div>
          {prefilledFrom ? (
            <p
              className="text-xs text-muted-foreground mb-4"
              data-testid="prefill-hint"
            >
              {prefilledFrom === "omnibox"
                ? "Prefilled from your omnibox request — review and edit freely, then validate and pay when you're ready."
                : prefilledFrom === SCAN_PREFILL_LABEL
                  ? "Prefilled from your scanned bill photo — review and edit freely, then validate and pay when you're ready."
                  : `Prefilled from your recent payments (${prefilledFrom}) — review and edit freely; the amount was left blank for you to confirm.`}
            </p>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="biller">Biller</Label>
              <Select value={chosenBiller} onValueChange={onBillerChange}>
                <SelectTrigger id="biller">
                  <SelectValue placeholder="Select biller" />
                </SelectTrigger>
                <SelectContent>
                  {billers.map((b) => (
                    <SelectItem key={b.name} value={b.name}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerNumber">Customer / meter number</Label>
              <Input
                id="customerNumber"
                value={customerNumber}
                onChange={(e) => onCustomerNumberChange(e.target.value)}
                placeholder="e.g. 12345678901"
              />
            </div>
            {isElectricity ? (
              <div className="space-y-2">
                <Label htmlFor="meterType">Meter type</Label>
                <Select
                  value={meterType}
                  onValueChange={(v) => {
                    // 2026-10-24 (W11-B2c): discrete change — no per-keystroke
                    // noise, value is an enum (never member-typed text).
                    trackEvent(UX_FLOW, "field_edited", {
                      fieldName: "meterType",
                    });
                    setMeterType(v as "prepaid" | "postpaid");
                  }}
                >
                  <SelectTrigger id="meterType">
                    <SelectValue placeholder="Meter type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prepaid">Prepaid</SelectItem>
                    <SelectItem value="postpaid">Postpaid</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (NGN)</Label>
              <Input
                id="amount"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                // 2026-10-24 (W11-B2c): onBlur, NOT per keystroke; field NAME
                // only — the amount value is never sent.
                onBlur={() =>
                  trackEvent(UX_FLOW, "field_edited", { fieldName: "amount" })
                }
                placeholder={
                  limits
                    ? `${limits.minAmountNGN} – ${limits.maxAmountNGN}`
                    : "Amount"
                }
              />
              {limits && amount && !amountInBounds ? (
                <p role="alert" className="text-xs text-destructive">
                  Enter a whole amount between {fmtNgn(limits.minAmountNGN)} and{" "}
                  {fmtNgn(limits.maxAmountNGN)}.
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              onClick={onValidate}
              disabled={!chosenBiller || !customerNumber.trim()}
            >
              Validate
            </Button>
            <Button onClick={onPay} disabled={!canPay}>
              {payMutation.isPending ? "Initiating…" : "Pay"}
            </Button>
          </div>
          {check ? (
            <div className="mt-4" data-testid="validate-result">
              {validateQuery.isLoading ? (
                <MemberLoading label="Validating customer number" />
              ) : validateQuery.isError ? (
                <MemberError message={validateQuery.error.message} />
              ) : result ? (
                <p className="text-sm">
                  <Badge variant={result.valid ? "default" : "destructive"}>
                    {result.valid ? "Valid" : "Invalid"}
                  </Badge>{" "}
                  <span className="text-muted-foreground">
                    {result.message} — {result.biller} / {result.customerNumber}
                  </span>
                  {!result.valid ? (
                    <span className="block text-xs text-destructive mt-1">
                      Payment is blocked until the customer number passes the
                      format check.
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          ) : null}
          {payError ? (
            <p
              role="alert"
              className="text-sm text-destructive border border-destructive/40 rounded-md p-3 mt-4"
            >
              Payment could not be initiated: {payError}
            </p>
          ) : null}
          {/* 2026-10-24 (W11-B3b): inline anomaly soft-confirm + recurring
              prompt (UX-only, never block the payment). */}
          {anomalyGate.dialog ? <div className="mt-4">{anomalyGate.dialog}</div> : null}
          {recurringPrompt.node ? (
            <div className="mt-4">{recurringPrompt.node}</div>
          ) : null}
          {payState ? (
            <div className="mt-4">
              <MemberCapturePanel
                initiation={payState}
                label="bill payment"
                confirming={confirmMutation.isPending}
                confirmation={confirmation}
                confirmError={confirmError}
                onVerify={() =>
                  confirmMutation.mutate({ reference: payState.reference })
                }
              />
            </div>
          ) : null}
        </MemberSection>

        {/* 2026-10-04 (W10-B4a): member bill-pay history is still NOT
            honestly scopable server-side (memberBillPayments.ts header) —
            the disclosure stays until a member-safe history proc ships. */}
        <p className="text-sm text-muted-foreground border rounded-md p-3">
          Your bill-payment history will appear here once member-scoped bill
          history ships; confirmations above are shown per payment for now.
        </p>
      </div>
    </MemberLayout>
  );
}
