import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 3): bills screen mirroring the web member portal
// MemberBills.tsx on the REAL memberBillPayments router
// (server/routers/memberBillPayments.ts):
//   - billers          (biller catalog: commission rates, platform limits,
//                       honest provider `configured` flag; static registry,
//                       no DB)
//   - validateCustomer (format-only customer-number check — electricity
//                       10-13 digits, TV 10-12 digits, else >= 5 chars)
//
// 2026-10-04 (W10-B4b): the pay flow is NOW WIRED, mirroring the web
// MemberBills.tsx W10-B4a on the W10-B2 server mutations:
//   - pay        (capture phase: REAL Paystack initiation — the member enters
//                 the amount within the server-displayed registry limits;
//                 the client NEVER computes prices)
//   - confirmPay (post-capture phase: tri-state outcome — submitted / failed
//                 + failed_refund_pending / unknown_outcome, NEVER a
//                 synchronous "delivered")
// Pay-flow discipline (web parity, memberFundsIntent.tsx):
//   - The Pay button stays disabled until validateCustomer returned
//     valid:true for the CURRENT biller + customer number and the amount is
//     an integer within the server-displayed registry limits.
//   - The idempotency key is stable per draft (AsyncStorage, fingerprinted on
//     biller+customerNumber+meterType+amountNGN — exactly the fields the
//     server payload-hash binds), minted fresh on any edit, retired on a
//     terminal confirm outcome.
//   - The authorizationUrl handoff opens the in-app PaystackCheckout
//     WebView (2026-10-06, W10-B5 — replaces the Linking.openURL system-
//     browser handoff); explicit "I've paid — verify" stays as fallback.
import { billsApi, type RecentPayee } from '../services/api';
// 2026-10-06 (W11-B1c): payee-directory prefill picker (web parity
// MemberBills.tsx W11-B1b). Selecting a payee prefills IDENTIFIERS ONLY
// (biller + meter), always CLEARS the amount, and resets the validation and
// capture state — the amount is never auto-prefilled.
import { RecentPayeePicker } from '../components/RecentPayeePicker';
import {
  MemberCapturePanel,
  intentIdempotencyKey,
  isTerminalConfirmation,
  retireIntentKey,
  type CaptureConfirmationView,
  type CaptureInitiationView,
} from './memberFundsIntent';
// 2026-10-24 (W11-B2c): UX instrumentation (fail-silent, field NAMES only).
import { trackEvent } from '../services/uxTrack';
// 2026-10-24 (W11-B3b): anomaly soft-confirm + recurring-payment prompt
// (memberInsights via insightsApi). UX-ONLY signals, never security gates —
// anomalous:false or a check error proceeds normally (insightsGuards.ts).
import {
  checkAmountAnomaly,
  findRecurringMatch,
  markRecurringPromptShown,
  recurringPromptAlreadyShown,
} from '../services/insightsGuards';
import { insightsApi } from '../services/api';
import { AnomalySoftConfirm, RecurringPromptNote } from '../components/InsightsWidgets';

const fmtNgn = (n: number) => `₦${Number(n).toLocaleString('en-NG')}`;

// Registry copy (memberBillPayments.ts:79, 2026-10-04 W10-B4b) — electricity
// billers take a meterType; the server registry is the source of truth.
const ELECTRICITY_BILLERS = [
  'EKEDC', 'IKEDC', 'AEDC', 'PHED', 'BEDC', 'EEDC', 'JED', 'KEDCO',
];

/** AsyncStorage scope for the bill-pay draft idempotency key. */
const IDEM_SCOPE = 'member-bill-pay';

/** 2026-10-24 (W11-B2c): instrumentation flow name (web parity). */
const UX_FLOW = 'member-bills';

export function BillsScreen({ navigation }: { navigation: any }) {
  // 2026-10-24 (W11-B2c): form_started once per screen mount.
  useEffect(() => {
    trackEvent(UX_FLOW, 'form_started');
  }, []);
  // prefill_overridden fires at most once per prefilled draft; a new payee
  // select re-arms it.
  const overrideTracked = useRef(false);
  const [biller, setBiller] = useState<string>('');
  const [customerNumber, setCustomerNumber] = useState<string>('');
  // Submitted validation params — the query only fires after Validate (web
  // parity: enabled gate).
  const [check, setCheck] = useState<{ biller: string; customerNumber: string } | null>(null);

  // ── Pay flow state (W10-B4b, 2026-10-04) ───────────────────────────────
  const [amount, setAmount] = useState<string>('');
  const [meterType, setMeterType] = useState<'prepaid' | 'postpaid'>('prepaid');
  const [payState, setPayState] = useState<CaptureInitiationView | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<CaptureConfirmationView | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // 2026-10-06 (W11-B1c): provenance label when the draft was prefilled from
  // the payee directory (the amount is always cleared, never carried over).
  const [prefilledFrom, setPrefilledFrom] = useState<string | null>(null);
  // 2026-10-24 (W11-B3b): anomaly soft-confirm + recurring prompt state.
  const [softConfirm, setSoftConfirm] = useState<{ amountKobo: number; multiple: number | null } | null>(null);
  const [recurringPrompt, setRecurringPrompt] = useState<{ cadenceDays: number } | null>(null);
  // The armed proceed callback lives in a ref (never in render state).
  const pendingPay = useRef<(() => Promise<void>) | null>(null);

  const billersQuery = useQuery({
    queryKey: ['memberBillPayments.billers'],
    queryFn: () => billsApi.billers(),
  });
  const validateQuery = useQuery({
    queryKey: ['memberBillPayments.validateCustomer', check?.biller, check?.customerNumber],
    queryFn: () => billsApi.validateCustomer(check!),
    enabled: check !== null,
  });

  const billers = billersQuery.data?.billers ?? [];
  const limits = billersQuery.data?.limits;
  const configured = billersQuery.data?.configured ?? false;
  const result = check ? validateQuery.data : undefined;
  // Default the selection to the first catalog biller (web parity).
  const chosenBiller = biller || (billers[0]?.name ?? '');
  const isElectricity = ELECTRICITY_BILLERS.includes(chosenBiller);

  const onValidate = () => {
    if (!chosenBiller || !customerNumber.trim()) return;
    setPayState(null);
    setPayError(null);
    setConfirmation(null);
    setConfirmError(null);
    setCheck({ biller: chosenBiller, customerNumber: customerNumber.trim() });
  };

  // 2026-10-06 (W11-B1c): payee-directory prefill (web parity W11-B1b). Only
  // the identifier fields are carried over (biller + meter number); the
  // amount is ALWAYS cleared so the member confirms it explicitly, and the
  // capture/validation state resets. The new field values flow into the
  // idempotency fingerprint at Pay time, so a prefilled draft is a NEW
  // intent with a fresh key (memberFundsIntent.tsx) — no special handling.
  const onPayeeSelect = (p: RecentPayee) => {
    if (p.billerCode && billers.some((b) => b.name === p.billerCode)) {
      setBiller(p.billerCode);
    }
    if (p.meterNumber) setCustomerNumber(p.meterNumber);
    setAmount('');
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
    trackEvent(UX_FLOW, 'prefill_accepted', {
      metadata: { rail: 'bill', hasMeterNumber: Boolean(p.meterNumber) },
    });
  };

  // 2026-10-24 (W11-B2c): an edit of a prefilled identifier field after a
  // payee select — tracked ONCE per draft, field NAME only, never the value.
  const trackPrefillOverride = (fieldName: 'biller' | 'customerNumber') => {
    if (!prefilledFrom || overrideTracked.current) return;
    overrideTracked.current = true;
    trackEvent(UX_FLOW, 'prefill_overridden', { fieldName });
  };

  // Pay is gated on a valid format check for the CURRENT draft (editing the
  // biller/customer number after validating re-locks the button) and an
  // integer amount within the registry limits (web parity).
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
  const canPay = validationCurrent && amountInBounds && !payBusy;

  const onPay = async () => {
    if (!canPay || !check) return;
    setPayError(null);
    setConfirmation(null);
    setConfirmError(null);
    setSoftConfirm(null);
    // Idempotency fingerprint = exactly the funds-relevant fields the server
    // payload-hash binds (memberBillPayments.pay idemPayload).
    const intent = {
      biller: check.biller,
      customerNumber: check.customerNumber,
      meterType: isElectricity ? meterType : null,
      amountNGN,
    };
    const doPay = async () => {
      setPayBusy(true);
      try {
        const idempotencyKey = await intentIdempotencyKey(IDEM_SCOPE, JSON.stringify(intent));
        const data = await billsApi.pay({
          biller: check.biller,
          customerNumber: check.customerNumber,
          ...(isElectricity ? { meterType } : {}),
          amountNGN,
          idempotencyKey,
        });
        setPayState({
          reference: data.reference,
          authorizationUrl: data.authorizationUrl,
          amount: data.amount,
          currency: data.currency,
          idempotent: data.idempotent,
        });
      } catch (e: any) {
        setPayState(null);
        setPayError(e?.message || 'Payment could not be initiated.');
      } finally {
        setPayBusy(false);
      }
    };
    // 2026-10-24 (W11-B3b): anomaly soft-confirm AFTER validation passes,
    // BEFORE pay fires. UX-only — null (error) or anomalous:false proceeds
    // straight to doPay; anomalous:true requires the explicit extra tap.
    setPayBusy(true);
    const verdict = await checkAmountAnomaly(
      'bill',
      { billerCode: check.biller, meterNumber: check.customerNumber },
      Math.round(amountNGN * 100),
    );
    setPayBusy(false);
    if (verdict?.anomalous) {
      pendingPay.current = doPay;
      setSoftConfirm({ amountKobo: Math.round(amountNGN * 100), multiple: verdict.multiple });
      return;
    }
    await doPay();
  };

  // 2026-10-24 (W11-B3b): explicit soft-confirm tap → the armed payment.
  const onSoftConfirm = async () => {
    const proceed = pendingPay.current;
    setSoftConfirm(null);
    pendingPay.current = null;
    trackEvent(UX_FLOW, 'recommendation_accepted', { metadata: { action: 'anomaly_soft_confirm' } });
    if (proceed) await proceed();
  };

  const onConfirm = async () => {
    if (!payState) return;
    setConfirmError(null);
    setConfirmBusy(true);
    try {
      const data = await billsApi.confirmPay(payState.reference);
      setConfirmation(data);
      // 2026-10-24 (W11-B2c): a terminal confirm outcome completes the flow.
      if (isTerminalConfirmation(data)) trackEvent(UX_FLOW, 'completed');
      // Terminal outcome → retire the draft key (a fresh intent needs a new
      // key; a non-terminal outcome keeps it so retrying confirm is safe).
      if (isTerminalConfirmation(data)) await retireIntentKey(IDEM_SCOPE);
      // 2026-10-24 (W11-B3b): recurring-payment prompt at the completed
      // moment — once per app session per rail; rail + average-amount join
      // (the candidate naturalKey is a server-side blind index).
      if (isTerminalConfirmation(data) && data.amount != null && !recurringPromptAlreadyShown('bill')) {
        try {
          const res = await insightsApi.recurringCandidates();
          const match = findRecurringMatch(res?.candidates, 'bill', Number(data.amount));
          if (match) {
            markRecurringPromptShown('bill');
            setRecurringPrompt({ cadenceDays: match.cadenceDays });
          }
        } catch {
          /* detections-only signal — a lookup failure never disturbs the confirm UX */
        }
      }
    } catch (e: any) {
      setConfirmation(null);
      setConfirmError(e?.message || 'Verification failed.');
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Bills</Text>
        <Text style={styles.subtitle}>
          Supported billers, the commission the agent rail applies, and platform limits.
        </Text>
      </View>

      <View style={styles.section}>
        {billersQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading billers…</Text></View>
        ) : billersQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(billersQuery.error as Error)?.message}</Text></View>
        ) : (
          <>
            {!configured ? (
              <View style={styles.noteBox}>
                <Text style={styles.noteText}>
                  No bill-payment provider is configured on this deployment, so live bill payment is unavailable.
                </Text>
              </View>
            ) : null}
            {limits ? (
              <Text style={styles.metaLine}>
                Limits: {fmtNgn(limits.minAmountNGN)} – {fmtNgn(limits.maxAmountNGN)} per payment, {fmtNgn(limits.dailyLimitNGN)} daily.
              </Text>
            ) : null}
            {billers.map((b) => (
              <View key={b.name} style={styles.row} testID={`biller-${b.name}`}>
                <Text style={styles.rowName}>{b.name}</Text>
                <Text style={styles.rowMeta}>{b.commissionPct}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Pay a Bill</Text>
        <Text style={styles.sectionDesc}>
          Check the customer number, enter an amount within the limits, and pay via the secure checkout. Fulfillment is confirmed after your payment is verified — never instantly.
        </Text>
        <RecentPayeePicker rail="bill" onSelect={onPayeeSelect} />
        {prefilledFrom ? (
          <Text style={styles.hintText} testID="prefill-hint-bill">
            Prefilled from your recent payments ({prefilledFrom}) — review and
            edit freely; the amount was left blank for you to confirm.
          </Text>
        ) : null}
        <Text style={styles.fieldLabel}>Biller</Text>
        <View style={styles.billerPicker}>
          {billers.map((b) => (
            <TouchableOpacity
              key={b.name}
              style={[styles.chip, chosenBiller === b.name && styles.chipActive]}
              onPress={() => { trackPrefillOverride('biller'); setBiller(b.name); }}
              accessibilityLabel={`Biller ${b.name}`}
            >
              <Text style={[styles.chipText, chosenBiller === b.name && { color: '#fff' }]}>{b.name}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.fieldLabel}>Customer / meter number</Text>
        <TextInput
          style={styles.input}
          value={customerNumber}
          onChangeText={(v) => { trackPrefillOverride('customerNumber'); setCustomerNumber(v); }}
          placeholder="e.g. 12345678901"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Customer number"
        />
        {isElectricity ? (
          <>
            <Text style={styles.fieldLabel}>Meter type</Text>
            <View style={styles.billerPicker}>
              {(['prepaid', 'postpaid'] as const).map((m) => (
                <TouchableOpacity
                  key={m}
                  style={[styles.chip, meterType === m && styles.chipActive]}
                  onPress={() => {
                    // 2026-10-24 (W11-B2c): discrete change — enum value,
                    // never member-typed text.
                    trackEvent(UX_FLOW, 'field_edited', { fieldName: 'meterType' });
                    setMeterType(m);
                  }}
                  accessibilityLabel={`Meter ${m}`}
                >
                  <Text style={[styles.chipText, meterType === m && { color: '#fff' }]}>{m}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        ) : null}
        <Text style={styles.fieldLabel}>Amount (NGN)</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          // 2026-10-24 (W11-B2c): onBlur, NOT per keystroke; field NAME only —
          // the amount value is never sent.
          onBlur={() => trackEvent(UX_FLOW, 'field_edited', { fieldName: 'amount' })}
          keyboardType="number-pad"
          placeholder={limits ? `${limits.minAmountNGN} – ${limits.maxAmountNGN}` : 'Amount'}
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Amount"
        />
        {limits && amount && !amountInBounds ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            Enter a whole amount between {fmtNgn(limits.minAmountNGN)} and {fmtNgn(limits.maxAmountNGN)}.
          </Text>
        ) : null}
        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.outlineBtn, (!chosenBiller || !customerNumber.trim()) && styles.submitDisabled]}
            disabled={!chosenBiller || !customerNumber.trim()}
            onPress={onValidate}
          >
            <Text style={styles.outlineBtnText}>Validate</Text>
          </TouchableOpacity>
          {/* 2026-10-04 (W10-B4b): Pay stays disabled until the CURRENT draft
              passed validateCustomer and the amount is in bounds — a stale
              validation (edited biller/number) re-locks the button. */}
          <TouchableOpacity
            style={[styles.payBtn, !canPay && styles.submitDisabled]}
            disabled={!canPay}
            accessibilityLabel="Pay"
            onPress={onPay}
          >
            <Text style={styles.submitText}>{payBusy ? 'Initiating…' : 'Pay'}</Text>
          </TouchableOpacity>
        </View>
        {check ? (
          <View style={{ marginTop: 12 }} testID="validate-result">
            {validateQuery.isLoading ? (
              <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Validating customer number…</Text></View>
            ) : validateQuery.isError ? (
              <View style={styles.errorBox}><Text style={styles.errorText}>{(validateQuery.error as Error)?.message}</Text></View>
            ) : result ? (
              <View style={styles.noteBox}>
                <Text style={styles.noteText}>
                  <Text style={{ fontWeight: '700', color: result.valid ? '#16a34a' : '#dc2626' }}>
                    {result.valid ? 'Valid' : 'Invalid'}
                  </Text>
                  {' — '}{result.message} — {result.biller} / {result.customerNumber}
                </Text>
                {!result.valid ? (
                  <Text style={[styles.errorText, { marginTop: 6 }]}>
                    Payment is blocked until the customer number passes the format check.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
        {payError ? (
          <View style={[styles.errorBox, { marginTop: 12 }]}>
            <Text style={styles.errorText}>Payment could not be initiated: {payError}</Text>
          </View>
        ) : null}
        {/* 2026-10-24 (W11-B3b): inline anomaly soft-confirm + recurring
            prompt (UX-only, never block the payment). */}
        {softConfirm ? (
          <AnomalySoftConfirm
            amountKobo={softConfirm.amountKobo}
            multiple={softConfirm.multiple}
            onConfirm={onSoftConfirm}
            onCancel={() => { setSoftConfirm(null); pendingPay.current = null; }}
          />
        ) : null}
        {recurringPrompt ? (
          <RecurringPromptNote
            cadenceDays={recurringPrompt.cadenceDays}
            onDismiss={() => setRecurringPrompt(null)}
          />
        ) : null}
        {payState ? (
          <MemberCapturePanel
            initiation={payState}
            label="bill payment"
            confirming={confirmBusy}
            confirmation={confirmation}
            confirmError={confirmError}
            onVerify={onConfirm}
            navigation={navigation}
          />
        ) : null}
      </View>

      {/* 2026-10-04 (W10-B4b): member bill-pay history is still NOT honestly
          scopable server-side (memberBillPayments.ts header) — the disclosure
          stays until a member-safe history proc ships. Web parity. */}
      <View style={[styles.section, styles.noteBox]}>
        <Text style={styles.noteText}>
          Your bill-payment history will appear here once member-scoped bill history ships; confirmations above are shown per payment for now.
        </Text>
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 },
  back: { fontSize: 16, color: '#2563eb', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 6 },
  section: { marginHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#0f172a', marginBottom: 4 },
  sectionDesc: { fontSize: 12, color: '#64748b', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 6 },
  rowName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  rowMeta: { fontSize: 13, color: '#64748b' },
  metaLine: { fontSize: 12, color: '#64748b', marginBottom: 10 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 12, marginBottom: 6 },
  billerPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 12, color: '#334155', fontWeight: '500' },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  submitBtn: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  payBtn: { backgroundColor: '#2563eb', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12, alignItems: 'center' },
  outlineBtn: { borderWidth: 1, borderColor: '#2563eb', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12, alignItems: 'center' },
  outlineBtnText: { color: '#2563eb', fontSize: 15, fontWeight: '700' },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  noteBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 },
  noteText: { fontSize: 13, color: '#64748b' },
  hintText: { fontSize: 12, color: '#64748b', marginTop: 8 },
});
