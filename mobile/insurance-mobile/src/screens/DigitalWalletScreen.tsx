import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, RefreshControl } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../store/authStore';
import { useOfflineSync } from '../services/offlineSync';

const API_BASE = 'http://localhost:3000/api/trpc';

export function DigitalWalletScreen() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const { getCachedData, setCachedData } = useOfflineSync();
  const [topupAmount, setTopupAmount] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: wallet, isLoading, refetch } = useQuery({
    queryKey: ['wallet.balance'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/wallet.balance`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        const data = json?.result?.data || json;
        await setCachedData('wallet', data, 60000);
        return data;
      } catch {
        return (await getCachedData('wallet')) || { balance: 0, currency: 'NGN' };
      }
    },
  });

  const { data: transactions } = useQuery({
    queryKey: ['wallet.transactions'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/wallet.history`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        return json?.result?.data || json || [];
      } catch {
        return [];
      }
    },
  });

  const topup = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(topupAmount);
      if (isNaN(amt) || amt < 100) throw new Error('Minimum top-up is ₦100');
      const res = await fetch(`${API_BASE}/wallet.topup`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ amount: amt }),
      });
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['wallet.balance'] }); setTopupAmount(''); Alert.alert('Success', 'Wallet topped up'); },
    onError: (e: any) => Alert.alert('Error', e.message),
  });

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const formatCurrency = (n: number) => '₦' + (n || 0).toLocaleString('en-NG');

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Digital Wallet</Text>

      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Available Balance</Text>
        <Text style={styles.balanceAmount}>{formatCurrency(wallet?.balance || 0)}</Text>
        <Text style={styles.currency}>{wallet?.currency || 'NGN'}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Top Up Wallet</Text>
        <TextInput style={styles.input} placeholder="Amount (₦)" keyboardType="number-pad" value={topupAmount} onChangeText={setTopupAmount} accessibilityLabel="Top-up amount" />
        <View style={styles.quickAmounts}>
          {[1000, 5000, 10000, 50000].map((amt) => (
            <TouchableOpacity key={amt} style={styles.quickBtn} onPress={() => setTopupAmount(String(amt))}>
              <Text style={styles.quickText}>₦{amt.toLocaleString()}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity style={styles.button} onPress={() => topup.mutate()} disabled={topup.isPending}>
          <Text style={styles.buttonText}>{topup.isPending ? 'Processing...' : 'Top Up'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Recent Transactions</Text>
        {Array.isArray(transactions) && transactions.length > 0 ? transactions.slice(0, 10).map((tx: any, i: number) => (
          <View key={tx.id || i} style={styles.txRow}>
            <View>
              <Text style={styles.txNarration}>{tx.narration || tx.type}</Text>
              <Text style={styles.txDate}>{tx.createdAt ? new Date(tx.createdAt).toLocaleDateString('en-NG') : ''}</Text>
            </View>
            <Text style={[styles.txAmount, { color: tx.type === 'credit' ? '#10b981' : '#ef4444' }]}>
              {tx.type === 'credit' ? '+' : '-'}{formatCurrency(tx.amount)}
            </Text>
          </View>
        )) : <Text style={styles.empty}>No transactions yet</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  balanceCard: { backgroundColor: '#2563eb', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 20 },
  balanceLabel: { color: '#93c5fd', fontSize: 14, marginBottom: 4 },
  balanceAmount: { color: '#fff', fontSize: 36, fontWeight: '700' },
  currency: { color: '#93c5fd', fontSize: 13, marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b', marginBottom: 12 },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 18, marginBottom: 12 },
  quickAmounts: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  quickBtn: { backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  quickText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  button: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  txNarration: { fontSize: 14, color: '#1e293b', fontWeight: '500' },
  txDate: { fontSize: 11, color: '#94a3b8', marginTop: 2 },
  txAmount: { fontSize: 15, fontWeight: '600' },
  empty: { fontSize: 14, color: '#94a3b8', textAlign: 'center', paddingVertical: 20 },
});
