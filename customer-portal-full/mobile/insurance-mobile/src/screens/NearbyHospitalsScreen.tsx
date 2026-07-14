import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ActivityIndicator, Linking, Platform } from 'react-native';
import { api } from '../services/api';

interface Hospital {
  id: number;
  name: string;
  address: string;
  phone: string;
  distance?: string;
  specialties: string[];
  inNetwork: boolean;
}

export default function NearbyHospitalsScreen() {
  const [hospitals, setHospitals] = useState<Hospital[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadHospitals(); }, []);

  async function loadHospitals() {
    try {
      const data = await api.query('healthProviders.nearby');
      setHospitals(Array.isArray(data) ? data : []);
    } catch {} finally { setLoading(false); }
  }

  function callHospital(phone: string) {
    Linking.openURL(`tel:${phone}`);
  }

  function openMap(address: string) {
    const url = Platform.OS === 'ios'
      ? `maps:?q=${encodeURIComponent(address)}`
      : `geo:0,0?q=${encodeURIComponent(address)}`;
    Linking.openURL(url);
  }

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#2563eb" /></View>;

  return (
    <View style={s.container}>
      <Text style={s.title}>Nearby Hospitals</Text>
      <Text style={s.subtitle}>In-network healthcare providers</Text>
      <FlatList
        data={hospitals}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.name}>{item.name}</Text>
              {item.inNetwork && <Text style={s.networkBadge}>In-Network</Text>}
            </View>
            <Text style={s.address}>{item.address}</Text>
            {item.distance && <Text style={s.distance}>{item.distance} away</Text>}
            <View style={s.actionRow}>
              <TouchableOpacity style={s.actionBtn} onPress={() => callHospital(item.phone)}>
                <Text style={s.actionBtnText}>Call</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.actionBtn, s.actionBtnSecondary]} onPress={() => openMap(item.address)}>
                <Text style={[s.actionBtnText, s.actionBtnTextSecondary]}>Directions</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No hospitals found nearby</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b' },
  subtitle: { fontSize: 15, color: '#64748b', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700', color: '#1e293b', flex: 1 },
  networkBadge: { fontSize: 11, fontWeight: '700', color: '#166534', backgroundColor: '#dcfce7', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  address: { fontSize: 14, color: '#475569', marginTop: 4 },
  distance: { fontSize: 13, color: '#2563eb', fontWeight: '600', marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionBtn: { flex: 1, backgroundColor: '#2563eb', borderRadius: 8, padding: 10, alignItems: 'center' },
  actionBtnSecondary: { backgroundColor: '#f1f5f9' },
  actionBtnText: { color: '#fff', fontWeight: '600' },
  actionBtnTextSecondary: { color: '#2563eb' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 16 },
});
