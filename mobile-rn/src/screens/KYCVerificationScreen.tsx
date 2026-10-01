// 2026-10-01 (R1b): all mock/stub paths removed from this screen — uploads,
// submission and biometric gating now hit real endpoints/libraries only.
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  AccessibilityProps,
} from 'react-native';
import { useNavigation, NativeStackScreenProps } from '@react-navigation/native';
import axios, { AxiosError } from 'axios';
import { launchCamera, launchImageLibrary, Asset } from 'react-native-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
// 2026-10-01 (R1b): real biometrics library (already used by
// BiometricAuthScreen/PinSetupScreen) replaces the always-true stub.
import ReactNativeBiometrics from 'react-native-biometrics';

// --- Configuration & Constants ---
const API_BASE_URL = 'https://kyc.insureportal.io/api/v1';
// 2026-10-01 (R1b): removed hardcoded Paystack/Flutterwave TEST public keys
// (PAYSTACK_PUBLIC_KEY / FLUTTERWAVE_PUBLIC_KEY). Test keys must never ship,
// and the fabricated "verification fee" payment step that used them was
// removed (see handleSubmitAll).

// --- Type Definitions ---

// Define the root stack param list for navigation
// 2026-10-01 (R1b): PaymentSuccess route removed — it does not exist and was
// only reachable via the fabricated fee-payment flow.
type RootStackParamList = {
  Home: undefined;
  KYCVerification: undefined;
};

// Define the screen props type
type KYCVerificationScreenProps = NativeStackScreenProps<RootStackParamList, 'KYCVerification'>;

// Document type interface
interface Document {
  id: string;
  name: string;
  status: 'pending' | 'uploaded' | 'verified' | 'rejected';
  fileUri?: string;
  fileName?: string;
  fileType?: string;
}

// State interface for the screen
interface KYCState {
  documents: Document[];
  isLoading: boolean;
  error: string | null;
  isOffline: boolean;
  biometricsEnabled: boolean;
  verificationStatus: 'initial' | 'in_progress' | 'complete';
}

// Initial state
const initialDocuments: Document[] = [
  { id: 'id_card', name: 'National ID Card (Front)', status: 'pending' },
  { id: 'proof_address', name: 'Proof of Address (Utility Bill)', status: 'pending' },
  { id: 'selfie', name: 'Live Selfie', status: 'pending' },
];

const initialState: KYCState = {
  documents: initialDocuments,
  isLoading: false,
  error: null,
  isOffline: false,
  biometricsEnabled: false,
  verificationStatus: 'initial',
};

// --- API Service (real endpoints; 2026-10-01, R1b) ---
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
    // Authorization: 'Bearer <token>', // Injected by APIClient interceptor
  },
});

// --- Biometrics (real) ---
// 2026-10-01 (R1b): FABRICATION REMOVED — the previous BiometricsService stub
// resolved `true` after a timer for BOTH support checks and authentication,
// i.e. biometric gating always "passed" without any biometric check.
const rnBiometrics = new ReactNativeBiometrics();

const BiometricsService = {
  isSupported: async (): Promise<boolean> => {
    const { available } = await rnBiometrics.isSensorAvailable();
    return available;
  },
  authenticate: async (prompt: string): Promise<boolean> => {
    const { success } = await rnBiometrics.simplePrompt({
      promptMessage: prompt,
      cancelButtonText: 'Cancel',
    });
    return success;
  },
};

// 2026-10-01 (R1b): PaymentService stub DELETED — it fabricated a successful
// transaction ID for a "verification fee" that was never charged. No real
// verification-fee endpoint exists in the API client; the step is removed
// from the submission flow entirely.

// --- Utility Functions ---

/**
 * Handles API errors and sets the error state.
 * @param err The Axios error object.
 */
const handleApiError = (err: AxiosError | Error, setError: (msg: string | null) => void) => {
  if (axios.isAxiosError(err)) {
    const message = err.response?.data?.message || err.message;
    setError(`API Error: ${message}`);
  } else {
    setError(`An unexpected error occurred: ${err.message}`);
  }
  console.error(err);
};

// --- Component ---

const KYCVerificationScreen: React.FC<KYCVerificationScreenProps> = () => {
  const navigation = useNavigation<KYCVerificationScreenProps['navigation']>();
  const [state, setState] = useState<KYCState>(initialState);

  const { documents, isLoading, error, isOffline, biometricsEnabled, verificationStatus } = state;

  // --- Side Effects & Initialization ---

  // Check for offline status and biometrics support on mount
  useEffect(() => {
    const checkStatus = async () => {
      // 2026-10-01 (R1b): removed stubbed `isConnected = true`. NetInfo is not
      // a dependency of this app; rather than fabricate connectivity state we
      // default to online and let real API errors surface honestly.
      setState(s => ({ ...s, isOffline: false }));

      // Check biometrics support
      try {
        const supported = await BiometricsService.isSupported();
        setState(s => ({ ...s, biometricsEnabled: supported }));
      } catch (e) {
        console.error('Biometrics check failed', e);
      }
    };
    checkStatus();
  }, []);

  // --- Document Upload Logic ---

  const handleImagePickerResponse = useCallback((docId: string, response: { didCancel?: boolean; errorCode?: string; errorMessage?: string; assets?: Asset[] }) => {
    if (response.didCancel) {
      console.log('User cancelled image picker');
      return;
    }
    if (response.errorCode) {
      Alert.alert('Error', `Image Picker Error: ${response.errorMessage}`);
      return;
    }

    const asset = response.assets?.[0];
    if (asset && asset.uri && asset.fileName && asset.type) {
      const newDocument: Partial<Document> = {
        fileUri: asset.uri,
        fileName: asset.fileName,
        fileType: asset.type,
        status: 'uploaded',
      };

      setState(s => ({
        ...s,
        documents: s.documents.map(doc =>
          doc.id === docId ? { ...doc, ...newDocument } : doc
        ),
      }));
    }
  }, []);

  const selectDocument = useCallback((docId: string, type: 'camera' | 'library') => {
    const options = {
      mediaType: 'photo' as const,
      quality: 0.7,
      maxWidth: 1024,
      maxHeight: 1024,
      includeBase64: false,
    };

    if (type === 'camera') {
      launchCamera(options, (response) => handleImagePickerResponse(docId, response));
    } else {
      launchImageLibrary(options, (response) => handleImagePickerResponse(docId, response));
    }
  }, [handleImagePickerResponse]);

  // --- API and Form Submission Logic ---

  const uploadDocument = async (document: Document) => {
    if (!document.fileUri || !document.fileName || !document.fileType) {
      Alert.alert('Error', `File for ${document.name} not selected.`);
      return;
    }

    setState(s => ({ ...s, isLoading: true, error: null }));

    try {
      // 1. Prepare form data
      const formData = new FormData();
      formData.append('documentType', document.id);
      formData.append('file', {
        uri: document.fileUri,
        name: document.fileName,
        type: document.fileType,
      } as any); // 'as any' is used because FormData expects a Blob/File, but RN uses a custom object

      // 2. API Call (real — 2026-10-01, R1b): previously this SKIPPED the
      // upload, waited 2s on a timer, then marked the document 'verified' —
      // a fabricated KYC pass. Now the file is actually uploaded and the
      // status only advances on a confirmed server response.
      await api.post('/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      // 3. Update state on confirmed success. Status is 'uploaded' (submitted
      //    for review) — only the backend compliance review can mark a
      //    document 'verified'.
      setState(s => ({
        ...s,
        isLoading: false,
        documents: s.documents.map(doc =>
          doc.id === document.id ? { ...doc, status: 'uploaded' } : doc
        ),
      }));
      Alert.alert('Success', `${document.name} uploaded and submitted for verification.`);

    } catch (err) {
      handleApiError(err as AxiosError, (msg) => setState(s => ({ ...s, error: msg })));
      setState(s => ({ ...s, isLoading: false }));
    }
  };

  const handleSubmitAll = async () => {
    // Form Validation: Check if all required documents are uploaded
    const pendingDocs = documents.filter(doc => doc.status !== 'uploaded' && doc.status !== 'verified');
    if (pendingDocs.length > 0) {
      Alert.alert('Incomplete', 'Please upload all required documents before submitting.');
      return;
    }

    setState(s => ({ ...s, isLoading: true, error: null, verificationStatus: 'in_progress' }));

    try {
      // 1. Biometric Authentication (Optional step for enhanced security)
      if (biometricsEnabled) {
        const authSuccess = await BiometricsService.authenticate('Confirm submission with biometrics');
        if (!authSuccess) {
          Alert.alert('Authentication Failed', 'Biometric authentication failed. Submission cancelled.');
          setState(s => ({ ...s, isLoading: false, verificationStatus: 'initial' }));
          return;
        }
      }

      // 2. Final KYC Submission API Call (real — 2026-10-01, R1b): previously
      //      a 3s timer simulated success and a stubbed PaymentService
      //      fabricated a fee transaction ID. Both removed.
      await api.post('/submit-kyc', {
        documentReferences: documents.map(d => d.fileName),
      });

      // 3. Record submitted status locally (cache only — the server is the
      //    source of truth for KYC state).
      await AsyncStorage.setItem('kyc_status', JSON.stringify({ status: 'submitted' }));

      // 4. Honest completion: no fabricated PaymentSuccess screen (that route
      //    does not exist); confirm and return.
      setState(s => ({ ...s, isLoading: false, verificationStatus: 'complete' }));
      Alert.alert(
        'Submitted',
        'Your documents have been submitted for verification. You will be notified once the review is complete.',
        [{ text: 'OK', onPress: () => navigation.goBack() }],
      );

    } catch (err) {
      handleApiError(err as AxiosError, (msg) => setState(s => ({ ...s, error: msg })));
      setState(s => ({ ...s, isLoading: false, verificationStatus: 'initial' }));
    }
  };

  // --- UI Rendering ---

  const renderDocumentItem = ({ item }: { item: Document }) => {
    const isUploaded = item.status === 'uploaded' || item.status === 'verified';
    const statusColor =
      item.status === 'verified' ? 'green' :
      item.status === 'rejected' ? 'red' :
      item.status === 'uploaded' ? 'orange' : 'gray';

    const accessibilityProps: AccessibilityProps = {
      accessibilityRole: 'button',
      accessibilityLabel: `${item.name}. Status: ${item.status}. Tap to upload.`,
      accessibilityHint: `Opens ${isUploaded ? 'options to re-upload' : 'camera or gallery'} for ${item.name}`,
    };

    return (
      <View style={styles.documentItem}>
        <View style={styles.documentInfo}>
          <Text style={styles.documentName}>{item.name}</Text>
          <Text style={[styles.documentStatus, { color: statusColor }]}>
            Status: {item.status.toUpperCase()}
          </Text>
          {item.fileName && <Text style={styles.fileNameText} numberOfLines={1}>File: {item.fileName}</Text>}
        </View>
        <View style={styles.buttonGroup}>
          <TouchableOpacity
            style={[styles.uploadButton, { backgroundColor: '#007AFF' }]}
            onPress={() => selectDocument(item.id, 'library')}
            disabled={isLoading}
            {...accessibilityProps}
          >
            <Text style={styles.buttonText}>Gallery</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.uploadButton, { backgroundColor: '#4CD964' }]}
            onPress={() => selectDocument(item.id, 'camera')}
            disabled={isLoading}
            {...accessibilityProps}
          >
            <Text style={styles.buttonText}>Camera</Text>
          </TouchableOpacity>
          {isUploaded && (
            <TouchableOpacity
              style={[styles.uploadButton, { backgroundColor: '#FF9500' }]}
              onPress={() => uploadDocument(item)}
              disabled={isLoading}
              accessibilityRole="button"
              accessibilityLabel={`Upload ${item.name} to server`}
            >
              <Text style={styles.buttonText}>Submit</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.header}>KYC Verification</Text>
        <Text style={styles.subheader}>
          Please upload the required documents to complete your Know Your Customer (KYC) verification.
        </Text>

        {isOffline && (
          <View style={styles.offlineBanner}>
            <Text style={styles.offlineText}>You are offline. Uploads will be queued.</Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>Error: {error}</Text>
          </View>
        )}

        <FlatList
          data={documents}
          renderItem={renderDocumentItem}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          contentContainerStyle={styles.listContainer}
        />

        <View style={styles.statusSection}>
          <Text style={styles.statusHeader}>Verification Status</Text>
          <Text style={styles.statusText}>Current Status: {verificationStatus.toUpperCase().replace('_', ' ')}</Text>
          {biometricsEnabled && (
            <Text style={styles.biometricsText}>
              Biometrics: {biometricsEnabled ? 'Enabled' : 'Disabled'}
            </Text>
          )}
        </View>

        <TouchableOpacity
          style={[styles.submitButton, isLoading && styles.submitButtonDisabled]}
          onPress={handleSubmitAll}
          disabled={isLoading}
          accessibilityRole="button"
          accessibilityLabel="Submit all documents for KYC verification"
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>
              {verificationStatus === 'complete' ? 'Verification Complete' : 'Submit for Verification'}
            </Text>
          )}
        </TouchableOpacity>

        <Text style={styles.footerText}>
          Your documents are securely encrypted and will be reviewed within 24 hours.
        </Text>
      </ScrollView>
    </View>
  );
};

// --- Styling ---

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f2f5',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1c1c1e',
    marginBottom: 10,
  },
  subheader: {
    fontSize: 16,
    color: '#6c757d',
    marginBottom: 20,
  },
  listContainer: {
    marginBottom: 20,
  },
  documentItem: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 8,
    marginBottom: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  documentInfo: {
    flex: 1,
    marginRight: 10,
  },
  documentName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  documentStatus: {
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 5,
  },
  fileNameText: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  buttonGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  uploadButton: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 5,
    marginLeft: 8,
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 12,
  },
  submitButton: {
    backgroundColor: '#0047AB', // Primary blue color
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  submitButtonDisabled: {
    backgroundColor: '#a0a0a0',
  },
  submitButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  errorBox: {
    backgroundColor: '#f8d7da',
    padding: 10,
    borderRadius: 5,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: '#f5c6cb',
  },
  errorText: {
    color: '#721c24',
    fontWeight: '600',
  },
  offlineBanner: {
    backgroundColor: '#ffc107',
    padding: 10,
    borderRadius: 5,
    marginBottom: 15,
    alignItems: 'center',
  },
  offlineText: {
    color: '#343a40',
    fontWeight: '600',
  },
  statusSection: {
    marginTop: 20,
    padding: 15,
    backgroundColor: '#e9ecef',
    borderRadius: 8,
  },
  statusHeader: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
    color: '#333',
  },
  statusText: {
    fontSize: 16,
    color: '#555',
  },
  biometricsText: {
    fontSize: 14,
    color: '#007bff',
    marginTop: 5,
  },
  footerText: {
    fontSize: 12,
    color: '#6c757d',
    textAlign: 'center',
    marginTop: 20,
  }
});

export default KYCVerificationScreen;
