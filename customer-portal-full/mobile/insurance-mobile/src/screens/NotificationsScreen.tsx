import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { api } from '../services/api';

interface Notification {
  id: number;
  title: string;
  message: string;
  type: string;
  read: boolean;
  createdAt: string;
}

export default function NotificationsScreen() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchNotifications = async () => {
    try {
      const data = await api.query('notifications.list');
      setNotifications(Array.isArray(data) ? data : []);
    } catch { setNotifications([]); }
  };

  useEffect(() => { fetchNotifications(); }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchNotifications();
    setRefreshing(false);
  };

  const markRead = async (id: number) => {
    await api.mutate('notifications.markRead', { id });
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n));
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'claim': return '📋';
      case 'payment': return '💳';
      case 'policy': return '📄';
      case 'kyc': return '🔐';
      default: return '🔔';
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Notifications</Text>
      <FlatList
        data={notifications}
        keyExtractor={item => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, !item.read && styles.unread]}
            onPress={() => markRead(item.id)}
          >
            <Text style={styles.icon}>{getIcon(item.type)}</Text>
            <View style={styles.content}>
              <Text style={styles.title}>{item.title}</Text>
              <Text style={styles.message}>{item.message}</Text>
              <Text style={styles.time}>{new Date(item.createdAt).toLocaleDateString()}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No notifications</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { fontSize: 24, fontWeight: 'bold', padding: 16, backgroundColor: '#fff' },
  card: { flexDirection: 'row', backgroundColor: '#fff', padding: 16, marginHorizontal: 16, marginTop: 8, borderRadius: 8 },
  unread: { borderLeftWidth: 3, borderLeftColor: '#2563eb' },
  icon: { fontSize: 24, marginRight: 12 },
  content: { flex: 1 },
  title: { fontWeight: '600', fontSize: 16 },
  message: { color: '#666', marginTop: 4 },
  time: { color: '#999', fontSize: 12, marginTop: 4 },
  empty: { textAlign: 'center', padding: 40, color: '#999' },
});
