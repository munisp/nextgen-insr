import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../services/api';

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
}

export default function CommunicationScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'all' | 'unread'>('all');

  useEffect(() => { loadNotifications(); }, []);

  async function loadNotifications() {
    try {
      const data = await api.query('communication.inbox');
      setNotifications(Array.isArray(data) ? data : []);
    } catch {} finally { setLoading(false); }
  }

  const filtered = tab === 'unread' ? notifications.filter((n) => !n.read) : notifications;

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#2563eb" /></View>;

  return (
    <View style={s.container}>
      <Text style={s.title}>Messages & Notifications</Text>
      <View style={s.tabRow}>
        <TouchableOpacity style={[s.tab, tab === 'all' && s.tabActive]} onPress={() => setTab('all')}>
          <Text style={[s.tabText, tab === 'all' && s.tabTextActive]}>All ({notifications.length})</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.tab, tab === 'unread' && s.tabActive]} onPress={() => setTab('unread')}>
          <Text style={[s.tabText, tab === 'unread' && s.tabTextActive]}>Unread ({notifications.filter(n => !n.read).length})</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={[s.card, !item.read && s.cardUnread]}>
            <View style={s.row}>
              <Text style={s.notifTitle}>{item.title}</Text>
              <Text style={s.time}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
            <Text style={s.message} numberOfLines={2}>{item.message}</Text>
            <Text style={s.typeBadge}>{item.type}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No messages</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  tabRow: { flexDirection: 'row', marginBottom: 16, gap: 8 },
  tab: { flex: 1, padding: 10, borderRadius: 8, backgroundColor: '#f1f5f9', alignItems: 'center' },
  tabActive: { backgroundColor: '#2563eb' },
  tabText: { fontWeight: '600', color: '#64748b' },
  tabTextActive: { color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: '#e2e8f0' },
  cardUnread: { borderLeftColor: '#2563eb', backgroundColor: '#f0f9ff' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  notifTitle: { fontSize: 15, fontWeight: '600', color: '#1e293b', flex: 1 },
  time: { fontSize: 12, color: '#94a3b8' },
  message: { fontSize: 14, color: '#475569', lineHeight: 20 },
  typeBadge: { marginTop: 6, fontSize: 11, color: '#2563eb', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 16 },
});
