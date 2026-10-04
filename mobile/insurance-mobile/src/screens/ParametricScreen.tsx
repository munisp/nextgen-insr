import React from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 3): parametric screen mirroring the web member
// portal MemberParametric.tsx (W7-B10) on the REAL member-scoped parametric
// router (server/routers/parametricMember.ts):
//   - parametricMember.myCoverage (the caller's policies riding on an ACTIVE
//     parametric product mapping, plus trigger state; policies.customerId =
//     ctx.user.id)
//   - parametricMember.myPayouts  (parametric_payout_settlements rows whose
//     claim belongs to the caller — claim-scoped IDOR guard server-side,
//     claims.claimantId = ctx.user.id)
// READ-ONLY: there are no mutations at all on this router — trigger CRUD,
// manual readings and payout evaluation live on the admin-only
// parametricEngine router and are never exposed here, so no
// payout-triggering UI exists and none is faked (web parity).
import { parametricApi, ParametricCoverageRow, ParametricPayoutRow } from '../services/api';

const fmt = (n: number, currency = 'NGN') =>
  currency === 'NGN' ? `₦${Number(n).toLocaleString('en-NG')}` : `${Number(n).toLocaleString('en-NG')} ${currency}`;
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : '—';

const badgeStyleFor = (status: string | null | undefined) =>
  status === 'active' || status === 'paid' || status === 'success' ? styles.badgeOk
    : status === 'pending' || status === 'triggered' ? styles.badgePending
      : styles.badgeBad;

export function ParametricScreen({ navigation }: { navigation: any }) {
  const coverageQuery = useQuery({
    queryKey: ['parametricMember.myCoverage'],
    queryFn: () => parametricApi.myCoverage(),
  });
  const payoutsQuery = useQuery({
    queryKey: ['parametricMember.myPayouts'],
    queryFn: () => parametricApi.myPayouts({ limit: 50, offset: 0 }),
  });

  const coverage = coverageQuery.data?.coverage ?? [];
  const payouts = payoutsQuery.data?.payouts ?? [];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Parametric Insurance</Text>
        <Text style={styles.subtitle}>
          Payouts are automatic when the trigger fires; there is nothing to claim manually.
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Parametric Coverage</Text>
        {coverageQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading parametric coverage…</Text></View>
        ) : coverageQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(coverageQuery.error as Error)?.message}</Text></View>
        ) : coverage.length === 0 ? (
          <Text style={styles.empty}>You have no parametric coverage yet.</Text>
        ) : (
          coverage.map((c: ParametricCoverageRow) => (
            <View key={c.policyId} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.rowName}>Policy #{c.policyId}</Text>
                <View style={[styles.badge, badgeStyleFor(c.status)]}>
                  <Text style={styles.badgeText}>{c.status ?? 'unknown'}</Text>
                </View>
              </View>
              <Text style={styles.metaLine}>
                {c.productName ?? '—'} · Peril: {c.coveredPeril ?? '—'} · Payout {fmt(Number(c.payoutAmount ?? 0), c.currency ?? 'NGN')}
              </Text>
              <Text style={styles.metaLine}>Trigger: {c.triggerStatus ?? '—'}</Text>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Parametric Payouts</Text>
        <Text style={styles.sectionDesc}>Automatic settlements paid (or pending) on your parametric claims.</Text>
        {payoutsQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading parametric payouts…</Text></View>
        ) : payoutsQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(payoutsQuery.error as Error)?.message}</Text></View>
        ) : payouts.length === 0 ? (
          <Text style={styles.empty}>You have no parametric payouts yet.</Text>
        ) : (
          payouts.map((p: ParametricPayoutRow) => (
            <View key={p.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.rowName}>Payout #{p.id}</Text>
                <View style={[styles.badge, badgeStyleFor(p.status)]}>
                  <Text style={styles.badgeText}>{p.status ?? 'unknown'}</Text>
                </View>
              </View>
              <Text style={styles.metaLine}>
                Policy #{p.policyId} · Claim #{p.claimId} · Event #{p.eventId}
              </Text>
              <Text style={styles.metaLine}>
                {fmt(Number(p.amount ?? 0), p.currency ?? 'NGN')} · {fmtDate(p.createdAt)}
              </Text>
            </View>
          ))
        )}
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
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#0f172a', marginBottom: 4 },
  sectionDesc: { fontSize: 12, color: '#64748b', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  rowName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  metaLine: { fontSize: 12, color: '#64748b', marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeOk: { backgroundColor: '#16a34a20' },
  badgePending: { backgroundColor: '#eab30820' },
  badgeBad: { backgroundColor: '#dc262620' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#334155', textTransform: 'uppercase' },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 24, fontSize: 14 },
});
