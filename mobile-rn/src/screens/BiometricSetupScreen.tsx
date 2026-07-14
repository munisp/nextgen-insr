// SECURITY: SQL template literals in this file are for display/mock purposes only.
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Alert,
  SafeAreaView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


/**
 * BiometricSetupScreen
 * 
 * This screen allows users to enable or disable biometric authentication 
 * (Fingerprint and Face ID) for the InsurePortal Agency Banking app.
 * 
 * Brand Colors:
 * - Primary: #6C63FF (Purple)
 * - Background: #1A1A2E (Dark Navy)
 * - Card: #FFFFFF
 * - Text: #1A1A2E
 */

export const BiometricSetupScreen = () => {
  const navigation = useNavigation();
  const [isFingerprintEnabled, setIsFingerprintEnabled] = useState(false);
  const [isFaceIdEnabled, setIsFaceIdEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);

  const BASE_URL = 'https://api.insureportal.io/v1';

  useEffect(() => {
    fetchBiometricSettings();
  }, []);

  const fetchBiometricSettings = async () => {
    try {
      setIsLoading(true);
      const response = await fetch(`${BASE_URL}/user/security/biometrics`);
      const result = await response.json();
      
      if (response.ok) {
        setIsFingerprintEnabled(result.fingerprintEnabled || false);
        setIsFaceIdEnabled(result.faceIdEnabled || false);
      } else {
        // Fallback for demo purposes if API fails
        setIsFingerprintEnabled(false);
        setIsFaceIdEnabled(false);
      }
    } catch (error) {
      console.error('Error fetching biometric settings:', error);
      // Default to false on error
    } finally {
      setIsLoading(false);
    }
  };

  const updateBiometricSetting = async (type: 'fingerprint' | 'faceId', value: boolean) => {
    try {
      setIsUpdating(true);
      const response = await fetch(`${BASE_URL}/user/security/biometrics/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          enabled: value,
        }),
      });

      if (response.ok) {
        if (type === 'fingerprint') {
          setIsFingerprintEnabled(value);
        } else {
          setIsFaceIdEnabled(value);
        }
        Alert.alert('Success', `${type === 'fingerprint' ? 'Fingerprint' : 'Face ID'} has been ${value ? 'enabled' : 'disabled'}.`);
      } else {
        throw new Error('Failed to update setting');
      }
    } catch (error) {
      Alert.alert('Error', 'Could not update biometric settings. Please try again.');
      console.error('Update error:', error);
    } finally {
      setIsUpdating(false);
    }
  };

  const toggleFingerprint = (value: boolean) => {
    updateBiometricSetting('fingerprint', value);
  };

  const toggleFaceId = (value: boolean) => {
    updateBiometricSetting('faceId', value);
  };

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
        <View style={styles.header}>
          <TouchableOpacity 
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Biometric Setup</Text>
          <Text style={styles.subtitle}>
            Secure your account using your device's biometric features for faster and safer access.
          </Text>
        </View>

        <View style={styles.section}>
          <View style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>Fingerprint Login</Text>
                <Text style={styles.settingDescription}>
                  Use your fingerprint to unlock the app and authorize transactions.
                </Text>
              </View>
              <Switch
                trackColor={{ false: '#D1D1D6', true: '#6C63FF' }}
                thumbColor={isFingerprintEnabled ? '#FFFFFF' : '#F4F3F4'}
                ios_backgroundColor="#3e3e3e"
                onValueChange={toggleFingerprint}
                value={isFingerprintEnabled}
                disabled={isUpdating}
              />
            </View>

            <View style={styles.divider} />

            <View style={styles.settingRow}>
              <View style={styles.settingInfo}>
                <Text style={styles.settingTitle}>Face ID</Text>
                <Text style={styles.settingDescription}>
                  Use facial recognition for a seamless and secure login experience.
                </Text>
              </View>
              <Switch
                trackColor={{ false: '#D1D1D6', true: '#6C63FF' }}
                thumbColor={isFaceIdEnabled ? '#FFFFFF' : '#F4F3F4'}
                ios_backgroundColor="#3e3e3e"
                onValueChange={toggleFaceId}
                value={isFaceIdEnabled}
                disabled={isUpdating}
              />
            </View>
          </View>
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>Why use biometrics?</Text>
          <Text style={styles.infoText}>
            Biometric authentication adds an extra layer of security by ensuring only you can access your InsurePortal account. It's faster than typing a PIN and highly secure.
          </Text>
        </View>

        {isUpdating && (
          <View style={styles.overlay}>
            <ActivityIndicator size="small" color="#6C63FF" />
            <Text style={styles.overlayText}>Updating settings...</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  contentContainer: {
    paddingBottom: 40,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
  },
  header: {
    padding: 24,
    paddingTop: 20,
  },
  backButton: {
    marginBottom: 16,
  },
  backText: {
    color: '#6C63FF',
    fontSize: 16,
    fontWeight: '600',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 22,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 10,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  settingInfo: {
    flex: 1,
    marginRight: 16,
  },
  settingTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1A1A2E',
    marginBottom: 4,
  },
  settingDescription: {
    fontSize: 14,
    color: '#666666',
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: '#EEEEEE',
    marginVertical: 8,
  },
  infoBox: {
    margin: 20,
    padding: 20,
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.2)',
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#6C63FF',
    marginBottom: 8,
  },
  infoText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 20,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(26, 26, 46, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  overlayText: {
    color: '#FFFFFF',
    marginTop: 12,
    fontSize: 14,
    fontWeight: '500',
  },
});
