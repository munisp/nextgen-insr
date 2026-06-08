import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  SafeAreaView,
  StatusBar,
  Dimensions,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


const { width } = Dimensions.get('window');
const SCAN_AREA_SIZE = width * 0.7;

const QRCodeScannerScreen: React.FC = () => {
  const navigation = useNavigation();
  const [manualCode, setManualCode] = useState('');
  const [isScanning, setIsScanning] = useState(true);
  const [isLoading, setIsLoading] = useState(false);

  // Simulate camera permission and initialization
  useEffect(() => {
    const timer = setTimeout(() => {
      // In a real app, we would check permissions here
    }, 1000);
    return () => clearTimeout(timer);
  }, []);

  const handleManualSubmit = async () => {
    if (!manualCode.trim()) {
      Alert.alert('Error', 'Please enter a valid merchant or transaction code.');
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch('https://api.insureportal.io/v1/payments/resolve-qr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code: manualCode }),
      });

      const data = await response.json();

      if (response.ok) {
        // Navigate to payment confirmation with data
        // navigation.navigate('SendMoney', { recipientData: data });
        Alert.alert('Success', `Code resolved: ${data.merchantName || 'Merchant'}`);
      } else {
        Alert.alert('Error', data.message || 'Invalid code. Please try again.');
      }
    } catch (error) {
      Alert.alert('Network Error', 'Unable to connect to the server. Please check your internet.');
    } finally {
      setIsLoading(false);
    }
  };

  const toggleScanner = () => {
    setIsScanning(!isScanning);
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity 
          onPress={() => navigation.goBack()}
          style={styles.backButton}
        >
          <Text style={styles.backButtonText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Scan QR Code</Text>
        <View style={styles.placeholder} />
      </View>

      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.content}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          {/* Scanner Viewfinder Placeholder */}
          <View style={styles.scannerContainer}>
            {isScanning ? (
              <View style={styles.viewfinderWrapper}>
                <View style={styles.viewfinder}>
                  <View style={[styles.corner, styles.topLeft]} />
                  <View style={[styles.corner, styles.topRight]} />
                  <View style={[styles.corner, styles.bottomLeft]} />
                  <View style={[styles.corner, styles.bottomRight]} />
                  
                  {/* Animated Scan Line Placeholder */}
                  <View style={styles.scanLine} />
                </View>
                <Text style={styles.hintText}>Align QR code within the frame</Text>
              </View>
            ) : (
              <View style={styles.disabledScanner}>
                <Text style={styles.disabledText}>Camera is paused</Text>
                <TouchableOpacity style={styles.resumeButton} onPress={toggleScanner}>
                  <Text style={styles.resumeButtonText}>Resume Camera</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* Manual Entry Section */}
          <View style={styles.manualEntryContainer}>
            <View style={styles.dividerContainer}>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>OR ENTER MANUALLY</Text>
              <View style={styles.divider} />
            </View>

            <View style={styles.inputWrapper}>
              <TextInput
                style={styles.input}
                placeholder="Enter Merchant Code"
                placeholderTextColor="#A0A0A0"
                value={manualCode}
                onChangeText={setManualCode}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              <TouchableOpacity 
                style={[styles.submitButton, !manualCode && styles.submitButtonDisabled]}
                onPress={handleManualSubmit}
                disabled={isLoading || !manualCode}
              >
                {isLoading ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.submitButtonText}>Continue</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>

          {/* Tips Section */}
          <View style={styles.tipsContainer}>
            <Text style={styles.tipsTitle}>Quick Tips</Text>
            <View style={styles.tipItem}>
              <View style={styles.tipDot} />
              <Text style={styles.tipText}>Ensure there is enough lighting</Text>
            </View>
            <View style={styles.tipItem}>
              <View style={styles.tipDot} />
              <Text style={styles.tipText}>Hold your phone steady</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E', // InsurePortal background
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backButtonText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  placeholder: {
    width: 40,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  scannerContainer: {
    height: width,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 20,
  },
  viewfinderWrapper: {
    alignItems: 'center',
  },
  viewfinder: {
    width: SCAN_AREA_SIZE,
    height: SCAN_AREA_SIZE,
    borderWidth: 0,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: '#6C63FF', // InsurePortal primary
    borderWidth: 4,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: 12,
  },
  topRight: {
    top: 0,
    right: 0,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: 12,
  },
  scanLine: {
    width: '90%',
    height: 2,
    backgroundColor: '#6C63FF',
    shadowColor: '#6C63FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
    elevation: 5,
  },
  hintText: {
    color: '#fff',
    marginTop: 30,
    fontSize: 14,
    opacity: 0.8,
  },
  disabledScanner: {
    width: SCAN_AREA_SIZE,
    height: SCAN_AREA_SIZE,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  disabledText: {
    color: '#A0A0A0',
    marginBottom: 20,
  },
  resumeButton: {
    backgroundColor: '#6C63FF',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  resumeButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  manualEntryContainer: {
    paddingHorizontal: 25,
    marginTop: 20,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 25,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  dividerText: {
    color: '#A0A0A0',
    paddingHorizontal: 15,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
  },
  inputWrapper: {
    backgroundColor: '#fff', // InsurePortal card
    borderRadius: 12,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  input: {
    flex: 1,
    height: 50,
    paddingHorizontal: 15,
    fontSize: 16,
    color: '#1A1A2E', // InsurePortal text
  },
  submitButton: {
    backgroundColor: '#6C63FF',
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  submitButtonDisabled: {
    backgroundColor: '#A0A0A0',
  },
  submitButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  tipsContainer: {
    marginTop: 40,
    paddingHorizontal: 25,
  },
  tipsTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 15,
  },
  tipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  tipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#6C63FF',
    marginRight: 12,
  },
  tipText: {
    color: '#A0A0A0',
    fontSize: 14,
  },
});

export default QRCodeScannerScreen;