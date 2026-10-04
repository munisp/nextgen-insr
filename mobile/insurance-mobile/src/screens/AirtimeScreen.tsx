import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 3): airtime & mobile-money screen mirroring the web
// member portal MemberAirtime.tsx (W7-B10) — one combined screen for both
// phone-scoped money rails (web parity: the two real backends share the same
// caller-phone scoping and by-status summary shape, and both are strictly
// read-only):
//   Airtime (server/routers/memberAirtime.ts):
//     - memberAirtime.myHistory  (paginated, newest first, ALL statuses
//                                 verbatim incl. failed/pending)
//     - memberAirtime.mySummary  (per-status counts + volumes over N days)
//   Mobile money (server/routers/memberMobileMoney.ts):
//     - memberMobileMoney.myTransactions (paginated, optional provider filter
//       — a FILTER within the caller's phone scope, never a re-scope)
//     - memberMobileMoney.myTransaction  (detail by ref; NOT_FOUND
//       non-enumerating on foreign/nonexistent refs)
//     - memberMobileMoney.mySummary      (per-status counts + volumes)
//     - memberMobileMoney.providers      (registry + honest `configured` flag)
//
// ALL READ-ONLY: neither router exposes any mutation (no airtime purchase, no
// cash-in/out — those are financialProcedure funds rails deferred to the
// reviewed funds wave), so no purchase/transfer UI exists here and none is
// faked (web parity note verbatim at the bottom).
import {
  airtimeApi, mobileMoneyApi, MOMO_PROVIDERS, MomoProvider,
  MemberAirtimeRow, MemberMomoTxRow, MemberStatusSummary,
} from '../services/api';

const fmt = (n: number, currency = 'NGN') =>
  currency === 'NGN' ? `₦${Number(n).toLocaleString('en-NG')}` : `${Number(n).toLocaleString('en-NG')} ${currency}`;
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : '—';

const badgeStyleFor = (status: string | null | undefined) =>
  status === 'success' ? styles.badgeOk
    : status === 'pending' || status === 'pending_provider' ? styles.badgePending
      : styles.badgeBad;

function SummaryList({ summary }: { summary: MemberStatusSummary }) {
  if (summary.byStatus.length === 0) {
    return (
      <Text style={styles.metaLine}>
        No transactions in the last {summary.periodDays} days.
      </Text>
    );
  }
  return (
    <View testID="summary-list">
      {summary.byStatus.map((s) => (
        <View key={s.status} style={styles.summaryRow}>
          <View style={[styles.badge, badgeStyleFor(s.status)]}>
            <Text style={styles.badgeText}>{s.status}</Text>
          </View>
          <Text style={styles.metaLine}>
            {s.count} transaction{s.count === 1 ? '' : 's'} · {fmt(s.volumeNGN)}
          </Text>
        </View>
      ))}
      <Text style={styles.metaLine}>
        Total: {summary.totalTransactions} over {summary.periodDays} days
      </Text>
    </View>
  );
}

export function AirtimeScreen({ navigation }: { navigation: any }) {
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const [providerFilter, setProviderFilter] = useState<'all' | MomoProvider>('all');

  // ── Airtime ──────────────────────────────────────────────────────────────
  const airtimeHistory = useQuery({
    queryKey: ['memberAirtime.myHistory'],
    queryFn: () => airtimeApi.myHistory({ limit: 20, offset: 0 }),
  });
  const airtimeSummary = useQuery({
    queryKey: ['memberAirtime.mySummary'],
    queryFn: () => airtimeApi.mySummary({ periodDays: 30 }),
  });

  // ── Mobile money ─────────────────────────────────────────────────────────
  const momoProviders = useQuery({
    queryKey: ['memberMobileMoney.providers'],
    queryFn: () => mobileMoneyApi.providers(),
  });
  const momoTx = useQuery({
    queryKey: ['memberMobileMoney.myTransactions', providerFilter],
    queryFn: () => mobileMoneyApi.myTransactions({
      limit: 20, offset: 0,
      ...(providerFilter !== 'all' ? { provider: providerFilter } : {}),
    }),
  });
  const momoSummary = useQuery({
    queryKey: ['memberMobileMoney.mySummary'],
    queryFn: () => mobileMoneyApi.mySummary({ periodDays: 30 }),
  });
  const momoDetail = useQuery({
    queryKey: ['memberMobileMoney.myTransaction', selectedRef],
    queryFn: () => mobileMoneyApi.myTransaction(selectedRef!),
    enabled: selectedRef !== null,
  });

  const providers = momoProviders.data?.providers ?? [];
  const detail = selectedRef ? momoDetail.data?.transaction : undefined;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Airtime & Mobile Money</Text>
        <Text style={styles.subtitle}>Your airtime purchases and mobile-money transactions, newest first.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Airtime Summary</Text>
        {airtimeSummary.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading airtime summary…</Text></View>
        ) : airtimeSummary.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(airtimeSummary.error as Error)?.message}</Text></View>
        ) : airtimeSummary.data ? (
          <SummaryList summary={airtimeSummary.data} />
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Airtime History</Text>
        {airtimeHistory.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading airtime history…</Text></View>
        ) : airtimeHistory.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(airtimeHistory.error as Error)?.message}</Text></View>
        ) : (airtimeHistory.data?.history ?? []).length === 0 ? (
          <Text style={styles.empty}>You have no airtime purchases yet.</Text>
        ) : (
          (airtimeHistory.data?.history ?? []).map((h: MemberAirtimeRow) => (
            <View key={h.ref} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.monoRef}>{h.ref}</Text>
                <View style={[styles.badge, badgeStyleFor(h.status)]}>
                  <Text style={styles.badgeText}>{h.status ?? 'unknown'}</Text>
                </View>
              </View>
              <Text style={styles.metaLine}>
                {h.network ?? '—'} · {h.phoneNumber ?? '—'} · {fmt(Number(h.amount ?? 0))} · {fmtDate(h.createdAt)}
              </Text>
              {h.failureReason ? (
                <Text style={styles.metaLine}>{h.failureReason}</Text>
              ) : null}
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mobile Money Summary</Text>
        {momoSummary.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading mobile money summary…</Text></View>
        ) : momoSummary.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(momoSummary.error as Error)?.message}</Text></View>
        ) : momoSummary.data ? (
          <SummaryList summary={momoSummary.data} />
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Mobile Money Transactions</Text>
        {momoProviders.data && !momoProviders.data.configured ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              No mobile-money provider is configured on this deployment, so new cash-ins and cash-outs are unavailable.
            </Text>
          </View>
        ) : null}
        {providers.length > 0 ? (
          <View style={styles.filterRow}>
            <TouchableOpacity
              style={[styles.chip, providerFilter === 'all' && styles.chipActive]}
              onPress={() => setProviderFilter('all')}
              accessibilityLabel="Filter all providers"
            >
              <Text style={[styles.chipText, providerFilter === 'all' && { color: '#fff' }]}>All providers</Text>
            </TouchableOpacity>
            {providers.map((p) => (
              <TouchableOpacity
                key={p.name}
                style={[styles.chip, providerFilter === p.name && styles.chipActive]}
                onPress={() => setProviderFilter(p.name as MomoProvider)}
                accessibilityLabel={`Provider ${p.name}`}
              >
                <Text style={[styles.chipText, providerFilter === p.name && { color: '#fff' }]}>{p.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {momoTx.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading mobile money transactions…</Text></View>
        ) : momoTx.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(momoTx.error as Error)?.message}</Text></View>
        ) : (momoTx.data?.transactions ?? []).length === 0 ? (
          <Text style={styles.empty}>You have no mobile-money transactions yet.</Text>
        ) : (
          (momoTx.data?.transactions ?? []).map((t: MemberMomoTxRow) => (
            <View key={t.ref} style={styles.card}>
              <TouchableOpacity onPress={() => setSelectedRef(selectedRef === t.ref ? null : t.ref)} accessibilityLabel={`Transaction ${t.ref}`}>
                <View style={styles.cardHeader}>
                  <Text style={styles.monoRef}>{t.ref}</Text>
                  <View style={[styles.badge, badgeStyleFor(t.status)]}>
                    <Text style={styles.badgeText}>{t.status ?? 'unknown'}</Text>
                  </View>
                </View>
                <Text style={styles.metaLine}>
                  {t.type ?? '—'} · {t.provider ?? '—'} · {fmt(Number(t.amount ?? 0))} · fee {fmt(Number(t.fee ?? 0))} · {fmtDate(t.createdAt)}
                </Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </View>

      {selectedRef ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transaction {selectedRef}</Text>
          {momoDetail.isLoading ? (
            <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading transaction detail…</Text></View>
          ) : momoDetail.isError ? (
            <View style={styles.errorBox}><Text style={styles.errorText}>{(momoDetail.error as Error)?.message}</Text></View>
          ) : detail ? (
            <View style={styles.card} testID="momo-detail">
              <Text style={styles.metaLine}>Type: {detail.type ?? '—'}</Text>
              <Text style={styles.metaLine}>Provider: {detail.provider ?? '—'}</Text>
              <Text style={styles.metaLine}>Amount: {fmt(Number(detail.amount ?? 0))}</Text>
              <Text style={styles.metaLine}>Fee: {fmt(Number(detail.fee ?? 0))}</Text>
              <Text style={styles.metaLine}>Status: {detail.status ?? 'unknown'}</Text>
              {detail.failureReason ? (
                <Text style={styles.metaLine}>Failure reason: {detail.failureReason}</Text>
              ) : null}
              <Text style={styles.metaLine}>Date: {fmtDate(detail.createdAt)}</Text>
            </View>
          ) : null}
        </View>
      ) : null}

      {/* 2026-10-03 (W9-B5 wave 3): honest read-only note — web parity
          (MemberAirtime.tsx:343-348); neither router has any
          purchase/cash-in/cash-out mutation (funds wave). */}
      <View style={[styles.section, styles.noteBox]}>
        <Text style={styles.noteText}>
          Buying airtime or moving money is not available in this app yet — this page shows your history and status only.
        </Text>
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
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#0f172a', marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  monoRef: { fontSize: 13, fontWeight: '600', color: '#0f172a', fontFamily: 'monospace' as any },
  metaLine: { fontSize: 12, color: '#64748b', marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeOk: { backgroundColor: '#16a34a20' },
  badgePending: { backgroundColor: '#eab30820' },
  badgeBad: { backgroundColor: '#dc262620' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#334155', textTransform: 'uppercase' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 12, color: '#334155', fontWeight: '500' },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 24, fontSize: 14 },
  noteBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 },
  noteText: { fontSize: 13, color: '#64748b' },
});
