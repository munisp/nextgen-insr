// Settings Screen for React Native — InsurePortal Agency Banking
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet, Alert,
  Platform, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { APIClient } from '../api/APIClient';

const api = new APIClient();

interface SettingsState {
  pushNotifications: boolean;
  biometricAuth: boolean;
  darkMode: boolean;
  autoLogout: boolean;
  transactionAlerts: boolean;
  marketingEmails: boolean;
  language: string;
  currency: string;
  autoLogoutMinutes: number;
}

const DEFAULT_SETTINGS: SettingsState = {
  pushNotifications: true,
  biometricAuth: false,
  darkMode: false,
  autoLogout: true,
  transactionAlerts: true,
  marketingEmails: false,
  language: 'en',
  currency: 'NGN',
  autoLogoutMinutes: 15,
};

export default function SettingsScreen({ navigation }: any) {
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [appVersion] = useState('2.4.0');

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const stored = await AsyncStorage.getItem('app_settings');
      if (stored) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(stored) });
    } catch (e) {
      console.error('Failed to load settings', e);
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async (key: keyof SettingsState, value: any) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    await AsyncStorage.setItem('app_settings', JSON.stringify(updated));
    try { await api.put('/agent/settings', { [key]: value }); } catch (e) { /* offline-safe */ }
  };

  const handleClearCache = () => {
    Alert.alert('Clear Cache', 'This will clear all cached data. Continue?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: async () => {
        await AsyncStorage.multiRemove(['cached_transactions', 'cached_agents', 'cached_reports']);
        Alert.alert('Success', 'Cache cleared successfully');
      }},
    ]);
  };

  const handleExportData = async () => {
    try {
      const result = await api.post('/agent/export-data', {});
      Alert.alert('Export Requested', `Your data export has been queued. Reference: ${result?.ref || 'N/A'}`);
    } catch (e) {
      Alert.alert('Error', 'Failed to request data export.');
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert('Delete Account', 'This action is irreversible. Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        Alert.alert('Confirmation Required', 'Please contact support to complete account deletion.', [
          { text: 'Contact Support', onPress: () => Linking.openURL('mailto:support@insureportal.io') },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }},
    ]);
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );

  const SettingRow = ({ label, description, value, onToggle }: {
    label: string; description?: string; value: boolean; onToggle: (v: boolean) => void;
  }) => (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {description && <Text style={styles.rowDesc}>{description}</Text>}
      </View>
      <Switch value={value} onValueChange={onToggle} trackColor={{ false: '#ccc', true: '#0A6847' }} thumbColor={value ? '#fff' : '#f4f3f4'} />
    </View>
  );

  const ActionRow = ({ label, description, onPress, destructive }: {
    label: string; description?: string; onPress: () => void; destructive?: boolean;
  }) => (
    <TouchableOpacity style={styles.row} onPress={onPress}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, destructive && styles.destructive]}>{label}</Text>
        {description && <Text style={styles.rowDesc}>{description}</Text>}
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );

  if (loading) return <View style={styles.center}><Text>Loading settings...</Text></View>;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Section title="Notifications">
        <SettingRow label="Push Notifications" description="Receive alerts for transactions and updates" value={settings.pushNotifications} onToggle={(v) => updateSetting('pushNotifications', v)} />
        <SettingRow label="Transaction Alerts" description="Real-time alerts for every transaction" value={settings.transactionAlerts} onToggle={(v) => updateSetting('transactionAlerts', v)} />
        <SettingRow label="Marketing Emails" description="Receive promotional offers and news" value={settings.marketingEmails} onToggle={(v) => updateSetting('marketingEmails', v)} />
      </Section>
      <Section title="Security">
        <SettingRow label="Biometric Authentication" description="Use fingerprint or face ID to login" value={settings.biometricAuth} onToggle={(v) => updateSetting('biometricAuth', v)} />
        <SettingRow label="Auto Logout" description={`Logout after ${settings.autoLogoutMinutes} min inactivity`} value={settings.autoLogout} onToggle={(v) => updateSetting('autoLogout', v)} />
        <ActionRow label="Change PIN" description="Update your 6-digit security PIN" onPress={() => navigation?.navigate?.('PinSetup')} />
        <ActionRow label="Security Settings" description="2FA, backup codes, trusted devices" onPress={() => navigation?.navigate?.('SecuritySettings')} />
      </Section>
      <Section title="Preferences">
        <ActionRow label="Language" description={settings.language === 'en' ? 'English' : settings.language} onPress={() => Alert.alert('Language', 'Language selection coming soon')} />
        <ActionRow label="Currency" description={settings.currency} onPress={() => Alert.alert('Currency', 'Currency selection coming soon')} />
        <SettingRow label="Dark Mode" description="Switch to dark theme" value={settings.darkMode} onToggle={(v) => updateSetting('darkMode', v)} />
      </Section>
      <Section title="Data & Storage">
        <ActionRow label="Clear Cache" description="Free up storage space" onPress={handleClearCache} />
        <ActionRow label="Export My Data" description="Download a copy of your data" onPress={handleExportData} />
      </Section>
      <Section title="About">
        <View style={styles.row}><Text style={styles.rowLabel}>App Version</Text><Text style={styles.rowValue}>{appVersion}</Text></View>
        <ActionRow label="Terms of Service" onPress={() => Linking.openURL('https://insureportal.io/terms')} />
        <ActionRow label="Privacy Policy" onPress={() => Linking.openURL('https://insureportal.io/privacy')} />
        <ActionRow label="Contact Support" onPress={() => Linking.openURL('mailto:support@insureportal.io')} />
      </Section>
      <Section title="Danger Zone">
        <ActionRow label="Delete Account" description="Permanently delete your account and all data" onPress={handleDeleteAccount} destructive />
      </Section>
      <View style={styles.footer}>
        <Text style={styles.footerText}>InsurePortal Agency Banking Platform</Text>
        <Text style={styles.footerText}>© 2024-2026 InsurePortal. All rights reserved.</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8f9fa' },
  content: { paddingBottom: 40 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  section: { marginTop: 16, backgroundColor: '#fff', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#e5e7eb' },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#6b7280', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#e5e7eb' },
  rowText: { flex: 1, marginRight: 12 },
  rowLabel: { fontSize: 16, color: '#111827', fontWeight: '500' },
  rowDesc: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  rowValue: { fontSize: 16, color: '#6b7280' },
  chevron: { fontSize: 20, color: '#9ca3af' },
  destructive: { color: '#dc2626' },
  footer: { alignItems: 'center', paddingVertical: 24 },
  footerText: { fontSize: 12, color: '#9ca3af', marginTop: 2 },
});