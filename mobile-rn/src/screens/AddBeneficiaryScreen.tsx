import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  StyleSheet,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


// InsurePortal Brand Colors
const COLORS = {
  primary: '#6C63FF',
  background: '#1A1A2E',
  card: '#FFFFFF',
  text: '#1A1A2E',
  textSecondary: '#666666',
  border: '#E0E0E0',
  error: '#FF4D4D',
  success: '#4CAF50',
};

const BASE_URL = 'https://api.insureportal.io/v1';

export const AddBeneficiaryScreen = () => {
  const navigation = useNavigation();
  
  // Form State
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [selectedBank, setSelectedBank] = useState<{ id: string; name: string } | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  
  // UI State
  const [banks, setBanks] = useState<{ id: string; name: string }[]>([]);
  const [isLoadingBanks, setIsLoadingBanks] = useState(true);
  const [isVerifyingAccount, setIsVerifyingAccount] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showBankPicker, setShowBankPicker] = useState(false);

  useEffect(() => {
    fetchBanks();
  }, []);

  const fetchBanks = async () => {
    try {
      const response = await fetch(`${BASE_URL}/banks`);
      const result = await response.json();
      if (result.success) {
        setBanks(result.data);
      } else {
        // Fallback banks for demo/production robustness
        setBanks([
          { id: '1', name: 'Access Bank' },
          { id: '2', name: 'First Bank of Nigeria' },
          { id: '3', name: 'GTBank' },
          { id: '4', name: 'Zenith Bank' },
          { id: '5', name: 'United Bank for Africa' },
        ]);
      }
    } catch (error) {
      console.error('Error fetching banks:', error);
      // Fallback banks
      setBanks([
        { id: '1', name: 'Access Bank' },
        { id: '2', name: 'First Bank of Nigeria' },
        { id: '3', name: 'GTBank' },
        { id: '4', name: 'Zenith Bank' },
        { id: '5', name: 'United Bank for Africa' },
      ]);
    } finally {
      setIsLoadingBanks(false);
    }
  };

  const verifyAccountNumber = async (number: string, bankId: string) => {
    if (number.length === 10 && bankId) {
      setIsVerifyingAccount(true);
      try {
        const response = await fetch(`${BASE_URL}/account/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountNumber: number, bankCode: bankId }),
        });
        const result = await response.json();
        if (result.success) {
          setAccountName(result.data.accountName);
        } else {
          setAccountName('');
        }
      } catch (error) {
        console.error('Error verifying account:', error);
      } finally {
        setIsVerifyingAccount(false);
      }
    }
  };

  const handleAccountNumberChange = (text: string) => {
    const cleaned = text.replace(/[^0-9]/g, '');
    setAccountNumber(cleaned);
    if (cleaned.length === 10 && selectedBank) {
      verifyAccountNumber(cleaned, selectedBank.id);
    } else {
      setAccountName('');
    }
  };

  const handleBankSelect = (bank: { id: string; name: string }) => {
    setSelectedBank(bank);
    setShowBankPicker(false);
    if (accountNumber.length === 10) {
      verifyAccountNumber(accountNumber, bank.id);
    }
  };

  const handleAddBeneficiary = async () => {
    if (!accountNumber || !accountName || !selectedBank || !phoneNumber) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${BASE_URL}/beneficiaries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountNumber,
          accountName,
          bankId: selectedBank.id,
          bankName: selectedBank.name,
          phoneNumber,
        }),
      });
      
      const result = await response.json();
      if (result.success) {
        Alert.alert('Success', 'Beneficiary added successfully', [
          { text: 'OK', onPress: () => navigation.goBack() }
        ]);
      } else {
        Alert.alert('Error', result.message || 'Failed to add beneficiary');
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.container}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Add Beneficiary</Text>
            <Text style={styles.subtitle}>Save bank details for quicker transfers</Text>
          </View>

          <View style={styles.form}>
            <Text style={styles.label}>Bank Name</Text>
            <TouchableOpacity 
              style={styles.pickerButton} 
              onPress={() => setShowBankPicker(!showBankPicker)}
            >
              <Text style={[styles.pickerText, !selectedBank && { color: '#999' }]}>
                {selectedBank ? selectedBank.name : 'Select a bank'}
              </Text>
              <Text style={styles.pickerIcon}>▼</Text>
            </TouchableOpacity>

            {showBankPicker && (
              <View style={styles.bankList}>
                {isLoadingBanks ? (
                  <ActivityIndicator color={COLORS.primary} style={{ padding: 20 }} />
                ) : (
                  banks.map((bank) => (
                    <TouchableOpacity 
                      key={bank.id} 
                      style={styles.bankItem}
                      onPress={() => handleBankSelect(bank)}
                    >
                      <Text style={styles.bankItemText}>{bank.name}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            )}

            <Text style={styles.label}>Account Number</Text>
            <View style={styles.inputContainer}>
              <TextInput
                style={styles.input}
                placeholder="Enter 10-digit account number"
                placeholderTextColor="#999"
                keyboardType="numeric"
                maxLength={10}
                value={accountNumber}
                onChangeText={handleAccountNumberChange}
              />
              {isVerifyingAccount && (
                <ActivityIndicator size="small" color={COLORS.primary} style={styles.inputLoader} />
              )}
            </View>

            <Text style={styles.label}>Account Name</Text>
            <TextInput
              style={[styles.input, styles.disabledInput]}
              placeholder="Account name will appear here"
              placeholderTextColor="#999"
              value={accountName}
              editable={false}
            />

            <Text style={styles.label}>Phone Number</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter recipient's phone number"
              placeholderTextColor="#999"
              keyboardType="phone-pad"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
            />
          </View>

          <TouchableOpacity 
            style={[styles.primaryButton, isSubmitting && styles.disabledButton]}
            onPress={handleAddBeneficiary}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.buttonText}>Save Beneficiary</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    padding: 24,
    paddingTop: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 8,
  },
  form: {
    backgroundColor: COLORS.card,
    margin: 20,
    padding: 24,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
    marginTop: 16,
  },
  inputContainer: {
    position: 'relative',
    justifyContent: 'center',
  },
  input: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: COLORS.text,
  },
  disabledInput: {
    backgroundColor: '#F0F0F0',
    color: '#666',
  },
  inputLoader: {
    position: 'absolute',
    right: 16,
  },
  pickerButton: {
    backgroundColor: '#F8F9FA',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  pickerText: {
    fontSize: 16,
    color: COLORS.text,
  },
  pickerIcon: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  bankList: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    maxHeight: 200,
    overflow: 'hidden',
  },
  bankItem: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  bankItemText: {
    fontSize: 15,
    color: COLORS.text,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    padding: 18,
    borderRadius: 16,
    marginHorizontal: 20,
    marginTop: 10,
    alignItems: 'center',
    shadowColor: COLORS.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  disabledButton: {
    opacity: 0.7,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
