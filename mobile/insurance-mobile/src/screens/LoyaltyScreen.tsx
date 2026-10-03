import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 2): loyalty screen mirroring the web member portal
// MemberLoyalty.tsx (W7-B7) on the REAL memberLoyalty router
// (server/routers/memberLoyalty.ts):
//   - myBalance (earned − redeemed over the caller's ledger)
//   - myHistory (paginated ledger, newest first)
// Identity is always resolved server-side from the session
// (customers.keycloakSub = String(ctx.user.id)); no client-supplied id.
// REDEEM UI DELIBERATELY OMITTED (same as web, 2026-10-03): the router is
// read-only by design — points are funds-adjacent (1pt = ₦1) and no
// member-safe reward catalog/redemption mutation exists. An honest note is
// shown instead of fabricating a redemption.
import { loyaltyApi, MemberLoyaltyHistoryRow } from '../services/api';

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : '—';

export function LoyaltyScreen({ navigation }: { navigation: any }) {
  const balanceQuery = useQuery({
    queryKey: ['memberLoyalty.myBalance'],
    queryFn: () => loyaltyApi.myBalance(),
  });
  const historyQuery = useQuery({
    queryKey: ['memberLoyalty.myHistory'],
    queryFn: () => loyaltyApi.myHistory({ limit: 50, offset: 0 }),
  });

  const balance = balanceQuery.data;
  const history: MemberLoyaltyHistoryRow[] = historyQuery.data?.history ?? [];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Loyalty Points</Text>
        <Text style={styles.subtitle}>Points earned on your policies and payments.</Text>
      </View>

      <View style={styles.section}>
        {balanceQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading loyalty balance…</Text></View>
        ) : balanceQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(balanceQuery.error as Error)?.message}</Text></View>
        ) : (
          <View style={styles.summaryCard}>
            <Text style={styles.balanceLabel}>Balance</Text>
            <Text style={styles.balanceValue} testID="loyalty-balance">{balance?.balance ?? 0} pts</Text>
            <View style={styles.row}><Text style={styles.label}>Earned</Text><Text style={styles.value}>{balance?.earned ?? 0} pts</Text></View>
            <View style={styles.row}><Text style={styles.label}>Redeemed</Text><Text style={styles.value}>{balance?.redeemed ?? 0} pts</Text></View>
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Points History</Text>
        <Text style={styles.sectionDesc}>Newest first.</Text>
        {historyQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading loyalty history…</Text></View>
        ) : historyQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(historyQuery.error as Error)?.message}</Text></View>
        ) : history.length === 0 ? (
          <Text style={styles.empty}>You have no loyalty activity yet.</Text>
        ) : (
          history.map((row) => (
            <View key={row.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.badge, row.type === 'earned' ? styles.badgeOk : styles.badgePending]}>
                  <Text style={styles.badgeText}>{row.type ?? '—'}</Text>
                </View>
                <Text style={styles.points}>{row.points} pts</Text>
              </View>
              <Text style={styles.descText}>{row.description ?? '—'}</Text>
              <View style={styles.row}>
                <Text style={styles.label}>Balance after: {row.balanceAfter ?? '—'}</Text>
                <Text style={styles.label}>{fmtDate(row.createdAt)}</Text>
              </View>
            </View>
          ))
        )}
      </View>

      {/* 2026-10-03 (W9-B5 wave 2): honest note — no member-safe redemption
          mutation exists; see header comment. */}
      <View style={styles.noteWrap}>
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>
            Points redemption is not available in this app yet. Your points keep accumulating — redemption options will be announced when the rewards program launches, or contact support for more information.
          </Text>
        </View>
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 },
  back: { fontSize: 16, color: '#2563eb', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 6 },
  section: { marginHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#0f172a', marginBottom: 4 },
  sectionDesc: { fontSize: 13, color: '#64748b', marginBottom: 12 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  balanceLabel: { fontSize: 12, color: '#64748b' },
  balanceValue: { fontSize: 26, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: 13, color: '#64748b' },
  value: { fontSize: 13, fontWeight: '500', color: '#0f172a' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeOk: { backgroundColor: '#16a34a20' },
  badgePending: { backgroundColor: '#eab30820' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#334155', textTransform: 'uppercase' },
  points: { fontSize: 14, fontWeight: '700', color: '#0f172a' },
  descText: { fontSize: 13, color: '#0f172a', marginBottom: 4 },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 24, fontSize: 14 },
  noteWrap: { marginHorizontal: 16 },
  noteBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginTop: 16 },
  noteText: { fontSize: 13, color: '#64748b' },
});
