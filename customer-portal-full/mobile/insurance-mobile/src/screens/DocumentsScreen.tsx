import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { api } from '../services/api';

interface Document {
  id: number;
  name: string;
  type: string;
  uploadDate: string;
  status: string;
  fileSize?: string;
}

export default function DocumentsScreen() {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDocuments();
  }, []);

  async function loadDocuments() {
    try {
      const data = await api.query('documents.list');
      setDocuments(Array.isArray(data) ? data : []);
    } catch {
      Alert.alert('Error', 'Failed to load documents');
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#2563eb" /></View>;

  return (
    <View style={s.container}>
      <Text style={s.title}>My Documents</Text>
      <FlatList
        data={documents}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <TouchableOpacity style={s.card}>
            <View style={s.row}>
              <Text style={s.docName}>{item.name}</Text>
              <Text style={[s.badge, item.status === 'verified' ? s.badgeGreen : s.badgeYellow]}>{item.status}</Text>
            </View>
            <Text style={s.meta}>{item.type} • {new Date(item.uploadDate).toLocaleDateString()}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={<Text style={s.empty}>No documents uploaded yet</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  docName: { fontSize: 16, fontWeight: '600', color: '#1e293b', flex: 1 },
  meta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12, fontSize: 12, overflow: 'hidden' },
  badgeGreen: { backgroundColor: '#dcfce7', color: '#166534' },
  badgeYellow: { backgroundColor: '#fef9c3', color: '#854d0e' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 16 },
});
