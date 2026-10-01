import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';

// 2026-10-01 (R1c): this screen called analytics.overview and
// financialWellness.score on a hardcoded localhost URL. NEITHER procedure
// exists for customers in the monolith (analytics.* are platform/agent KPIs,
// and there is no financialWellness router), so every figure previously
// shown was a fabricated zero. Replaced with an honest unavailable state —
// no fake metrics.
export function AnalyticsScreen() {
  const [refreshing, setRefreshing] = React.useState(false);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(false)} />}
    >
      <Text style={styles.title}>Analytics</Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Personal analytics unavailable</Text>
        <Text style={styles.unavailableText}>
          Policy and claims analytics are not yet available for customer accounts.
          Your policy and claim details are always up to date on the Policies and
          Claims tabs.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Financial Wellness</Text>
        <Text style={styles.unavailableText}>
          A financial wellness score is not currently offered. When available,
          it will be computed from your real account data — we do not show
          placeholder scores.
        </Text>
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
  unavailableText: { fontSize: 14, color: '#64748b', lineHeight: 20 },
});
