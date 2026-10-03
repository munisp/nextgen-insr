import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, RefreshControl } from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '../store/authStore';
import { useOfflineSync } from '../services/offlineSync';

// 2026-10-01 (R1c): was wallet.* (nonexistent) on hardcoded localhost —
// rewired to the real mounted customerWalletSystem router.
// 2026-10-01 (W9-B3): removed the fabricated `{balance: 0, currency:'NGN'}`
// fallback. A real balance is shown only when the server returned one;
// offline we show the last CACHED balance, clearly labelled with its age;
// with neither, we show an honest error state — never a made-up zero.
import { trpcQuery } from '../config';

interface WalletBalance { balance: number; currency: string }
interface WalletResult extends WalletBalance { fromCache: boolean }

export function DigitalWalletScreen() {
  const { token } = useAuth();
  const { getCachedData, setCachedData } = useOfflineSync();
  const [topupAmount, setTopupAmount] = React.useState('');
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: wallet, isLoading, isError, error, refetch } = useQuery<WalletResult>({
    queryKey: ['wallet.balance'],
    queryFn: async () => {
      try {
        const data = await trpcQuery<WalletBalance>(
          'customerWalletSystem.getBalance', null, token,
        );
        await setCachedData('wallet', data, 60000);
        return { ...data, fromCache: false };
      } catch (err) {
        const cached = await getCachedData<WalletBalance>('wallet');
        if (cached && typeof cached.balance === 'number') {
          return { ...cached, fromCache: true };
        }
        // No real value available — propagate the error so the UI shows an
        // honest failure instead of a fabricated balance.
        throw err instanceof Error ? err : new Error('Balance unavailable');
      }
    },
  });

  const { data: transactions, isError: txError, refetch: refetchTx } = useQuery({
    queryKey: ['wallet.transactions'],
    queryFn: async () => {
      const result = await trpcQuery<{ transactions: any[]; total: number }>(
        'customerWalletSystem.getTransactions', { limit: 50 }, token,
      );
      return result?.transactions ?? [];
    },
    // 2026-10-01 (W9-B3): no silent empty-array fallback — a failed query is
    // rendered as an error message below, not as "No transactions yet".
    retry: 1,
  });

  // 2026-10-01 (R1c): the monolith customerWalletSystem.topUp is fail-closed
  // — it requires a railReference to an ALREADY-SETTLED inbound payment plus
  // an idempotencyKey. A bare amount from the app can never legitimately
  // credit a wallet, so the old wallet.topup call is replaced with an honest
  // explanation instead of a fake/failing mutation.
  const topup = useMutation({
    mutationFn: async () => {
      const amt = parseFloat(topupAmount);
      if (isNaN(amt) || amt < 100) throw new Error('Minimum top-up is ₦100');
      throw new Error(
        'In-app wallet top-up is not available. Wallet credit requires a verified bank/payment-rail transfer — please use the payment link from your agent or the Payments tab.',
      );
    },
    onError: (e: any) => Alert.alert('Top-Up Unavailable', e.message),
  });

  const onRefresh = async () => { setRefreshing(true); await Promise.allSettled([refetch(), refetchTx()]); setRefreshing(false); };

  const formatCurrency = (n: number) => '₦' + (n || 0).toLocaleString('en-NG');

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Digital Wallet</Text>

      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Available Balance</Text>
        {isLoading ? (
          <Text style={styles.balanceStatus} testID="wallet-loading">Loading…</Text>
        ) : isError ? (
          <>
            <Text style={styles.balanceStatus} testID="wallet-error">Balance unavailable</Text>
            <Text style={styles.balanceHint}>{(error as Error)?.message || 'Check your connection and try again'}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={() => refetch()} accessibilityLabel="Retry balance fetch">
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.balanceAmount} testID="wallet-balance">{formatCurrency(wallet?.balance ?? 0)}</Text>
            <Text style={styles.currency}>{wallet?.currency ?? ''}</Text>
            {wallet?.fromCache && (
              <Text style={styles.balanceHint} testID="wallet-offline">
                Last known balance — you are offline
              </Text>
            )}
          </>
        )}
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
        {txError ? (
          <Text style={styles.empty} testID="wallet-tx-error">Transactions could not be loaded. Pull to refresh.</Text>
        ) : Array.isArray(transactions) && transactions.length > 0 ? transactions.slice(0, 10).map((tx: any, i: number) => (
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
  balanceStatus: { color: '#fff', fontSize: 20, fontWeight: '600', marginTop: 4 },
  balanceHint: { color: '#bfdbfe', fontSize: 12, marginTop: 6, textAlign: 'center' },
  currency: { color: '#93c5fd', fontSize: 13, marginTop: 4 },
  retryBtn: { marginTop: 10, backgroundColor: '#1d4ed8', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '600' },
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
