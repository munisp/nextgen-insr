import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 2): savings screen mirroring the web member portal
// MemberSavings.tsx (W7-B7) on the REAL memberSavings router
// (server/routers/memberSavings.ts):
//   - myAccount ({ account } | { account: null } — null renders the
//     account-opening form, never an error)
//   - mySummary (settled-only balance; pending/failed never enter it)
//   - myTransactions (ALL statuses — failed rows are shown honestly)
//   - openMyAccount (identity from the SESSION server-side; the form sends
//     only phone/email/bvn/nin/address per the zod schema; Tier 2+ gated by
//     the fail-closed KYC enforcement service)
// DEPOSIT/WITHDRAW UI DELIBERATELY OMITTED (same as web, 2026-10-03): no
// member-safe deposit/withdraw mutation exists (memberSavings.ts:8-15 —
// savingsProducts.deposit/withdraw are fabricated-funds IDOR paths,
// fail-closed by design). An honest note is shown instead.
import { savingsApi, MemberSavingsAccount, MemberSavingsTxRow } from '../services/api';

const fmtNgn = (n: number, currency = 'NGN') =>
  `${currency === 'NGN' ? '₦' : `${currency} `}${(n || 0).toLocaleString('en-NG')}`;
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : '—';

export function SavingsScreen({ navigation }: { navigation: any }) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [bvn, setBvn] = useState('');
  const [nin, setNin] = useState('');
  const [address, setAddress] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accountQuery = useQuery({
    queryKey: ['memberSavings.myAccount'],
    queryFn: () => savingsApi.myAccount(),
  });
  const account: MemberSavingsAccount | null = accountQuery.data?.account ?? null;

  // Web parity (MemberSavings.tsx:166-175): without an account there is no
  // caller scope — summary/transactions honestly throw NOT_FOUND; only run
  // them once an account exists.
  const summaryQuery = useQuery({
    queryKey: ['memberSavings.mySummary'],
    queryFn: () => savingsApi.mySummary(),
    enabled: !!account,
  });
  const txQuery = useQuery({
    queryKey: ['memberSavings.myTransactions'],
    queryFn: () => savingsApi.myTransactions({ limit: 20, offset: 0 }),
    enabled: !!account,
  });
  const transactions: MemberSavingsTxRow[] = txQuery.data?.transactions ?? [];

  async function handleOpen() {
    setFormError(null);
    if (phone.trim().length < 7) {
      setFormError('Enter a valid phone number (at least 7 digits).');
      return;
    }
    setBusy(true);
    try {
      // zod-exact input: optional fields omitted entirely when blank so the
      // server schema (email(), bvn/nin length 11) is never tripped by "".
      await savingsApi.openMyAccount({
        phone: phone.trim(),
        ...(email.trim() ? { email: email.trim() } : {}),
        ...(bvn.trim() ? { bvn: bvn.trim() } : {}),
        ...(nin.trim() ? { nin: nin.trim() } : {}),
        ...(address.trim() ? { address: address.trim() } : {}),
      });
      queryClient.invalidateQueries({ queryKey: ['memberSavings.myAccount'] });
      queryClient.invalidateQueries({ queryKey: ['memberSavings.mySummary'] });
      queryClient.invalidateQueries({ queryKey: ['memberSavings.myTransactions'] });
    } catch (e: any) {
      setFormError(`Account could not be opened: ${e?.message || 'unknown error'}`);
    } finally {
      setBusy(false);
    }
  }

  const summary = summaryQuery.data;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Savings Account</Text>
        <Text style={styles.subtitle}>
          Your member savings account, resolved from your signed-in profile. Settled funds only.
        </Text>
      </View>

      <View style={styles.section}>
        {accountQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading savings account…</Text></View>
        ) : accountQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(accountQuery.error as Error)?.message}</Text></View>
        ) : !account ? (
          <>
            <Text style={styles.sectionDesc}>
              You do not have a savings account yet. Open one below — your name is taken from your signed-in profile, and supplying a BVN or NIN requires live KYC verification.
            </Text>
            {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}
            <Text style={styles.fieldLabel}>Phone number</Text>
            <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="08012345678" placeholderTextColor="#94a3b8" keyboardType="phone-pad" accessibilityLabel="Phone number" />
            <Text style={styles.fieldLabel}>Email (optional)</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholderTextColor="#94a3b8" accessibilityLabel="Email" />
            <Text style={styles.fieldLabel}>BVN (optional, 11 digits)</Text>
            <TextInput style={styles.input} value={bvn} onChangeText={setBvn} keyboardType="numeric" maxLength={11} placeholderTextColor="#94a3b8" accessibilityLabel="BVN" />
            <Text style={styles.fieldLabel}>NIN (optional, 11 digits)</Text>
            <TextInput style={styles.input} value={nin} onChangeText={setNin} keyboardType="numeric" maxLength={11} placeholderTextColor="#94a3b8" accessibilityLabel="NIN" />
            <Text style={styles.fieldLabel}>Address (optional)</Text>
            <TextInput style={styles.input} value={address} onChangeText={setAddress} placeholderTextColor="#94a3b8" accessibilityLabel="Address" />
            <TouchableOpacity style={[styles.submitBtn, busy && styles.submitDisabled]} disabled={busy} onPress={handleOpen}>
              <Text style={styles.submitText}>{busy ? 'Opening…' : 'Open savings account'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.productName}>{account.firstName} {account.lastName}</Text>
              <Text style={styles.metaLine}>Status: {account.status ?? 'unknown'} · KYC level: {account.kycLevel ?? '—'}</Text>
              <Text style={styles.metaLine}>Opened {fmtDate(account.createdAt)}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Savings Summary</Text>
              <Text style={styles.sectionDesc}>Settled funds only — pending or failed transactions never enter the balance.</Text>
              {summaryQuery.isLoading ? (
                <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading savings summary…</Text></View>
              ) : summaryQuery.isError ? (
                <View style={styles.errorBox}><Text style={styles.errorText}>{(summaryQuery.error as Error)?.message}</Text></View>
              ) : (
                <View style={styles.summaryCard}>
                  <Text style={styles.balanceLabel}>Balance</Text>
                  <Text style={styles.balanceValue} testID="savings-balance">
                    {fmtNgn(summary?.balance ?? 0, summary?.currency ?? 'NGN')}
                  </Text>
                  <View style={styles.row}><Text style={styles.label}>Total in</Text><Text style={styles.value}>{fmtNgn(summary?.totalIn ?? 0, summary?.currency ?? 'NGN')}</Text></View>
                  <View style={styles.row}><Text style={styles.label}>Total out</Text><Text style={styles.value}>{fmtNgn(summary?.totalOut ?? 0, summary?.currency ?? 'NGN')}</Text></View>
                  <View style={styles.row}><Text style={styles.label}>Settled transactions</Text><Text style={styles.value}>{summary?.settledTransactions ?? 0}</Text></View>
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Savings Transactions</Text>
              <Text style={styles.sectionDesc}>Newest first — including failed and pending attempts.</Text>
              {txQuery.isLoading ? (
                <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading savings transactions…</Text></View>
              ) : txQuery.isError ? (
                <View style={styles.errorBox}><Text style={styles.errorText}>{(txQuery.error as Error)?.message}</Text></View>
              ) : transactions.length === 0 ? (
                <Text style={styles.empty}>You have no savings transactions yet.</Text>
              ) : (
                transactions.map((tx) => (
                  <View key={tx.id} style={styles.card}>
                    <View style={styles.cardHeader}>
                      <Text style={styles.monoRef}>{tx.ref ?? `#${tx.id}`}</Text>
                      <View style={[styles.badge, tx.status === 'success' ? styles.badgeOk : tx.status === 'pending' ? styles.badgePending : styles.badgeBad]}>
                        <Text style={styles.badgeText}>{tx.status ?? 'unknown'}</Text>
                      </View>
                    </View>
                    <View style={styles.row}><Text style={styles.label}>{tx.type ?? '—'}</Text><Text style={styles.value}>{fmtNgn(Number(tx.amount ?? 0), tx.currency ?? 'NGN')}</Text></View>
                    {tx.failureReason ? <Text style={styles.metaLine}>{tx.failureReason}</Text> : null}
                    <Text style={styles.metaLine}>{fmtDate(tx.createdAt)}</Text>
                  </View>
                ))
              )}
            </View>

            {/* 2026-10-03 (W9-B5 wave 2): honest note — no member-safe
                deposit/withdraw mutation exists; see header comment. */}
            <View style={styles.noteBox}>
              <Text style={styles.noteText}>
                Deposits and withdrawals are not available in this app. Savings funding goes through your rail-verified wallet — use the Payments tab or contact support for assistance.
              </Text>
            </View>
          </>
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
  productName: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  metaLine: { fontSize: 12, color: '#64748b', marginTop: 4 },
  monoRef: { fontSize: 12, color: '#0f172a', fontFamily: 'monospace' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeOk: { backgroundColor: '#16a34a20' },
  badgePending: { backgroundColor: '#eab30820' },
  badgeBad: { backgroundColor: '#dc262620' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#334155', textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: 13, color: '#64748b' },
  value: { fontSize: 13, fontWeight: '500', color: '#0f172a' },
  summaryCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  balanceLabel: { fontSize: 12, color: '#64748b' },
  balanceValue: { fontSize: 26, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  formError: { fontSize: 13, color: '#dc2626', marginTop: 12 },
  submitBtn: { backgroundColor: '#2563eb', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 24, fontSize: 14 },
  noteBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginTop: 16 },
  noteText: { fontSize: 13, color: '#64748b' },
});
