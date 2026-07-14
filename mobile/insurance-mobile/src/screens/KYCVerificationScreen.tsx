import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert, TextInput } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../store/authStore';
import { useOfflineSync } from '../services/offlineSync';

const API_BASE = 'http://localhost:3000/api/trpc';

export function KYCVerificationScreen({ navigation }: { navigation: any }) {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { getCachedData, setCachedData } = useOfflineSync();
  const [bvn, setBvn] = React.useState('');
  const [nin, setNin] = React.useState('');

  const { data: kycGate, isLoading } = useQuery({
    queryKey: ['kyc.gate'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/kyc.gate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        const data = json?.result?.data || json;
        await setCachedData('kyc.gate', data, 300000);
        return data;
      } catch {
        return await getCachedData('kyc.gate') || { level: 0, kycStatus: 'unknown', completedSteps: [], remainingSteps: ['bvn', 'nin', 'phone'] };
      }
    },
  });

  const verifyBVN = useMutation({
    mutationFn: async () => {
      if (bvn.length !== 11) throw new Error('BVN must be 11 digits');
      const res = await fetch(`${API_BASE}/kyc.verifyBVN`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ bvn }),
      });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['kyc.gate'] }); Alert.alert('Success', 'BVN verified successfully'); },
    onError: (e: any) => Alert.alert('Error', e.message),
  });

  const verifyNIN = useMutation({
    mutationFn: async () => {
      if (nin.length !== 11) throw new Error('NIN must be 11 digits');
      const res = await fetch(`${API_BASE}/kyc.verifyNIN`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ nin }),
      });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['kyc.gate'] }); Alert.alert('Success', 'NIN verified successfully'); },
    onError: (e: any) => Alert.alert('Error', e.message),
  });

  const tierColors: Record<number, string> = { 0: '#ef4444', 1: '#f59e0b', 2: '#3b82f6', 3: '#10b981' };
  const tierLabels: Record<number, string> = { 0: 'Unverified', 1: 'Tier 1 — Basic', 2: 'Tier 2 — Standard', 3: 'Tier 3 — Full' };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>KYC Verification</Text>
        <View style={[styles.badge, { backgroundColor: tierColors[kycGate?.level || 0] }]}>
          <Text style={styles.badgeText}>{tierLabels[kycGate?.level || 0]}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Verification Status</Text>
        <Text style={styles.status}>Status: {kycGate?.kycStatus || 'pending'}</Text>
        <Text style={styles.label}>Completed: {kycGate?.completedSteps?.join(', ') || 'None'}</Text>
        <Text style={styles.label}>Remaining: {kycGate?.remainingSteps?.join(', ') || 'None'}</Text>
        {kycGate?.facialMatchScore && <Text style={styles.label}>Facial Match: {kycGate.facialMatchScore}%</Text>}
        {kycGate?.nextReviewDate && <Text style={styles.label}>Next Review: {new Date(kycGate.nextReviewDate).toLocaleDateString()}</Text>}
      </View>

      {kycGate?.remainingSteps?.includes('bvn') && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Step 1: Verify BVN</Text>
          <Text style={styles.hint}>Bank Verification Number — 11 digits</Text>
          <TextInput style={styles.input} placeholder="Enter BVN" keyboardType="number-pad" maxLength={11} value={bvn} onChangeText={setBvn} accessibilityLabel="BVN input" />
          <TouchableOpacity style={[styles.button, bvn.length !== 11 && styles.buttonDisabled]} onPress={() => verifyBVN.mutate()} disabled={bvn.length !== 11 || verifyBVN.isPending}>
            <Text style={styles.buttonText}>{verifyBVN.isPending ? 'Verifying...' : 'Verify BVN'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {kycGate?.remainingSteps?.includes('nin') && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Step 2: Verify NIN</Text>
          <Text style={styles.hint}>National Identification Number — 11 digits</Text>
          <TextInput style={styles.input} placeholder="Enter NIN" keyboardType="number-pad" maxLength={11} value={nin} onChangeText={setNin} accessibilityLabel="NIN input" />
          <TouchableOpacity style={[styles.button, nin.length !== 11 && styles.buttonDisabled]} onPress={() => verifyNIN.mutate()} disabled={nin.length !== 11 || verifyNIN.isPending}>
            <Text style={styles.buttonText}>{verifyNIN.isPending ? 'Verifying...' : 'Verify NIN'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {kycGate?.blockedFeatures?.length > 0 && (
        <View style={[styles.card, { borderLeftColor: '#ef4444', borderLeftWidth: 4 }]}>
          <Text style={styles.cardTitle}>Blocked Features</Text>
          {kycGate.blockedFeatures.map((f: string, i: number) => (
            <Text key={i} style={styles.blockedItem}>• {f.replace(/_/g, ' ')}</Text>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b' },
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b', marginBottom: 8 },
  status: { fontSize: 14, color: '#475569', marginBottom: 4 },
  label: { fontSize: 13, color: '#64748b', marginBottom: 2 },
  hint: { fontSize: 12, color: '#94a3b8', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 12, backgroundColor: '#f8fafc' },
  button: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  buttonDisabled: { backgroundColor: '#94a3b8' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  blockedItem: { fontSize: 13, color: '#ef4444', marginBottom: 4, textTransform: 'capitalize' },
});
