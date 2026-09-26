import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import { launchCamera, launchImageLibrary } from 'react-native-image-picker';
import { useOfflineSync } from '../services/offlineSync';
import { reimbursementApi } from '../services/api';

export function FileClaimScreen({ navigation, route }: { navigation: any; route?: { params?: { reimbursement?: boolean } } }) {
  const { enqueue, state } = useOfflineSync();
  // Q4 (2026-09-25): one-tap photo reimbursement mode. Entered from
  // ClaimsScreen's "Photo Reimbursement" entry point. Uses the EXISTING
  // P-wave presigned upload flow (authorize+sign, direct PUT to storage,
  // then submit) — receipts never transit the API server as bytes.
  const isReimbursement = route?.params?.reimbursement === true;
  const [form, setForm] = useState({ type: '', description: '', amount: '', policyNumber: '' });
  const [evidence, setEvidence] = useState<Array<{ uri: string; name: string }>>([]);
  const [submitting, setSubmitting] = useState(false);

  const claimTypes = ['Motor Accident', 'Health/Medical', 'Property Damage', 'Life/Death', 'Marine Cargo', 'Fire/Burglary', 'Travel', 'Agricultural'];

  async function handleReimbursementSubmit() {
    if (evidence.length === 0) { Alert.alert('Required', 'Please snap at least one receipt photo'); return; }
    if (!form.amount || Number.isNaN(Number(form.amount)) || Number(form.amount) <= 0) {
      Alert.alert('Required', 'Please enter the receipt amount'); return;
    }
    setSubmitting(true);
    try {
      const fileKeys: string[] = [];
      for (const photo of evidence) {
        const blob = await (await fetch(photo.uri)).blob();
        const mime = blob.type || 'image/jpeg';
        const signed = await reimbursementApi.requestUploadUrl({
          fileName: photo.name,
          mimeType: (['image/jpeg', 'image/png', 'image/webp'].includes(mime) ? mime : 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/webp',
          fileSize: blob.size,
        });
        await reimbursementApi.uploadBytes(signed.uploadUrl, blob, mime);
        fileKeys.push(signed.fileKey);
      }
      const result = await reimbursementApi.submit({
        documentRefs: fileKeys,
        amount: Number(form.amount),
        description: form.description || undefined,
      });
      // Surface the server's OCR disclosure verbatim when present — it is an
      // honest manual-entry notice, NOT an extraction result.
      const ocrNote = result.ocrDisclosure ? `\n\n${result.ocrDisclosure}` : '';
      Alert.alert('Reimbursement Submitted', `Request #${result.id} is ${result.status.replace(/_/g, ' ')}.${ocrNote}`, [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (err) {
      Alert.alert('Submission Failed', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!form.type || !form.description) { Alert.alert('Required', 'Please fill in claim type and description'); return; }
    setSubmitting(true);
    await enqueue({
      type: 'CREATE', entity: 'claim',
      payload: { ...form, evidence: evidence.map((e) => e.uri), filedAt: new Date().toISOString() },
      maxRetries: 10, priority: 'high', conflictStrategy: 'client-wins',
    });
    setSubmitting(false);
    Alert.alert('Claim Filed', state.isOnline ? 'Your claim has been submitted.' : 'Claim queued — will submit when you\'re back online.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
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
        <Text style={styles.title}>{isReimbursement ? 'Photo Reimbursement' : 'File a Claim'}</Text>
      </View>
      <View style={styles.form}>
        {isReimbursement ? (
          <>
            <Text style={styles.label}>Receipt Photos ({evidence.length}) *</Text>
            <View style={styles.evidenceRow}>
              <TouchableOpacity style={styles.evidenceBtn} onPress={() => addPhoto('camera')}><Text style={styles.evidenceBtnText}>📷 Camera</Text></TouchableOpacity>
              <TouchableOpacity style={styles.evidenceBtn} onPress={() => addPhoto('gallery')}><Text style={styles.evidenceBtnText}>🖼️ Gallery</Text></TouchableOpacity>
            </View>

            <Text style={styles.label}>Receipt Amount (₦) *</Text>
            <TextInput style={styles.input} value={form.amount} onChangeText={(v) => setForm({ ...form, amount: v })} keyboardType="numeric" placeholder="0" placeholderTextColor="#94a3b8" />

            <Text style={styles.label}>Note (optional)</Text>
            <TextInput style={[styles.input, styles.textarea]} value={form.description} onChangeText={(v) => setForm({ ...form, description: v })} multiline numberOfLines={3} placeholder="What is this receipt for?" placeholderTextColor="#94a3b8" />

            <TouchableOpacity style={[styles.submitBtn, submitting && styles.submitDisabled]} onPress={handleReimbursementSubmit} disabled={submitting}>
              <Text style={styles.submitText}>{submitting ? 'Uploading...' : 'Submit Reimbursement'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
        <Text style={styles.label}>Claim Type *</Text>
        <View style={styles.typeGrid}>
          {claimTypes.map((t) => (
            <TouchableOpacity key={t} style={[styles.typeChip, form.type === t && styles.typeActive]} onPress={() => setForm({ ...form, type: t })}>
              <Text style={[styles.typeText, form.type === t && { color: '#fff' }]}>{t}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Policy Number</Text>
        <TextInput style={styles.input} value={form.policyNumber} onChangeText={(v) => setForm({ ...form, policyNumber: v })} placeholder="INS-XXXXX" placeholderTextColor="#94a3b8" />

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
