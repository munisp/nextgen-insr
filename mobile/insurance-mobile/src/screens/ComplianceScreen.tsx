import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../store/authStore';
import { useOfflineSync } from '../services/offlineSync';

const API_BASE = 'http://localhost:3000/api/trpc';

export function ComplianceScreen() {
  const { token } = useAuth();
  const { getCachedData, setCachedData } = useOfflineSync();
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: reports, isLoading, refetch } = useQuery({
    queryKey: ['compliance.list'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/compliance.list`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        const data = json?.result?.data || json || [];
        await setCachedData('compliance', data, 300000);
        return Array.isArray(data) ? data : [];
      } catch {
        return (await getCachedData('compliance')) || [];
      }
    },
  });

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const statusColors: Record<string, string> = { completed: '#10b981', in_progress: '#f59e0b', pending: '#94a3b8', overdue: '#ef4444' };

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Compliance & Regulatory</Text>
      <Text style={styles.subtitle}>NAICOM compliance reports and filing status</Text>

      {isLoading ? (
        <View style={styles.card}><Text style={styles.empty}>Loading compliance data...</Text></View>
      ) : reports?.length === 0 ? (
        <View style={styles.card}><Text style={styles.empty}>No compliance reports</Text></View>
      ) : (
        reports?.map((r: any) => (
          <View key={r.id} style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.reportType}>{r.reportType}</Text>
              <View style={[styles.statusBadge, { backgroundColor: statusColors[r.status] || '#94a3b8' }]}>
                <Text style={styles.statusText}>{r.status}</Text>
              </View>
            </View>
            <Text style={styles.period}>Period: {r.period}</Text>
            <View style={styles.alertsRow}>
              <View style={[styles.alertBadge, { backgroundColor: '#fee2e2' }]}><Text style={styles.alertCount}>{r.highAlerts || 0} High</Text></View>
              <View style={[styles.alertBadge, { backgroundColor: '#fef3c7' }]}><Text style={styles.alertCount}>{r.mediumAlerts || 0} Medium</Text></View>
              <View style={[styles.alertBadge, { backgroundColor: '#f0fdf4' }]}><Text style={styles.alertCount}>{r.lowAlerts || 0} Low</Text></View>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#64748b', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  reportType: { fontSize: 15, fontWeight: '600', color: '#1e293b' },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  statusText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  period: { fontSize: 13, color: '#64748b', marginBottom: 8 },
  alertsRow: { flexDirection: 'row', gap: 8 },
  alertBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  alertCount: { fontSize: 12, fontWeight: '600', color: '#1e293b' },
  empty: { fontSize: 14, color: '#94a3b8', textAlign: 'center', paddingVertical: 20 },
});
