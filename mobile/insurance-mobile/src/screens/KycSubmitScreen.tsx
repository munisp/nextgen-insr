import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-04 (W10-B4b): KYC document submission, mirroring the web member
// portal MemberIdentity.tsx KycSubmitSection (W10-B4a) on the REAL W10-B3
// memberIdentity procs (server/routers/memberIdentity.ts):
//   - myKycStatus  (honest empty state when no customer profile; session is
//                   scoped to DOCUMENT-verification sessions only)
//   - myKycSession (caller-scoped PII-safe read of the open submission)
//   - submitKyc    (zod-STRICT { docType nin|bvn, docNumber exactly 11 digits }
//                   — real enhanced-kyc-kyb verification; status transitions
//                   ONLY on the service's adjudication)
// Honest-contract discipline (web parity):
//   - An OPEN ("pending") session renders its real status panel + Refresh
//     instead of a duplicate form (the server would CONFLICT a duplicate).
//   - The submit response message is the server's VERBATIM wording —
//     including the honest "unavailable, still pending" outcome — never
//     paraphrased into a success.
//   - The verification-service PRECONDITION_FAILED / CONFLICT errors are
//     surfaced verbatim.
import { kycApi, MemberKycStatus, SubmitKycResult } from '../services/api';

export function KycSubmitScreen({ navigation }: { navigation: any }) {
  const [docType, setDocType] = useState<'nin' | 'bvn'>('nin');
  const [docNumber, setDocNumber] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitKycResult | null>(null);
  const [busy, setBusy] = useState(false);

  const kycQuery = useQuery<MemberKycStatus>({
    queryKey: ['memberIdentity.myKycStatus'],
    queryFn: () => kycApi.myKycStatus(),
  });

  const openSession =
    kycQuery.data?.session && kycQuery.data.session.status === 'pending'
      ? kycQuery.data.session
      : null;

  // Real per-session read for the open submission (caller-scoped, PII-safe).
  const sessionQuery = useQuery({
    queryKey: ['memberIdentity.myKycSession', openSession?.id],
    queryFn: () => kycApi.myKycSession(openSession!.id),
    enabled: openSession !== null,
  });

  const onSubmit = async () => {
    setFormError(null);
    setSubmitError(null);
    setResult(null);
    // zod-exact client guard: NIN/BVN exactly 11 digits (server enforces).
    if (!/^\d{11}$/.test(docNumber.trim())) {
      setFormError('NIN/BVN must be exactly 11 digits.');
      return;
    }
    setBusy(true);
    try {
      // zod-strict payload: { docType, docNumber } only — no docImageRef
      // (no upload flow in this batch).
      const data = await kycApi.submitKyc({ docType, docNumber: docNumber.trim() });
      setResult(data);
      setDocNumber('');
      kycQuery.refetch();
    } catch (e: any) {
      setResult(null);
      setSubmitError(e?.message || 'KYC submission failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Identity Verification</Text>
        <Text style={styles.subtitle}>
          Submit your NIN or BVN for verification against the real identity service.
        </Text>
      </View>

      <View style={styles.section}>
        {kycQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading KYC status…</Text></View>
        ) : kycQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(kycQuery.error as Error)?.message}</Text></View>
        ) : !kycQuery.data?.hasProfile ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>
              No customer profile is linked to your account yet, so no KYC status is available.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.metaLine}>
              Current status: {kycQuery.data.status} · KYC level {kycQuery.data.kycLevel}
            </Text>

            {openSession ? (
              // Open-session status panel (web parity): NO duplicate form
              // while a submission is pending — the server guards with
              // CONFLICT anyway. Refresh re-reads the truth.
              <View style={styles.noteBox} testID="kyc-open-session">
                <Text style={styles.noteText}>
                  You have an open KYC submission (#{openSession.id}) — status:{' '}
                  {sessionQuery.data?.status ?? openSession.status}. A duplicate submission is not
                  allowed while it is open.
                </Text>
                {sessionQuery.data?.rejectionReason ? (
                  <Text style={styles.noteText}>{sessionQuery.data.rejectionReason}</Text>
                ) : null}
                {sessionQuery.isError ? (
                  <Text accessibilityRole="alert" style={styles.errorText}>
                    {(sessionQuery.error as Error)?.message}
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={styles.outlineBtn}
                  accessibilityLabel="Refresh status"
                  onPress={() => {
                    sessionQuery.refetch();
                    kycQuery.refetch();
                  }}
                >
                  <Text style={styles.outlineBtnText}>Refresh status</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}
                {submitError ? <Text accessibilityRole="alert" style={styles.formError}>{submitError}</Text> : null}
                {result ? (
                  // Verbatim server message — the "unavailable, still pending"
                  // outcome renders as-is and is NEVER styled as a success.
                  <View
                    style={result.verified ? styles.noteBox : result.serviceOutcome === 'unavailable' ? styles.noteBox : styles.failedBox}
                    testID="kyc-submit-result"
                  >
                    <Text style={result.verified || result.serviceOutcome === 'unavailable' ? styles.noteText : styles.failedText}>
                      {result.message} (session #{result.sessionId}, status: {result.status})
                    </Text>
                  </View>
                ) : null}
                <Text style={styles.fieldLabel}>Document type</Text>
                <View style={styles.chipRow}>
                  {(['nin', 'bvn'] as const).map((t) => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.chip, docType === t && styles.chipActive]}
                      onPress={() => setDocType(t)}
                      accessibilityLabel={`Document type ${t.toUpperCase()}`}
                    >
                      <Text style={[styles.chipText, docType === t && { color: '#fff' }]}>{t.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <Text style={styles.fieldLabel}>{docType === 'nin' ? 'NIN' : 'BVN'} (11 digits)</Text>
                <TextInput
                  style={styles.input}
                  value={docNumber}
                  onChangeText={setDocNumber}
                  keyboardType="number-pad"
                  maxLength={11}
                  placeholder="12345678901"
                  placeholderTextColor="#94a3b8"
                  accessibilityLabel="Document number"
                />
                <TouchableOpacity
                  style={[styles.submitBtn, busy && styles.submitDisabled]}
                  disabled={busy}
                  onPress={onSubmit}
                >
                  <Text style={styles.submitText}>{busy ? 'Submitting…' : 'Submit for verification'}</Text>
                </TouchableOpacity>
                <Text style={styles.metaLine}>
                  Your document number is verified against the real identity service and stored encrypted;
                  the result — verified, rejected, or still pending — is reported exactly as the service
                  adjudicates it.
                </Text>
              </>
            )}
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
  metaLine: { fontSize: 12, color: '#64748b', marginTop: 8 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 12, marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 12, color: '#334155', fontWeight: '500' },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  submitBtn: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  outlineBtn: { borderWidth: 1, borderColor: '#2563eb', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10, alignItems: 'center', marginTop: 12, alignSelf: 'flex-start' },
  outlineBtnText: { color: '#2563eb', fontSize: 14, fontWeight: '700' },
  formError: { fontSize: 13, color: '#dc2626', marginBottom: 8 },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  noteBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginTop: 12 },
  noteText: { fontSize: 13, color: '#64748b' },
  failedBox: { borderWidth: 1, borderColor: '#fecaca', backgroundColor: '#fef2f2', borderRadius: 10, padding: 12, marginTop: 12 },
  failedText: { fontSize: 13, color: '#dc2626' },
});
