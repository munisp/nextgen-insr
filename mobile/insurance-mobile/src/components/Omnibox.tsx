/**
 * Omnibox.tsx — 2026-10-25 (W11-B4b): natural-language omnibox on the
 * mobile Dashboard, consuming the W11-B4a server surface
 * (server/routers/memberIntent.ts → memberIntent.parseIntent /
 * resolvePayeeHint via intentApi). Mobile mirror of the web
 * client/src/pages/member/Omnibox.tsx.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PREFILL-ONLY (funds-critical): the omnibox NEVER executes a payment. │
 * │ A `ready` intent renders a confirmation card; the explicit Continue  │
 * │ CTA navigates into the EXISTING validated flow (Bills / Airtime /    │
 * │ Claims / Renewals) with the parsed values passed as `omniboxPrefill` │
 * │ route params — the screens land them in normal form state. The       │
 * │ member reviews and taps the normal Pay/Buy button; every existing    │
 * │ guard still runs on submit (validation, bounds, the W11-B3b anomaly  │
 * │ soft-confirm, the real two-phase capture). No auto-submit, no new    │
 * │ endpoint, no guard bypass.                                           │
 * │                                                                      │
 * │ clarify  → question/options render INLINE (conversation-style),      │
 * │            never guessed. unsupported → honest refusal + what IS     │
 * │            supported. parse error → fail-closed, NO navigation.      │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Instrumentation (services/uxTrack): omnibox_opened (first focus),
 * intent_parsed (metadata: intent TYPE only), prefill_applied (metadata:
 * rail only), clarify_shown (metadata: flow + missing COUNT only). Raw
 * text, amounts, identifiers are NEVER tracked.
 *
 * The only server call made here is memberIntent.parseIntent. Meter/phone/
 * amount values go to NO other endpoint — only into the existing forms.
 */
import React, { useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
} from 'react-native';
import { intentApi, type MemberIntentView } from '../services/api';
import { trackEvent } from '../services/uxTrack';

/** 2026-10-25 (W11-B4b): instrumentation flow name for this surface. */
const UX_FLOW = 'member-omnibox';

/** The one-shot prefill param the funds screens consume (BillsScreen /
 *  AirtimeScreen read route.params.omniboxPrefill once and clear it). */
export type OmniboxPrefillParam =
  | { rail: 'bill'; billerCode: string; customerNumber: string; amountNGN: number }
  | { rail: 'airtime'; network: string; phone: string; amountNGN: number }
  | { rail: 'momo'; provider: string; amountNGN: number };

type OmniboxState =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; intent: MemberIntentView; payeeLabel: string | null }
  | {
      phase: 'clarify';
      flow: MemberIntentView['flow'] | null;
      missing: string[];
      partial: Record<string, string | number>;
      reason: string;
    }
  | { phase: 'unsupported'; reason: string }
  | { phase: 'error' };

const fmtNgn = (n: number) => `₦${Number(n).toLocaleString('en-NG')}`;

/** Human summary line for the ready-intent confirmation card. */
export function intentSummary(intent: MemberIntentView): string {
  switch (intent.flow) {
    case 'airtime_vend':
      return `Buy ${fmtNgn(intent.amountNGN)} ${intent.network} airtime for ${intent.phone}`;
    case 'bill_pay':
      return `Pay ${fmtNgn(intent.amountNGN)} to ${intent.billerCode} for customer ${intent.customerNumber}`;
    case 'momo_cash_in':
      return `Cash in ${fmtNgn(intent.amountNGN)} to your ${intent.provider} wallet`;
    case 'navigate':
      return intent.target === 'claims_file' ? 'File a claim' : 'Renew a policy';
  }
}

function continueLabel(intent: MemberIntentView): string {
  switch (intent.flow) {
    case 'airtime_vend':
      return 'Continue to airtime';
    case 'bill_pay':
      return 'Continue to bill payment';
    case 'momo_cash_in':
      return 'Continue to cash-in';
    case 'navigate':
      return intent.target === 'claims_file' ? 'Go to claims' : 'Go to renewals';
  }
}

const MISSING_LABELS: Record<string, string> = {
  amount: 'the amount',
  phone: 'the phone number',
  network: 'the network (MTN, Glo, Airtel or 9mobile)',
  biller: 'the biller (e.g. Ikeja Electric, DSTV)',
  customerNumber: 'the customer / meter number',
  provider: 'the provider (MTN MoMo, Airtel Money, Glo Xtra or 9PSB)',
};

function clarifyQuestion(reason: string, missing: string[]): string {
  switch (reason) {
    case 'ambiguous_amounts':
      return 'I found more than one amount in that — please rephrase with a single amount.';
    case 'amount_out_of_bounds':
      return 'That amount is outside the allowed range for this payment — please enter an in-range amount.';
    case 'ambiguous_phones':
      return 'I found more than one phone number — please rephrase with a single phone number.';
    case 'conflicting_networks':
      return 'You named two different networks — please tell me which one.';
    case 'conflicting_billers':
      return 'You named two different billers — please tell me which one.';
    case 'conflicting_providers':
      return 'You named two different providers — please tell me which one.';
    case 'ambiguous_customer_numbers':
      return 'I found more than one customer / meter number — please rephrase with a single number.';
    default:
      return missing.length > 0
        ? `I need a bit more detail: ${missing.map((m) => MISSING_LABELS[m] ?? m).join(', ')}.`
        : 'I need a bit more detail — please rephrase.';
  }
}

function unsupportedMessage(reason: string): string {
  switch (reason) {
    case 'empty_input':
      return 'Type a request first — for example "buy ₦2,000 MTN airtime for 08031234567".';
    case 'data_bundle_not_supported':
      return "Data bundles aren't supported here — the airtime flow vends airtime credit only.";
    case 'bank_transfer_not_supported':
      return "Bank transfers aren't supported here.";
    case 'momo_cash_out_not_supported':
      return "Wallet cash-out isn't supported from the omnibox.";
    default:
      return reason.startsWith('provider_not_supported:')
        ? `That provider (${reason.slice('provider_not_supported:'.length).replace(/_/g, ' ')}) isn't supported here.`
        : "I couldn't turn that into a supported action.";
  }
}

const SUPPORTED_NOTE =
  'Supported: buy airtime (MTN / Glo / Airtel / 9mobile), pay a bill (e.g. Ikeja Electric, DSTV), cash in to a mobile-money wallet (MTN MoMo / Airtel Money / Glo Xtra / 9PSB), file a claim, or renew a policy.';

export function Omnibox({ navigation }: { navigation: any }) {
  const [text, setText] = useState('');
  const [state, setState] = useState<OmniboxState>({ phase: 'idle' });
  const [busy, setBusy] = useState(false);
  // omnibox_opened fires once per mount on FIRST focus.
  const openedTracked = useRef(false);

  const onFirstFocus = () => {
    if (openedTracked.current) return;
    openedTracked.current = true;
    trackEvent(UX_FLOW, 'omnibox_opened');
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setState({ phase: 'loading' });
    try {
      // The ONLY server call this component makes (parse-only mutation).
      const data = await intentApi.parse(trimmed);
      const result = data.result;
      // intent_parsed: the intent TYPE only — never text/amounts/identifiers.
      trackEvent(UX_FLOW, 'intent_parsed', { metadata: { intentType: result.status } });
      if (result.status === 'ready') {
        setState({ phase: 'ready', intent: result.intent, payeeLabel: data.payee?.label ?? null });
      } else if (result.status === 'clarification') {
        trackEvent(UX_FLOW, 'clarify_shown', {
          metadata: { flow: result.flow ?? 'none', missingCount: result.missing.length },
        });
        setState({
          phase: 'clarify',
          flow: result.flow,
          missing: result.missing,
          partial: result.partial,
          reason: result.reason,
        });
      } else {
        setState({ phase: 'unsupported', reason: result.reason });
      }
    } catch {
      // FAIL-CLOSED: a parse failure shows an honest error and NEVER
      // navigates or prefills anything.
      setState({ phase: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Continue = navigate into the existing flow with the parsed values as a
   * one-shot `omniboxPrefill` route param. The payment is NOT executed
   * here — the member reviews the prefilled form and taps the normal
   * Pay/Buy button (all guards re-run on submit).
   */
  const onContinue = (intent: MemberIntentView) => {
    switch (intent.flow) {
      case 'airtime_vend':
        trackEvent(UX_FLOW, 'prefill_applied', { metadata: { rail: 'airtime' } });
        navigation.navigate('Policies', {
          screen: 'Airtime',
          params: {
            omniboxPrefill: {
              rail: 'airtime',
              network: intent.network,
              phone: intent.phone,
              amountNGN: intent.amountNGN,
            } satisfies OmniboxPrefillParam,
          },
        });
        return;
      case 'bill_pay':
        trackEvent(UX_FLOW, 'prefill_applied', { metadata: { rail: 'bill' } });
        navigation.navigate('Policies', {
          screen: 'Bills',
          params: {
            omniboxPrefill: {
              rail: 'bill',
              billerCode: intent.billerCode,
              customerNumber: intent.customerNumber,
              amountNGN: intent.amountNGN,
            } satisfies OmniboxPrefillParam,
          },
        });
        return;
      case 'momo_cash_in':
        trackEvent(UX_FLOW, 'prefill_applied', { metadata: { rail: 'momo' } });
        navigation.navigate('Policies', {
          screen: 'Airtime',
          params: {
            omniboxPrefill: {
              rail: 'momo',
              provider: intent.provider,
              amountNGN: intent.amountNGN,
            } satisfies OmniboxPrefillParam,
          },
        });
        return;
      case 'navigate':
        // Navigation intent only — no payload is fabricated or carried.
        if (intent.target === 'claims_file') {
          navigation.navigate('Claims', { screen: 'FileClaim' });
        } else {
          navigation.navigate('Policies', { screen: 'Renewals' });
        }
        return;
    }
  };

  /** Option chip for a clarification: appends the choice to the input for
   *  the member to review and RE-SUBMIT explicitly — never an auto-guess. */
  const optionChips: string[] =
    state.phase === 'clarify'
      ? state.missing.includes('network')
        ? ['MTN', 'Glo', 'Airtel', '9mobile']
        : state.missing.includes('provider')
          ? ['MTN MoMo', 'Airtel Money', 'Glo Xtra', '9PSB']
          : []
      : [];

  return (
    <View style={styles.panel} testID="omnibox">
      <Text style={styles.title}>Tell me what you need</Text>
      <Text style={styles.subtitle}>
        Plain words, e.g. "buy ₦2,000 MTN airtime for 08031234567". Nothing is
        paid from here — you always review and confirm on the normal form.
      </Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          onFocus={onFirstFocus}
          maxLength={280}
          placeholder="What would you like to do?"
          accessibilityLabel="Omnibox request"
          editable={!busy}
          onSubmitEditing={submit}
          returnKeyType="go"
        />
        <TouchableOpacity
          style={[styles.goBtn, (!text.trim() || busy) && styles.goBtnDisabled]}
          onPress={submit}
          disabled={!text.trim() || busy}
          accessibilityLabel="Submit omnibox request"
          testID="omnibox-submit"
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.goText}>Go</Text>
          )}
        </TouchableOpacity>
      </View>

      {state.phase === 'ready' ? (
        <View style={styles.card} testID="omnibox-ready">
          <Text style={styles.cardTitle}>{intentSummary(state.intent)}</Text>
          {state.payeeLabel ? (
            <Text style={styles.cardMeta}>Matches your saved payee: {state.payeeLabel}</Text>
          ) : null}
          <Text style={styles.cardMeta}>
            Nothing is paid yet — Continue opens the normal form with these
            details prefilled for your review.
          </Text>
          <TouchableOpacity
            style={styles.continueBtn}
            onPress={() => onContinue(state.intent)}
            accessibilityLabel={continueLabel(state.intent)}
            testID="omnibox-continue"
          >
            <Text style={styles.continueText}>{continueLabel(state.intent)}</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {state.phase === 'clarify' ? (
        <View style={styles.card} testID="omnibox-clarify">
          <Text style={styles.cardTitle}>{clarifyQuestion(state.reason, state.missing)}</Text>
          {Object.keys(state.partial).length > 0 ? (
            <Text style={styles.cardMeta}>
              I got:{' '}
              {Object.entries(state.partial)
                .map(([k, v]) => `${k} = ${String(v)}`)
                .join(', ')}
            </Text>
          ) : null}
          {optionChips.length > 0 ? (
            <View style={styles.chipRow}>
              {optionChips.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={styles.chip}
                  onPress={() => setText((t) => `${t.trim()} ${opt}`.trim())}
                  accessibilityLabel={`Choose ${opt}`}
                  testID={`omnibox-chip-${opt}`}
                >
                  <Text style={styles.chipText}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ) : null}
          <Text style={styles.cardMeta}>Edit your request above and tap Go again.</Text>
        </View>
      ) : null}

      {state.phase === 'unsupported' ? (
        <View style={styles.card} testID="omnibox-unsupported">
          <Text style={styles.cardTitle}>{unsupportedMessage(state.reason)}</Text>
          <Text style={styles.cardMeta}>{SUPPORTED_NOTE}</Text>
        </View>
      ) : null}

      {state.phase === 'error' ? (
        <View style={[styles.card, styles.errorCard]} testID="omnibox-error">
          <Text style={styles.errorText}>
            Sorry, I couldn't read that right now. Please use the normal forms —
            nothing was sent or paid.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 16, marginTop: 20, backgroundColor: '#fff', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  title: { fontSize: 18, fontWeight: '600', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 4, marginBottom: 10 },
  inputRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderColor: '#cbd5e1', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: '#0f172a' },
  goBtn: { backgroundColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 18, borderRadius: 8, minWidth: 52, alignItems: 'center' },
  goBtnDisabled: { opacity: 0.5 },
  goText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  card: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginTop: 10 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  cardMeta: { fontSize: 12, color: '#64748b', marginTop: 4 },
  continueBtn: { backgroundColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8, marginTop: 10, alignSelf: 'flex-start' },
  continueText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: { borderWidth: 1, borderColor: '#2563eb', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 8 },
  chipText: { color: '#2563eb', fontSize: 13, fontWeight: '700' },
  errorCard: { borderColor: '#fecaca', backgroundColor: '#fef2f2' },
  errorText: { fontSize: 13, color: '#b91c1c' },
});
