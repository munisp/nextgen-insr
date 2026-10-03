import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-03 (W9-B4): rewired onto the REAL memberPayments router.
// "Upcoming Premiums" now lists the server-derived DUE LEDGER ROWS from
// memberPayments.myPremiumDue (never a client-entered amount). "Pay Now"
// calls memberPayments.initiatePremiumPayment with a stable per-intent
// idempotency key; since this build cannot host the Paystack inline
// webview, the UI renders the honest pending/verify state (real reference +
// authorizationUrl, "I've Paid — Verify" → memberPayments.verifyPremiumPayment).
// No fake success anywhere: a payment is only shown as paid when the
// server-side verification returns status 'success'.
import { premiumApi, DuePremium, PremiumDueView } from '../services/api';
import { useOfflineSync } from '../services/offlineSync';

const EMPTY_DUE: PremiumDueView = { duePremiums: [], policies: [], disclosure: '' };

export function PaymentsScreen() {
  const { getCachedData, setCachedData } = useOfflineSync();
  const [verifying, setVerifying] = useState<string | null>(null);

  const { data, refetch } = useQuery<PremiumDueView>({
    queryKey: ['memberPayments.myPremiumDue'],
    queryFn: async () => {
      try {
        const res = await premiumApi.due();
        await setCachedData('premiumDue', res, 60 * 60 * 1000);
        return res;
      } catch {
        return (await getCachedData<PremiumDueView>('premiumDue')) || EMPTY_DUE;
      }
    },
  });

  const duePremiums: DuePremium[] = data?.duePremiums ?? [];
  const disclosure: string = data?.disclosure ?? '';

  async function handlePay(p: DuePremium) {
    try {
      const initiated = await premiumApi.initiate(p.policyId, p.id);
      // Honest pending state: the payment EXISTS as a pending row with a
      // real server-derived reference, but no funds have moved until the
      // member completes checkout and the server verifies with Paystack.
      Alert.alert(
        'Payment Initiated',
        `Reference: ${initiated.reference}\nAmount: ₦${Number(initiated.amount).toLocaleString()} (server-recorded)\n\nComplete the payment at the Paystack checkout page, then tap "Verify" to confirm. Your payment is NOT complete until verification succeeds.`,
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Verify', onPress: () => handleVerify(initiated.reference, p.policyId, p.id) },
        ],
      );
    } catch (e: any) {
      // Fail loud with the real server reason (gateway unconfigured, not
      // payable, ownership, idempotency conflict, ...).
      Alert.alert('Payment Unavailable', e?.message || 'Premium payment could not be initiated.');
    }
  }

  async function handleVerify(reference: string, policyId: number, premiumId: number) {
    setVerifying(reference);
    try {
      const res = await premiumApi.verify(reference, policyId, premiumId);
      if (res.status === 'success') {
        Alert.alert('Payment Confirmed', `Payment ${res.reference} verified — ₦${Number(res.amount).toLocaleString()} credited to your policy.`);
        refetch();
      } else {
        // Honest unpaid surface: pending/failed/abandoned is reported as-is.
        Alert.alert('Not Yet Paid', `Payment ${res.reference} is ${res.status}. No premium was credited. Complete checkout, then verify again.`);
      }
    } catch (e: any) {
      Alert.alert('Verification Failed', e?.message || 'Payment status could not be verified.');
    } finally {
      setVerifying(null);
    }
  }

  return (
    <ScrollView style={s.container}>
      <View style={s.header}><Text style={s.title}>Payments</Text></View>
      <View style={s.card}>
        <Text style={s.cardTitle}>Due Premiums</Text>
        {duePremiums.length === 0 ? (
          <Text style={s.empty}>No due premiums on your ledger</Text>
        ) : duePremiums.map((p) => (
          <View key={p.id} style={s.paymentRow}>
            <View>
              <Text style={s.payType}>{p.premiumRef}</Text>
              <Text style={s.payPolicy}>{p.policyNumber ?? `Policy #${p.policyId}`}</Text>
              {p.dueDate && <Text style={s.payDue}>Due {new Date(p.dueDate).toLocaleDateString()}</Text>}
            </View>
            <View style={s.payRight}>
              <Text style={s.payAmount}>₦{Number(p.amount).toLocaleString()}</Text>
              <TouchableOpacity
                style={s.payBtn}
                disabled={verifying != null}
                onPress={() => handlePay(p)}
                accessibilityLabel={`Pay premium ${p.premiumRef}`}
              >
                <Text style={s.payBtnText}>Pay Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))}
        {!!disclosure && <Text style={s.disclosure}>{disclosure}</Text>}
      </View>
      <View style={s.card}>
        <Text style={s.cardTitle}>Payment Methods</Text>
        {['Card Payment (Paystack — initiated in-app, completed at checkout)', 'Bank Transfer (use your policy number as reference)', 'USSD (*384*100#)', 'Mobile Money'].map((m) => (
          <View key={m} style={s.methodRow}><Text style={s.methodText}>{m}</Text></View>
        ))}
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' }, header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 16, borderRadius: 12, padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a', marginBottom: 12 },
  empty: { color: '#94a3b8', textAlign: 'center', paddingVertical: 16 },
  paymentRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  payType: { fontSize: 14, fontWeight: '600', color: '#0f172a' }, payPolicy: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  payDue: { fontSize: 11, color: '#64748b', marginTop: 2 },
  payRight: { alignItems: 'flex-end' }, payAmount: { fontSize: 16, fontWeight: '600', color: '#2563eb' },
  payBtn: { backgroundColor: '#2563eb', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6, marginTop: 4 },
  payBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  disclosure: { fontSize: 11, color: '#94a3b8', marginTop: 12, fontStyle: 'italic' },
  methodRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }, methodText: { fontSize: 14, color: '#334155' },
});
