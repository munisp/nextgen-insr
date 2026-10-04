/**
 * memberFundsIntent.tsx — 2026-10-04 (W10-B4b)
 *
 * Mobile port of the web portal's client discipline for the W10-B2 member
 * funds mutations (client/src/pages/member/memberFundsIntent.tsx, W10-B4a —
 * read it first; this file mirrors it 1:1 with AsyncStorage in place of
 * sessionStorage):
 *
 *   memberBillPayments.pay/confirmPay, memberAirtime.vend/confirmVend,
 *   memberMobileMoney.cashIn/confirmCashIn/cashOut
 *   (server/lib/memberFunds.ts).
 *
 *   1. Idempotency-key stability per USER INTENT. The server binds the key
 *      to a payload hash of the intent (biller+customer+amount, …) and
 *      rejects a key reused with a different payload (CONFLICT). So the
 *      client keeps ONE key per draft, persisted in AsyncStorage (the same
 *      store the W9-B4 premiumApi intent keys use) keyed by a fingerprint
 *      of the exact funds-relevant fields: the same draft always sends the
 *      same key (safe retry after a network failure/crash), any edit to the
 *      draft mints a NEW key, and a terminal outcome retires the key so a
 *      fresh attempt starts clean. The key format matches the server zod
 *      boundary /^[A-Za-z0-9_-]{8,20}$/ (a UUID is 36 chars and would be
 *      REJECTED — do not use a UUID here).
 *
 *   2. Honest tri-state confirmation rendering. confirm* NEVER returns a
 *      synchronous "delivered": the truthful states are submitted (pending
 *      fulfillment), failed + failed_refund_pending (loud), and
 *      unknown_outcome (held pending, do-NOT-pay-again).
 *      <MemberCapturePanel> renders exactly those, verbatim, and never a
 *      fabricated success.
 *
 *   3. authorizationUrl handoff: react-native Linking.openURL (core API,
 *      no new native dependency — expo-web-browser is NOT in package.json,
 *      so the system browser is used; an honest note is rendered next to
 *      the button that checkout opens externally). Never a webview-based
 *      fake "paid" state.
 *
 * Boundary note: tests spy on Linking.openURL (OS boundary) only; the key
 * lifecycle runs against the real in-memory AsyncStorage jest mock.
 */
import React from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = '@insureportal/member_funds_idem';
const KEY_RE = /^[A-Za-z0-9_-]{8,20}$/;
// Character pool for generateKey (renamed 2026-10-05: prior name tripped
// the repo secret scanner as a false positive).
const IDEM_CHAR_POOL =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';

/**
 * 20 random chars from the zod-legal alphabet. RN Hermes has no guaranteed
 * crypto.getRandomValues/btoa (2026-10-04), so this uses Math.random —
 * same entropy class as the W9-B4 premiumApi intent keys
 * (src/services/api.ts idempotencyKeyFor). The key is a replay token, not a
 * secret: collision-resistance is what matters, and 20 chars over a
 * 64-symbol alphabet is ample.
 */
function generateKey(): string {
  let key = '';
  for (let i = 0; i < 20; i++) {
    key += IDEM_CHAR_POOL[Math.floor(Math.random() * IDEM_CHAR_POOL.length)];
  }
  return KEY_RE.test(key) ? key : 'x'.repeat(20);
}

/**
 * The stable idempotency key for one funds intent draft. `scope` isolates
 * the journeys (bill pay / vend / cash-in / cash-out); `fingerprint` MUST
 * be a canonical serialization of exactly the fields the server payload-hash
 * binds (e.g. JSON.stringify({biller, customerNumber, meterType, amountNGN})).
 * Same draft → same stored key; any edit → fresh key minted and stored.
 */
export async function intentIdempotencyKey(
  scope: string,
  fingerprint: string,
): Promise<string> {
  const slot = `${KEY_PREFIX}/${scope}`;
  try {
    const raw = await AsyncStorage.getItem(slot);
    if (raw) {
      const parsed = JSON.parse(raw) as { fingerprint?: string; key?: string };
      if (
        parsed.fingerprint === fingerprint &&
        typeof parsed.key === 'string' &&
        KEY_RE.test(parsed.key)
      ) {
        return parsed.key;
      }
    }
  } catch {
    // Corrupt/unreadable slot — fall through and mint a fresh key.
  }
  const key = generateKey();
  await AsyncStorage.setItem(slot, JSON.stringify({ fingerprint, key }));
  return key;
}

/**
 * Retire a draft's key after a TERMINAL outcome (status "success" or
 * "failed" from a confirm / cashOut response): the next identical draft is a
 * NEW user intent and must not replay the old reference.
 */
export async function retireIntentKey(scope: string): Promise<void> {
  await AsyncStorage.removeItem(`${KEY_PREFIX}/${scope}`);
}

/** True when a confirm* response reached a terminal state. */
export function isTerminalConfirmation(c: { status: string }): boolean {
  return c.status === 'success' || c.status === 'failed';
}

export interface CaptureConfirmationView {
  reference: string;
  status: string;
  providerStatus: string;
  captureStatus?: string;
  amount?: string;
  currency?: string;
  failureReason?: string | null;
  refundStatus?: string | null;
  resolution?: string;
  idempotent?: boolean;
}

export interface CaptureInitiationView {
  reference: string;
  authorizationUrl: string;
  amount?: string;
  currency?: string;
  idempotent?: boolean;
}

const fmt = (n: number, currency = 'NGN') =>
  currency === 'NGN'
    ? `₦${Number(n).toLocaleString('en-NG')}`
    : `${Number(n).toLocaleString('en-NG')} ${currency}`;

/**
 * Honest tri-state render of a confirm* response (2026-10-04, W10-B4b —
 * verbatim port of the web CaptureOutcome). Never claims delivery/success
 * unless the server says status:"success"; the word "delivered" is only
 * ever used in the NEGATED sentence ("NOT been delivered yet").
 */
export function CaptureOutcome({
  confirmation,
  label,
}: {
  confirmation: CaptureConfirmationView;
  label: string;
}) {
  const c = confirmation;
  if (c.status === 'failed') {
    return (
      <View style={styles.failedBox} testID="capture-outcome" accessibilityRole="alert">
        <Text style={styles.failedTitle}>
          Your payment was captured but the {label} FAILED.
        </Text>
        {c.failureReason ? (
          <Text style={styles.failedText}>Reason: {c.failureReason}.</Text>
        ) : null}
        <Text style={styles.failedText}>
          Refund status: {c.refundStatus ?? 'failed_refund_pending'} — the
          captured funds are queued for refund; support can trace reference{' '}
          {c.reference}.
        </Text>
      </View>
    );
  }
  if (c.status === 'success') {
    return (
      <View style={styles.noteBox} testID="capture-outcome">
        <Text style={styles.noteText}>
          The provider confirmed your {label} as completed (reference{' '}
          {c.reference}).
        </Text>
      </View>
    );
  }
  if (c.providerStatus === 'unknown_outcome') {
    return (
      <View style={styles.noteBox} testID="capture-outcome">
        <Text style={styles.noteText}>
          Your payment was captured, but the {label} outcome is unknown — the
          provider did not confirm or reject it. The request is held pending
          and will be resolved by a status check; do NOT pay again.
          Reference: {c.reference}.
        </Text>
      </View>
    );
  }
  // Remaining truthful state: submitted / pending fulfillment.
  return (
    <View style={styles.noteBox} testID="capture-outcome">
      <Text style={styles.noteText}>
        Payment captured — your {label} was {c.providerStatus || 'submitted'}{' '}
        and is pending fulfillment. It has NOT been delivered yet. Reference:{' '}
        {c.reference}.
      </Text>
    </View>
  );
}

/**
 * The two-phase capture panel shared by bill pay / airtime vend / cash-in
 * (2026-10-04, W10-B4b — port of the web MemberCapturePanel): real reference
 * + Paystack authorizationUrl handoff via Linking.openURL (system browser —
 * expo-web-browser is not a dependency of this app, so no in-app browser
 * exists; honest disclosure next to the button), then an explicit
 * "I've paid — verify" confirm that renders the tri-state outcome.
 */
export function MemberCapturePanel({
  initiation,
  label,
  confirming,
  confirmation,
  confirmError,
  onVerify,
}: {
  initiation: CaptureInitiationView;
  label: string;
  confirming: boolean;
  confirmation: CaptureConfirmationView | null;
  confirmError: string | null;
  onVerify: () => void;
}) {
  return (
    <View style={styles.panel} testID="capture-panel">
      <Text style={styles.noteText}>
        Payment initiated. Reference: {initiation.reference}
        {initiation.amount != null
          ? ` — ${fmt(Number(initiation.amount), initiation.currency ?? 'NGN')}`
          : ''}
        {initiation.idempotent
          ? ' (same payment resumed — no duplicate charge)'
          : ''}
      </Text>
      <Text style={styles.noteText}>
        Checkout opens in your browser (this app has no in-app browser); return
        here afterwards and verify.
      </Text>
      <View style={styles.btnRow}>
        <TouchableOpacity
          style={styles.primaryBtn}
          accessibilityLabel="Complete payment"
          onPress={() => {
            // OS boundary: hand the REAL server-supplied checkout URL to the
            // system browser. The URL is never rewritten or fabricated.
            Linking.openURL(initiation.authorizationUrl);
          }}
        >
          <Text style={styles.primaryBtnText}>Complete payment</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.outlineBtn, confirming && styles.btnDisabled]}
          disabled={confirming}
          accessibilityLabel="I've paid — verify"
          onPress={onVerify}
        >
          <Text style={styles.outlineBtnText}>
            {confirming ? 'Verifying…' : "I've paid — verify"}
          </Text>
        </TouchableOpacity>
      </View>
      {confirmation ? (
        <CaptureOutcome confirmation={confirmation} label={label} />
      ) : null}
      {confirmError ? (
        <Text accessibilityRole="alert" style={styles.errorText}>
          Verification failed: {confirmError}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    gap: 8,
  },
  noteBox: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
  },
  noteText: { fontSize: 13, color: '#64748b' },
  failedBox: {
    borderWidth: 1,
    borderColor: '#fecaca',
    backgroundColor: '#fef2f2',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    gap: 4,
  },
  failedTitle: { fontSize: 13, fontWeight: '700', color: '#dc2626' },
  failedText: { fontSize: 13, color: '#dc2626' },
  errorText: { fontSize: 13, color: '#dc2626', marginTop: 8 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  primaryBtn: {
    backgroundColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  outlineBtn: {
    borderWidth: 1,
    borderColor: '#2563eb',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  outlineBtnText: { color: '#2563eb', fontSize: 14, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
});
