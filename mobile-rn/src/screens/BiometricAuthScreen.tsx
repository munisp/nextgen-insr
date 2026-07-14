import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  AccessibilityProps,
  TextInput, // Added TextInput
} from 'react-native';
import { useNavigation, NativeStackScreenProps } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import { APIClient } from '../api/APIClient';

// --- Type Definitions ---

// Define the shape of the navigation stack parameters
type RootStackParamList = {
  BiometricAuth: undefined;
  Home: undefined; // Placeholder for the next screen after successful auth
  Login: undefined; // Placeholder for the fallback screen
};

type BiometricAuthScreenProps = NativeStackScreenProps<RootStackParamList, 'BiometricAuth'>;

// Define the shape of the API response for authentication
interface AuthResponse {
  success: boolean;
  token: string;
  message: string;
}

// Define the shape of the component's state
interface BiometricState {
  isSupported: boolean;
  biometryType: BiometryTypes | null;
  isLoading: boolean;
  error: string | null;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const AUTH_TOKEN_KEY = '@insureportal:authToken';
const REFRESH_TOKEN_KEY = '@insureportal:refreshToken';
const USER_ID_KEY = '@insureportal:userId';
const apiClient = new APIClient();

// ── Real API helpers ──────────────────────────────────────────────────────────

/**
 * Verify biometric signature against the InsurePortal backend.
 * The server checks the signature using the public key registered during setup.
 */
const verifyBiometricWithServer = async (
  signature: string,
  payload: string
): Promise<AuthResponse> => {
  try {
    const response = await apiClient.post('/auth/biometric/verify', {
      signature,
      payload,
      platform: Platform.OS,
      timestamp: new Date().toISOString(),
    });
    return response.data as AuthResponse;
  } catch (error: any) {
    const message = error?.response?.data?.message ?? error?.message ?? 'Biometric verification failed';
    return { success: false, token: '', message };
  }
};

/**
 * Register biometric public key with the InsurePortal backend.
 * Called once during biometric setup / first login.
 */
const registerBiometricKey = async (publicKey: string): Promise<boolean> => {
  try {
    const response = await apiClient.post('/auth/biometric/register', {
      publicKey,
      platform: Platform.OS,
      deviceInfo: { os: Platform.OS, version: Platform.Version },
    });
    return response.data?.success === true;
  } catch {
    return false;
  }
};

// --- Component ---

const BiometricAuthScreen: React.FC<BiometricAuthScreenProps> = () => {
  const navigation = useNavigation<BiometricAuthScreenProps['navigation']>();
  const rnBiometrics = new ReactNativeBiometrics();

  const [state, setState] = useState<BiometricState>({
    isSupported: false,
    biometryType: null,
    isLoading: false,
    error: null,
  });

  const { isSupported, biometryType, isLoading, error } = state;

  // 1. Check Biometric Support on Mount
  useEffect(() => {
    const checkBiometrics = async () => {
      try {
        const { available, biometryType } = await rnBiometrics.isSensorAvailable();
        setState(s => ({
          ...s,
          isSupported: available,
          biometryType: available ? biometryType : null,
          error: available ? null : 'Biometric authentication is not available on this device.',
        }));
        if (available) setTimeout(() => handleBiometricAuth(), 500);
      } catch {
        setState(s => ({
          ...s,
          isSupported: false,
          biometryType: null,
          error: 'An error occurred while checking biometric support.',
        }));
      }
    };
    checkBiometrics();
  }, []);

  // 2. Biometric Authentication Logic (real server verification)
  const handleBiometricAuth = useCallback(async () => {
    if (!isSupported || isLoading) return;
    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      const epochSeconds = String(Math.round(Date.now() / 1000));
      const userId = (await AsyncStorage.getItem(USER_ID_KEY)) ?? 'unknown';
      const payload = `${epochSeconds}:${userId}:insureportal-biometric`;

      // Ensure biometric key pair exists (creates on first use)
      const { keysExist } = await rnBiometrics.biometricKeysExist();
      if (!keysExist) {
        const { publicKey } = await rnBiometrics.createKeys();
        const registered = await registerBiometricKey(publicKey);
        if (!registered) throw new Error('Failed to register biometric key with server.');
      }

      const { success, signature } = await rnBiometrics.createSignature({
        promptMessage: 'Confirm your identity to log in',
        payload,
        cancelButtonText: 'Use Password',
      });

      if (!success || !signature) {
        setState(s => ({ ...s, isLoading: false }));
        return;
      }

      const authResult = await verifyBiometricWithServer(signature, payload);

      if (authResult.success) {
        await AsyncStorage.setItem(AUTH_TOKEN_KEY, authResult.token);
        if (authResult.refreshToken) await AsyncStorage.setItem(REFRESH_TOKEN_KEY, authResult.refreshToken);
        if (authResult.userId) await AsyncStorage.setItem(USER_ID_KEY, authResult.userId);
        navigation.replace('Home');
      } else {
        throw new Error(authResult.message ?? 'Server verification failed.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Authentication failed.';
      setState(s => ({ ...s, error: msg }));
    } finally {
      setState(s => ({ ...s, isLoading: false }));
    }
  }, [isSupported, isLoading, navigation, rnBiometrics]);

  // 3. Fallback to Login Screen
  const handleFallback = useCallback(() => {
    navigation.replace('Login');
  }, [navigation]);

  // --- Accessibility Props and Content ---
  const biometryName = biometryType === BiometryTypes.FaceID ? 'Face ID' : 'Touch ID/Fingerprint';
  const authButtonLabel = `Authenticate with ${biometryName}`;

  const accessibilityProps = {
    accessible: true,
    accessibilityRole: 'button' as const,
    accessibilityLabel: authButtonLabel,
    accessibilityHint: 'Performs biometric authentication to log into the application.',
  };

  // --- Render Logic ---
  return (
    <View style={styles.container}>
      <Text style={styles.header}>Biometric Authentication</Text>

      {isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Authenticating...</Text>
        </View>
      )}

      {error && <Text style={styles.errorText}>{error}</Text>}

      {isSupported && !isLoading && (
        <TouchableOpacity
          style={styles.authButton}
          onPress={handleBiometricAuth}
          disabled={isLoading}
          {...accessibilityProps}
        >
          <Text style={styles.buttonText}>{authButtonLabel}</Text>
        </TouchableOpacity>
      )}

      {!isSupported && !isLoading && (
        <Text style={styles.infoText}>
          Biometrics not available. Please use the standard login method.
        </Text>
      )}

      <TouchableOpacity
        style={styles.fallbackButton}
        onPress={handleFallback}
        disabled={isLoading}
        accessibilityRole="button"
        accessibilityLabel="Fallback to password login"
      >
        <Text style={styles.fallbackButtonText}>Use Password Login</Text>
      </TouchableOpacity>

      {/* Payment Gateway Integration Example */}
      <View style={styles.paymentSection}>
        <Text style={styles.subheader}>Payment Gateway Demo</Text>
        <Text style={styles.label}>Enter Amount (₦):</Text>
        {/* Using TextInput for proper form input and validation */}
        <TextInput
          style={styles.inputPlaceholder}
          onChangeText={setPaymentAmount}
          value={paymentAmount}
          keyboardType="numeric"
          placeholder="e.g., 1000"
          accessibilityLabel="Payment amount input"
        />
        {paymentError && <Text style={styles.paymentErrorText}>{paymentError}</Text>}

        <View style={styles.paymentButtonsContainer}>
          <TouchableOpacity
            style={[styles.paymentButton, { backgroundColor: '#00C389' }]} // Paystack Green
            onPress={() => validateAndPay('paystack')}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Pay with Paystack</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.paymentButton, { backgroundColor: '#FF5733' }]} // Flutterwave Orange
            onPress={() => validateAndPay('flutterwave')}
            disabled={isLoading}
          >
            <Text style={styles.buttonText}>Pay with Flutterwave</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Documentation Placeholder */}
      <View style={styles.documentation}>
        <Text style={styles.docHeader}>Documentation</Text>
        <Text style={styles.docText}>
          This screen handles biometric authentication using react-native-biometrics.
          It integrates with a mock API via axios, uses AsyncStorage for offline token storage,
          and includes placeholders for Paystack and Flutterwave payment integrations.
          State is managed via React hooks, and navigation uses React Navigation.
        </Text>
      </View>
    </View>
  );
};

// --- Styling ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 30,
    textAlign: 'center',
    color: '#333',
  },
  subheader: {
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
    marginBottom: 10,
    color: '#555',
  },
  authButton: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 15,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  fallbackButton: {
    padding: 10,
    alignItems: 'center',
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#007AFF',
    borderRadius: 8,
  },
  fallbackButtonText: {
    color: '#007AFF',
    fontSize: 14,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    marginBottom: 15,
  },
  loadingText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#555',
  },
  errorText: {
    color: 'red',
    textAlign: 'center',
    marginBottom: 15,
    fontSize: 14,
  },
  infoText: {
    textAlign: 'center',
    marginBottom: 15,
    fontSize: 16,
    color: '#777',
  },
  paymentSection: {
    marginTop: 30,
    paddingTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
  },
  label: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
  inputPlaceholder: {
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    borderRadius: 4,
    marginBottom: 15,
    backgroundColor: '#fff',
    color: '#000',
  },
  paymentErrorText: {
    color: 'red',
    marginBottom: 10,
    fontSize: 12,
  },
  paymentButtonsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  paymentButton: {
    flex: 1,
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  documentation: {
    marginTop: 40,
    padding: 15,
    backgroundColor: '#eee',
    borderRadius: 8,
  },
  docHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  docText: {
    fontSize: 12,
    color: '#555',
    lineHeight: 18,
  },
});

export default BiometricAuthScreen;
