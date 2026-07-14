import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../store/authStore';
import { useOfflineSync } from '../services/offlineSync';

const API_BASE = 'http://localhost:3000/api/trpc';

export function NotificationsScreen() {
  const { token } = useAuth();
  const { getCachedData, setCachedData } = useOfflineSync();
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: notifications, isLoading, refetch } = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE}/dashboard.notifications`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        });
        const json = await res.json();
        const data = json?.result?.data || json || [];
        await setCachedData('notifications', data, 300000);
        return Array.isArray(data) ? data : [];
      } catch {
        return (await getCachedData('notifications')) || [];
      }
    },
  });

  const onRefresh = async () => { setRefreshing(true); await refetch(); setRefreshing(false); };

  const typeColors: Record<string, string> = {
    policy: '#3b82f6', claim: '#f59e0b', payment: '#10b981', kyc: '#8b5cf6', commission: '#ec4899', compliance: '#ef4444', system: '#6b7280',
  };
  const typeIcons: Record<string, string> = {
    policy: '📋', claim: '📄', payment: '💰', kyc: '🔐', commission: '💵', compliance: '⚖️', system: '🔧',
  };

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
      <Text style={styles.title}>Notifications</Text>
      {isLoading ? (
        <View style={styles.card}><Text style={styles.loading}>Loading notifications...</Text></View>
      ) : notifications?.length === 0 ? (
        <View style={styles.card}><Text style={styles.empty}>No notifications</Text></View>
      ) : (
        notifications?.map((n: any) => (
          <TouchableOpacity key={n.id} style={[styles.card, !n.read && styles.unread]} accessibilityLabel={`Notification: ${n.title}`}>
            <View style={styles.row}>
              <Text style={styles.icon}>{typeIcons[n.type] || '📌'}</Text>
              <View style={styles.content}>
                <View style={styles.headerRow}>
                  <Text style={styles.notifTitle}>{n.title}</Text>
                  <View style={[styles.typeBadge, { backgroundColor: typeColors[n.type] || '#6b7280' }]}>
                    <Text style={styles.typeText}>{n.type}</Text>
                  </View>
                </View>
                <Text style={styles.message} numberOfLines={2}>{n.message}</Text>
                <Text style={styles.time}>{n.createdAt ? new Date(n.createdAt).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</Text>
              </View>
            </View>
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  unread: { borderLeftWidth: 4, borderLeftColor: '#2563eb' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  icon: { fontSize: 24, marginRight: 12 },
  content: { flex: 1 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  notifTitle: { fontSize: 15, fontWeight: '600', color: '#1e293b', flex: 1 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginLeft: 8 },
  typeText: { color: '#fff', fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
  message: { fontSize: 13, color: '#64748b', marginBottom: 4 },
  time: { fontSize: 11, color: '#94a3b8' },
  loading: { fontSize: 14, color: '#94a3b8', textAlign: 'center' },
  empty: { fontSize: 14, color: '#94a3b8', textAlign: 'center' },
});
