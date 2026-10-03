import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-01 (W9-B3): premiumApi methods now throw honest errors (no premium
// endpoints exist on the BFF). The "Pay Now" button surfaces that honestly
// instead of silently doing nothing.
import { premiumApi, policyApi } from '../services/api';
import { useOfflineSync } from '../services/offlineSync';

export function PaymentsScreen() {
  const { getCachedData, setCachedData } = useOfflineSync();
  const { data } = useQuery({ queryKey: ['policies'], queryFn: async () => { try { const r = await policyApi.list(); await setCachedData('policies', r.data, 60 * 60 * 1000); return r.data; } catch { return await getCachedData('policies') || { policies: [] }; } } });
  const policies = data?.policies || [];
  const duePolicies = policies.filter((p: any) => p.status === 'active');

  async function handlePay(policyId: string) {
    try {
      await premiumApi.pay(policyId, {});
    } catch (e: any) {
      Alert.alert('Payment Unavailable', e?.message || 'In-app premium payment is not available yet.');
    }
  }

  return (
    <ScrollView style={s.container}>
      <View style={s.header}><Text style={s.title}>Payments</Text></View>
      <View style={s.card}>
        <Text style={s.cardTitle}>Upcoming Premiums</Text>
        {duePolicies.length === 0 ? <Text style={s.empty}>No upcoming payments</Text> : duePolicies.map((p: any) => (
          <View key={p.id} style={s.paymentRow}>
            <View><Text style={s.payType}>{p.type}</Text><Text style={s.payPolicy}>{p.policyNumber}</Text></View>
            <View style={s.payRight}><Text style={s.payAmount}>₦{p.premiumAmount?.toLocaleString()}</Text>
              <TouchableOpacity style={s.payBtn} onPress={() => handlePay(String(p.id))}><Text style={s.payBtnText}>Pay Now</Text></TouchableOpacity>
            </View>
          </View>
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.cardTitle}>Payment Methods</Text>
        {['Bank Transfer (GTBank, Zenith, Access)', 'Card Payment (Paystack)', 'USSD (*384*100#)', 'Mobile Money'].map((m) => (
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
  payRight: { alignItems: 'flex-end' }, payAmount: { fontSize: 16, fontWeight: '600', color: '#2563eb' },
  payBtn: { backgroundColor: '#2563eb', paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6, marginTop: 4 },
  payBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  methodRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }, methodText: { fontSize: 14, color: '#334155' },
});
