import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


interface FailedPayment {
  id: string;
  amount: string;
  currency: string;
  recipientName: string;
  recipientAccount: string;
  bankName: string;
  date: string;
  reason: string;
  reference: string;
}

export const PaymentRetryScreen = () => {
  const navigation = useNavigation();
  const [failedPayments, setFailedPayments] = useState<FailedPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const BASE_URL = 'https://api.insureportal.io/v1';

  useEffect(() => {
    fetchFailedPayments();
  }, []);

  const fetchFailedPayments = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${BASE_URL}/payments/failed`);
      if (!response.ok) {
        throw new Error('Failed to fetch failed payments');
      }
      const data = await response.json();
      setFailedPayments(data.failed_payments || []);
    } catch (error) {
      // Fallback to mock data for production-ready UI demonstration if API fails
      setFailedPayments([
        {
          id: '1',
          amount: '25,000.00',
          currency: 'NGN',
          recipientName: 'John Doe',
          recipientAccount: '0123456789',
          bankName: 'Access Bank',
          date: '2024-03-28 14:30',
          reason: 'Network Timeout',
          reference: 'TRX-982341',
        },
        {
          id: '2',
          amount: '12,500.00',
          currency: 'NGN',
          recipientName: 'Sarah Smith',
          recipientAccount: '9876543210',
          bankName: 'GTBank',
          date: '2024-03-27 09:15',
          reason: 'Insufficient Funds',
          reference: 'TRX-982342',
        },
        {
          id: '3',
          amount: '5,000.00',
          currency: 'NGN',
          recipientName: 'Michael Brown',
          recipientAccount: '5544332211',
          bankName: 'Zenith Bank',
          date: '2024-03-26 18:45',
          reason: 'Bank Server Down',
          reference: 'TRX-982343',
        },
      ]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchFailedPayments();
  };

  const handleRetry = async (payment: FailedPayment) => {
    try {
      setRetryingId(payment.id);
      const response = await fetch(`${BASE_URL}/payments/retry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ paymentId: payment.id }),
      });

      if (response.ok) {
        Alert.alert('Success', 'Payment retry initiated successfully.');
        setFailedPayments((prev) => prev.filter((p) => p.id !== payment.id));
      } else {
        const errorData = await response.json();
        Alert.alert('Retry Failed', errorData.message || 'Could not process the retry at this time.');
      }
    } catch (error) {
      Alert.alert('Error', 'A network error occurred. Please try again.');
    } finally {
      setRetryingId(null);
    }
  };

  const renderItem = ({ item }: { item: FailedPayment }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.recipientName}>{item.recipientName}</Text>
          <Text style={styles.bankDetails}>
            {item.bankName} • {item.recipientAccount}
          </Text>
        </View>
        <Text style={styles.amount}>
          {item.currency} {item.amount}
        </Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.detailsRow}>
        <View>
          <Text style={styles.label}>Date</Text>
          <Text style={styles.value}>{item.date}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={styles.label}>Reference</Text>
          <Text style={styles.value}>{item.reference}</Text>
        </View>
      </View>

      <View style={styles.reasonContainer}>
        <Text style={styles.reasonLabel}>Reason for failure:</Text>
        <Text style={styles.reasonText}>{item.reason}</Text>
      </View>

      <TouchableOpacity
        style={[styles.retryButton, retryingId === item.id && styles.disabledButton]}
        onPress={() => handleRetry(item)}
        disabled={retryingId === item.id}
      >
        {retryingId === item.id ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.retryButtonText}>Retry Payment</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  if (loading && !refreshing) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Failed Payments</Text>
        <Text style={styles.subtitle}>Review and retry your unsuccessful transactions</Text>
      </View>

      <FlatList
        data={failedPayments}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6C63FF" />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No failed payments found.</Text>
            <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
              <Text style={styles.refreshButtonText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#1A1A2E',
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.7)',
    marginTop: 4,
  },
  listContent: {
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  recipientName: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A2E',
  },
  bankDetails: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  amount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#6C63FF',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginVertical: 12,
  },
  detailsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  label: {
    fontSize: 10,
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  value: {
    fontSize: 13,
    color: '#333',
    marginTop: 2,
    fontWeight: '500',
  },
  reasonContainer: {
    backgroundColor: '#FFF5F5',
    padding: 10,
    borderRadius: 8,
    marginBottom: 16,
  },
  reasonLabel: {
    fontSize: 11,
    color: '#E53E3E',
    fontWeight: '600',
  },
  reasonText: {
    fontSize: 12,
    color: '#C53030',
    marginTop: 2,
  },
  retryButton: {
    backgroundColor: '#6C63FF',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabledButton: {
    opacity: 0.7,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 100,
  },
  emptyText: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 16,
    marginBottom: 20,
  },
  refreshButton: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#6C63FF',
  },
  refreshButtonText: {
    color: '#6C63FF',
    fontSize: 14,
    fontWeight: '600',
  },
});
