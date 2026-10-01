import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../store/authStore';
import { useOfflineSync } from '../services/offlineSync';
// 2026-10-01 (R1c): was kyc.gate / kyc.verifyBVN / kyc.verifyNIN (all
// nonexistent) on hardcoded localhost. Status is rewired to the real mounted
// customer.kyc.status; self-service BVN/NIN verification has NO monolith
// equivalent, so it is replaced with an honest unavailable state below —
// identity verification must never be faked (fail-closed).
import { trpcQuery } from '../config';

interface KycSession {
  status?: string;
  docType?: string;
  createdAt?: string;
}

export function KYCVerificationScreen({ navigation }: { navigation: any }) {
  const { token } = useAuth();
  const { getCachedData, setCachedData } = useOfflineSync();

  const { data: kycStatus, isLoading } = useQuery({
    queryKey: ['customer.kyc.status'],
    queryFn: async (): Promise<KycSession | null> => {
      try {
        const data = await trpcQuery<KycSession | null>('customer.kyc.status', null, token);
        await setCachedData('kyc.status', data, 300000);
        return data;
      } catch {
        return await getCachedData('kyc.status');
      }
    },
  });

  // 2026-10-01 (R1c): render only what customer.kyc.status really returns
  // (latest KYC session or null). No fabricated tiers/steps.
  const statusLabel = isLoading
    ? 'Loading…'
    : kycStatus?.status
      ? String(kycStatus.status).replace(/_/g, ' ')
      : 'No KYC session on record';
  const statusColor = kycStatus?.status === 'approved' || kycStatus?.status === 'verified'
    ? '#10b981'
    : kycStatus?.status ? '#f59e0b' : '#94a3b8';

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>KYC Verification</Text>
        <View style={[styles.badge, { backgroundColor: statusColor }]}>
          <Text style={styles.badgeText}>{statusLabel}</Text>
        </View>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Verification Status</Text>
        {isLoading ? (
          <Text style={styles.status}>Loading…</Text>
        ) : kycStatus ? (
          <>
            <Text style={styles.status}>Status: {statusLabel}</Text>
            {kycStatus.docType && <Text style={styles.label}>Document type: {kycStatus.docType.replace(/_/g, ' ')}</Text>}
            {kycStatus.createdAt && <Text style={styles.label}>Submitted: {new Date(kycStatus.createdAt).toLocaleDateString()}</Text>}
          </>
        ) : (
          <Text style={styles.status}>No KYC verification has been started for your account yet.</Text>
        )}
      </View>

      {/* 2026-10-01 (R1c): honest unavailable state — self-service BVN/NIN
          verification does not exist in the monolith; previously this form
          called nonexistent kyc.verifyBVN/verifyNIN endpoints. */}
      <View style={[styles.card, { borderLeftColor: '#f59e0b', borderLeftWidth: 4 }]}>
        <Text style={styles.cardTitle}>BVN / NIN Verification</Text>
        <Text style={styles.status}>
          Self-service identity verification is not currently available in the app.
          To complete BVN or NIN verification, please contact your agent or visit a
          branch — your identity documents are verified in person for your protection.
        </Text>
      </View>
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
