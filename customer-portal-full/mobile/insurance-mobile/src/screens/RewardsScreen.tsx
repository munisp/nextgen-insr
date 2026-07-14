import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { api } from '../services/api';

interface Reward {
  id: number;
  title: string;
  description: string;
  pointsCost: number;
  category: string;
  available: boolean;
}

export default function RewardsScreen() {
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [points, setPoints] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadRewards(); }, []);

  async function loadRewards() {
    try {
      const data = await api.query('loyalty.rewards');
      const list = Array.isArray(data) ? data : data?.rewards || [];
      setRewards(list);
      setPoints(data?.totalPoints || data?.points || 0);
    } catch {} finally { setLoading(false); }
  }

  async function redeemReward(reward: Reward) {
    if (points < reward.pointsCost) {
      Alert.alert('Insufficient Points', `You need ${reward.pointsCost - points} more points.`);
      return;
    }
    Alert.alert('Redeem Reward', `Redeem "${reward.title}" for ${reward.pointsCost} points?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Redeem', onPress: async () => {
        try {
          await api.mutate('loyalty.redeem', { rewardId: reward.id });
          Alert.alert('Success', 'Reward redeemed!');
          loadRewards();
        } catch { Alert.alert('Error', 'Redemption failed'); }
      }},
    ]);
  }

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#2563eb" /></View>;

  return (
    <View style={s.container}>
      <View style={s.pointsCard}>
        <Text style={s.pointsLabel}>Your Points</Text>
        <Text style={s.pointsValue}>{points.toLocaleString()}</Text>
      </View>

      <Text style={s.sectionTitle}>Available Rewards</Text>
      <FlatList
        data={rewards}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={s.card}>
            <Text style={s.rewardTitle}>{item.title}</Text>
            <Text style={s.rewardDesc}>{item.description}</Text>
            <View style={s.row}>
              <Text style={s.cost}>{item.pointsCost} pts</Text>
              <TouchableOpacity style={[s.redeemBtn, !item.available && s.redeemBtnDisabled]} onPress={() => redeemReward(item)} disabled={!item.available}>
                <Text style={s.redeemBtnText}>{item.available ? 'Redeem' : 'Unavailable'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No rewards available</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pointsCard: { backgroundColor: '#2563eb', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 24 },
  pointsLabel: { fontSize: 14, color: '#bfdbfe', fontWeight: '600' },
  pointsValue: { fontSize: 40, fontWeight: '800', color: '#fff' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  rewardTitle: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  rewardDesc: { fontSize: 14, color: '#64748b', marginTop: 4, marginBottom: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cost: { fontSize: 16, fontWeight: '700', color: '#f59e0b' },
  redeemBtn: { backgroundColor: '#22c55e', paddingHorizontal: 20, paddingVertical: 8, borderRadius: 8 },
  redeemBtnDisabled: { backgroundColor: '#e2e8f0' },
  redeemBtnText: { color: '#fff', fontWeight: '700' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 16 },
});
