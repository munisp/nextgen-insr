import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';
import { api } from '../services/api';

export default function AnalyticsScreen() {
  const [metrics, setMetrics] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchMetrics = async () => {
    try {
      const data = await api.query('analytics.overview');
      setMetrics(data);
    } catch { setMetrics(null); }
  };

  useEffect(() => { fetchMetrics(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMetrics();
    setRefreshing(false);
  };

  const formatNaira = (n: number) => `₦${(n || 0).toLocaleString()}`;

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.header}>Analytics</Text>

      <View style={styles.grid}>
        <View style={[styles.card, styles.cardBlue]}>
          <Text style={styles.cardLabel}>Total Premium</Text>
          <Text style={styles.cardValue}>{formatNaira(metrics?.totalPremium || 0)}</Text>
        </View>
        <View style={[styles.card, styles.cardGreen]}>
          <Text style={styles.cardLabel}>Active Policies</Text>
          <Text style={styles.cardValue}>{metrics?.activePolicies || 0}</Text>
        </View>
        <View style={[styles.card, styles.cardAmber]}>
          <Text style={styles.cardLabel}>Open Claims</Text>
          <Text style={styles.cardValue}>{metrics?.openClaims || 0}</Text>
        </View>
        <View style={[styles.card, styles.cardRed]}>
          <Text style={styles.cardLabel}>Loss Ratio</Text>
          <Text style={styles.cardValue}>{((metrics?.lossRatio || 0) * 100).toFixed(1)}%</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Premium by Product</Text>
        {(metrics?.premiumByProduct || []).map((item: any, i: number) => (
          <View key={i} style={styles.barRow}>
            <Text style={styles.barLabel}>{item.product}</Text>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${(item.amount / (metrics?.totalPremium || 1)) * 100}%` }]} />
            </View>
            <Text style={styles.barValue}>{formatNaira(item.amount)}</Text>
          </View>
        ))}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Claims Status</Text>
        {(metrics?.claimsByStatus || []).map((item: any, i: number) => (
          <View key={i} style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: item.status === 'approved' ? '#16a34a' : item.status === 'pending' ? '#f59e0b' : '#dc2626' }]} />
            <Text style={styles.statusLabel}>{item.status}</Text>
            <Text style={styles.statusCount}>{item.count}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { fontSize: 24, fontWeight: 'bold', padding: 16, backgroundColor: '#fff' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', padding: 8 },
  card: { width: '46%', margin: '2%', padding: 16, borderRadius: 12 },
  cardBlue: { backgroundColor: '#eff6ff' },
  cardGreen: { backgroundColor: '#f0fdf4' },
  cardAmber: { backgroundColor: '#fffbeb' },
  cardRed: { backgroundColor: '#fef2f2' },
  cardLabel: { fontSize: 12, color: '#666' },
  cardValue: { fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  section: { backgroundColor: '#fff', marginTop: 8, padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  barRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  barLabel: { width: 80, fontSize: 12 },
  barTrack: { flex: 1, height: 8, backgroundColor: '#e5e7eb', borderRadius: 4, marginHorizontal: 8 },
  barFill: { height: 8, backgroundColor: '#2563eb', borderRadius: 4 },
  barValue: { width: 90, fontSize: 12, textAlign: 'right' },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusLabel: { flex: 1, textTransform: 'capitalize' },
  statusCount: { fontWeight: '600' },
});
