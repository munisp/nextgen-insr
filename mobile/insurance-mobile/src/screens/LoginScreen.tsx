import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useAuth } from '../store/authStore';

/**
 * LoginScreen.tsx — 2026-10-01 (W9-B3)
 * The old email/password form POSTed credentials to /api/v1/auth/login on
 * the Go BFF — a route that does not exist (guaranteed 404), and no member
 * password endpoint exists anywhere in the platform. Real authentication is
 * Keycloak OIDC: this screen launches the authorization-code + PKCE flow in
 * the system browser, where Keycloak (not this app) collects credentials.
 * "Forgot password" is handled by Keycloak's own account console, reachable
 * from the login page it renders — no fake in-app reset form.
 */
export function LoginScreen() {
  const { login, loginWithBiometric, biometricEnabled, biometricType } = useAuth();
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setLoading(true); setError('');
    try {
      await login();
    } catch (e: any) {
      // Honest error surfacing — including user-cancel from the browser.
      const msg: string = e?.message || '';
      setError(
        msg.toLowerCase().includes('cancel')
          ? 'Sign-in was cancelled.'
          : `Sign-in failed${msg ? `: ${msg}` : ''}`,
      );
    }
    setLoading(false);
  }

  async function handleBiometric() {
    setLoading(true); setError('');
    try { await loginWithBiometric(); }
    catch (e: any) { setError(e?.message || 'Biometric sign-in failed'); }
    setLoading(false);
  }

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={s.logoContainer}><Text style={s.logo}>InsurePortal</Text><Text style={s.tagline}>Your Insurance, Simplified</Text></View>
      <View style={s.form}>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <TouchableOpacity style={[s.loginBtn, loading && { opacity: 0.6 }]} onPress={handleLogin} disabled={loading} accessibilityLabel="Sign in with Keycloak">
          <Text style={s.loginText}>{loading ? 'Opening secure sign-in...' : 'Sign In'}</Text>
        </TouchableOpacity>
        <Text style={s.hint}>
          You will sign in through your secure InsurePortal account page. Password reset is available there.
        </Text>
        {biometricEnabled && (
          <TouchableOpacity style={s.biometricBtn} onPress={handleBiometric} disabled={loading}>
            <Text style={s.biometricText}>{biometricType === 'face' ? '👤 Unlock with Face ID' : '👆 Unlock with Fingerprint'}</Text>
          </TouchableOpacity>
        )}
      </View>
      <Text style={s.footer}>NAICOM Licensed | NDPR Compliant</Text>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', justifyContent: 'center', padding: 24 },
  logoContainer: { alignItems: 'center', marginBottom: 48 },
  logo: { fontSize: 32, fontWeight: '800', color: '#2563eb' }, tagline: { fontSize: 14, color: '#64748b', marginTop: 4 },
  form: { gap: 12 }, error: { color: '#dc2626', textAlign: 'center', fontSize: 13, marginBottom: 4 },
  loginBtn: { backgroundColor: '#2563eb', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 8 },
  loginText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hint: { fontSize: 12, color: '#64748b', textAlign: 'center', lineHeight: 17 },
  biometricBtn: { alignItems: 'center', paddingVertical: 14, backgroundColor: '#f1f5f9', borderRadius: 12 },
  biometricText: { fontSize: 15, color: '#334155', fontWeight: '500' },
  footer: { textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 40 },
});
