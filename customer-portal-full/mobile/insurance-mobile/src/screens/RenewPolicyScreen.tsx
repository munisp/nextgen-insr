import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { api } from '../services/api';

interface RenewablePolicy {
  id: number;
  policyNumber: string;
  type: string;
  premium: number;
  endDate: string;
  daysUntilExpiry: number;
}

export default function RenewPolicyScreen() {
  const [policies, setPolicies] = useState<RenewablePolicy[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadPolicies(); }, []);

  async function loadPolicies() {
    try {
      const data = await api.query('policies.list');
      const list = (Array.isArray(data) ? data : []).map((p: any) => ({
        ...p,
        daysUntilExpiry: Math.ceil((new Date(p.endDate || p.expiryDate).getTime() - Date.now()) / 86400000),
      })).filter((p: RenewablePolicy) => p.daysUntilExpiry < 90);
      setPolicies(list);
    } catch {} finally { setLoading(false); }
  }

  async function renewPolicy(policyId: number) {
    Alert.alert('Confirm Renewal', 'Proceed with policy renewal?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Renew', onPress: async () => {
        try {
          await api.mutate('policies.renew', { policyId });
          Alert.alert('Success', 'Policy renewal initiated. You will receive confirmation shortly.');
          loadPolicies();
        } catch { Alert.alert('Error', 'Renewal failed. Please try again.'); }
      }},
    ]);
  }

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#2563eb" /></View>;

  return (
    <View style={s.container}>
      <Text style={s.title}>Renew Policies</Text>
      <Text style={s.subtitle}>Policies expiring within 90 days</Text>
      <FlatList
        data={policies}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.row}>
              <View style={{ flex: 1 }}>
                <Text style={s.policyNum}>{item.policyNumber}</Text>
                <Text style={s.type}>{item.type}</Text>
              </View>
              <View style={[s.expiryBadge, item.daysUntilExpiry < 15 ? s.expiryUrgent : s.expiryWarning]}>
                <Text style={s.expiryText}>{item.daysUntilExpiry < 0 ? 'EXPIRED' : `${item.daysUntilExpiry}d left`}</Text>
              </View>
            </View>
            <View style={[s.row, { marginTop: 12 }]}>
              <Text style={s.premium}>₦{Number(item.premium).toLocaleString()}/yr</Text>
              <TouchableOpacity style={s.renewBtn} onPress={() => renewPolicy(item.id)}>
                <Text style={s.renewBtnText}>Renew Now</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>All policies are up to date</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b' },
  subtitle: { fontSize: 15, color: '#64748b', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  policyNum: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  type: { fontSize: 13, color: '#64748b', marginTop: 2 },
  premium: { fontSize: 16, fontWeight: '600', color: '#475569' },
  expiryBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  expiryUrgent: { backgroundColor: '#fee2e2' },
  expiryWarning: { backgroundColor: '#fef9c3' },
  expiryText: { fontSize: 12, fontWeight: '700', color: '#991b1b' },
  renewBtn: { backgroundColor: '#2563eb', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  renewBtnText: { color: '#fff', fontWeight: '700' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 16 },
});
