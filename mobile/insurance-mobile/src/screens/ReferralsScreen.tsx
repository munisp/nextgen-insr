import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Share,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 2): referrals screen mirroring the web member
// portal MemberReferrals.tsx (W7-B7) on the REAL memberReferrals router
// (server/routers/memberReferrals.ts):
//   - myCode (READ-ONLY — the caller's existing still-valid pending code, or
//     null. Member-context minting was removed server-side (2026-10-01
//     R3-fix): null is an honest "unavailable", nothing is minted
//     client-side either.)
//   - myReferrals (caller's referrals as referrer, paginated)
// Identity is always resolved server-side from the session; no referrerId /
// customerId is ever accepted from input. There is NO create mutation.
// The web "copy code" button maps to the real RN Share sheet (no clipboard
// package is installed in this build — Share is a built-in RN API).
import { referralsApi, MemberReferralRow } from '../services/api';

const fmtNgn = (n: number | string | null | undefined) =>
  n == null ? '—' : `₦${Number(n).toLocaleString('en-NG')}`;
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : '—';

export function ReferralsScreen({ navigation }: { navigation: any }) {
  const [shareError, setShareError] = useState<string | null>(null);

  const codeQuery = useQuery({
    queryKey: ['memberReferrals.myCode'],
    queryFn: () => referralsApi.myCode(),
  });
  const referralsQuery = useQuery({
    queryKey: ['memberReferrals.myReferrals'],
    queryFn: () => referralsApi.myReferrals({ limit: 50, offset: 0 }),
  });

  const code = codeQuery.data; // { referralCode, expiresAt, existing } | null
  const referrals: MemberReferralRow[] = referralsQuery.data?.referrals ?? [];

  async function shareCode() {
    setShareError(null);
    if (!code?.referralCode) return;
    try {
      await Share.share({ message: `Join me on InsurePortal — use my referral code ${code.referralCode}` });
    } catch (e: any) {
      setShareError(e?.message || 'Sharing is not available on this device.');
    }
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Referrals</Text>
        <Text style={styles.subtitle}>Share your code with friends and family.</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Referral Code</Text>
        {codeQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading your referral code…</Text></View>
        ) : codeQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(codeQuery.error as Error)?.message}</Text></View>
        ) : !code ? (
          // Honest unavailable state (2026-10-03, W9-B5 wave 2): the server
          // returns null when no valid member code exists; nothing is minted.
          <Text style={styles.empty}>
            A referral code is not available for your account yet. Referral codes are issued as part of the referral program — contact support if you believe you should have one.
          </Text>
        ) : (
          <View style={styles.card}>
            <Text style={styles.codeText} testID="referral-code">{code.referralCode}</Text>
            {code.expiresAt ? (
              <Text style={styles.metaLine}>Valid until {fmtDate(code.expiresAt)}</Text>
            ) : null}
            <TouchableOpacity style={styles.shareBtn} onPress={shareCode}>
              <Text style={styles.shareText}>Share code</Text>
            </TouchableOpacity>
            {shareError ? <Text accessibilityRole="alert" style={styles.formError}>{shareError}</Text> : null}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Your Referrals</Text>
        <Text style={styles.sectionDesc}>People you have referred, newest first.</Text>
        {referralsQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading your referrals…</Text></View>
        ) : referralsQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(referralsQuery.error as Error)?.message}</Text></View>
        ) : referrals.length === 0 ? (
          <Text style={styles.empty}>You have not referred anyone yet.</Text>
        ) : (
          referrals.map((r) => (
            <View key={r.id} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.monoRef}>{r.referralCode ?? '—'}</Text>
                <View style={[styles.badge, r.status === 'rewarded' ? styles.badgeOk : r.status === 'expired' ? styles.badgeBad : styles.badgePending]}>
                  <Text style={styles.badgeText}>{r.status ?? '—'}</Text>
                </View>
              </View>
              <View style={styles.row}><Text style={styles.label}>Bonus points</Text><Text style={styles.value}>{r.bonusPoints ?? '—'}</Text></View>
              <View style={styles.row}><Text style={styles.label}>Bonus cash</Text><Text style={styles.value}>{fmtNgn(r.bonusCash)}</Text></View>
              <View style={styles.row}><Text style={styles.label}>Activated</Text><Text style={styles.value}>{fmtDate(r.activatedAt)}</Text></View>
              <View style={styles.row}><Text style={styles.label}>Expires</Text><Text style={styles.value}>{fmtDate(r.expiresAt)}</Text></View>
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
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#0f172a', marginBottom: 4 },
  sectionDesc: { fontSize: 13, color: '#64748b', marginBottom: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  codeText: { fontSize: 20, fontWeight: '700', color: '#0f172a', fontFamily: 'monospace', letterSpacing: 1 },
  metaLine: { fontSize: 12, color: '#64748b', marginTop: 4 },
  shareBtn: { marginTop: 12, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: '#2563eb' },
  shareText: { fontSize: 14, fontWeight: '600', color: '#2563eb' },
  monoRef: { fontSize: 13, color: '#0f172a', fontFamily: 'monospace' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeOk: { backgroundColor: '#16a34a20' },
  badgePending: { backgroundColor: '#eab30820' },
  badgeBad: { backgroundColor: '#dc262620' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#334155', textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: 13, color: '#64748b' },
  value: { fontSize: 13, fontWeight: '500', color: '#0f172a' },
  formError: { fontSize: 13, color: '#dc2626', marginTop: 12 },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  empty: { color: '#64748b', paddingVertical: 16, fontSize: 14 },
});
