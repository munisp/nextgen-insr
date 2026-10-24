/**
 * BillScanSection.tsx — 2026-10-25 (W11-B4c-3): mobile OCR bill-scan intake
 * for the member bill/airtime rails over memberBillScan.parse
 * (server/routers/memberBillScan.ts, W11-B4c-1; web/server contract:
 * EXTRACT-ONLY — the image is processed in-memory and discarded, no funds
 * row is ever written).
 *
 * PREFILL-ONLY, funds-critical:
 *   - The member explicitly chooses "Take photo" / "Choose from library"
 *     (inline ActionSheet-style choice; react-native-image-picker with
 *     includeBase64, quality ~0.7, max 1600px).
 *   - ok + prefill → a REVIEW card ("Scanned from photo — review before
 *     paying") showing the extracted values. "Apply" hands IDENTIFIERS
 *     ONLY to the host screen's existing prefill path (biller applied only
 *     on a catalog match, amount always cleared, validation/capture state
 *     reset — the same contract as RecentPayeePicker's onPayeeSelect).
 *   - The extracted AMOUNT is rendered as a separate suggestion chip that
 *     requires an explicit tap to fill the amount field — it is NEVER set
 *     silently and nothing is ever auto-submitted; the normal Pay/Vend +
 *     anomaly soft-confirm flow is untouched.
 *   - unavailable / low_confidence / error / network failure → the honest
 *     server message (or a fail-closed network message) is shown inline
 *     and the form stays fully usable. No extraction is ever fabricated.
 *
 * Instrumentation (services/uxTrack.ts): flow "bill_scan", events
 * scan_started / scan_succeeded / scan_failed with metadata {rail, status}
 * ONLY — the mobile transport has no kind gate, so the scrub discipline is
 * manual: extracted values (biller/meter/amount) are NEVER tracked here.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  type ImagePickerResponse,
} from 'react-native-image-picker';

import { scanApi, type BillScanResult } from '../services/api';
import { trackEvent } from '../services/uxTrack';

const fmtNgnFromKobo = (kobo: number) =>
  `₦${(kobo / 100).toLocaleString('en-NG')}`;

/** Identifiers extracted by the scan, handed to the host screen's existing
 *  prefill path. The AMOUNT is deliberately NOT part of this object. */
export interface BillScanIdentifiers {
  billerCode?: string;
  customerNumber?: string;
}

export function BillScanSection({
  rail,
  onApply,
  onApplyAmount,
}: {
  rail: 'bill' | 'airtime';
  /** Apply the extracted IDENTIFIERS (biller + customer number) through the
   *  host screen's normal prefill/reset path. */
  onApply: (ids: BillScanIdentifiers) => void;
  /** Explicit amount-chip tap: fill the amount field with the suggested
   *  amount (kobo). Never invoked automatically. */
  onApplyAmount: (amountKobo: number) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<BillScanResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [amountApplied, setAmountApplied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const runPicker = async (source: 'camera' | 'library') => {
    setChoosing(false);
    const fn = source === 'camera' ? launchCamera : launchImageLibrary;
    let result: ImagePickerResponse;
    try {
      result = await fn({
        mediaType: 'photo',
        includeBase64: true,
        quality: 0.7,
        maxWidth: 1600,
        maxHeight: 1600,
      });
    } catch {
      // Picker bridge itself failed — fail closed, no scan attempted.
      setNotice('The photo picker could not be opened. Please enter the details manually.');
      return;
    }
    if (result.didCancel) return;
    const base64 = result.assets?.[0]?.base64;
    if (!base64) {
      // Honest failure: the OS handed back no usable image data (and any
      // picker error is surfaced rather than swallowed).
      setNotice(
        result.errorMessage
          ? `The photo could not be read (${result.errorMessage}). Please enter the details manually.`
          : 'No photo data was returned. Please enter the details manually.',
      );
      return;
    }

    trackEvent('bill_scan', 'scan_started', { metadata: { rail } });
    setBusy(true);
    setNotice(null);
    setReview(null);
    setApplied(false);
    setAmountApplied(false);
    try {
      const res = await scanApi.parseBill({ imageBase64: base64, rail });
      if (res.status === 'ok' && res.mode === 'prefill' && res.prefill) {
        setReview(res);
        trackEvent('bill_scan', 'scan_succeeded', {
          metadata: { rail, status: res.status },
        });
      } else {
        // unavailable / low_confidence / error — honest manual-entry
        // fallback with the server's verbatim message; nothing prefilled.
        setNotice(res.message || 'The bill could not be scanned. Please enter the details manually.');
        trackEvent('bill_scan', 'scan_failed', {
          metadata: { rail, status: res.status },
        });
      }
    } catch {
      // Network/transport failure — fail closed, form fully usable.
      setNotice('The bill could not be scanned right now (network or sign-in issue). Please enter the details manually.');
      trackEvent('bill_scan', 'scan_failed', {
        metadata: { rail, status: 'error' },
      });
    } finally {
      setBusy(false);
    }
  };

  const prefill = review?.prefill;
  const suggestedAmountKobo =
    prefill && typeof prefill.amountKobo === 'number' && prefill.amountKobo > 0
      ? prefill.amountKobo
      : null;

  return (
    <View style={styles.wrap} testID={`scan-section-${rail}`}>
      <TouchableOpacity
        style={styles.scanBtn}
        onPress={() => setChoosing((c) => !c)}
        disabled={busy}
        testID={`scan-open-${rail}`}
        accessibilityLabel="Scan a bill"
      >
        <Text style={styles.scanBtnText}>{busy ? 'Scanning…' : '📷 Scan a bill'}</Text>
      </TouchableOpacity>

      {choosing && !busy ? (
        <View style={styles.choiceRow} testID={`scan-choices-${rail}`}>
          <TouchableOpacity
            style={styles.choiceBtn}
            onPress={() => void runPicker('camera')}
            testID={`scan-camera-${rail}`}
          >
            <Text style={styles.choiceBtnText}>Take photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.choiceBtn}
            onPress={() => void runPicker('library')}
            testID={`scan-library-${rail}`}
          >
            <Text style={styles.choiceBtnText}>Choose from library</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.choiceBtn}
            onPress={() => setChoosing(false)}
            testID={`scan-cancel-${rail}`}
          >
            <Text style={styles.choiceBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {busy ? (
        <View style={styles.stateRow}>
          <ActivityIndicator color="#2563eb" />
          <Text style={styles.stateText}>Scanning the photo…</Text>
        </View>
      ) : null}

      {notice ? (
        <View style={styles.noticeBox} testID={`scan-notice-${rail}`}>
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      {/* 2026-10-24 (W11-B4c-3 verifier M2): the review card renders ONLY
          on a strict ok+prefill verdict — a non-ok response carrying a stray
          `prefill` object must NEVER surface as an extraction proposal
          (defense in depth; the ok-branch already gates setReview). */}
      {review && review.status === 'ok' && review.mode === 'prefill' && prefill ? (
        <View style={styles.reviewCard} testID={`scan-review-${rail}`}>
          <Text style={styles.reviewTitle}>Scanned from photo — review before paying</Text>
          <Text style={styles.reviewHint}>
            Nothing has been paid or saved. Apply the details below, then validate and pay as usual.
          </Text>
          {prefill.billerCode ? (
            <Text style={styles.reviewRow} testID={`scan-biller-${rail}`}>
              Biller: {prefill.billerCode}
            </Text>
          ) : null}
          {prefill.customerNumber ? (
            <Text style={styles.reviewRow} testID={`scan-customer-${rail}`}>
              {rail === 'airtime' ? 'Phone' : 'Customer / meter'}: {prefill.customerNumber}
            </Text>
          ) : null}
          {suggestedAmountKobo !== null ? (
            <View style={styles.amountRow}>
              <Text style={styles.reviewRow}>Amount on the bill: {fmtNgnFromKobo(suggestedAmountKobo)}</Text>
              {/* The amount is a SUGGESTION only — an explicit tap fills the
                  amount field; it is never set silently. */}
              <TouchableOpacity
                style={styles.amountChip}
                onPress={() => {
                  onApplyAmount(suggestedAmountKobo);
                  setAmountApplied(true);
                }}
                testID={`scan-amount-${rail}`}
                accessibilityLabel={`Use scanned amount ${fmtNgnFromKobo(suggestedAmountKobo)}`}
              >
                <Text style={styles.amountChipText}>
                  {amountApplied ? '✓ Amount filled' : `Use ${fmtNgnFromKobo(suggestedAmountKobo)}`}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {typeof review.confidence === 'number' ? (
            <Text style={styles.reviewHint}>Scan confidence: {review.confidence.toFixed(2)}</Text>
          ) : null}
          <View style={styles.reviewActions}>
            <TouchableOpacity
              style={styles.applyBtn}
              onPress={() => {
                // IDENTIFIERS ONLY — the amount is applied solely via the
                // suggestion chip above (explicit tap), never here.
                onApply({
                  ...(prefill.billerCode ? { billerCode: prefill.billerCode } : {}),
                  ...(prefill.customerNumber ? { customerNumber: prefill.customerNumber } : {}),
                });
                setApplied(true);
                trackEvent('bill_scan', 'prefill_applied', { metadata: { rail } });
              }}
              testID={`scan-apply-${rail}`}
              accessibilityLabel="Apply scanned details"
            >
              <Text style={styles.applyBtnText}>{applied ? '✓ Applied' : 'Apply'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dismissBtn}
              onPress={() => setReview(null)}
              testID={`scan-dismiss-${rail}`}
            >
              <Text style={styles.dismissBtnText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12 },
  scanBtn: {
    borderWidth: 1, borderColor: '#2563eb', borderRadius: 12,
    paddingVertical: 12, alignItems: 'center',
  },
  scanBtnText: { color: '#2563eb', fontSize: 14, fontWeight: '700' },
  choiceRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  choiceBtn: {
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9',
  },
  choiceBtnText: { fontSize: 13, color: '#334155', fontWeight: '600' },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  stateText: { fontSize: 13, color: '#64748b' },
  noticeBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginTop: 10 },
  noticeText: { fontSize: 13, color: '#64748b' },
  reviewCard: {
    borderWidth: 1, borderColor: '#2563eb', borderRadius: 10, padding: 12, marginTop: 10,
    backgroundColor: '#eff6ff',
  },
  reviewTitle: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  reviewHint: { fontSize: 12, color: '#64748b', marginTop: 4 },
  reviewRow: { fontSize: 13, color: '#0f172a', marginTop: 6 },
  amountRow: { marginTop: 4 },
  amountChip: {
    alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 8, backgroundColor: '#2563eb',
  },
  amountChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  reviewActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  applyBtn: {
    backgroundColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10,
  },
  applyBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  dismissBtn: {
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, borderColor: '#cbd5e1',
  },
  dismissBtnText: { color: '#64748b', fontSize: 13, fontWeight: '600' },
});
