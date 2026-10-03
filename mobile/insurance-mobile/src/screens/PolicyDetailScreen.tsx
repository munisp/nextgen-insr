import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-03 (W9-B4): detail now comes from memberPolicies.myPolicy (real,
// caller-scoped, NOT_FOUND on foreign id). The old fabricated "Deductible ₦0"
// row and empty "Coverage Items" card are removed — the real procedure does
// not return those fields. "Renew Policy" is wired to the REAL
// memberRenewals.requestRenewal mutation (was a dead button).
import { policyApi } from '../services/api';
import { useOfflineSync } from '../services/offlineSync';

export function PolicyDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const { policyId } = route.params;
  const { getCachedData, setCachedData } = useOfflineSync();
  const [renewing, setRenewing] = React.useState(false);

  const { data: policy, isLoading } = useQuery<any>({
    queryKey: ['policy', policyId],
    queryFn: async () => {
      try {
        const res = await policyApi.getById(policyId);
        await setCachedData(`policy_${policyId}`, res.data, 30 * 60 * 1000);
        return res.data;
      } catch {
        return await getCachedData(`policy_${policyId}`);
      }
    },
  });

  async function handleRenew() {
    setRenewing(true);
    try {
      await policyApi.renew(policy.id);
      Alert.alert('Renewal Requested', 'Your renewal request was recorded. Your agent will confirm the renewed policy.');
    } catch (e: any) {
      // Fail loud with the real server reason (not renewable status,
      // duplicate open renewal, ...). Never a fake success.
      Alert.alert('Renewal Unavailable', e?.message || 'This policy cannot be renewed in the app right now.');
    } finally {
      setRenewing(false);
    }
  }

  if (isLoading || !policy) {
    return <View style={styles.center}><Text>Loading...</Text></View>;
  }

  const statusColor: Record<string, string> = { active: '#16a34a', expired: '#dc2626', pending: '#eab308' };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{policy.type} Insurance</Text>
        <View style={[styles.badge, { backgroundColor: (statusColor[policy.status] || '#64748b') + '20' }]}>
          <Text style={[styles.badgeText, { color: statusColor[policy.status] || '#64748b' }]}>{policy.status}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Policy Details</Text>
        {[
          ['Policy Number', policy.policyNumber],
          ['Provider', policy.provider],
          ['Start Date', new Date(policy.startDate).toLocaleDateString()],
          ['End Date', new Date(policy.endDate).toLocaleDateString()],
          ['Premium', `₦${policy.premiumAmount?.toLocaleString()}/year`],
          ['Coverage', `₦${(policy.coverageAmount / 1_000_000).toFixed(1)}M`],
          // 2026-10-03 (W9-B4): only real memberPolicies.myPolicy fields below.
          ...(policy.certificateNumber ? [['Certificate', policy.certificateNumber]] : []),
          ...(policy.renewalDate ? [['Renewal Date', new Date(policy.renewalDate).toLocaleDateString()]] : []),
        ].map(([label, value]) => (
          <View key={label} style={styles.row}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.value}>{value}</Text>
          </View>
        ))}
      </View>

      {/* 2026-10-03 (W9-B4): the old "Coverage Items" card rendered a
          permanently empty list — memberPolicies.myPolicy has no such field.
          Removed rather than rendered as a fake empty state. */}

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={() => navigation.navigate('Claims', { screen: 'FileClaim', params: { policyId } })}>
          <Text style={styles.actionText}>File Claim</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.renewBtn]} disabled={renewing} onPress={handleRenew}>
          <Text style={[styles.actionText, { color: '#2563eb' }]}>{renewing ? 'Requesting…' : 'Renew Policy'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.actionBtn, styles.docBtn]}>
          <Text style={[styles.actionText, { color: '#64748b' }]}>View Documents</Text>
        </TouchableOpacity>
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 20 },
  backBtn: { fontSize: 16, color: '#2563eb', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginTop: 8 },
  badgeText: { fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 16, borderRadius: 12, padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#0f172a', marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  label: { fontSize: 14, color: '#64748b' },
  value: { fontSize: 14, fontWeight: '500', color: '#0f172a' },
  coverageItem: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8 },
  coverageName: { fontSize: 14, color: '#334155' },
  coverageLimit: { fontSize: 14, fontWeight: '500', color: '#0f172a' },
  actions: { paddingHorizontal: 16, gap: 10 },
  actionBtn: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  actionText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  renewBtn: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#2563eb' },
  docBtn: { backgroundColor: '#f1f5f9' },
});
