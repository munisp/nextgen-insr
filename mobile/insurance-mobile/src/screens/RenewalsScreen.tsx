import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Switch,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 1): renewals mirroring the web member portal
// MemberRenewals.tsx (W7-B5) on the REAL memberRenewals router
// (server/routers/memberRenewals.ts):
//   - myRenewals      (caller-scoped list, joined policyNumber, honest empty)
//   - requestRenewal  (same procedure PolicyDetailScreen uses via
//     policyApi.renew — W9-B4; ownership gate, active/bound status gate and
//     the one-open-renewal duplicate guard all enforced server-side; no
//     funds move — payRenewal is deliberately NOT in the member router)
// Policy picker = caller's REAL policies via policyApi.list. Route param
// policyId (optional) preselects the picker, mirroring the web portal's
// ?policy=<id> deep link.
import { renewalsApi, policyApi, MemberRenewalRow } from '../services/api';

const fmtNgn = (n: number) => `₦${(n || 0).toLocaleString('en-NG')}`;
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : '—';

const statusColor: Record<string, string> = {
  pending: '#eab308', completed: '#16a34a', cancelled: '#64748b',
};

export function RenewalsScreen({ route, navigation }: { route?: any; navigation: any }) {
  const queryClient = useQueryClient();
  const preselect = Number(route?.params?.policyId);
  const [policyId, setPolicyId] = useState<number | null>(
    Number.isInteger(preselect) && preselect > 0 ? preselect : null,
  );
  const [isAutoRenewal, setIsAutoRenewal] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const renewalsQuery = useQuery({
    queryKey: ['memberRenewals.myRenewals'],
    queryFn: () => renewalsApi.list(),
  });
  const pickerQuery = useQuery({
    queryKey: ['policies'],
    queryFn: async () => (await policyApi.list()).data.policies,
  });

  async function handleSubmit() {
    setFormError(null);
    setSuccessMessage(null);
    if (policyId == null) { setFormError('Select the policy to renew.'); return; }
    setBusy(true);
    try {
      // Input shape = server zod schema exactly
      // (memberRenewals.requestRenewal: { policyId, isAutoRenewal? }).
      await renewalsApi.request({ policyId, isAutoRenewal });
      setPolicyId(null);
      setIsAutoRenewal(false);
      setSuccessMessage('Renewal requested — your agent will confirm the renewed policy.');
      queryClient.invalidateQueries({ queryKey: ['memberRenewals.myRenewals'] });
    } catch (e: any) {
      // Fail loud with the real server reason (not renewable status,
      // duplicate open renewal, ...). Never a fake success.
      setFormError(e?.message || 'This policy cannot be renewed right now.');
    } finally {
      setBusy(false);
    }
  }

  const renewals: MemberRenewalRow[] = renewalsQuery.data?.renewals ?? [];
  const myPolicies: any[] = pickerQuery.data ?? [];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>My Renewals</Text>
        <Text style={styles.subtitle}>Renewal requests for policies on your account.</Text>
      </View>

      <View style={styles.section}>
        {renewalsQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading your renewals…</Text></View>
        ) : renewalsQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(renewalsQuery.error as Error)?.message}</Text></View>
        ) : renewals.length === 0 ? (
          <Text style={styles.empty}>You have no renewals yet.</Text>
        ) : (
          <>
            {renewals.map((r) => (
              <View key={r.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{r.policyNumber}</Text>
                  <View style={[styles.badge, { backgroundColor: (statusColor[r.status] ?? '#64748b') + '20' }]}>
                    <Text style={[styles.badgeText, { color: statusColor[r.status] ?? '#64748b' }]}>{r.status}</Text>
                  </View>
                </View>
                <View style={styles.row}><Text style={styles.label}>Due date</Text><Text style={styles.value}>{fmtDate(r.renewalDueDate)}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Renewal premium</Text><Text style={styles.value}>{fmtNgn(Number(r.renewalPremium ?? 0))}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Auto-renew</Text><Text style={styles.value}>{r.isAutoRenewal ? 'Yes' : 'No'}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Completed</Text><Text style={styles.value}>{fmtDate(r.completedAt)}</Text></View>
              </View>
            ))}
            <Text style={styles.countText}>
              {renewalsQuery.data?.count ?? renewals.length} renewal{renewalsQuery.data?.count === 1 ? '' : 's'} on your account.
            </Text>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Request a Renewal</Text>
        <Text style={styles.sectionDesc}>Request renewal of one of your active policies.</Text>
        <Text style={styles.fieldLabel}>Policy</Text>
        {pickerQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading your policies…</Text></View>
        ) : pickerQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(pickerQuery.error as Error)?.message}</Text></View>
        ) : myPolicies.length === 0 ? (
          <Text style={styles.empty}>No policies found on your account — a renewal must target an existing policy.</Text>
        ) : (
          <View style={styles.chipGrid}>
            {myPolicies.map((p: any) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.chip, policyId === Number(p.id) && styles.chipActive]}
                onPress={() => setPolicyId(Number(p.id))}
              >
                <Text style={[styles.chipText, policyId === Number(p.id) && { color: '#fff' }]}>
                  {p.policyNumber} — {p.provider ?? 'policy'} ({p.status})
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.switchRow}>
          <Switch
            value={isAutoRenewal}
            onValueChange={setIsAutoRenewal}
            accessibilityLabel="Renew automatically"
          />
          <Text style={styles.switchLabel}>Renew automatically</Text>
        </View>

        {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}
        {successMessage ? <Text style={styles.formSuccess}>{successMessage}</Text> : null}
        <TouchableOpacity style={[styles.submitBtn, busy && styles.submitDisabled]} disabled={busy} onPress={handleSubmit}>
          <Text style={styles.submitText}>{busy ? 'Requesting…' : 'Request renewal'}</Text>
        </TouchableOpacity>
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
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#0f172a', flex: 1, fontFamily: 'monospace' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: 13, color: '#64748b' },
  value: { fontSize: 13, fontWeight: '500', color: '#0f172a' },
  countText: { fontSize: 13, color: '#64748b', paddingVertical: 8 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#334155', fontWeight: '500' },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 16, marginBottom: 8 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  switchLabel: { fontSize: 14, color: '#334155', fontWeight: '500' },
  formError: { fontSize: 13, color: '#dc2626', marginTop: 12 },
  formSuccess: { fontSize: 13, color: '#16a34a', marginTop: 12 },
  submitBtn: { backgroundColor: '#2563eb', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 24, fontSize: 14 },
});
