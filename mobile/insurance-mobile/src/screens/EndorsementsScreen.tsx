import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 1): endorsements mirroring the web member portal
// MemberEndorsements.tsx (W7-B5) on the REAL memberEndorsements router
// (server/routers/memberEndorsements.ts):
//   - myEndorsements       (caller-scoped list, joined policyNumber)
//   - requestEndorsement   (ownership-guarded server-side)
// The policy picker reads the caller's REAL policies via policyApi.list
// (memberPolicies.myPolicies) — the same picker source the web page uses.
// premiumAdjustment/sumInsuredAdjustment are member-PROPOSED request fields
// only (no funds movement — router header); the form labels them as such.
// Route param policyId (optional) preselects the picker, mirroring the web
// portal's ?policy=<id> deep link from MemberPolicyDetail.
import { endorsementsApi, policyApi, ENDORSEMENT_TYPES, EndorsementType, MemberEndorsementRow } from '../services/api';

const fmtNgn = (n: number) => `₦${(n || 0).toLocaleString('en-NG')}`;
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : '—';

export function EndorsementsScreen({ route, navigation }: { route?: any; navigation: any }) {
  const queryClient = useQueryClient();
  const preselect = Number(route?.params?.policyId);
  const [policyId, setPolicyId] = useState<number | null>(
    Number.isInteger(preselect) && preselect > 0 ? preselect : null,
  );
  const [type, setType] = useState<EndorsementType | null>(null);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [description, setDescription] = useState('');
  const [premiumAdjustment, setPremiumAdjustment] = useState('');
  const [sumInsuredAdjustment, setSumInsuredAdjustment] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const endorsementsQuery = useQuery({
    queryKey: ['memberEndorsements.myEndorsements'],
    queryFn: () => endorsementsApi.list(),
  });
  const pickerQuery = useQuery({
    queryKey: ['policies'],
    queryFn: async () => (await policyApi.list()).data.policies,
  });

  async function handleSubmit() {
    setFormError(null);
    setSuccessMessage(null);
    if (policyId == null) { setFormError('Select the policy to endorse.'); return; }
    if (!type) { setFormError('Select an endorsement type.'); return; }
    if (!effectiveDate.trim() || Number.isNaN(Date.parse(effectiveDate.trim()))) {
      setFormError('Enter the effective date (YYYY-MM-DD).');
      return;
    }
    if (!description.trim()) { setFormError('Describe the requested change.'); return; }
    const premAdj = premiumAdjustment.trim() ? Number(premiumAdjustment) : undefined;
    const sumAdj = sumInsuredAdjustment.trim() ? Number(sumInsuredAdjustment) : undefined;
    if (premAdj !== undefined && !Number.isFinite(premAdj)) { setFormError('Enter a valid premium adjustment.'); return; }
    if (sumAdj !== undefined && !Number.isFinite(sumAdj)) { setFormError('Enter a valid sum-insured adjustment.'); return; }
    setBusy(true);
    try {
      // Input shape = server zod schema exactly
      // (memberEndorsements.requestEndorsement); optional adjustments only
      // sent when provided.
      const res = await endorsementsApi.request({
        policyId,
        type,
        effectiveDate: effectiveDate.trim(),
        description: description.trim(),
        ...(premAdj !== undefined ? { premiumAdjustment: premAdj } : {}),
        ...(sumAdj !== undefined ? { sumInsuredAdjustment: sumAdj } : {}),
      });
      setType(null);
      setEffectiveDate('');
      setDescription('');
      setPremiumAdjustment('');
      setSumInsuredAdjustment('');
      setSuccessMessage(`Endorsement requested (${res.endorsementNumber})`);
      queryClient.invalidateQueries({ queryKey: ['memberEndorsements.myEndorsements'] });
    } catch (e: any) {
      setFormError(e?.message || 'Endorsement request failed — nothing was recorded.');
    } finally {
      setBusy(false);
    }
  }

  const endorsements: MemberEndorsementRow[] = endorsementsQuery.data?.endorsements ?? [];
  const myPolicies: any[] = pickerQuery.data ?? [];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>My Endorsements</Text>
        <Text style={styles.subtitle}>Endorsement requests and changes on your policies.</Text>
      </View>

      <View style={styles.section}>
        {endorsementsQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading your endorsements…</Text></View>
        ) : endorsementsQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(endorsementsQuery.error as Error)?.message}</Text></View>
        ) : endorsements.length === 0 ? (
          <Text style={styles.empty}>You have no endorsements yet.</Text>
        ) : (
          <>
            {endorsements.map((en) => (
              <View key={en.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{en.endorsementNumber}</Text>
                  <View style={styles.badge}><Text style={styles.badgeText}>{en.type}</Text></View>
                </View>
                <View style={styles.row}><Text style={styles.label}>Policy</Text><Text style={styles.value}>{en.policyNumber}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Effective</Text><Text style={styles.value}>{fmtDate(en.effectiveDate)}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Premium adj.</Text><Text style={styles.value}>{fmtNgn(Number(en.premiumAdjustment ?? 0))}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Sum insured adj.</Text><Text style={styles.value}>{fmtNgn(Number(en.sumInsuredAdjustment ?? 0))}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Approved</Text><Text style={styles.value}>{fmtDate(en.approvedAt)}</Text></View>
              </View>
            ))}
            <Text style={styles.countText}>
              {endorsementsQuery.data?.count ?? endorsements.length} endorsement{endorsementsQuery.data?.count === 1 ? '' : 's'} on your account.
            </Text>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Request an Endorsement</Text>
        <Text style={styles.sectionDesc}>
          Request a change to one of your policies. Proposed adjustments are requests for staff review — no payment is taken here.
        </Text>
        <Text style={styles.fieldLabel}>Policy</Text>
        {pickerQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading your policies…</Text></View>
        ) : pickerQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(pickerQuery.error as Error)?.message}</Text></View>
        ) : myPolicies.length === 0 ? (
          <Text style={styles.empty}>No policies found on your account — an endorsement must target an existing policy.</Text>
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

        <Text style={styles.fieldLabel}>Type</Text>
        <View style={styles.chipGrid}>
          {ENDORSEMENT_TYPES.map((t) => (
            <TouchableOpacity key={t} style={[styles.chip, type === t && styles.chipActive]} onPress={() => setType(t)}>
              <Text style={[styles.chipText, type === t && { color: '#fff' }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.fieldLabel}>Effective date</Text>
        <TextInput
          style={styles.input}
          value={effectiveDate}
          onChangeText={setEffectiveDate}
          placeholder="YYYY-MM-DD"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Effective date"
        />
        <Text style={styles.fieldLabel}>Description</Text>
        <TextInput
          style={[styles.input, styles.textarea]}
          value={description}
          onChangeText={setDescription}
          multiline
          numberOfLines={4}
          maxLength={4096}
          placeholder="Describe the requested change…"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Description"
        />
        <Text style={styles.fieldLabel}>Proposed premium adjustment (NGN, optional)</Text>
        <TextInput
          style={styles.input}
          value={premiumAdjustment}
          onChangeText={setPremiumAdjustment}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Proposed premium adjustment"
        />
        <Text style={styles.fieldLabel}>Proposed sum-insured adjustment (NGN, optional)</Text>
        <TextInput
          style={styles.input}
          value={sumInsuredAdjustment}
          onChangeText={setSumInsuredAdjustment}
          keyboardType="numeric"
          placeholder="0"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Proposed sum insured adjustment"
        />
        {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}
        {successMessage ? <Text style={styles.formSuccess}>{successMessage}</Text> : null}
        <TouchableOpacity style={[styles.submitBtn, busy && styles.submitDisabled]} disabled={busy} onPress={handleSubmit}>
          <Text style={styles.submitText}>{busy ? 'Requesting…' : 'Request endorsement'}</Text>
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
  badge: { backgroundColor: '#eff6ff', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#2563eb', textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: 13, color: '#64748b' },
  value: { fontSize: 13, fontWeight: '500', color: '#0f172a' },
  countText: { fontSize: 13, color: '#64748b', paddingVertical: 8 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#334155', fontWeight: '500' },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
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
