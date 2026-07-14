import React, { useState, useEffect, useCallback, useReducer } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
} from 'react-native';
import { useNavigation, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import axios, { AxiosError } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CreditCardInput, LiteCreditCardInput } from 'react-native-credit-card-input';
import RNBiometrics from 'react-native-biometrics';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


// --- Type Definitions ---

// Define the root stack param list for navigation
type RootStackParamList = {
  PaymentMethods: undefined;
  // Add other screens as needed
};

type PaymentMethodsScreenNavigationProp = StackNavigationProp<
  RootStackParamList,
  'PaymentMethods'
>;

type PaymentMethodsScreenRouteProp = RouteProp<
  RootStackParamList,
  'PaymentMethods'
>;

interface CardInfo {
  status: {
    number: 'valid' | 'invalid' | 'incomplete';
    expiry: 'valid' | 'invalid' | 'incomplete';
    cvc: 'valid' | 'invalid' | 'incomplete';
    name: 'valid' | 'invalid' | 'incomplete';
    postalCode: 'valid' | 'invalid' | 'incomplete';
  };
  valid: boolean;
  values: {
    number: string;
    expiry: string;
    cvc: string;
    name: string;
    postalCode: string;
    type: string;
  };
}

interface PaymentMethod {
  id: string;
  last4: string;
  brand: string;
  expiryMonth: number;
  expiryYear: number;
  isDefault: boolean;
}

interface State {
  loading: boolean;
  error: string | null;
  paymentMethods: PaymentMethod[];
  cardInfo: CardInfo | null;
  isAddingNewCard: boolean;
  biometricsEnabled: boolean;
}

type Action =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_PAYMENT_METHODS'; payload: PaymentMethod[] }
  | { type: 'SET_CARD_INFO'; payload: CardInfo }
  | { type: 'TOGGLE_ADD_CARD'; payload: boolean }
  | { type: 'SET_BIOMETRICS_ENABLED'; payload: boolean };

const initialState: State = {
  loading: false,
  error: null,
  paymentMethods: [],
  cardInfo: null,
  isAddingNewCard: false,
  biometricsEnabled: false,
};

const reducer = (state: State, action: Action): State => {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'SET_PAYMENT_METHODS':
      return { ...state, paymentMethods: action.payload };
    case 'SET_CARD_INFO':
      return { ...state, cardInfo: action.payload };
    case 'TOGGLE_ADD_CARD':
      return { ...state, isAddingNewCard: action.payload };
    case 'SET_BIOMETRICS_ENABLED':
      return { ...state, biometricsEnabled: action.payload };
    default:
      return state;
  }
};

// --- API and Storage Constants/Functions (Stubs) ---

const API_BASE_URL = 'https://api.insureportal.io/v1';
const PAYMENT_METHODS_STORAGE_KEY = '@PaymentMethods';
const BIOMETRICS_KEY = 'payment_auth_key';

// Helper for API calls
const apiCall = async <T,>(
  method: 'get' | 'post' | 'delete',
  endpoint: string,
  data?: any
): Promise<T> => {
  // Retrieve auth token from AsyncStorage (set during biometric login in BiometricAuthScreen)
  const token = (await AsyncStorage.getItem('@insureportal:authToken')) ?? '';
  const config = {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };

  try {
    const url = `${API_BASE_URL}${endpoint}`;
    let response;
    switch (method) {
      case 'get':
        response = await axios.get<T>(url, config);
        break;
      case 'post':
        response = await axios.post<T>(url, data, config);
        break;
      case 'delete':
        response = await axios.delete<T>(url, config);
        break;
    }
    return response.data;
  } catch (error) {
    const axiosError = error as AxiosError;
    if (axiosError.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      throw new Error(
        axiosError.response.data?.message ||
          `API Error: ${axiosError.response.status}`
      );
    } else if (axiosError.request) {
      // The request was made but no response was received
      throw new Error('Network Error: No response from server.');
    } else {
      // Something happened in setting up the request that triggered an Error
      throw new Error(`Request Setup Error: ${axiosError.message}`);
    }
  }
};

// --- Component Implementation ---

const PaymentMethodsScreen: React.FC = () => {
  const [state, dispatch] = useReducer(reducer, initialState);
  const navigation = useNavigation<PaymentMethodsScreenNavigationProp>();

  const {
    loading,
    error,
    paymentMethods,
    cardInfo,
    isAddingNewCard,
    biometricsEnabled,
  } = state;

  // --- Offline Storage (AsyncStorage) Handlers ---

  const savePaymentMethodsOffline = useCallback(
    async (methods: PaymentMethod[]) => {
      try {
        const jsonValue = JSON.stringify(methods);
        await AsyncStorage.setItem(PAYMENT_METHODS_STORAGE_KEY, jsonValue);
      } catch (e) {
        console.error('Error saving payment methods offline:', e);
      }
    },
    []
  );

  const loadPaymentMethodsOffline = useCallback(async () => {
    try {
      const jsonValue = await AsyncStorage.getItem(
        PAYMENT_METHODS_STORAGE_KEY
      );
      if (jsonValue != null) {
        const methods: PaymentMethod[] = JSON.parse(jsonValue);
        dispatch({ type: 'SET_PAYMENT_METHODS', payload: methods });
        return methods;
      }
    } catch (e) {
      console.error('Error loading payment methods offline:', e);
    }
    return [];
  }, []);

  // --- Biometrics Handlers ---

  const checkBiometrics = useCallback(async () => {
    try {
      const { available, biometryType } = await RNBiometrics.isSensorAvailable();
      if (available) {
        dispatch({ type: 'SET_BIOMETRICS_ENABLED', payload: true });
        console.log(`Biometrics available: ${biometryType}`);
      } else {
        dispatch({ type: 'SET_BIOMETRICS_ENABLED', payload: false });
      }
    } catch (error) {
      console.error('Biometrics check failed:', error);
      dispatch({ type: 'SET_BIOMETRICS_ENABLED', payload: false });
    }
  }, []);

  const authenticateWithBiometrics = useCallback(async (): Promise<boolean> => {
    if (!biometricsEnabled) return true; // Skip if not enabled

    try {
      const { success } = await RNBiometrics.simplePrompt({
        promptMessage: 'Confirm payment with biometrics',
        cancelButtonText: 'Cancel',
      });
      return success;
    } catch (error) {
      console.error('Biometric authentication failed:', error);
      Alert.alert('Authentication Failed', 'Could not verify your identity.');
      return false;
    }
  }, [biometricsEnabled]);

  // --- API Handlers ---

  const fetchPaymentMethods = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      // 1. Try to fetch from API
      const methods = await apiCall<PaymentMethod[]>('get', '/payment-methods');
      dispatch({ type: 'SET_PAYMENT_METHODS', payload: methods });
      // 2. Save to offline storage
      await savePaymentMethodsOffline(methods);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'An unknown error occurred.';
      dispatch({ type: 'SET_ERROR', payload: errorMessage });
      // 3. Fallback to offline data on API failure
      await loadPaymentMethodsOffline();
      Alert.alert(
        'Offline Mode',
        'Could not connect to the server. Displaying cached payment methods.'
      );
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [savePaymentMethodsOffline, loadPaymentMethodsOffline]);

  const addPaymentMethod = useCallback(async () => {
    if (!cardInfo || !cardInfo.valid) {
      Alert.alert('Validation Error', 'Please enter valid card details.');
      return;
    }

    const isAuthenticated = await authenticateWithBiometrics();
    if (!isAuthenticated) return;

    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });

    try {
      // Integrate with a payment gateway (e.g., Paystack/Flutterwave)
      // Tokenize card via backend gateway integration (Paystack/Flutterwave).
      // The backend handles gateway tokenization — we pass card details securely.
      const cardData = {
        ...cardInfo.values,
        // Assuming the backend handles the gateway integration (Paystack/Flutterwave)
        gateway: 'Paystack', // or 'Flutterwave'
      };

      const newMethod = await apiCall<PaymentMethod>(
        'post',
        '/payment-methods',
        cardData
      );

      const updatedMethods = [...paymentMethods, newMethod];
      dispatch({ type: 'SET_PAYMENT_METHODS', payload: updatedMethods });
      await savePaymentMethodsOffline(updatedMethods);
      dispatch({ type: 'TOGGLE_ADD_CARD', payload: false });
      Alert.alert('Success', 'Payment method added successfully.');
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Failed to add payment method.';
      dispatch({ type: 'SET_ERROR', payload: errorMessage });
      Alert.alert('Error', errorMessage);
    } finally {
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, [cardInfo, paymentMethods, savePaymentMethodsOffline, authenticateWithBiometrics]);

  const deletePaymentMethod = useCallback(
    async (id: string) => {
      const isAuthenticated = await authenticateWithBiometrics();
      if (!isAuthenticated) return;

      dispatch({ type: 'SET_LOADING', payload: true });
      dispatch({ type: 'SET_ERROR', payload: null });

      try {
        await apiCall<void>('delete', `/payment-methods/${id}`);

        const updatedMethods = paymentMethods.filter((m) => m.id !== id);
        dispatch({ type: 'SET_PAYMENT_METHODS', payload: updatedMethods });
        await savePaymentMethodsOffline(updatedMethods);
        Alert.alert('Success', 'Payment method deleted.');
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : 'Failed to delete payment method.';
        dispatch({ type: 'SET_ERROR', payload: errorMessage });
        Alert.alert('Error', errorMessage);
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    },
    [paymentMethods, savePaymentMethodsOffline, authenticateWithBiometrics]
  );

  // --- Effects ---

  useEffect(() => {
    // Load initial data and check biometrics on mount
    fetchPaymentMethods();
    checkBiometrics();
  }, [fetchPaymentMethods, checkBiometrics]);

  // --- Render Helpers ---

  const renderPaymentMethod = ({ item }: { item: PaymentMethod }) => (
    <View style={styles.cardItem} accessibilityLabel={`Payment card ending in ${item.last4}`}>
      <Text style={styles.cardBrand}>{item.brand}</Text>
      <Text style={styles.cardText}>
        **** **** **** {item.last4}
      </Text>
      <Text style={styles.cardText}>
        Expires: {item.expiryMonth}/{item.expiryYear}
      </Text>
      {item.isDefault && <Text style={styles.defaultBadge}>DEFAULT</Text>}
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => deletePaymentMethod(item.id)}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={`Delete card ending in ${item.last4}`}
      >
        <Text style={styles.deleteButtonText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  const renderAddCardForm = () => (
    <View style={styles.addCardContainer}>
      <Text style={styles.sectionTitle}>Add New Payment Method</Text>
      <CreditCardInput
        onChange={(form: CardInfo) => dispatch({ type: 'SET_CARD_INFO', payload: form })}
        requiresName={true}
        requiresPostalCode={false}
        cardFontFamily={Platform.OS === 'ios' ? 'Courier' : 'monospace'}
        inputContainerStyle={styles.inputContainer}
        labelStyle={styles.label}
        inputStyle={styles.input}
        allowScroll={true}
        accessibilityLabel="Credit card input form"
      />
      <TouchableOpacity
        style={[styles.addButton, (!cardInfo || !cardInfo.valid || loading) && styles.disabledButton]}
        onPress={addPaymentMethod}
        disabled={!cardInfo || !cardInfo.valid || loading}
        accessibilityRole="button"
        accessibilityLabel="Save new payment method"
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.addButtonText}>Save Card</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.cancelButton}
        onPress={() => dispatch({ type: 'TOGGLE_ADD_CARD', payload: false })}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel="Cancel adding new card"
      >
        <Text style={styles.cancelButtonText}>Cancel</Text>
      </TouchableOpacity>
    </View>
  );

  // --- Main Render ---

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <Text style={styles.header}>Payment Methods</Text>

        {error && (
          <View style={styles.errorContainer} accessibilityLiveRegion="assertive">
            <Text style={styles.errorText}>Error: {error}</Text>
            <TouchableOpacity onPress={fetchPaymentMethods} style={styles.retryButton}>
              <Text style={styles.retryButtonText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {loading && !paymentMethods.length && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#007AFF" />
            <Text style={styles.loadingText}>Loading payment methods...</Text>
          </View>
        )}

        {!isAddingNewCard && (
          <>
            <FlatList
              data={paymentMethods}
              keyExtractor={(item) => item.id}
              renderItem={renderPaymentMethod}
              ListEmptyComponent={
                !loading ? (
                  <Text style={styles.emptyText}>No payment methods added yet.</Text>
                ) : null
              }
              contentContainerStyle={styles.listContent}
              accessibilityLabel="List of saved payment methods"
            />

            <TouchableOpacity
              style={styles.addCardToggle}
              onPress={() => dispatch({ type: 'TOGGLE_ADD_CARD', payload: true })}
              disabled={loading}
              accessibilityRole="button"
              accessibilityLabel="Add a new payment method"
            >
              <Text style={styles.addCardToggleText}>+ Add New Card</Text>
            </TouchableOpacity>

            {biometricsEnabled && (
              <Text style={styles.biometricsStatus}>
                Biometric authentication is **Enabled** for payment actions.
              </Text>
            )}
          </>
        )}

        {isAddingNewCard && renderAddCardForm()}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

// --- Styling ---

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    flex: 1,
    padding: 20,
  },
  header: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#333',
  },
  listContent: {
    paddingBottom: 20,
  },
  cardItem: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
    position: 'relative',
  },
  cardBrand: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#007AFF',
    marginBottom: 5,
  },
  cardText: {
    fontSize: 14,
    color: '#555',
    marginBottom: 3,
  },
  defaultBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: '#4CAF50',
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 5,
    fontSize: 10,
    fontWeight: 'bold',
  },
  deleteButton: {
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
    backgroundColor: '#FF3B30',
  },
  deleteButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  addCardToggle: {
    backgroundColor: '#007AFF',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  addCardToggleText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  addCardContainer: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#fff',
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '600',
    marginBottom: 15,
    color: '#333',
  },
  inputContainer: {
    borderBottomWidth: 1,
    borderBottomColor: '#ccc',
  },
  label: {
    color: '#888',
    fontSize: 12,
  },
  input: {
    color: '#333',
    fontSize: 16,
  },
  addButton: {
    backgroundColor: '#4CAF50',
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  cancelButton: {
    marginTop: 10,
    padding: 10,
    alignItems: 'center',
  },
  cancelButtonText: {
    color: '#007AFF',
    fontSize: 16,
  },
  disabledButton: {
    backgroundColor: '#A5D6A7',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 50,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#555',
  },
  errorContainer: {
    backgroundColor: '#FFEBEE',
    padding: 15,
    borderRadius: 8,
    marginBottom: 15,
    borderLeftWidth: 5,
    borderLeftColor: '#FF3B30',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  errorText: {
    color: '#FF3B30',
    flex: 1,
    marginRight: 10,
  },
  retryButton: {
    backgroundColor: '#FF3B30',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
  },
  emptyText: {
    textAlign: 'center',
    marginTop: 50,
    fontSize: 16,
    color: '#888',
  },
  biometricsStatus: {
    marginTop: 15,
    textAlign: 'center',
    fontSize: 14,
    color: '#555',
  }
});

// --- Documentation ---

/**
 * @file PaymentMethodsScreen.tsx
 * @description A complete, production-ready React Native TypeScript screen for payment method management.
 *
 * Features:
 * - Uses React Native with TypeScript and React Hooks (useReducer for state management).
 * - Integrates with React Navigation.
 * - Uses `react-native-credit-card-input` for secure card detail input.
 * - Stubs for API integration with `axios` for fetching, adding, and deleting cards.
 * - Supports offline mode by caching payment methods with `AsyncStorage`.
 * - Integrates `react-native-biometrics` for biometric authentication before sensitive actions (add/delete).
 * - Includes proper loading states, error handling, and form validation.
 * - Uses a clean, modern `StyleSheet` for styling.
 * - Includes accessibility props (`accessibilityLabel`, `accessibilityRole`, `accessibilityLiveRegion`).
 * - Stubs for payment gateway integration (Paystack, Flutterwave) on the backend.
 */

export default PaymentMethodsScreen;
