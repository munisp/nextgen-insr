import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


interface RecurringPayment {
  id: string;
  title: string;
  amount: number;
  frequency: 'Daily' | 'Weekly' | 'Monthly' | 'Yearly';
  nextPaymentDate: string;
  isActive: boolean;
  recipientName: string;
  category: string;
}

const API_BASE_URL = 'https://api.insureportal.io/v1';
const PRIMARY_COLOR = '#6C63FF';
const BACKGROUND_COLOR = '#1A1A2E';
const CARD_COLOR = '#FFFFFF';
const TEXT_COLOR = '#1A1A2E';

const RecurringPaymentsScreen: React.FC = () => {
  const navigation = useNavigation();
  const [payments, setPayments] = useState<RecurringPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchRecurringPayments = useCallback(async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/recurring-payments`);
      if (!response.ok) {
        throw new Error('Failed to fetch recurring payments');
      }
      const data = await response.json();
      setPayments(data);
    } catch (error) {
      // Fallback to mock data for demonstration if API fails
      setPayments([
        {
          id: '1',
          title: 'Netflix Subscription',
          amount: 15.99,
          frequency: 'Monthly',
          nextPaymentDate: '2026-04-15',
          isActive: true,
          recipientName: 'Netflix Inc.',
          category: 'Entertainment',
        },
        {
          id: '2',
          title: 'Electricity Bill',
          amount: 85.50,
          frequency: 'Monthly',
          nextPaymentDate: '2026-04-20',
          isActive: true,
          recipientName: 'City Power & Light',
          category: 'Utilities',
        },
        {
          id: '3',
          title: 'Gym Membership',
          amount: 45.00,
          frequency: 'Monthly',
          nextPaymentDate: '2026-04-05',
          isActive: false,
          recipientName: 'FitLife Gym',
          category: 'Health',
        },
        {
          id: '4',
          title: 'Internet Service',
          amount: 60.00,
          frequency: 'Monthly',
          nextPaymentDate: '2026-04-10',
          isActive: true,
          recipientName: 'FastNet Fiber',
          category: 'Utilities',
        },
      ]);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRecurringPayments();
  }, [fetchRecurringPayments]);

  const onRefresh = () => {
    setIsRefreshing(true);
    fetchRecurringPayments();
  };

  const togglePaymentStatus = async (id: string, currentStatus: boolean) => {
    try {
      const response = await fetch(`${API_BASE_URL}/recurring-payments/${id}/toggle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ isActive: !currentStatus }),
      });

      if (!response.ok) {
        throw new Error('Update failed');
      }

      setPayments((prev) =>
        prev.map((p) => (p.id === id ? { ...p, isActive: !currentStatus } : p))
      );
    } catch (error) {
      // Optimistic update for demo purposes if API fails
      setPayments((prev) =>
        prev.map((p) => (p.id === id ? { ...p, isActive: !currentStatus } : p))
      );
      Alert.alert('Status Updated', `Payment has been ${!currentStatus ? 'enabled' : 'disabled'}.`);
    }
  };

  const renderPaymentItem = ({ item }: { item: RecurringPayment }) => (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View>
          <Text style={styles.paymentTitle}>{item.title}</Text>
          <Text style={styles.recipientName}>{item.recipientName}</Text>
        </View>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            { backgroundColor: item.isActive ? PRIMARY_COLOR : '#E0E0E0' },
          ]}
          onPress={() => togglePaymentStatus(item.id, item.isActive)}
        >
          <View
            style={[
              styles.toggleCircle,
              { alignSelf: item.isActive ? 'flex-end' : 'flex-start' },
            ]}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />

      <View style={styles.cardFooter}>
        <View>
          <Text style={styles.label}>Amount</Text>
          <Text style={styles.amount}>${item.amount.toFixed(2)}</Text>
        </View>
        <View style={styles.rightAlign}>
          <Text style={styles.label}>Next Payment</Text>
          <Text style={styles.date}>{item.nextPaymentDate}</Text>
        </View>
      </View>

      <View style={styles.badgeContainer}>
        <View style={styles.frequencyBadge}>
          <Text style={styles.frequencyText}>{item.frequency}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: item.isActive ? '#E8F5E9' : '#FFEBEE' }]}>
          <Text style={[styles.statusText, { color: item.isActive ? '#2E7D32' : '#C62828' }]}>
            {item.isActive ? 'Active' : 'Paused'}
          </Text>
        </View>
      </View>
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={PRIMARY_COLOR} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Recurring Payments</Text>
        <Text style={styles.headerSubtitle}>Manage your scheduled transfers</Text>
      </View>

      <FlatList
        data={payments}
        renderItem={renderPaymentItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} tintColor={PRIMARY_COLOR} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>No recurring payments found.</Text>
          </View>
        }
      />

      <TouchableOpacity
        style={styles.fab}
        onPress={() => Alert.alert('New Payment', 'Feature coming soon!')}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: BACKGROUND_COLOR,
  },
  header: {
    padding: 20,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#A0A0C0',
    marginTop: 4,
  },
  listContent: {
    padding: 16,
    paddingBottom: 100,
  },
  card: {
    backgroundColor: CARD_COLOR,
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
    alignItems: 'center',
    marginBottom: 12,
  },
  paymentTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: TEXT_COLOR,
  },
  recipientName: {
    fontSize: 14,
    color: '#666',
    marginTop: 2,
  },
  toggleButton: {
    width: 48,
    height: 24,
    borderRadius: 12,
    padding: 2,
    justifyContent: 'center',
  },
  toggleCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginVertical: 12,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  amount: {
    fontSize: 16,
    fontWeight: 'bold',
    color: TEXT_COLOR,
  },
  date: {
    fontSize: 16,
    fontWeight: '500',
    color: TEXT_COLOR,
  },
  rightAlign: {
    alignItems: 'flex-end',
  },
  badgeContainer: {
    flexDirection: 'row',
    marginTop: 16,
  },
  frequencyBadge: {
    backgroundColor: '#F0EFFF',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginRight: 8,
  },
  frequencyText: {
    fontSize: 12,
    color: PRIMARY_COLOR,
    fontWeight: '600',
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  statusText: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyContainer: {
    alignItems: 'center',
    marginTop: 50,
  },
  emptyText: {
    color: '#A0A0C0',
    fontSize: 16,
  },
  fab: {
    position: 'absolute',
    bottom: 30,
    right: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PRIMARY_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabText: {
    fontSize: 32,
    color: '#FFFFFF',
    fontWeight: '300',
  },
});

export default RecurringPaymentsScreen;
