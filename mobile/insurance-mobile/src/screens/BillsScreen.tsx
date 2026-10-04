import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 3): bills screen mirroring the web member portal
// MemberBills.tsx (W7-B10) on the REAL memberBillPayments router
// (server/routers/memberBillPayments.ts):
//   - billers          (biller catalog: commission rates, platform limits,
//                       honest provider `configured` flag; static registry,
//                       no DB)
//   - validateCustomer (format-only customer-number check — electricity
//                       10-13 digits, TV 10-12 digits, else >= 5 chars)
//
// NO PAY BUTTON — deliberate, web parity (MemberBills.tsx:13-19): the
// member router has NO pay-bill mutation (billPayments.pay is a `transfer`
// funds op the `user` role has no permission for; member history is not
// member-scopable). Any "Pay" button would be a fabricated action with no
// backend to honor it, so this screen shows the catalog + format validation
// only, with an honest note. Revisit when a member-safe pay mutation ships.
import { billsApi } from '../services/api';

const fmtNgn = (n: number) => `₦${Number(n).toLocaleString('en-NG')}`;

export function BillsScreen({ navigation }: { navigation: any }) {
  const [biller, setBiller] = useState<string>('');
  const [customerNumber, setCustomerNumber] = useState<string>('');
  // Submitted validation params — the query only fires after Validate (web
  // parity: enabled gate).
  const [check, setCheck] = useState<{ biller: string; customerNumber: string } | null>(null);

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

  const onValidate = () => {
    if (!chosenBiller || !customerNumber.trim()) return;
    setCheck({ biller: chosenBiller, customerNumber: customerNumber.trim() });
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
        <Text style={styles.sectionTitle}>Check a Customer Number</Text>
        <Text style={styles.sectionDesc}>
          Format check only — a valid result does not confirm the account with the biller and never authorises a payment.
        </Text>
        <Text style={styles.fieldLabel}>Biller</Text>
        <View style={styles.billerPicker}>
          {billers.map((b) => (
            <TouchableOpacity
              key={b.name}
              style={[styles.chip, chosenBiller === b.name && styles.chipActive]}
              onPress={() => setBiller(b.name)}
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
          onChangeText={setCustomerNumber}
          placeholder="e.g. 12345678901"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Customer number"
        />
        <TouchableOpacity
          style={[styles.submitBtn, (!chosenBiller || !customerNumber.trim()) && styles.submitDisabled]}
          disabled={!chosenBiller || !customerNumber.trim()}
          onPress={onValidate}
        >
          <Text style={styles.submitText}>Validate</Text>
        </TouchableOpacity>
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
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {/* 2026-10-03 (W9-B5 wave 3): honest note in place of a pay button —
          web parity (MemberBills.tsx:186-192). */}
      <View style={[styles.section, styles.noteBox]}>
        <Text style={styles.noteText}>
          Paying a bill is not available in this app yet — member-initiated bill pay has no backend on this deployment. Your payment history will appear here once member-initiated bill pay ships.
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
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  noteBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 },
  noteText: { fontSize: 13, color: '#64748b' },
});
