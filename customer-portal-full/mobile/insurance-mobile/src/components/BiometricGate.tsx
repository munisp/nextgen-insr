import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useAuth } from '../store/authStore';

export function BiometricGate({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, biometricEnabled, biometricType, loginWithBiometric } = useAuth();
  const [biometricFailed, setBiometricFailed] = useState(false);

  useEffect(() => {
    if (isAuthenticated && biometricEnabled && !biometricFailed) {
      attemptBiometric();
    }
  }, [isAuthenticated, biometricEnabled]);

  async function attemptBiometric() {
    try {
      await loginWithBiometric();
    } catch {
      setBiometricFailed(true);
    }
  }

  // 2026-09-19 (P-wave): no loading spinner here — first paint must not block
  // on auth boot or the biometric sensor check. Children render immediately;
  // while unauthenticated the navigator shows the auth stack anyway. The
  // biometric prompt is only a gate once it has actually been attempted and
  // failed (a protected action), not a blanket paint blocker.
  if (biometricFailed && biometricEnabled) {
    return (
      <View style={styles.container}>
        <Text style={styles.icon}>
          {biometricType === 'face' ? '👤' : '👆'}
        </Text>
        <Text style={styles.title}>Authentication Required</Text>
        <Text style={styles.subtitle}>
          Use {biometricType === 'face' ? 'Face ID' : 'fingerprint'} to unlock
        </Text>
        <TouchableOpacity style={styles.retryButton} onPress={attemptBiometric}>
          <Text style={styles.retryText}>Try Again</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.fallbackButton}
          onPress={() => setBiometricFailed(false)}
        >
          <Text style={styles.fallbackText}>Use Password Instead</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc', padding: 32 },
  loadingText: { marginTop: 16, fontSize: 16, color: '#64748b' },
  icon: { fontSize: 64, marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#64748b', marginBottom: 32, textAlign: 'center' },
  retryButton: { backgroundColor: '#2563eb', paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12, marginBottom: 16 },
  retryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  fallbackButton: { paddingVertical: 12 },
  fallbackText: { color: '#2563eb', fontSize: 14 },
});
