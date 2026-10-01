import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  AccessibilityProps,
} from 'react-native';
import { StackScreenProps } from '@react-navigation/stack';
import PinView from 'react-native-pin-view';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';
import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
// 2026-10-01 (R1b): PIN must NEVER be stored plaintext in AsyncStorage.
// We persist only a salted SHA-256 verifier hash, and store it in
// expo-secure-store (Keychain/Keystore-backed), not AsyncStorage. Both
// dependencies were added to mobile-rn/package.json as part of this fix
// (the directory previously had no package.json at all).
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


// --- CONFIGURATION ---
const PIN_LENGTH = 4;
const API_ENDPOINT = 'https://api.insureportal.io/v1/user/set-pin';
const BIOMETRIC_KEY_ALIAS = 'userPinKey';

// --- TYPESCRIPT INTERFACES ---

/**
 * Define the structure for the navigation stack parameters.
 * Assuming a root stack with a 'Home' screen for navigation after setup.
 */
// 2026-10-01 (R1b): PaymentGateway route type removed — the route does not
// exist; it was only referenced by the deleted mock gateway launcher.
type RootStackParamList = {
  PinSetup: undefined;
  Home: undefined;
};

type PinSetupScreenProps = StackScreenProps<RootStackParamList, 'PinSetup'>;

/**
 * Interface for the API response when setting the PIN.
 */
interface PinSetupResponse {
  success: boolean;
  message: string;
  token?: string;
}

/**
 * Interface for the component's state.
 */
interface PinSetupState {
  pin: string;
  confirmPin: string;
  isConfirming: boolean;
  isLoading: boolean;
  error: string | null;
  biometricsAvailable: boolean;
  biometryType: BiometryTypes | null;
}

// --- UTILITY FUNCTIONS ---

/**
 * Simple PIN strength validation.
 * @param pin The PIN string to validate.
 * @returns A string indicating the strength or an error message.
 */
const validatePinStrength = (pin: string): string => {
  if (pin.length !== PIN_LENGTH) {
    return `PIN must be ${PIN_LENGTH} digits.`;
  }
  if (/(\d)\1\1\1/.test(pin)) {
    return 'Weak: Avoid repeating digits.';
  }
  if (/(0123|1234|2345|3456|4567|5678|6789|9876|8765|7654|6543|5432|4321|3210)/.test(pin)) {
    return 'Weak: Avoid sequential digits.';
  }
  return 'Strong';
};

/**
 * 2026-10-01 (R1b): compute a salted SHA-256 verifier hash of the PIN.
 * The plaintext PIN is NEVER persisted — only this verifier is stored, and it
 * lives in expo-secure-store (hardware-backed Keychain/Keystore), so a lost
 * device or AsyncStorage dump does not expose the PIN. PIN verification
 * happens server-side; the local verifier only supports offline re-auth UX.
 */
const PIN_VERIFIER_KEY = 'pin_verifier_hash';
// Static app-level salt; per-user uniqueness comes from the server-side PIN
// record. (A 4-digit PIN space is brute-forceable regardless — the verifier
// exists only so the plaintext PIN is never at rest.)
const PIN_VERIFIER_SALT = 'insureportal.pin-verifier.v1';

const hashPin = async (pin: string): Promise<string> => {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${PIN_VERIFIER_SALT}:${pin}`,
  );
};

const persistPinVerifier = async (pin: string): Promise<void> => {
  const verifier = await hashPin(pin);
  await SecureStore.setItemAsync(PIN_VERIFIER_KEY, verifier);
  // Defence-in-depth: purge any legacy plaintext PIN written by older builds.
  await AsyncStorage.removeItem('@user_pin');
  await AsyncStorage.removeItem('@user_pin_pending');
};

/**
 * Set the PIN on the server (real endpoint).
 * 2026-10-01 (R1b): SECURITY FIX — previously stored the plaintext PIN in
 * AsyncStorage ('@user_pin') on success, and on network failure stored the
 * plaintext PIN in '@user_pin_pending' while telling the user it was "saved
 * for later sync" — a fabricated success and a plaintext credential at rest.
 * Now: plaintext is never persisted; only the secure-store verifier hash is
 * kept, and only after the SERVER confirms. Network failure = fail-closed.
 */
const setPinOnServer = async (pin: string): Promise<PinSetupResponse> => {
  try {
    const response = await axios.post<PinSetupResponse>(API_ENDPOINT, { pin });

    if (response.data.success) {
      await persistPinVerifier(pin); // verifier hash only — never the PIN
      return { success: true, message: 'PIN set successfully.' };
    }
    return { success: false, message: response.data.message || 'Failed to set PIN.' };
  } catch (error) {
    console.error('API Error:', error);
    // Fail-closed: do NOT queue the PIN locally, do NOT claim offline success.
    return { success: false, message: 'Network error. Your PIN was not set. Please try again when you are back online.' };
  }
};

// 2026-10-01 (R1b): removed `initiatePayment` and the "Test Payment Gateways
// (Mock)" buttons — they navigated to a nonexistent 'PaymentGateway' route
// with a hardcoded ₦1000 demo amount. A mock payment launcher has no place on
// a production PIN-setup screen.

// --- BIOMETRICS SETUP ---
const rnBiometrics = new ReactNativeBiometrics({ allowDeviceCredentials: true });

const checkBiometrics = async (
  setState: React.Dispatch<React.SetStateAction<PinSetupState>>,
) => {
  try {
    const { available, biometryType } = await rnBiometrics.isSensorAvailable();
    setState(prev => ({
      ...prev,
      biometricsAvailable: available,
      biometryType: biometryType,
    }));
  } catch (error) {
    console.error('Biometrics check failed:', error);
    setState(prev => ({ ...prev, biometricsAvailable: false }));
  }
};

const createBiometricKey = async () => {
  try {
    const { publicKey } = await rnBiometrics.createKeys({
      promptMessage: 'Enable Biometrics for quick access',
      keyAlias: BIOMETRIC_KEY_ALIAS,
    });
    Alert.alert('Success', `Biometric key created with public key: ${publicKey}`);
  } catch (error) {
    console.error('Biometric key creation failed:', error);
    Alert.alert('Error', 'Failed to set up biometrics.');
  }
};

// --- MAIN COMPONENT ---

const PinSetupScreen: React.FC<PinSetupScreenProps> = ({ navigation }) => {
  const [state, setState] = useState<PinSetupState>({
    pin: '',
    confirmPin: '',
    isConfirming: false,
    isLoading: false,
    error: null,
    biometricsAvailable: false,
    biometryType: null,
  });

  const pinStrength = validatePinStrength(state.pin);
  const isPinValid = pinStrength === 'Strong';
  const isPinReady = state.pin.length === PIN_LENGTH;
  const isConfirmReady = state.confirmPin.length === PIN_LENGTH;

  // Check for biometrics on mount
  useEffect(() => {
    checkBiometrics(setState);
  }, []);

  // Handle PIN input change
  const onPinChange = useCallback(
    (newPin: string) => {
      if (!state.isConfirming) {
        setState(prev => ({ ...prev, pin: newPin, error: null }));
      } else {
        setState(prev => ({ ...prev, confirmPin: newPin, error: null }));
      }
    },
    [state.isConfirming],
  );

  // Handle PIN submission
  const handlePinSubmit = useCallback(async () => {
    if (!state.isConfirming) {
      // First PIN entry
      if (!isPinValid) {
        setState(prev => ({ ...prev, error: pinStrength }));
        return;
      }
      setState(prev => ({ ...prev, isConfirming: true, confirmPin: '' }));
    } else {
      // Confirmation PIN entry
      if (state.pin !== state.confirmPin) {
        setState(prev => ({
          ...prev,
          error: 'PINs do not match. Please try again.',
          confirmPin: '',
        }));
        return;
      }

      // Final submission
      setState(prev => ({ ...prev, isLoading: true, error: null }));
      const result = await setPinOnServer(state.pin);
      setState(prev => ({ ...prev, isLoading: false }));

      if (result.success) {
        Alert.alert('Success', result.message, [
          {
            text: 'Enable Biometrics',
            onPress: () => {
              if (state.biometricsAvailable) {
                createBiometricKey();
              } else {
                Alert.alert('Info', 'Biometrics not available on this device.');
              }
              navigation.navigate('Home');
            },
          },
          { text: 'Skip', onPress: () => navigation.navigate('Home') },
        ]);
      } else {
        setState(prev => ({ ...prev, error: result.message }));
      }
    }
  }, [
    state.isConfirming,
    state.pin,
    state.confirmPin,
    isPinValid,
    pinStrength,
    state.biometricsAvailable,
    navigation,
  ]);

  // --- RENDER HELPERS ---

  const renderHeader = () => {
    const title = state.isConfirming ? 'Confirm Your PIN' : 'Create a New PIN';
    const subtitle = state.isConfirming
      ? 'Re-enter your 4-digit PIN to confirm.'
      : `Your PIN must be ${PIN_LENGTH} digits.`;

    return (
      <View style={styles.headerContainer}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
      </View>
    );
  };

  const renderPinStrength = () => {
    if (state.isConfirming || !isPinReady) {
      return null;
    }

    const color =
      pinStrength === 'Strong'
        ? 'green'
        : pinStrength.includes('Weak')
        ? 'orange'
        : 'red';

    return (
      <Text style={[styles.strengthText, { color }]} accessibilityLiveRegion="polite">
        Strength: {pinStrength}
      </Text>
    );
  };

  const renderError = () => {
    if (!state.error) {
      return null;
    }
    return (
      <Text style={styles.errorText} accessibilityLiveRegion="assertive">
        {state.error}
      </Text>
    );
  };

  // 2026-10-01 (R1b): renderPaymentGatewayButtons removed (mock gateway
  // launcher targeting a nonexistent route).

  // --- MAIN RENDER ---

  return (
    <View style={styles.container}>
      {renderHeader()}

      <View style={styles.pinContainer}>
        <PinView
          pinLength={PIN_LENGTH}
          onValueChange={onPinChange}
          onComplete={handlePinSubmit}
          inputTextStyle={styles.pinInputText}
          inputViewStyle={styles.pinInputView}
          buttonViewStyle={styles.pinButtonView}
          buttonTextStyle={styles.pinButtonText}
          keyboardViewStyle={styles.pinKeyboardView}
          keyboardContainerStyle={styles.pinKeyboardContainer}
          // The value prop controls the input field
          value={state.isConfirming ? state.confirmPin : state.pin}
          // Custom render for the display dots
          renderInput={() => (
            <View style={styles.inputDisplayContainer}>
              {Array(PIN_LENGTH)
                .fill(0)
                .map((_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.inputDot,
                      {
                        backgroundColor:
                          (state.isConfirming ? state.confirmPin : state.pin).length > index
                            ? '#007AFF'
                            : '#E0E0E0',
                      },
                    ]}
                    accessibilityLabel={`PIN digit ${index + 1}`}
                  />
                ))}
            </View>
          )}
        />
      </View>

      {renderPinStrength()}
      {renderError()}

      {state.isLoading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" accessibilityLabel="Loading" />
          <Text style={styles.loadingText}>
            {state.isConfirming ? 'Confirming PIN...' : 'Setting up PIN...'}
          </Text>
        </View>
      )}

      {/* Biometrics Info */}
      {state.biometricsAvailable && (
        <Text style={styles.biometricsText}>
          Biometrics available: {state.biometryType}
        </Text>
      )}

      {/* 2026-10-01 (R1b): mock payment gateway buttons removed. */}
    </View>
  );
};

// --- STYLESHEET ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    padding: 20,
    alignItems: 'center',
  },
  headerContainer: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
  },
  pinContainer: {
    width: '100%',
    maxWidth: 300,
    marginBottom: 20,
  },
  inputDisplayContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '80%',
    alignSelf: 'center',
    marginBottom: 30,
  },
  inputDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#E0E0E0',
  },
  strengthText: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  errorText: {
    fontSize: 14,
    color: 'red',
    textAlign: 'center',
    marginBottom: 10,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
  },
  loadingText: {
    marginLeft: 10,
    fontSize: 16,
    color: '#333',
  },
  biometricsText: {
    marginTop: 20,
    fontSize: 14,
    color: '#007AFF',
  },
  // react-native-pin-view custom styles
  pinInputText: {
    color: 'transparent', // Hide the actual input text
  },
  pinInputView: {
    // Custom input view style (not used due to custom renderInput)
  },
  pinButtonView: {
    backgroundColor: '#FFF',
    borderColor: '#DDD',
    borderWidth: 1,
    borderRadius: 50,
    margin: 8,
  },
  pinButtonText: {
    color: '#333',
    fontSize: 24,
  },
  pinKeyboardView: {
    // Style for the keyboard view
  },
  pinKeyboardContainer: {
    // Style for the keyboard container
  },
  // Payment Gateway Styles
  paymentContainer: {
    marginTop: 40,
    width: '100%',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EEE',
    paddingTop: 20,
  },
  paymentHeader: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333',
  },
  paymentButtons: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 25,
    borderRadius: 8,
    minWidth: 120,
    alignItems: 'center',
  },
  paystackButton: {
    backgroundColor: '#00C3F7', // Paystack blue
  },
  flutterwaveButton: {
    backgroundColor: '#FFB300', // Flutterwave yellow/orange
  },
  buttonText: {
    color: '#FFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default PinSetupScreen;
