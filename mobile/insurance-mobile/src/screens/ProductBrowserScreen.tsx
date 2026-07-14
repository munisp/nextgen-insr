import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../store/authStore';
import { useOfflineSync } from '../services/offlineSync';

const API_BASE = 'http://localhost:3000/api/trpc';

export function ProductBrowserScreen({ navigation }: { navigation: any }) {
  const { token } = useAuth();
  const { getCachedData, setCachedData } = useOfflineSync();
  const [refreshing, setRefreshing] = React.useState(false);
  const [selectedCategory, setSelectedCategory] = React.useState<string | null>(null);

  const { data: products, isLoading, refetch } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/products.list`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        const data = json?.result?.data || json || [];
        await setCachedData('products', data, 3600000);
        return Array.isArray(data) ? data : [];
      } catch {
        return (await getCachedData('products')) || [];
      }
    },
  });

  const categories = React.useMemo(() => {
    if (!products) return [];
    const cats = [...new Set(products.map((p: any) => p.category))];
    return cats.sort();
  }, [products]);

  const filteredProducts = selectedCategory ? products?.filter((p: any) => p.category === selectedCategory) : products;

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };
  const formatCurrency = (n: number) => '₦' + (n || 0).toLocaleString('en-NG');

  const categoryColors: Record<string, string> = {
    Motor: '#3b82f6', Health: '#10b981', Life: '#8b5cf6', Property: '#f59e0b',
    Travel: '#06b6d4', Business: '#ec4899', Agriculture: '#84cc16', Marine: '#6366f1',
  };

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Insurance Products</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.categories}>
        <TouchableOpacity style={[styles.catBtn, !selectedCategory && styles.catActive]} onPress={() => setSelectedCategory(null)}>
          <Text style={[styles.catText, !selectedCategory && styles.catTextActive]}>All</Text>
        </TouchableOpacity>
        {categories.map((cat: string) => (
          <TouchableOpacity key={cat} style={[styles.catBtn, selectedCategory === cat && styles.catActive]} onPress={() => setSelectedCategory(cat)}>
            <Text style={[styles.catText, selectedCategory === cat && styles.catTextActive]}>{cat}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {isLoading ? (
        <View style={styles.card}><Text style={styles.empty}>Loading products...</Text></View>
      ) : (
        filteredProducts?.map((product: any) => (
          <View key={product.id} style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={[styles.catDot, { backgroundColor: categoryColors[product.category] || '#6b7280' }]} />
              <Text style={styles.productName}>{product.name}</Text>
            </View>
            <Text style={styles.description} numberOfLines={2}>{product.description}</Text>
            <View style={styles.priceRow}>
              <View>
                <Text style={styles.priceLabel}>Premium from</Text>
                <Text style={styles.price}>{formatCurrency(product.minPremium)}</Text>
              </View>
              <View>
                <Text style={styles.priceLabel}>Coverage up to</Text>
                <Text style={styles.coverage}>{formatCurrency(product.coverageLimit)}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.button} accessibilityLabel={`Get quote for ${product.name}`}>
              <Text style={styles.buttonText}>Get Quote</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  categories: { marginBottom: 16 },
  catBtn: { backgroundColor: '#f1f5f9', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 8 },
  catActive: { backgroundColor: '#2563eb' },
  catText: { fontSize: 13, color: '#475569', fontWeight: '600' },
  catTextActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  catDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  productName: { fontSize: 16, fontWeight: '600', color: '#1e293b', flex: 1 },
  description: { fontSize: 13, color: '#64748b', marginBottom: 12 },
  priceRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  priceLabel: { fontSize: 11, color: '#94a3b8' },
  price: { fontSize: 18, fontWeight: '700', color: '#2563eb' },
  coverage: { fontSize: 16, fontWeight: '600', color: '#10b981', textAlign: 'right' },
  button: { backgroundColor: '#2563eb', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  empty: { fontSize: 14, color: '#94a3b8', textAlign: 'center', paddingVertical: 20 },
});
