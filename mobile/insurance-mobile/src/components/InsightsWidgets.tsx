/**
 * InsightsWidgets.tsx — 2026-10-24 (W11-B3b): presentational widgets for the
 * Phase 3 member-intelligence UX guards (services/insightsGuards.ts), shared
 * by BillsScreen / AirtimeScreen (web parity: insightsGuards.tsx dialogs).
 *
 *   AnomalySoftConfirm — inline soft-confirm shown when
 *     memberInsights.amountAnomalyCheck returns anomalous:true. Requires ONE
 *     explicit extra tap ("Confirm amount") before the payment proceeds;
 *     "Go back" simply closes (nothing is submitted or aborted). UX-ONLY —
 *     NOT a security gate.
 *   RecurringPromptNote — the one-time "monthly payment" prompt after a
 *     terminal confirm; dismissible.
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const fmtNgnFromKobo = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

export function AnomalySoftConfirm({
  amountKobo,
  multiple,
  onConfirm,
  onCancel,
}: {
  amountKobo: number;
  multiple: number | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.confirmBox} testID="anomaly-soft-confirm" accessibilityRole="alert">
      <Text style={styles.confirmText}>
        {fmtNgnFromKobo(amountKobo)} is {multiple != null ? `${multiple}×` : 'more than'} your usual
        payment to this payee — confirm?
      </Text>
      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.confirmBtn} onPress={onConfirm} accessibilityLabel="Confirm amount">
          <Text style={styles.confirmBtnText}>Confirm amount</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.cancelBtn} onPress={onCancel} accessibilityLabel="Go back">
          <Text style={styles.cancelBtnText}>Go back</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function RecurringPromptNote({
  cadenceDays,
  onDismiss,
}: {
  cadenceDays: number;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.promptBox} testID="recurring-prompt">
      <Text style={styles.promptText}>
        This looks like a monthly payment (every ~{cadenceDays} days) — we'll remind you next month.
      </Text>
      <TouchableOpacity style={styles.cancelBtn} onPress={onDismiss} accessibilityLabel="Dismiss recurring prompt">
        <Text style={styles.cancelBtnText}>Dismiss</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  confirmBox: { borderWidth: 1, borderColor: '#f59e0b', backgroundColor: '#fffbeb', borderRadius: 10, padding: 12, marginTop: 12 },
  confirmText: { fontSize: 14, color: '#0f172a' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  confirmBtn: { backgroundColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  confirmBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  cancelBtn: { borderWidth: 1, borderColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  cancelBtnText: { color: '#2563eb', fontSize: 13, fontWeight: '700' },
  promptBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  promptText: { fontSize: 13, color: '#334155', flex: 1 },
});
