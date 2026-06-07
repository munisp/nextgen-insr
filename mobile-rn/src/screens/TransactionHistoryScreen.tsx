import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


interface Transaction {
  id: string;
  type: 'credit' | 'debit';
  amount: number;
  currency: string;
  description: string;
  status: 'success' | 'pending' | 'failed';
  timestamp: string;
  reference: string;
}

const TransactionHistoryScreen = () => {
  const navigation = useNavigation<any>();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [filterType, setFilterType] = useState<'all' | 'credit' | 'debit'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const fetchTransactions = async (pageNum: number, isRefresh = false) => {
    try {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      const response = await fetch(
        `https://api.insureportal.io/v1/transactions?page=${pageNum}&limit=20&type=${filterType === 'all' ? '' : filterType}&search=${searchQuery}`
      );
      const data = await response.json();

      if (response.ok) {
        const newTransactions = data.transactions || [];
        if (isRefresh) {
          setTransactions(newTransactions);
        } else {
          setTransactions(prev => [...prev, ...newTransactions]);
        }
        setHasMore(newTransactions.length === 20);
      } else {
        Alert.alert('Error', data.message || 'Failed to fetch transactions');
      }
    } catch (error) {
      Alert.alert('Error', 'Network error. Please try again later.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTransactions(1, true);
  }, [filterType, searchQuery]);

  const handleRefresh = () => {
    setPage(1);
    fetchTransactions(1, true);
  };

  const handleLoadMore = () => {
    if (!loading && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchTransactions(nextPage);
    }
  };

  const renderTransactionItem = ({ item }: { item: Transaction }) => (
    <TouchableOpacity
      style={styles.transactionCard}
      onPress={() => navigation.navigate('TransactionDetails', { transactionId: item.id })}
    >
      <View style={styles.iconContainer}>
        <View style={[styles.dot, { backgroundColor: item.type === 'credit' ? '#4CAF50' : '#F44336' }]} />
      </View>
      <View style={styles.transactionInfo}>
        <Text style={styles.descriptionText} numberOfLines={1}>{item.description}</Text>
        <Text style={styles.dateText}>{new Date(item.timestamp).toLocaleDateString()}</Text>
      </View>
      <View style={styles.amountContainer}>
        <Text style={[styles.amountText, { color: item.type === 'credit' ? '#4CAF50' : '#1A1A2E' }]}>
          {item.type === 'credit' ? '+' : '-'}{item.currency} {item.amount.toLocaleString()}
        </Text>
        <Text style={[styles.statusText, styles[item.status]]}>{item.status.toUpperCase()}</Text>
      </View>
    </TouchableOpacity>
  );

  const FilterButton = ({ type, label }: { type: 'all' | 'credit' | 'debit', label: string }) => (
    <TouchableOpacity
      style={[styles.filterBtn, filterType === type && styles.filterBtnActive]}
      onPress={() => setFilterType(type)}
    >
      <Text style={[styles.filterBtnText, filterType === type && styles.filterBtnTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Transaction History</Text>
      </View>

      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search by reference or description"
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
      </View>

      <View style={styles.filterContainer}>
        <FilterButton type="all" label="All" />
        <FilterButton type="credit" label="Income" />
        <FilterButton type="debit" label="Expense" />
      </View>

      <FlatList
        data={transactions}
        renderItem={renderTransactionItem}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.listContent}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No transactions found</Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          loading && page > 1 ? (
            <ActivityIndicator color="#6C63FF" style={{ marginVertical: 20 }} />
          ) : null
        }
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  header: {
    padding: 20,
    backgroundColor: '#1A1A2E',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 15,
  },
  searchInput: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 15,
    paddingVertical: 12,
    fontSize: 16,
    color: '#1A1A2E',
  },
  filterContainer: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 15,
  },
  filterBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    marginRight: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  filterBtnActive: {
    backgroundColor: '#6C63FF',
  },
  filterBtnText: {
    color: '#fff',
    fontWeight: '600',
  },
  filterBtnTextActive: {
    color: '#fff',
  },
  listContent: {
    padding: 20,
    backgroundColor: '#F5F7FA',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    flexGrow: 1,
  },
  transactionCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 15,
    marginBottom: 12,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 5,
    elevation: 2,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F0F0F0',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  transactionInfo: {
    flex: 1,
  },
  descriptionText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A2E',
    marginBottom: 4,
  },
  dateText: {
    fontSize: 12,
    color: '#666',
  },
  amountContainer: {
    alignItems: 'flex-end',
  },
  amountText: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  statusText: {
    fontSize: 10,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    overflow: 'hidden',
  },
  success: {
    backgroundColor: '#E8F5E9',
    color: '#4CAF50',
  },
  pending: {
    backgroundColor: '#FFF3E0',
    color: '#FF9800',
  },
  failed: {
    backgroundColor: '#FFEBEE',
    color: '#F44336',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 100,
  },
  emptyText: {
    fontSize: 16,
    color: '#666',
  },
});

export default TransactionHistoryScreen;
