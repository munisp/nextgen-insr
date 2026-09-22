import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { policyApi } from '../services/api';
import { useOfflineSync } from '../services/offlineSync';

interface Policy {
  id: string;
  policyNumber: string;
  type: string;
  provider: string;
  status: 'active' | 'expired' | 'pending' | 'cancelled';
  premiumAmount: number;
  startDate: string;
  endDate: string;
  coverageAmount: number;
}

// 2026-09-19 (P-wave): hoisted — was recreated on every render.
const STATUS_COLOR: Record<string, string> = { active: '#16a34a', expired: '#dc2626', pending: '#eab308', cancelled: '#64748b' };

// Memoized row: a keystroke in search no longer re-renders every card.
const PolicyCard = React.memo(function PolicyCard({ item, onPress }: { item: Policy; onPress: (id: string) => void }) {
  const handlePress = useCallback(() => onPress(item.id), [onPress, item.id]);
  return (
    <TouchableOpacity style={styles.policyCard} onPress={handlePress}>
      <View style={styles.policyHeader}>
        <Text style={styles.policyType}>{item.type}</Text>
        <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[item.status] + '20' }]}>
          <Text style={[styles.statusText, { color: STATUS_COLOR[item.status] }]}>{item.status}</Text>
        </View>
      </View>
      <Text style={styles.policyNumber}>{item.policyNumber}</Text>
      <Text style={styles.provider}>{item.provider}</Text>
      <View style={styles.policyFooter}>
        <Text style={styles.premium}>₦{item.premiumAmount?.toLocaleString()}/yr</Text>
        <Text style={styles.coverage}>Coverage: ₦{(item.coverageAmount / 1_000_000).toFixed(1)}M</Text>
      </View>
      <Text style={styles.dates}>{new Date(item.startDate).toLocaleDateString()} — {new Date(item.endDate).toLocaleDateString()}</Text>
    </TouchableOpacity>
  );
});

const keyExtractor = (item: Policy) => item.id;

export function PoliciesScreen({ navigation }: { navigation: any }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<string>('all');
  const { getCachedData, setCachedData } = useOfflineSync();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['policies'],
    queryFn: async () => {
      try {
        const res = await policyApi.list();
        await setCachedData('policies', res.data, 60 * 60 * 1000);
        return res.data;
      } catch {
        return await getCachedData<{ policies: Policy[] }>('policies') || { policies: [] };
      }
    },
  });

  const policies: Policy[] = useMemo(() => data?.policies || [], [data]);

  // 2026-09-19 (P-wave): filter memoized — was recomputed on every render.
  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return policies.filter((p) => {
      if (filter !== 'all' && p.status !== filter) return false;
      if (q && !p.policyNumber.toLowerCase().includes(q) && !p.type.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [policies, filter, search]);

  const handleCardPress = useCallback((id: string) => {
    navigation.navigate('PolicyDetail', { policyId: id });
  }, [navigation]);

  const renderItem = useCallback(({ item }: { item: Policy }) => (
    <PolicyCard item={item} onPress={handleCardPress} />
  ), [handleCardPress]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>My Policies</Text>
        <Text style={styles.count}>{policies.length} total</Text>
      </View>

      <TextInput style={styles.searchBar} placeholder="Search policies..." value={search} onChangeText={setSearch} placeholderTextColor="#94a3b8" />

      <View style={styles.filterRow}>
        {['all', 'active', 'expired', 'pending'].map((f) => (
          <TouchableOpacity key={f} style={[styles.filterChip, filter === f && styles.filterActive]} onPress={() => setFilter(f)}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        initialNumToRender={10}
        maxToRenderPerBatch={10}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={<Text style={styles.empty}>{isLoading ? 'Loading...' : 'No policies found'}</Text>}
        contentContainerStyle={{ paddingBottom: 20 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  count: { fontSize: 14, color: '#64748b' },
  searchBar: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  filterRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: '#f1f5f9' },
  filterActive: { backgroundColor: '#2563eb' },
  filterText: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  filterTextActive: { color: '#fff' },
  policyCard: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 12, borderRadius: 12, padding: 16, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  policyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  policyType: { fontSize: 16, fontWeight: '600', color: '#0f172a' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  policyNumber: { fontSize: 13, color: '#64748b', fontFamily: 'monospace' },
  provider: { fontSize: 13, color: '#94a3b8', marginTop: 2 },
  policyFooter: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  premium: { fontSize: 14, fontWeight: '600', color: '#2563eb' },
  coverage: { fontSize: 13, color: '#64748b' },
  dates: { fontSize: 11, color: '#94a3b8', marginTop: 8 },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 40, fontSize: 14 },
});
