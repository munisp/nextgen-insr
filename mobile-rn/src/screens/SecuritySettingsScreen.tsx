import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


const API_BASE_URL = 'https://api.insureportal.io/v1';
const PRIMARY_COLOR = '#6C63FF';
const BACKGROUND_COLOR = '#1A1A2E';
const CARD_COLOR = '#FFFFFF';
const TEXT_COLOR = '#1A1A2E';

const SecuritySettingsScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(false);
  const [biometricEnabled, setBiometricEnabled] = useState(false);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState('15');
  const [showTimeoutModal, setShowTimeoutModal] = useState(false);

  useEffect(() => {
    fetchSecuritySettings();
  }, []);

  const fetchSecuritySettings = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/security/settings`);
      const data = await response.json();
      if (response.ok) {
        setBiometricEnabled(data.biometricEnabled);
        setTwoFactorEnabled(data.twoFactorEnabled);
        setSessionTimeout(data.sessionTimeout.toString());
      }
    } catch (error) {
      console.error('Error fetching security settings:', error);
    } finally {
      setLoading(false);
    }
  };

  const toggleBiometric = async (value: boolean) => {
    setBiometricEnabled(value);
    try {
      const response = await fetch(`${API_BASE_URL}/security/biometric`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: value }),
      });
      if (!response.ok) throw new Error('Failed to update biometric setting');
    } catch (error) {
      setBiometricEnabled(!value);
      Alert.alert('Error', 'Could not update biometric settings. Please try again.');
    }
  };

  const toggle2FA = async (value: boolean) => {
    setTwoFactorEnabled(value);
    try {
      const response = await fetch(`${API_BASE_URL}/security/2fa`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: value }),
      });
      if (!response.ok) throw new Error('Failed to update 2FA setting');
    } catch (error) {
      setTwoFactorEnabled(!value);
      Alert.alert('Error', 'Could not update 2FA settings. Please try again.');
    }
  };

  const updateSessionTimeout = async (timeout: string) => {
    setSessionTimeout(timeout);
    setShowTimeoutModal(false);
    try {
      const response = await fetch(`${API_BASE_URL}/security/session-timeout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeout: parseInt(timeout) }),
      });
      if (!response.ok) throw new Error('Failed to update session timeout');
    } catch (error) {
      Alert.alert('Error', 'Could not update session timeout. Please try again.');
    }
  };

  const handleChangePin = () => {
    Alert.alert(
      'Change PIN',
      'Are you sure you want to change your transaction PIN?',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Proceed', onPress: () => console.log('Navigate to Change PIN') },
      ]
    );
  };

  const SettingItem = ({ title, subtitle, value, onToggle, type = 'toggle', onPress }: any) => (
    <TouchableOpacity 
      style={styles.settingItem} 
      onPress={onPress} 
      disabled={type === 'toggle'}
      activeOpacity={0.7}
    >
      <View style={styles.settingTextContainer}>
        <Text style={styles.settingTitle}>{title}</Text>
        {subtitle && <Text style={styles.settingSubtitle}>{subtitle}</Text>}
      </View>
      {type === 'toggle' ? (
        <Switch
          trackColor={{ false: '#D1D1D1', true: PRIMARY_COLOR }}
          thumbColor="#FFFFFF"
          ios_backgroundColor="#D1D1D1"
          onValueChange={onToggle}
          value={value}
        />
      ) : (
        <Text style={styles.settingValue}>{value}</Text>
      )}
    </TouchableOpacity>
  );

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={PRIMARY_COLOR} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Security Settings</Text>
        <Text style={styles.headerSubtitle}>Manage your account security and authentication methods</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Authentication</Text>
        <View style={styles.card}>
          <SettingItem
            title="Change Transaction PIN"
            subtitle="Update your 4-digit security PIN"
            type="action"
            value="Change"
            onPress={handleChangePin}
          />
          <View style={styles.divider} />
          <SettingItem
            title="Biometric Login"
            subtitle="Use Fingerprint or Face ID to login"
            value={biometricEnabled}
            onToggle={toggleBiometric}
          />
          <View style={styles.divider} />
          <SettingItem
            title="Two-Factor Authentication (2FA)"
            subtitle="Add an extra layer of security"
            value={twoFactorEnabled}
            onToggle={toggle2FA}
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Session Management</Text>
        <View style={styles.card}>
          <SettingItem
            title="Session Timeout"
            subtitle="Automatically log out after inactivity"
            type="action"
            value={`${sessionTimeout} Minutes`}
            onPress={() => setShowTimeoutModal(true)}
          />
        </View>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoText}>
          For your security, we recommend enabling Biometric Login and Two-Factor Authentication. 
          Never share your PIN or OTP with anyone, including InsurePortal staff.
        </Text>
      </View>

      <Modal
        visible={showTimeoutModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowTimeoutModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Select Session Timeout</Text>
            {['5', '15', '30', '60'].map((time) => (
              <TouchableOpacity
                key={time}
                style={styles.modalOption}
                onPress={() => updateSessionTimeout(time)}
              >
                <Text style={[
                  styles.modalOptionText,
                  sessionTimeout === time && styles.modalOptionTextSelected
                ]}>
                  {time} Minutes
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={styles.modalCloseButton}
              onPress={() => setShowTimeoutModal(false)}
            >
              <Text style={styles.modalCloseButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    padding: 24,
    paddingTop: 40,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 22,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 12,
    marginLeft: 4,
  },
  card: {
    backgroundColor: CARD_COLOR,
    borderRadius: 16,
    overflow: 'hidden',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  settingTextContainer: {
    flex: 1,
    marginRight: 16,
  },
  settingTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: TEXT_COLOR,
    marginBottom: 4,
  },
  settingSubtitle: {
    fontSize: 13,
    color: '#666',
  },
  settingValue: {
    fontSize: 14,
    fontWeight: '600',
    color: PRIMARY_COLOR,
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginHorizontal: 16,
  },
  infoBox: {
    margin: 20,
    padding: 16,
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.2)',
  },
  infoText: {
    fontSize: 13,
    color: '#FFFFFF',
    lineHeight: 18,
    textAlign: 'center',
    opacity: 0.8,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: TEXT_COLOR,
    marginBottom: 20,
    textAlign: 'center',
  },
  modalOption: {
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  modalOptionText: {
    fontSize: 16,
    color: TEXT_COLOR,
    textAlign: 'center',
  },
  modalOptionTextSelected: {
    color: PRIMARY_COLOR,
    fontWeight: 'bold',
  },
  modalCloseButton: {
    marginTop: 20,
    paddingVertical: 16,
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
  },
  modalCloseButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#666',
    textAlign: 'center',
  },
});

export default SecuritySettingsScreen;
