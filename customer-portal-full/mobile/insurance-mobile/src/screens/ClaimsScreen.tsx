import React, { useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { claimsApi } from '../services/api';
import { useOfflineSync } from '../services/offlineSync';

export function ClaimsScreen({ navigation }: { navigation: any }) {
  const [filter, setFilter] = useState('all');
  const { getCachedData, setCachedData } = useOfflineSync();

  const { data, isLoading } = useQuery({
    queryKey: ['claims'],
    queryFn: async () => {
      try {
        const res = await claimsApi.list();
        await setCachedData('claims', res.data, 30 * 60 * 1000);
        return res.data;
      } catch {
        return await getCachedData('claims') || { claims: [] };
      }
    },
  });

  const claims = (data?.claims || []).filter((c: any) => filter === 'all' || c.status === filter);
  const statusColor: Record<string, string> = { approved: '#16a34a', pending: '#eab308', rejected: '#dc2626', processing: '#2563eb' };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Claims</Text>
        <TouchableOpacity style={styles.newBtn} onPress={() => navigation.navigate('FileClaim')}>
          <Text style={styles.newBtnText}>+ New Claim</Text>
        </TouchableOpacity>
      </View>
      {/* Q4 (2026-09-25): one-tap photo reimbursement entry point. Routes to
          the existing FileClaim screen in reimbursement mode (camera flow +
          P-wave presigned upload + careRetention.photoReimbursementSubmit). */}
      <TouchableOpacity style={styles.reimburseBtn} onPress={() => navigation.navigate('FileClaim', { reimbursement: true })}>
        <Text style={styles.reimburseBtnText}>📷 Photo Reimbursement — snap a receipt, get reimbursed</Text>
      </TouchableOpacity>
      <View style={styles.filterRow}>
        {['all', 'pending', 'processing', 'approved', 'rejected'].map((f) => (
          <TouchableOpacity key={f} style={[styles.chip, filter === f && styles.chipActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.chipText, filter === f && { color: '#fff' }]}>{f}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={claims}
        keyExtractor={(item: any) => item.id}
        renderItem={({ item }: { item: any }) => (
          <TouchableOpacity style={styles.card} onPress={() => navigation.navigate('ClaimDetail', { claimId: item.id })}>
            <View style={styles.cardHeader}>
              <Text style={styles.claimType}>{item.type}</Text>
              <View style={[styles.status, { backgroundColor: (statusColor[item.status] || '#64748b') + '20' }]}>
                <Text style={{ color: statusColor[item.status] || '#64748b', fontSize: 11, fontWeight: '600' }}>{item.status}</Text>
              </View>
            </View>
            <Text style={styles.claimId}>#{item.id?.slice(-8)}</Text>
            <View style={styles.cardFooter}>
              <Text style={styles.amount}>₦{(item.amount || 0).toLocaleString()}</Text>
              <Text style={styles.date}>{new Date(item.filedAt).toLocaleDateString()}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No claims found'}</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  newBtn: { backgroundColor: '#2563eb', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  newBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  // Q4 (2026-09-25): photo reimbursement entry.
  reimburseBtn: { marginHorizontal: 16, marginBottom: 12, backgroundColor: '#059669', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  reimburseBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 12, color: '#64748b', fontWeight: '500', textTransform: 'capitalize' },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 10, borderRadius: 12, padding: 16 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  claimType: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  status: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  claimId: { fontSize: 12, color: '#94a3b8', fontFamily: 'monospace', marginTop: 4 },
  cardFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  amount: { fontSize: 16, fontWeight: '600', color: '#2563eb' },
  date: { fontSize: 13, color: '#94a3b8' },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 40 },
});
