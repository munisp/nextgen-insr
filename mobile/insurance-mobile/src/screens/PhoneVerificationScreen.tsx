import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
} from 'react-native';
// 2026-10-03 (W9-B5 wave 3): phone ownership verification, mirroring the web
// member portal MemberIdentity.tsx PhoneVerificationSection (W7-B9) on the
// REAL memberPhone router (server/routers/memberPhone.ts:93-114):
//   - requestPhoneOtp ({ phone: 10..15 } only — NO userId/customerId in the
//     schema; the caller's own customer profile is required server-side,
//     NOT_FOUND non-enumerating)
//   - verifyPhoneOtp  ({ phone, otp: exactly 6 } — bcrypt-hashed codes in the
//     real phone_verification_otps table; 5-attempt lock fails CLOSED)
// Fail-closed semantics (memberPhone.ts:9-27): the per-phone throttle
// (5 requests/hr) and post-verify proof marker are Redis/DB-backed
// server-side — a correct OTP can surface an ERROR instead of a silent pass
// when Redis is down; that error is shown verbatim, never a fabricated
// success. The API returns {success, message} / {verified} only — no
// cooldown fields — so NO client-side resend countdown is fabricated (web
// parity, MemberIdentity.tsx:497-499).
import { memberPhoneApi } from '../services/api';

export function PhoneVerificationScreen({ navigation }: { navigation: any }) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [stage, setStage] = useState<'request' | 'verify' | 'verified'>('request');
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitRequest() {
    setFormError(null);
    setStatusMessage(null);
    const trimmed = phone.trim();
    // zod-exact client guard: phone 10..15 chars (server enforces).
    if (trimmed.length < 10 || trimmed.length > 15) {
      setFormError('Phone number must be 10–15 digits.');
      return;
    }
    setBusy(true);
    try {
      // zod-exact: { phone } only — no userId/customerId anywhere.
      const data = await memberPhoneApi.requestPhoneOtp(trimmed);
      setStatusMessage(data?.message ?? 'Verification code sent by SMS');
      setStage('verify');
    } catch (e: any) {
      setFormError(e?.message || 'Could not send the verification code.');
    } finally {
      setBusy(false);
    }
  }

  async function submitVerify() {
    setFormError(null);
    // zod-exact: otp exactly 6 chars.
    if (otp.trim().length !== 6) {
      setFormError('Enter the 6-digit code from the SMS.');
      return;
    }
    setBusy(true);
    try {
      const data = await memberPhoneApi.verifyPhoneOtp({ phone: phone.trim(), otp: otp.trim() });
      if (data?.verified) {
        setFormError(null);
        setStatusMessage(null);
        setStage('verified');
      } else {
        // Honest {verified:false} payload — surfaced as-is, fail-closed:
        // never treated as success.
        setFormError('The code did not match. Check the SMS and try again.');
      }
    } catch (e: any) {
      setFormError(e?.message || 'Could not verify the code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Phone Verification</Text>
        <Text style={styles.subtitle}>Prove ownership of your phone number with an SMS code.</Text>
      </View>

      <View style={styles.section}>
        {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}
        {statusMessage ? (
          <View style={styles.noteBox}><Text style={styles.noteText}>{statusMessage}</Text></View>
        ) : null}

        {stage === 'verified' ? (
          <View style={styles.noteBox}>
            <Text style={styles.noteText}>Your phone number was verified successfully.</Text>
          </View>
        ) : stage === 'request' ? (
          <>
            <Text style={styles.fieldLabel}>Phone number</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="e.g. 08031234567"
              placeholderTextColor="#94a3b8"
              keyboardType="phone-pad"
              maxLength={15}
              accessibilityLabel="Phone number"
            />
            {/* No client-side resend countdown: the API returns no cooldown
                fields — throttling is enforced server-side (2026-10-03,
                W9-B5 wave 3; web parity). */}
            <TouchableOpacity
              style={[styles.submitBtn, busy && styles.submitDisabled]}
              disabled={busy}
              onPress={submitRequest}
            >
              <Text style={styles.submitText}>{busy ? 'Sending…' : 'Send verification code'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.fieldLabel}>6-digit code</Text>
            <TextInput
              style={styles.input}
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              maxLength={6}
              accessibilityLabel="OTP code"
            />
            <TouchableOpacity
              style={[styles.submitBtn, busy && styles.submitDisabled]}
              disabled={busy}
              onPress={submitVerify}
            >
              <Text style={styles.submitText}>{busy ? 'Verifying…' : 'Verify code'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.outlineBtn}
              onPress={() => {
                setStage('request');
                setOtp('');
                setFormError(null);
                setStatusMessage(null);
              }}
            >
              <Text style={styles.outlineBtnText}>Use a different number</Text>
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
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 6 },
  section: { marginHorizontal: 16, marginTop: 16 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  submitBtn: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  outlineBtn: { borderWidth: 1, borderColor: '#2563eb', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  outlineBtnText: { color: '#2563eb', fontSize: 14, fontWeight: '700' },
  formError: { fontSize: 13, color: '#dc2626', marginBottom: 8 },
  noteBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 },
  noteText: { fontSize: 13, color: '#64748b' },
});
