import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, Alert } from 'react-native';
import { useAuth } from '../store/authStore';

export function SettingsScreen({ navigation }: { navigation: any }) {
  const { user, logout } = useAuth();
  const [pushNotifications, setPushNotifications] = React.useState(true);
  const [biometricLogin, setBiometricLogin] = React.useState(false);
  const [darkMode, setDarkMode] = React.useState(false);
  const [offlineMode, setOfflineMode] = React.useState(true);

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  const settingsSections = [
    {
      title: 'Security',
      items: [
        { label: 'Biometric Login', value: biometricLogin, onToggle: setBiometricLogin, description: 'Use fingerprint or face to login' },
        { label: 'Change Password', type: 'link', onPress: () => navigation.navigate('ChangePassword') },
        { label: 'Two-Factor Authentication', type: 'link', onPress: () => Alert.alert('2FA', 'Configure 2FA in your profile settings') },
      ],
    },
    {
      title: 'Notifications',
      items: [
        { label: 'Push Notifications', value: pushNotifications, onToggle: setPushNotifications, description: 'Receive claim updates, renewals, payments' },
        { label: 'Email Notifications', type: 'link', onPress: () => Alert.alert('Email', 'Configure email preferences in your profile') },
      ],
    },
    {
      title: 'App Preferences',
      items: [
        { label: 'Dark Mode', value: darkMode, onToggle: setDarkMode },
        { label: 'Offline Mode', value: offlineMode, onToggle: setOfflineMode, description: 'Cache data for offline access' },
        { label: 'Language', type: 'link', onPress: () => Alert.alert('Language', 'Available: English, Hausa, Yoruba, Igbo') },
      ],
    },
    {
      title: 'Support',
      items: [
        { label: 'Help Center', type: 'link', onPress: () => {} },
        { label: 'Privacy Policy', type: 'link', onPress: () => {} },
        { label: 'Terms of Service', type: 'link', onPress: () => {} },
        { label: 'App Version', type: 'info', value: '2.5.0' },
      ],
    },
  ];

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Settings</Text>

      {settingsSections.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{section.title}</Text>
          {section.items.map((item: any) => (
            <View key={item.label} style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingLabel}>{item.label}</Text>
                {item.description && <Text style={styles.settingDesc}>{item.description}</Text>}
              </View>
              {item.onToggle ? (
                <Switch value={item.value} onValueChange={item.onToggle} trackColor={{ true: '#2563eb' }} />
              ) : item.type === 'link' ? (
                <TouchableOpacity onPress={item.onPress} accessibilityLabel={item.label}>
                  <Text style={styles.arrow}>›</Text>
                </TouchableOpacity>
              ) : item.type === 'info' ? (
                <Text style={styles.infoValue}>{item.value}</Text>
              ) : null}
            </View>
          ))}
        </View>
      ))}

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 20 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, paddingHorizontal: 4 },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', padding: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  settingInfo: { flex: 1 },
  settingLabel: { fontSize: 15, color: '#1e293b', fontWeight: '500' },
  settingDesc: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  arrow: { fontSize: 24, color: '#94a3b8' },
  infoValue: { fontSize: 14, color: '#64748b' },
  logoutButton: { backgroundColor: '#fee2e2', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginVertical: 24 },
  logoutText: { color: '#ef4444', fontSize: 16, fontWeight: '600' },
});
