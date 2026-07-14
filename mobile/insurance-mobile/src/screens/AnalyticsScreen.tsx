import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../store/authStore';
import { useOfflineSync } from '../services/offlineSync';

const API_BASE = 'http://localhost:3000/api/trpc';

export function AnalyticsScreen() {
  const { token } = useAuth();
  const { getCachedData, setCachedData } = useOfflineSync();
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: overview } = useQuery({
    queryKey: ['analytics.overview'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/analytics.overview`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        const data = json?.result?.data || json;
        await setCachedData('analytics', data, 300000);
        return data;
      } catch {
        return (await getCachedData('analytics')) || {};
      }
    },
  });

  const { data: financials } = useQuery({
    queryKey: ['financialWellness.score'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/financialWellness.score`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        return json?.result?.data || json || {};
      } catch {
        return {};
      }
    },
  });

  const formatCurrency = (n: number) => '₦' + (n || 0).toLocaleString('en-NG');

  const metrics = [
    { label: 'Total Policies', value: overview?.totalPolicies || 0, color: '#3b82f6' },
    { label: 'Active Policies', value: overview?.activePolicies || 0, color: '#10b981' },
    { label: 'Total Claims', value: overview?.totalClaims || 0, color: '#f59e0b' },
    { label: 'Claims Ratio', value: `${overview?.claimsRatio || 0}%`, color: '#8b5cf6' },
  ];

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); setRefreshing(false); }} />}>
      <Text style={styles.title}>Analytics</Text>

      <View style={styles.metricsGrid}>
        {metrics.map((m) => (
          <View key={m.label} style={[styles.metricCard, { borderTopColor: m.color, borderTopWidth: 3 }]}>
            <Text style={styles.metricValue}>{m.value}</Text>
            <Text style={styles.metricLabel}>{m.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Financial Wellness</Text>
        <View style={styles.scoreContainer}>
          <Text style={styles.score}>{financials?.score || 0}</Text>
          <Text style={styles.scoreMax}>/ 100</Text>
        </View>
        {financials?.tips?.map((tip: string, i: number) => (
          <Text key={i} style={styles.tip}>• {tip}</Text>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Premium Summary</Text>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total Premium Paid</Text>
          <Text style={styles.summaryValue}>{formatCurrency(overview?.totalPremiumPaid || 0)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Total Coverage</Text>
          <Text style={styles.summaryValue}>{formatCurrency(overview?.totalCoverage || 0)}</Text>
        </View>
        <View style={styles.summaryRow}>
          <Text style={styles.summaryLabel}>Claims Received</Text>
          <Text style={styles.summaryValue}>{formatCurrency(overview?.claimsReceived || 0)}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  metricCard: { width: '47%', backgroundColor: '#fff', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  metricValue: { fontSize: 24, fontWeight: '700', color: '#1e293b' },
  metricLabel: { fontSize: 12, color: '#64748b', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b', marginBottom: 12 },
  scoreContainer: { flexDirection: 'row', alignItems: 'baseline', marginBottom: 12 },
  score: { fontSize: 48, fontWeight: '700', color: '#2563eb' },
  scoreMax: { fontSize: 18, color: '#94a3b8', marginLeft: 4 },
  tip: { fontSize: 13, color: '#64748b', marginBottom: 4 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  summaryLabel: { fontSize: 14, color: '#64748b' },
  summaryValue: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
});
