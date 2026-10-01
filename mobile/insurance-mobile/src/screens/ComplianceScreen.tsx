import React from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl } from 'react-native';

// 2026-10-01 (R1c): this screen called compliance.list on a hardcoded
// localhost URL. No customer-facing compliance procedure exists in the
// monolith (compliance* routers are NAICOM/regulator- and admin-facing), so
// the screen always rendered fabricated emptiness. Replaced with an honest
// unavailable state — no fake compliance data.
export function ComplianceScreen() {
  const [refreshing, setRefreshing] = React.useState(false);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => setRefreshing(false)} />}
    >
      <Text style={styles.title}>Compliance & Regulatory</Text>
      <Text style={styles.subtitle}>NAICOM compliance reports and filing status</Text>

      <View style={styles.card}>
        <Text style={styles.empty}>
          Regulatory compliance filings are managed by the company and are not
          published to customer accounts. If you need a compliance certificate
          or regulatory document for your policy, please contact support.
        </Text>
      </View>
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
