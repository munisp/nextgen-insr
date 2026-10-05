import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, TextInput,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 3): airtime & mobile-money screen mirroring the web
// member portal MemberAirtime.tsx — one combined screen for both phone-scoped
// money rails:
//   Airtime (server/routers/memberAirtime.ts):
//     - memberAirtime.myHistory  (paginated, newest first, ALL statuses
//                                 verbatim incl. failed/pending)
//     - memberAirtime.mySummary  (per-status counts + volumes over N days)
//   Mobile money (server/routers/memberMobileMoney.ts):
//     - memberMobileMoney.myTransactions (paginated, optional provider filter
//       — a FILTER within the caller's phone scope, never a re-scope)
//     - memberMobileMoney.myTransaction  (detail by ref; NOT_FOUND
//       non-enumerating on foreign/nonexistent refs)
//     - memberMobileMoney.mySummary      (per-status counts + volumes)
//     - memberMobileMoney.providers      (registry + honest `configured` flag)
//
// 2026-10-04 (W10-B4b): the W10-B2 mutations are NOW WIRED, mirroring the web
// MemberAirtime.tsx W10-B4a sections:
//   - memberAirtime.vend/confirmVend       (BuyAirtimeSection — two-phase
//     capture; network select, optional beneficiary phone OMITTED when blank,
//     ₦50–₦50,000 client guards matching the server zod boundary)
//   - memberMobileMoney.cashIn/confirmCashIn (MomoCashSection — two-phase)
//   - memberMobileMoney.cashOut            (PENDING-only honest v1; a
//     PRECONDITION_FAILED verdict is surfaced VERBATIM, never hidden)
// Idempotency keys: stable per draft fingerprint (AsyncStorage,
// memberFundsIntent.tsx), retired on terminal outcome. The capture panel
// never claims delivery — tri-state only.
import {
  airtimeApi, mobileMoneyApi, MOMO_PROVIDERS, MomoProvider,
  MemberAirtimeRow, MemberMomoTxRow, MemberStatusSummary,
} from '../services/api';
import {
  MemberCapturePanel,
  intentIdempotencyKey,
  isTerminalConfirmation,
  retireIntentKey,
  type CaptureConfirmationView,
  type CaptureInitiationView,
} from './memberFundsIntent';

const fmt = (n: number, currency = 'NGN') =>
  currency === 'NGN' ? `₦${Number(n).toLocaleString('en-NG')}` : `${Number(n).toLocaleString('en-NG')} ${currency}`;
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : '—';

const badgeStyleFor = (status: string | null | undefined) =>
  status === 'success' ? styles.badgeOk
    : status === 'pending' || status === 'pending_provider' ? styles.badgePending
      : styles.badgeBad;

function SummaryList({ summary }: { summary: MemberStatusSummary }) {
  if (summary.byStatus.length === 0) {
    return (
      <Text style={styles.metaLine}>
        No transactions in the last {summary.periodDays} days.
      </Text>
    );
  }
  return (
    <View testID="summary-list">
      {summary.byStatus.map((s) => (
        <View key={s.status} style={styles.summaryRow}>
          <View style={[styles.badge, badgeStyleFor(s.status)]}>
            <Text style={styles.badgeText}>{s.status}</Text>
          </View>
          <Text style={styles.metaLine}>
            {s.count} transaction{s.count === 1 ? '' : 's'} · {fmt(s.volumeNGN)}
          </Text>
        </View>
      ))}
      <Text style={styles.metaLine}>
        Total: {summary.totalTransactions} over {summary.periodDays} days
      </Text>
    </View>
  );
}

// ── W10-B4b (2026-10-04): funds sections mirroring MemberAirtime.tsx W10-B4a
// Server zod-boundary copies (memberAirtime.ts:90-94 — never assumed).
const NETWORKS = ['MTN', 'Glo', 'Airtel', '9mobile'] as const;
const VEND_MIN_NGN = 50;
const VEND_MAX_NGN = 50_000;
const NIGERIAN_PHONE = /^(0|\+234)[789][01]\d{8}$/;
const VEND_IDEM_SCOPE = 'member-airtime-vend';
const CASHIN_IDEM_SCOPE = 'member-momo-cashin';
const CASHOUT_IDEM_SCOPE = 'member-momo-cashout';

/** Buy-airtime form: vend (capture) → authorizationUrl → confirmVend. */
function BuyAirtimeSection({ navigation }: { navigation: any }) {
  const [network, setNetwork] = useState<string>('');
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [vendState, setVendState] = useState<CaptureInitiationView | null>(null);
  const [vendError, setVendError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<CaptureConfirmationView | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const chosenNetwork = network || NETWORKS[0];
  const amountNGN = Number(amount);
  const amountInBounds =
    Number.isInteger(amountNGN) && amountNGN >= VEND_MIN_NGN && amountNGN <= VEND_MAX_NGN;

  const onVend = async () => {
    setFormError(null);
    setVendError(null);
    setConfirmation(null);
    setConfirmError(null);
    const trimmedPhone = phone.trim();
    // zod-exact client guards (server enforces the same rules).
    if (!amountInBounds) {
      setFormError(`Enter a whole amount between ₦${VEND_MIN_NGN} and ₦${VEND_MAX_NGN.toLocaleString()}.`);
      return;
    }
    if (trimmedPhone && !NIGERIAN_PHONE.test(trimmedPhone)) {
      setFormError('Enter a valid Nigerian phone number (e.g. 08031234567).');
      return;
    }
    // The beneficiary phone defaults server-side to the member's own
    // registered number; an empty field sends NO phoneNumber (zod-exact).
    const beneficiary = trimmedPhone || null;
    const intent = { network: chosenNetwork, phoneNumber: beneficiary, amountNGN };
    setBusy(true);
    try {
      const idempotencyKey = await intentIdempotencyKey(VEND_IDEM_SCOPE, JSON.stringify(intent));
      const data = await airtimeApi.vend({
        network: chosenNetwork as (typeof NETWORKS)[number],
        ...(beneficiary ? { phoneNumber: beneficiary } : {}),
        amountNGN,
        idempotencyKey,
      });
      setVendState({
        reference: data.reference,
        authorizationUrl: data.authorizationUrl,
        amount: data.amount,
        currency: data.currency,
        idempotent: data.idempotent,
      });
    } catch (e: any) {
      setVendState(null);
      setVendError(e?.message || 'Airtime purchase could not be initiated.');
    } finally {
      setBusy(false);
    }
  };

  const onConfirm = async () => {
    if (!vendState) return;
    setConfirmError(null);
    setConfirming(true);
    try {
      const data = await airtimeApi.confirmVend(vendState.reference);
      setConfirmation(data);
      if (isTerminalConfirmation(data)) await retireIntentKey(VEND_IDEM_SCOPE);
    } catch (e: any) {
      setConfirmation(null);
      setConfirmError(e?.message || 'Verification failed.');
    } finally {
      setConfirming(false);
    }
  };

  return (
    <View>
      <Text style={styles.fieldLabel}>Network</Text>
      <View style={styles.filterRow}>
        {NETWORKS.map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.chip, chosenNetwork === n && styles.chipActive]}
            onPress={() => setNetwork(n)}
            accessibilityLabel={`Network ${n}`}
          >
            <Text style={[styles.chipText, chosenNetwork === n && { color: '#fff' }]}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.fieldLabel}>Phone (optional — defaults to your number)</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="e.g. 08031234567"
        placeholderTextColor="#94a3b8"
        accessibilityLabel="Beneficiary phone"
      />
      <Text style={styles.fieldLabel}>Amount (NGN)</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="number-pad"
        placeholder={`${VEND_MIN_NGN} – ${VEND_MAX_NGN.toLocaleString()}`}
        placeholderTextColor="#94a3b8"
        accessibilityLabel="Airtime amount"
      />
      {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}
      {vendError ? (
        <View style={[styles.errorBox, { marginTop: 10 }]}>
          <Text style={styles.errorText}>Airtime purchase could not be initiated: {vendError}</Text>
        </View>
      ) : null}
      <TouchableOpacity
        style={[styles.submitBtn, (!amountInBounds || busy) && styles.submitDisabled]}
        disabled={!amountInBounds || busy}
        onPress={onVend}
      >
        <Text style={styles.submitText}>{busy ? 'Initiating…' : 'Buy airtime'}</Text>
      </TouchableOpacity>
      {vendState ? (
        <MemberCapturePanel
          initiation={vendState}
          label="airtime purchase"
          confirming={confirming}
          confirmation={confirmation}
          confirmError={confirmError}
          onVerify={onConfirm}
   
          navigation={navigation}
        />
      ) : null}
    </View>
  );
}

interface CashOutResultView {
  reference: string;
  status: string;
  providerStatus: string;
  amount?: string;
  currency?: string;
  failureReason?: string | null;
  idempotent?: boolean;
}

/** Mobile-money cash-in (two-phase) and cash-out (PENDING-only honest v1). */
function MomoCashSection({
  providers,
  limits,
  navigation,
}: {
  providers: Array<{ name: string }>;
  limits: { minAmountNGN: number; maxAmountNGN: number; dailyLimitNGN: number } | undefined;
  navigation: any;
}) {
  const [provider, setProvider] = useState<string>('');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [cashInState, setCashInState] = useState<CaptureInitiationView | null>(null);
  const [cashInError, setCashInError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<CaptureConfirmationView | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [cashOutResult, setCashOutResult] = useState<CashOutResultView | null>(null);
  const [cashOutError, setCashOutError] = useState<string | null>(null);
  const [cashInBusy, setCashInBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cashOutBusy, setCashOutBusy] = useState(false);

  const chosenProvider = provider || (providers[0]?.name ?? '');
  const amountNGN = Number(amount);
  const amountInBounds =
    Number.isInteger(amountNGN) &&
    limits !== undefined &&
    amountNGN >= limits.minAmountNGN &&
    amountNGN <= limits.maxAmountNGN;

  const guard = (): boolean => {
    setFormError(null);
    if (!chosenProvider) {
      setFormError('No mobile-money provider is available.');
      return false;
    }
    if (!amountInBounds) {
      setFormError(
        limits
          ? `Enter a whole amount between ${fmt(limits.minAmountNGN)} and ${fmt(limits.maxAmountNGN)}.`
          : 'Amount limits are unavailable.',
      );
      return false;
    }
    return true;
  };

  const onCashIn = async () => {
    setCashInError(null);
    setConfirmation(null);
    setConfirmError(null);
    if (!guard()) return;
    const intent = { provider: chosenProvider, amountNGN };
    setCashInBusy(true);
    try {
      const idempotencyKey = await intentIdempotencyKey(CASHIN_IDEM_SCOPE, JSON.stringify(intent));
      const data = await mobileMoneyApi.cashIn({
        provider: chosenProvider as MomoProvider,
        amountNGN,
        idempotencyKey,
      });
      setCashInState({
        reference: data.reference,
        authorizationUrl: data.authorizationUrl,
        amount: data.amount,
        currency: data.currency,
        idempotent: data.idempotent,
      });
    } catch (e: any) {
      setCashInState(null);
      setCashInError(e?.message || 'Cash-in could not be initiated.');
    } finally {
      setCashInBusy(false);
    }
  };

  const onConfirmCashIn = async () => {
    if (!cashInState) return;
    setConfirmError(null);
    setConfirming(true);
    try {
      const data = await mobileMoneyApi.confirmCashIn(cashInState.reference);
      setConfirmation(data);
      if (isTerminalConfirmation(data)) await retireIntentKey(CASHIN_IDEM_SCOPE);
    } catch (e: any) {
      setConfirmation(null);
      setConfirmError(e?.message || 'Verification failed.');
    } finally {
      setConfirming(false);
    }
  };

  const onCashOut = async () => {
    setCashOutError(null);
    setCashOutResult(null);
    if (!guard()) return;
    const intent = { provider: chosenProvider, amountNGN };
    setCashOutBusy(true);
    try {
      const idempotencyKey = await intentIdempotencyKey(CASHOUT_IDEM_SCOPE, JSON.stringify(intent));
      const data = await mobileMoneyApi.cashOut({
        provider: chosenProvider as MomoProvider,
        amountNGN,
        idempotencyKey,
      });
      setCashOutResult(data);
      if (isTerminalConfirmation(data)) await retireIntentKey(CASHOUT_IDEM_SCOPE);
    } catch (e: any) {
      // 2026-10-04 (W10-B4b): the server verdict is surfaced VERBATIM — a
      // PRECONDITION_FAILED ("provider not configured") is shown, not hidden.
      setCashOutResult(null);
      setCashOutError(e?.message || 'Cash-out was not recorded.');
    } finally {
      setCashOutBusy(false);
    }
  };

  return (
    <View>
      <Text style={styles.fieldLabel}>Provider</Text>
      <View style={styles.filterRow}>
        {providers.map((p) => (
          <TouchableOpacity
            key={p.name}
            style={[styles.chip, chosenProvider === p.name && styles.chipActive]}
            onPress={() => setProvider(p.name)}
            accessibilityLabel={`Cash provider ${p.name}`}
          >
            <Text style={[styles.chipText, chosenProvider === p.name && { color: '#fff' }]}>{p.name}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={styles.fieldLabel}>Cash amount (NGN)</Text>
      <TextInput
        style={styles.input}
        value={amount}
        onChangeText={setAmount}
        keyboardType="number-pad"
        placeholder={limits ? `${limits.minAmountNGN} – ${limits.maxAmountNGN.toLocaleString()}` : 'Amount'}
        placeholderTextColor="#94a3b8"
        accessibilityLabel="Cash amount"
      />
      {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}
      {cashInError ? (
        <View style={[styles.errorBox, { marginTop: 10 }]}>
          <Text style={styles.errorText}>Cash-in could not be initiated: {cashInError}</Text>
        </View>
      ) : null}
      {cashOutError ? (
        <View style={[styles.errorBox, { marginTop: 10 }]}>
          <Text style={styles.errorText}>Cash-out was not recorded: {cashOutError}</Text>
        </View>
      ) : null}
      <View style={styles.btnRow}>
        <TouchableOpacity
          style={[styles.submitBtn, { marginTop: 0 }, (!amountInBounds || cashInBusy) && styles.submitDisabled]}
          disabled={!amountInBounds || cashInBusy}
          onPress={onCashIn}
        >
          <Text style={styles.submitText}>{cashInBusy ? 'Initiating…' : 'Cash in'}</Text>
        </TouchableOpacity>
        {/* Cash-out stays ATTEMPTABLE with the honest server verdict — a
            PRECONDITION_FAILED ("provider not configured") is surfaced
            verbatim above rather than hiding the operation (2026-10-04,
            W10-B4b; web parity MemberAirtime.tsx MomoCashSection). */}
        <TouchableOpacity
          style={[styles.outlineBtn, (!amountInBounds || cashOutBusy) && styles.submitDisabled]}
          disabled={!amountInBounds || cashOutBusy}
          onPress={onCashOut}
        >
          <Text style={styles.outlineBtnText}>{cashOutBusy ? 'Requesting…' : 'Cash out'}</Text>
        </TouchableOpacity>
      </View>
      {cashInState ? (
        <MemberCapturePanel
          initiation={cashInState}
          label="cash-in"
          confirming={confirming}
          confirmation={confirmation}
          confirmError={confirmError}
          onVerify={onConfirmCashIn}
   
          navigation={navigation}
        />
      ) : null}
      {cashOutResult ? (
        <View style={styles.noteBox} testID="cashout-result">
          <Text style={styles.noteText}>Cash-out request recorded. Reference: {cashOutResult.reference}</Text>
          <Text style={styles.noteText}>
            Status: {cashOutResult.status} — provider: {cashOutResult.providerStatus} — settlement is entirely
            provider-side; this is NOT a completed payout.
          </Text>
          {cashOutResult.failureReason ? (
            <Text style={styles.errorText}>{cashOutResult.failureReason}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function AirtimeScreen({ navigation }: { navigation: any }) {
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<'all' | MomoProvider>('all');

  // ── Airtime ──────────────────────────────────────────────────────────────
  const airtimeHistory = useQuery({
    queryKey: ['memberAirtime.myHistory'],
    queryFn: () => airtimeApi.myHistory({ limit: 20, offset: 0 }),
  });
  const airtimeSummary = useQuery({
    queryKey: ['memberAirtime.mySummary'],
    queryFn: () => airtimeApi.mySummary({ periodDays: 30 }),
  });

  // ── Mobile money ─────────────────────────────────────────────────────────
  const momoProviders = useQuery({
    queryKey: ['memberMobileMoney.providers'],
    queryFn: () => mobileMoneyApi.providers(),
  });
  const momoTx = useQuery({
    queryKey: ['memberMobileMoney.myTransactions', providerFilter],
    queryFn: () => mobileMoneyApi.myTransactions({
      limit: 20, offset: 0,
      ...(providerFilter !== 'all' ? { provider: providerFilter } : {}),
    }),
  });
  const momoSummary = useQuery({
    queryKey: ['memberMobileMoney.mySummary'],
    queryFn: () => mobileMoneyApi.mySummary({ periodDays: 30 }),
  });
  const momoDetail = useQuery({
    queryKey: ['memberMobileMoney.myTransaction', selectedRef],
    queryFn: () => mobileMoneyApi.myTransaction(selectedRef!),
    enabled: selectedRef !== null,
  });

  const providers = momoProviders.data?.providers ?? [];
  const detail = selectedRef ? momoDetail.data?.transaction : undefined;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Airtime & Mobile Money</Text>
        <Text style={styles.subtitle}>Your airtime purchases and mobile-money transactions, newest first.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Buy Airtime</Text>
        <Text style={styles.sectionDesc}>
          Pay by card/bank via the secure checkout; the vend is dispatched only after your payment is verified — fulfillment is never instant.
        </Text>
        <BuyAirtimeSection navigation={navigation} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Airtime Summary</Text>
        {airtimeSummary.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading airtime summary…</Text></View>
        ) : airtimeSummary.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(airtimeSummary.error as Error)?.message}</Text></View>
        ) : airtimeSummary.data ? (
          <SummaryList summary={airtimeSummary.data} />
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Airtime History</Text>
        {airtimeHistory.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading airtime history…</Text></View>
        ) : airtimeHistory.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(airtimeHistory.error as Error)?.message}</Text></View>
        ) : (airtimeHistory.data?.history ?? []).length === 0 ? (
          <Text style={styles.empty}>You have no airtime purchases yet.</Text>
        ) : (
          (airtimeHistory.data?.history ?? []).map((h: MemberAirtimeRow) => (
            <View key={h.ref} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.monoRef}>{h.ref}</Text>
                <View style={[styles.badge, badgeStyleFor(h.status)]}>
                  <Text style={styles.badgeText}>{h.status ?? 'unknown'}</Text>
                </View>
              </View>
              <Text style={styles.metaLine}>
                {h.network ?? '—'} · {h.phoneNumber ?? '—'} · {fmt(Number(h.amount ?? 0))} · {fmtDate(h.createdAt)}
              </Text>
              {h.failureReason ? (
                <Text style={styles.metaLine}>{h.failureReason}</Text>
              ) : null}
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mobile Money Summary</Text>
        {momoSummary.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading mobile money summary…</Text></View>
        ) : momoSummary.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(momoSummary.error as Error)?.message}</Text></View>
        ) : momoSummary.data ? (
          <SummaryList summary={momoSummary.data} />
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Cash In / Cash Out</Text>
        <Text style={styles.sectionDesc}>
          Cash in by card/bank via the secure checkout; cash out is a provider-side settlement request only — never an instant payout.
        </Text>
        <MomoCashSection providers={providers} limits={momoProviders.data?.limits} navigation={navigation} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mobile Money Transactions</Text>
        {momoProviders.data && !momoProviders.data.configured ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              No mobile-money provider is configured on this deployment, so new cash-ins and cash-outs are unavailable.
            </Text>
          </View>
        ) : null}
        {providers.length > 0 ? (
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.chip, providerFilter === 'all' && styles.chipActive]}
              onPress={() => setProviderFilter('all')}
              accessibilityLabel="Filter all providers"
            >
              <Text style={[styles.chipText, providerFilter === 'all' && { color: '#fff' }]}>All providers</Text>
            </TouchableOpacity>
            {providers.map((p) => (
              <TouchableOpacity
                key={p.name}
                style={[styles.chip, providerFilter === p.name && styles.chipActive]}
                onPress={() => setProviderFilter(p.name as MomoProvider)}
                accessibilityLabel={`Provider ${p.name}`}
              >
                <Text style={[styles.chipText, providerFilter === p.name && { color: '#fff' }]}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {momoTx.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading mobile money transactions…</Text></View>
        ) : momoTx.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(momoTx.error as Error)?.message}</Text></View>
        ) : (momoTx.data?.transactions ?? []).length === 0 ? (
          <Text style={styles.empty}>You have no mobile-money transactions yet.</Text>
        ) : (
          (momoTx.data?.transactions ?? []).map((t: MemberMomoTxRow) => (
            <View key={t.ref} style={styles.card}>
              <TouchableOpacity onPress={() => setSelectedRef(selectedRef === t.ref ? null : t.ref)} accessibilityLabel={`Transaction ${t.ref}`}>
                <View style={styles.cardHeader}>
                  <Text style={styles.monoRef}>{t.ref}</Text>
                  <View style={[styles.badge, badgeStyleFor(t.status)]}>
                    <Text style={styles.badgeText}>{t.status ?? 'unknown'}</Text>
                  </View>
                </View>
                <Text style={styles.metaLine}>
                  {t.type ?? '—'} · {t.provider ?? '—'} · {fmt(Number(t.amount ?? 0))} · fee {fmt(Number(t.fee ?? 0))} · {fmtDate(t.createdAt)}
                </Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {selectedRef ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transaction {selectedRef}</Text>
          {momoDetail.isLoading ? (
            <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading transaction detail…</Text></View>
          ) : momoDetail.isError ? (
            <View style={styles.errorBox}><Text style={styles.errorText}>{(momoDetail.error as Error)?.message}</Text></View>
          ) : detail ? (
            <View style={styles.card} testID="momo-detail">
              <Text style={styles.metaLine}>Type: {detail.type ?? '—'}</Text>
              <Text style={styles.metaLine}>Provider: {detail.provider ?? '—'}</Text>
              <Text style={styles.metaLine}>Amount: {fmt(Number(detail.amount ?? 0))}</Text>
              <Text style={styles.metaLine}>Fee: {fmt(Number(detail.fee ?? 0))}</Text>
              <Text style={styles.metaLine}>Status: {detail.status ?? 'unknown'}</Text>
              {detail.failureReason ? (
                <Text style={styles.metaLine}>Failure reason: {detail.failureReason}</Text>
              ) : null}
              <Text style={styles.metaLine}>Date: {fmtDate(detail.createdAt)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 2026-10-04 (W10-B4b): purchase/cash flows are wired above; a
          submitted vend/cash-in is pending fulfillment and a cash-out is a
          provider-side settlement request — the ledger below carries the
          verbatim statuses, never a fabricated completion. */}
      <View style={[styles.section, styles.noteBox]}>
        <Text style={styles.noteText}>
          A submitted purchase or cash-in is pending until the provider confirms it; check the status in your history below. Cash-out settlement is entirely provider-side.
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
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#0f172a', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  monoRef: { fontSize: 13, fontWeight: '600', color: '#0f172a', fontFamily: 'monospace' as any },
  metaLine: { fontSize: 12, color: '#64748b', marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeOk: { backgroundColor: '#16a34a20' },
  badgePending: { backgroundColor: '#eab30820' },
  badgeBad: { backgroundColor: '#dc262620' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#334155', textTransform: 'uppercase' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 12, color: '#334155', fontWeight: '500' },
  sectionDesc: { fontSize: 12, color: '#64748b', marginBottom: 8 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  submitBtn: { backgroundColor: '#2563eb', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  outlineBtn: { borderWidth: 1, borderColor: '#2563eb', paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12, alignItems: 'center' },
  outlineBtnText: { color: '#2563eb', fontSize: 15, fontWeight: '700' },
  formError: { fontSize: 13, color: '#dc2626', marginTop: 10 },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 24, fontSize: 14 },
  noteBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 },
  noteText: { fontSize: 13, color: '#64748b' },
});
