// SECURITY: SQL template literals in this file are for display/mock purposes only.
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  FlatList,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


const PRIMARY_COLOR = '#6C63FF';
const BACKGROUND_COLOR = '#1A1A2E';
const CARD_COLOR = '#FFFFFF';
const TEXT_COLOR = '#1A1A2E';
const API_BASE_URL = 'https://api.insureportal.io/v1';

interface Beneficiary {
  id: string;
  name: string;
  accountNumber: string;
  bankName: string;
}

const SendMoneyScreen = () => {
  const navigation = useNavigation();
  const [amount, setAmount] = useState('');
  const [narration, setNarration] = useState('');
  const [selectedBeneficiary, setSelectedBeneficiary] = useState<Beneficiary | null>(null);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchingBeneficiaries, setFetchingBeneficiaries] = useState(true);

  useEffect(() => {
    fetchBeneficiaries();
  }, []);

  const fetchBeneficiaries = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/beneficiaries`);
      const data = await response.json();
      if (response.ok) {
        setBeneficiaries(data.beneficiaries || []);
      } else {
        // Fallback for demo purposes if API is not reachable
        setBeneficiaries([
          { id: '1', name: 'John Doe', accountNumber: '0123456789', bankName: 'Access Bank' },
          { id: '2', name: 'Jane Smith', accountNumber: '9876543210', bankName: 'GTBank' },
          { id: '3', name: 'Michael Brown', accountNumber: '5544332211', bankName: 'Zenith Bank' },
        ]);
      }
    } catch (error) {
      // Fallback for demo purposes
      setBeneficiaries([
        { id: '1', name: 'John Doe', accountNumber: '0123456789', bankName: 'Access Bank' },
        { id: '2', name: 'Jane Smith', accountNumber: '9876543210', bankName: 'GTBank' },
        { id: '3', name: 'Michael Brown', accountNumber: '5544332211', bankName: 'Zenith Bank' },
      ]);
    } finally {
      setFetchingBeneficiaries(false);
    }
  };

  const handleSendMoney = async () => {
    if (!selectedBeneficiary) {
      Alert.alert('Error', 'Please select a recipient');
      return;
    }
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Error', 'Please enter a valid amount');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/transactions/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          beneficiaryId: selectedBeneficiary.id,
          amount: parseFloat(amount),
          narration: narration,
        }),
      });

      const result = await response.json();

      if (response.ok) {
        Alert.alert(
          'Success',
          `Successfully sent ₦${amount} to ${selectedBeneficiary.name}`,
          [{ text: 'OK', onPress: () => navigation.goBack() }]
        );
      } else {
        Alert.alert('Transaction Failed', result.message || 'Something went wrong');
      }
    } catch (error) {
      Alert.alert('Error', 'Unable to process transaction. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const renderBeneficiaryItem = ({ item }: { item: Beneficiary }) => (
    <TouchableOpacity
      style={[
        styles.beneficiaryCard,
        selectedBeneficiary?.id === item.id && styles.selectedBeneficiaryCard,
      ]}
      onPress={() => setSelectedBeneficiary(item)}
    >
      <View style={styles.avatarContainer}>
        <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
      </View>
      <View style={styles.beneficiaryInfo}>
        <Text style={styles.beneficiaryName}>{item.name}</Text>
        <Text style={styles.beneficiaryDetails}>
          {item.bankName} • {item.accountNumber}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Send Money</Text>
            <Text style={styles.headerSubtitle}>Transfer funds instantly to any bank account</Text>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Recipient</Text>
            {fetchingBeneficiaries ? (
              <ActivityIndicator color={PRIMARY_COLOR} style={{ marginVertical: 20 }} />
            ) : (
              <FlatList
                data={beneficiaries}
                renderItem={renderBeneficiaryItem}
                keyExtractor={(item) => item.id}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.beneficiaryList}
              />
            )}
          </View>

          <View style={styles.formContainer}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Amount (₦)</Text>
              <TextInput
                style={styles.input}
                placeholder="0.00"
                placeholderTextColor="#A0A0A0"
                keyboardType="numeric"
                value={amount}
                onChangeText={setAmount}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Narration (Optional)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="What's this for?"
                placeholderTextColor="#A0A0A0"
                multiline
                numberOfLines={3}
                value={narration}
                onChangeText={setNarration}
              />
            </View>

            {selectedBeneficiary && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryTitle}>Transaction Summary</Text>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Recipient</Text>
                  <Text style={styles.summaryValue}>{selectedBeneficiary.name}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Bank</Text>
                  <Text style={styles.summaryValue}>{selectedBeneficiary.bankName}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Amount</Text>
                  <Text style={styles.summaryValue}>₦{amount || '0.00'}</Text>
                </View>
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryLabel}>Fee</Text>
                  <Text style={styles.summaryValue}>₦10.00</Text>
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleSendMoney}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.buttonText}>Confirm Transfer</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    padding: 24,
    paddingTop: 40,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#A0A0A0',
    marginTop: 8,
  },
  section: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginLeft: 24,
    marginBottom: 16,
  },
  beneficiaryList: {
    paddingLeft: 24,
    paddingRight: 8,
  },
  beneficiaryCard: {
    backgroundColor: CARD_COLOR,
    width: 140,
    padding: 16,
    borderRadius: 16,
    marginRight: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  selectedBeneficiaryCard: {
    borderColor: PRIMARY_COLOR,
  },
  avatarContainer: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: '#F0F0FF',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: PRIMARY_COLOR,
  },
  beneficiaryInfo: {
    alignItems: 'center',
  },
  beneficiaryName: {
    fontSize: 14,
    fontWeight: '600',
    color: TEXT_COLOR,
    textAlign: 'center',
  },
  beneficiaryDetails: {
    fontSize: 10,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  formContainer: {
    padding: 24,
    marginTop: 10,
  },
  inputGroup: {
    marginBottom: 20,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  input: {
    backgroundColor: CARD_COLOR,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: TEXT_COLOR,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  summaryCard: {
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(108, 99, 255, 0.3)',
  },
  summaryTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  summaryLabel: {
    fontSize: 14,
    color: '#A0A0A0',
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  button: {
    backgroundColor: PRIMARY_COLOR,
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: PRIMARY_COLOR,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default SendMoneyScreen;
