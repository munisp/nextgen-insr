import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { api } from '../services/api';

interface Transaction {
  id: number;
  type: string;
  amount: number;
  description: string;
  status: string;
  createdAt: string;
}

export default function WalletScreen() {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchWallet = async () => {
    try {
      const data = await api.query('wallet.balance');
      setBalance(data?.balance || 0);
      const txns = await api.query('wallet.transactions');
      setTransactions(Array.isArray(txns) ? txns : []);
    } catch {}
  };

  useEffect(() => { fetchWallet(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchWallet();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Wallet Balance</Text>
        <Text style={styles.balanceAmount}>₦{balance.toLocaleString()}</Text>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn}>
            <Text style={styles.actionText}>Fund</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.withdrawBtn]}>
            <Text style={styles.actionText}>Withdraw</Text>
          </TouchableOpacity>
        </View>
      </View>
      <Text style={styles.sectionTitle}>Recent Transactions</Text>
      <FlatList
        data={transactions}
        keyExtractor={item => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <View style={styles.txnCard}>
            <View>
              <Text style={styles.txnDesc}>{item.description || item.type}</Text>
              <Text style={styles.txnDate}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
            <Text style={[styles.txnAmount, item.type === 'credit' ? styles.credit : styles.debit]}>
              {item.type === 'credit' ? '+' : '-'}₦{Math.abs(item.amount).toLocaleString()}
            </Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No transactions</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  balanceCard: { backgroundColor: '#1e40af', padding: 24, margin: 16, borderRadius: 16 },
  balanceLabel: { color: '#93c5fd', fontSize: 14 },
  balanceAmount: { color: '#fff', fontSize: 36, fontWeight: 'bold', marginTop: 8 },
  actions: { flexDirection: 'row', marginTop: 16, gap: 12 },
  actionBtn: { backgroundColor: '#3b82f6', paddingVertical: 10, paddingHorizontal: 24, borderRadius: 8 },
  withdrawBtn: { backgroundColor: '#1e3a8a' },
  actionText: { color: '#fff', fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '600', paddingHorizontal: 16, paddingTop: 8 },
  txnCard: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', padding: 16, marginHorizontal: 16, marginTop: 8, borderRadius: 8 },
  txnDesc: { fontWeight: '500' },
  txnDate: { color: '#999', fontSize: 12, marginTop: 2 },
  txnAmount: { fontWeight: '700', fontSize: 16 },
  credit: { color: '#16a34a' },
  debit: { color: '#dc2626' },
  empty: { textAlign: 'center', padding: 40, color: '#999' },
});
