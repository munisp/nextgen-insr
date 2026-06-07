import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';

const apiClient = new APIClient();

// Define types for the transaction data
interface Transaction {
  id: string;
  type: 'TRANSFER' | 'BILL_PAYMENT' | 'WITHDRAWAL' | 'DEPOSIT';
  status: 'SUCCESS' | 'PENDING' | 'FAILED';
  amount: number;
  currency: string;
  senderName: string;
  senderBank: string;
  recipientName: string;
  recipientBank: string;
  recipientAccountNumber: string;
  reference: string;
  narration: string;
  timestamp: string;
  fee: number;
}

type RootStackParamList = {
  TransactionDetails: { transactionId: string };
};

type TransactionDetailsRouteProp = RouteProp<RootStackParamList, 'TransactionDetails'>;

export const TransactionDetailsScreen = () => {
  const navigation = useNavigation();
  const route = useRoute<TransactionDetailsRouteProp>();
  const { transactionId } = route.params || { transactionId: 'TXN-782910442' }; // Fallback for demo

  const [transaction, setTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTransactionDetails();
  }, [transactionId]);

  const fetchTransactionDetails = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get(`/transactions/${transactionId}`);
      setTransaction(response.data as Transaction);
    } catch (error) {
      console.error('Error fetching transaction details:', error);
      Alert.alert('Error', 'Failed to load transaction details. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleShare = () => {
    Alert.alert('Share Receipt', 'Receipt sharing functionality would be triggered here.');
  };

  const handleReport = () => {
    Alert.alert('Report Issue', 'Redirecting to support for this transaction.');
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  if (!transaction) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Transaction not found</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Text style={styles.backButtonText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'SUCCESS': return '#4CAF50';
      case 'PENDING': return '#FF9800';
      case 'FAILED': return '#F44336';
      default: return '#1A1A2E';
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Transaction Receipt</Text>
        <TouchableOpacity onPress={handleShare} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>Share</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.receiptCard}>
          {/* Status Icon & Amount */}
          <View style={styles.statusSection}>
            <View style={[styles.statusBadge, { backgroundColor: getStatusColor(transaction.status) + '20' }]}>
              <Text style={[styles.statusText, { color: getStatusColor(transaction.status) }]}>
                {transaction.status}
              </Text>
            </View>
            <Text style={styles.amountText}>
              {transaction.currency} {transaction.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
            </Text>
            <Text style={styles.dateText}>{transaction.timestamp}</Text>
          </View>

          <View style={styles.divider} />

          {/* Transaction Details */}
          <View style={styles.detailsSection}>
            <DetailRow label="Transaction Type" value={transaction.type} />
            <DetailRow label="Reference Number" value={transaction.reference} />
            <DetailRow label="Narration" value={transaction.narration} />
          </View>

          <View style={styles.divider} />

          {/* Transfer Parties */}
          <View style={styles.detailsSection}>
            <Text style={styles.sectionTitle}>Transfer Details</Text>
            <DetailRow label="From" value={transaction.senderName} subValue={transaction.senderBank} />
            <DetailRow 
              label="To" 
              value={transaction.recipientName} 
              subValue={`${transaction.recipientBank} • ${transaction.recipientAccountNumber}`} 
            />
          </View>

          <View style={styles.divider} />

          {/* Fees & Total */}
          <View style={styles.detailsSection}>
            <DetailRow label="Transaction Fee" value={`${transaction.currency} ${transaction.fee.toFixed(2)}`} />
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total Amount</Text>
              <Text style={styles.totalValue}>
                {transaction.currency} {(transaction.amount + transaction.fee).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </Text>
            </View>
          </View>

          {/* Branding Footer */}
          <View style={styles.receiptFooter}>
            <Text style={styles.footerBrand}>InsurePortal Agency Banking</Text>
            <Text style={styles.footerTagline}>Secure • Fast • Reliable</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.reportButton} onPress={handleReport}>
          <Text style={styles.reportButtonText}>Report an issue with this transaction</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
};

const DetailRow = ({ label, value, subValue }: { label: string, value: string, subValue?: string }) => (
  <View style={styles.detailRow}>
    <View style={styles.detailLabelContainer}>
      <Text style={styles.detailLabel}>{label}</Text>
    </View>
    <View style={styles.detailValueContainer}>
      <Text style={styles.detailValue}>{value}</Text>
      {subValue && <Text style={styles.detailSubValue}>{subValue}</Text>}
    </View>
  </View>
);

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  container: {
    flex: 1,
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
    padding: 20,
  },
  errorText: {
    color: '#fff',
    fontSize: 18,
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: '#6C63FF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1A1A2E',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  headerButton: {
    padding: 8,
  },
  headerButtonText: {
    color: '#6C63FF',
    fontSize: 16,
    fontWeight: '600',
  },
  receiptCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  statusSection: {
    alignItems: 'center',
    marginBottom: 20,
  },
  statusBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 12,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  amountText: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1A1A2E',
    marginBottom: 4,
  },
  dateText: {
    fontSize: 14,
    color: '#666',
  },
  divider: {
    height: 1,
    backgroundColor: '#EEE',
    marginVertical: 20,
    borderStyle: 'dashed',
    borderRadius: 1,
  },
  detailsSection: {
    width: '100%',
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A2E',
    marginBottom: 16,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  detailLabelContainer: {
    flex: 0.4,
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
  },
  detailValueContainer: {
    flex: 0.6,
    alignItems: 'flex-end',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A2E',
    textAlign: 'right',
  },
  detailSubValue: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  totalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#6C63FF',
  },
  receiptFooter: {
    marginTop: 30,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F0F0F0',
    paddingTop: 20,
  },
  footerBrand: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  footerTagline: {
    fontSize: 12,
    color: '#999',
    marginTop: 4,
  },
  reportButton: {
    marginTop: 24,
    padding: 16,
    alignItems: 'center',
  },
  reportButtonText: {
    color: '#FF4D4D',
    fontSize: 14,
    fontWeight: '600',
  },
});
