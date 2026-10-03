import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import Geolocation from 'react-native-geolocation-service';
import { agentApi } from '../services/api';

// 2026-10-01 (W9-B3): /api/v1/agents/nearby does NOT exist on the Go BFF
// (404) and agentApi.findNearby now throws an honest error. This screen
// previously swallowed the failure and rendered an empty list as if a real
// search found nobody. Now the failure is shown as unavailable, not "no
// agents found".
export function AgentLocatorScreen({ navigation }: { navigation: any }) {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    Geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await agentApi.findNearby(pos.coords.latitude, pos.coords.longitude, 25);
          setAgents((res as any).data.agents || []);
        } catch (e: any) {
          setUnavailable(e?.message || 'Agent lookup is unavailable');
        }
        setLoading(false);
      },
      () => { setUnavailable('Location unavailable — cannot search for nearby agents.'); setLoading(false); },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, []);

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        <Text style={s.title}>Find an Agent</Text>
        <Text style={s.subtitle}>Nearest insurance agents to you</Text>
      </View>
      {unavailable ? (
        <View style={s.card}><Text style={s.empty}>{unavailable}</Text></View>
      ) : (
        <FlatList data={agents} keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <View style={s.card}>
              <Text style={s.agentName}>{item.name}</Text>
              <Text style={s.agentSpecialty}>{item.specialty}</Text>
              <Text style={s.agentDistance}>{item.distance?.toFixed(1)} km away</Text>
              <Text style={s.agentPhone}>{item.phone}</Text>
              <TouchableOpacity style={s.callBtn}><Text style={s.callBtnText}>Call Agent</Text></TouchableOpacity>
            </View>
          )}
          ListEmptyComponent={<Text style={s.empty}>{loading ? 'Finding nearby agents...' : 'No agents found nearby'}</Text>}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 }, back: { fontSize: 16, color: '#2563eb', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' }, subtitle: { fontSize: 14, color: '#64748b', marginTop: 4 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 12, borderRadius: 12, padding: 16 },
  agentName: { fontSize: 16, fontWeight: '600', color: '#0f172a' }, agentSpecialty: { fontSize: 13, color: '#2563eb', marginTop: 4 },
  agentDistance: { fontSize: 13, color: '#64748b', marginTop: 4 }, agentPhone: { fontSize: 14, color: '#334155', marginTop: 4 },
  callBtn: { backgroundColor: '#16a34a', paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 12 },
  callBtnText: { color: '#fff', fontWeight: '600' }, empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 40 },
});
