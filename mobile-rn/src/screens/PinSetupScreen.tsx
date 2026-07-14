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
type RootStackParamList = {
  PinSetup: undefined;
  Home: undefined;
  PaymentGateway: { gateway: 'Paystack' | 'Flutterwave'; amount: number };
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
 * Mock function to handle API integration for setting the PIN.
 * @param pin The PIN to send to the server.
 */
const setPinOnServer = async (pin: string): Promise<PinSetupResponse> => {
  try {
    // Simulate API call with axios
    const response = await axios.post<PinSetupResponse>(API_ENDPOINT, { pin });

    if (response.data.success) {
      // On success, save the PIN locally for offline use (encrypted in a real app)
      await AsyncStorage.setItem('@user_pin', pin);
      return { success: true, message: 'PIN set successfully.' };
    } else {
      return { success: false, message: response.data.message || 'Failed to set PIN.' };
    }
  } catch (error) {
    console.error('API Error:', error);
    // Fallback to offline storage if API fails (for offline mode support)
    await AsyncStorage.setItem('@user_pin_pending', pin);
    return { success: false, message: 'Network error. PIN saved for later sync (Offline Mode).' };
  }
};

/**
 * Mock function to initiate a payment gateway transaction.
 * @param gateway The payment gateway to use.
 */
const initiatePayment = (
  navigation: PinSetupScreenProps['navigation'],
  gateway: 'Paystack' | 'Flutterwave',
) => {
  // In a real app, this would navigate to a dedicated payment screen
  // or open a WebView for the payment gateway.
  navigation.navigate('PaymentGateway', { gateway, amount: 1000 });
};

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

  const renderPaymentGatewayButtons = () => (
    <View style={styles.paymentContainer}>
      <Text style={styles.paymentHeader}>Test Payment Gateways (Mock)</Text>
      <View style={styles.paymentButtons}>
        <TouchableOpacity
          style={[styles.button, styles.paystackButton]}
          onPress={() => initiatePayment(navigation, 'Paystack')}
          accessibilityLabel="Test Paystack Payment"
          accessibilityRole="button">
          <Text style={styles.buttonText}>Paystack</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.button, styles.flutterwaveButton]}
          onPress={() => initiatePayment(navigation, 'Flutterwave')}
          accessibilityLabel="Test Flutterwave Payment"
          accessibilityRole="button">
          <Text style={styles.buttonText}>Flutterwave</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

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

      {renderPaymentGatewayButtons()}
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
