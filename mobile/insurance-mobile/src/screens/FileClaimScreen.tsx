import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useQuery } from '@tanstack/react-query';
import { useOfflineSync } from '../services/offlineSync';
// 2026-10-01 (W9-B3): this screen previously referenced undefined
// `policies`/`selectedPolicyId` variables (it could not even compile) and
// "filed" claims only into the offline queue with a success message. Now:
// the policy picker reads the REAL memberClaims.myPoliciesPicker tRPC
// procedure (caller's active policies only), and online submission calls
// the real memberClaims.fileClaim mutation (server re-verifies policy
// ownership). Offline submissions are queued — and labelled as queued.
// 2026-10-03 (W9-B4): routed through memberTrpc (Bearer + 401 refresh-retry).
import { claimsApi } from '../services/api';
import { memberQuery, memberMutation } from '../services/memberTrpc';

export function FileClaimScreen({ navigation }: { navigation: any }) {
  const { enqueue, state } = useOfflineSync();
  const [form, setForm] = useState({ type: '', description: '', amount: '', policyNumber: '' });
  const [evidence, setEvidence] = useState<Array<{ uri: string; name: string }>>([]);
  const [submitting, setSubmitting] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState<number | null>(null);

  const claimTypes = ['Motor Accident', 'Health/Medical', 'Property Damage', 'Life/Death', 'Marine Cargo', 'Fire/Burglary', 'Travel', 'Agricultural'];

  // Real active-policy picker (memberClaims.myPoliciesPicker).
  const { data: policies, isLoading: policiesLoading } = useQuery<any[]>({
    queryKey: ['memberClaims.myPoliciesPicker'],
    queryFn: async () => {
      // 2026-10-03 (W9-B4 round 2): myPoliciesPicker returns
      // `{ policies: rows }` (server/routers/memberClaims.ts:224), not a
      // bare array — the pre-round-2 Array.isArray check silently rendered
      // an empty picker. Read the real shape.
      const res = await memberQuery<{ policies: any[] }>('memberClaims.myPoliciesPicker', null);
      return res?.policies ?? [];
    },
  });

  async function handleSubmit() {
    if (!form.type || !form.description) { Alert.alert('Required', 'Please fill in claim type and description'); return; }
    if (selectedPolicyId == null) { Alert.alert('Required', 'Please select the policy this claim is for'); return; }
    const claimedAmount = parseFloat(form.amount);
    // memberClaims.fileClaim requires a positive claimedAmount — validate
    // honestly instead of sending 0 and failing server-side.
    if (!Number.isFinite(claimedAmount) || claimedAmount <= 0) {
      Alert.alert('Required', 'Please enter a valid estimated amount (greater than ₦0)');
      return;
    }
    setSubmitting(true);
    try {
      if (state.isOnline) {
        // Real submission path — memberClaims.fileClaim. The app has no
        // document-upload pipeline yet, so evidence photos cannot be
        // attached online; say so honestly instead of dropping them.
        if (evidence.length > 0) {
          Alert.alert(
            'Evidence Not Attached',
            'Photo evidence cannot be uploaded from the app yet. File the claim now and your agent can attach the photos, or submit offline so the photos stay queued on this device.',
          );
          setSubmitting(false);
          return;
        }
        await memberMutation('memberClaims.fileClaim', {
          policyId: selectedPolicyId,
          claimType: form.type,
          incidentDate: new Date().toISOString(),
          claimedAmount,
          incidentDescription: form.description,
          documents: [],
        });
        Alert.alert('Claim Filed', 'Your claim was submitted and accepted by the server.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      } else {
        await enqueue({
          type: 'CREATE', entity: 'claim',
          payload: { ...form, policyId: selectedPolicyId, evidence: evidence.map((e) => e.uri), filedAt: new Date().toISOString() },
          maxRetries: 10, priority: 'high', conflictStrategy: 'client-wins',
        });
        // 2026-10-01 (W9-B3): honest wording — queued, not "submitted".
        Alert.alert('Claim Queued', 'Offline — your claim is queued on this device and will be submitted when you are back online.', [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
      }
    } catch (e: any) {
      Alert.alert('Claim Not Filed', e?.message || 'Submission failed — nothing was filed.');
    }
    setSubmitting(false);
  }

  async function addPhoto(source: 'camera' | 'gallery') {
    const fn = source === 'camera' ? launchCamera : launchImageLibrary;
    const result = await fn({ mediaType: 'photo', quality: 0.7, maxWidth: 1920, maxHeight: 1920 });
    if (result.assets?.[0]) {
      evidence.push({ uri: result.assets[0].uri!, name: result.assets[0].fileName || `photo_${Date.now()}.jpg` });
      setEvidence([...evidence]);
    }
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>File a Claim</Text>
      </View>
      <View style={styles.form}>
        <Text style={styles.label}>Claim Type *</Text>
        <View style={styles.typeGrid}>
          {claimTypes.map((t) => (
            <TouchableOpacity key={t} style={[styles.typeChip, form.type === t && styles.typeActive]} onPress={() => setForm({ ...form, type: t })}>
              <Text style={[styles.typeText, form.type === t && { color: '#fff' }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Policy *</Text>
        {policiesLoading ? (
          <ActivityIndicator color="#2563eb" />
        ) : !policies || policies.length === 0 ? (
          /* 2026-10-01 (R1c): honest empty state — cannot file without a policy */
          <View style={styles.offlineNote}><Text style={styles.offlineNoteText}>No policies found on your account — a claim must be filed against an existing policy.</Text></View>
        ) : (
          <View style={styles.typeGrid}>
            {policies.map((p: any) => (
              <TouchableOpacity key={p.id} style={[styles.typeChip, selectedPolicyId === Number(p.id) && styles.typeActive]} onPress={() => setSelectedPolicyId(Number(p.id))}>
                <Text style={[styles.typeText, selectedPolicyId === Number(p.id) && { color: '#fff' }]}>
                  {p.policyNumber || `Policy #${p.id}`}{p.status ? ` (${p.status})` : ''}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <Text style={styles.label}>Description *</Text>
        <TextInput style={[styles.input, styles.textarea]} value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline numberOfLines={4} placeholder="Describe the incident..." placeholderTextColor="#94a3b8" />

        <Text style={styles.label}>Estimated Amount (₦)</Text>
        <TextInput style={styles.input} value={form.amount} onChangeText={(v) => setForm({ ...form, amount: v })} keyboardType="numeric" placeholder="0" placeholderTextColor="#94a3b8" />

        <Text style={styles.label}>Evidence ({evidence.length} files)</Text>
        <View style={styles.evidenceRow}>
          <TouchableOpacity style={styles.evidenceBtn} onPress={() => addPhoto('camera')}><Text style={styles.evidenceBtnText}>📷 Camera</Text></TouchableOpacity>
          <TouchableOpacity style={styles.evidenceBtn} onPress={() => addPhoto('gallery')}><Text style={styles.evidenceBtnText}>🖼️ Gallery</Text></TouchableOpacity>
        </View>

        {!state.isOnline && <View style={styles.offlineNote}><Text style={styles.offlineNoteText}>📡 Offline — claim will be queued and submitted when online</Text></View>}

        <TouchableOpacity style={[styles.submitBtn, submitting && styles.submitDisabled]} onPress={handleSubmit} disabled={submitting}>
          <Text style={styles.submitText}>{submitting ? 'Submitting...' : 'Submit Claim'}</Text>
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
  form: { paddingHorizontal: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  textarea: { minHeight: 100, textAlignVertical: 'top' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9' },
  typeActive: { backgroundColor: '#2563eb' },
  typeText: { fontSize: 13, color: '#334155', fontWeight: '500' },
  evidenceRow: { flexDirection: 'row', gap: 12 },
  evidenceBtn: { flex: 1, backgroundColor: '#fff', paddingVertical: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#e2e8f0', borderStyle: 'dashed' },
  evidenceBtnText: { fontSize: 14, fontWeight: '500', color: '#334155' },
  offlineNote: { backgroundColor: '#fef3c7', padding: 12, borderRadius: 8, marginTop: 16 },
  offlineNoteText: { fontSize: 12, color: '#92400e', textAlign: 'center' },
  submitBtn: { backgroundColor: '#2563eb', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
