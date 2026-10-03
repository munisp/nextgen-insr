import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, Alert } from 'react-native';
import { useAuth } from '../store/authStore';

export function ProfileScreen() {
  const { user, logout, biometricEnabled, biometricType, enableBiometric, disableBiometric } = useAuth();
  return (
    <ScrollView style={s.container}>
      <View style={s.header}>
        <View style={s.avatar}><Text style={s.avatarText}>{user?.firstName?.[0]}{user?.lastName?.[0]}</Text></View>
        <Text style={s.name}>{user?.firstName} {user?.lastName}</Text>
        <Text style={s.email}>{user?.email}</Text>
        <View style={[s.kycBadge, { backgroundColor: user?.kycVerified ? '#dcfce7' : '#fef3c7' }]}>
          <Text style={{ color: user?.kycVerified ? '#16a34a' : '#92400e', fontSize: 12, fontWeight: '600' }}>
            KYC {user?.kycVerified ? 'Verified' : 'Pending'}
          </Text>
        </View>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Security</Text>
        <View style={s.settingRow}>
          <Text style={s.settingLabel}>{biometricType === 'face' ? 'Face ID' : 'Fingerprint'} Login</Text>
          <Switch value={biometricEnabled} onValueChange={async (v) => { if (v) { await enableBiometric(); } else { await disableBiometric(); } }} trackColor={{ true: '#2563eb' }} />
        </View>
        {/* 2026-10-01 (W9-B3): credentials and 2FA are managed by Keycloak
            (the platform IdP), not this app — these rows now say so instead
            of being dead buttons that pretended a feature existed. */}
        <TouchableOpacity style={s.settingRow} onPress={() => Alert.alert('Change Password', 'Passwords are managed on your secure InsurePortal account page (Keycloak). Use the password reset link on the sign-in screen.')}><Text style={s.settingLabel}>Change Password</Text><Text style={s.arrow}>→</Text></TouchableOpacity>
        <TouchableOpacity style={s.settingRow} onPress={() => Alert.alert('Two-Factor Authentication', 'Two-factor authentication is configured on your InsurePortal account page (Keycloak), not in the app.')}><Text style={s.settingLabel}>Two-Factor Authentication</Text><Text style={s.arrow}>→</Text></TouchableOpacity>
      </View>
      <View style={s.section}>
        <Text style={s.sectionTitle}>Preferences</Text>
        <TouchableOpacity style={s.settingRow}><Text style={s.settingLabel}>Notifications</Text><Text style={s.arrow}>→</Text></TouchableOpacity>
        <TouchableOpacity style={s.settingRow}><Text style={s.settingLabel}>Language</Text><Text style={s.settingValue}>English</Text></TouchableOpacity>
        <TouchableOpacity style={s.settingRow}><Text style={s.settingLabel}>Currency</Text><Text style={s.settingValue}>₦ NGN</Text></TouchableOpacity>
      </View>
      <View style={s.section}>
        <TouchableOpacity style={s.settingRow}><Text style={s.settingLabel}>Help & Support</Text><Text style={s.arrow}>→</Text></TouchableOpacity>
        <TouchableOpacity style={s.settingRow}><Text style={s.settingLabel}>Privacy Policy</Text><Text style={s.arrow}>→</Text></TouchableOpacity>
        <TouchableOpacity style={s.settingRow}><Text style={s.settingLabel}>Terms of Service</Text><Text style={s.arrow}>→</Text></TouchableOpacity>
      </View>
      <TouchableOpacity style={s.logoutBtn} onPress={logout}><Text style={s.logoutText}>Sign Out</Text></TouchableOpacity>
      <Text style={s.version}>InsurePortal v2.0.0 | NAICOM Licensed</Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { alignItems: 'center', paddingTop: 60, paddingBottom: 24, backgroundColor: '#fff', marginBottom: 16 },
  avatar: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#2563eb', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 28, fontWeight: '700' },
  name: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginTop: 12 }, email: { fontSize: 14, color: '#64748b', marginTop: 4 },
  kycBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 8, marginTop: 8 },
  section: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 16, borderRadius: 12, overflow: 'hidden' },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  settingLabel: { fontSize: 15, color: '#0f172a' }, settingValue: { fontSize: 14, color: '#64748b' }, arrow: { fontSize: 16, color: '#94a3b8' },
  logoutBtn: { marginHorizontal: 16, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#fef2f2', marginTop: 8 },
  logoutText: { color: '#dc2626', fontSize: 15, fontWeight: '600' },
  version: { textAlign: 'center', color: '#94a3b8', fontSize: 11, marginTop: 24 },
});
