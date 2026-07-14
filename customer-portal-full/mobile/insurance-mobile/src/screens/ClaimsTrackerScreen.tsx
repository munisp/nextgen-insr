import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../services/api';

interface ClaimStep {
  status: string;
  date: string;
  label: string;
  completed: boolean;
}

interface TrackedClaim {
  id: number;
  claimNumber: string;
  amount: number;
  status: string;
  timeline: ClaimStep[];
}

export default function ClaimsTrackerScreen() {
  const [claims, setClaims] = useState<TrackedClaim[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadClaims();
  }, []);

  async function loadClaims() {
    try {
      const data = await api.query('claims.list');
      const claimsList = Array.isArray(data) ? data : [];
      const tracked = claimsList.map((c: any) => ({
        ...c,
        timeline: buildTimeline(c.status),
      }));
      setClaims(tracked);
    } catch {} finally { setLoading(false); }
  }

  function buildTimeline(status: string): ClaimStep[] {
    const steps = ['Submitted', 'Under Review', 'Approved', 'Paid'];
    const idx = steps.indexOf(status);
    return steps.map((s, i) => ({
      status: s,
      label: s,
      date: i <= idx ? new Date().toISOString() : '',
      completed: i <= idx,
    }));
  }

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#2563eb" /></View>;

  return (
    <View style={s.container}>
      <Text style={s.title}>Claims Tracker</Text>
      <FlatList
        data={claims}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.header}>
              <Text style={s.claimNum}>{item.claimNumber}</Text>
              <Text style={s.amount}>₦{Number(item.amount).toLocaleString()}</Text>
            </View>
            <View style={s.timelineRow}>
              {item.timeline.map((step, i) => (
                <View key={i} style={s.stepCol}>
                  <View style={[s.dot, step.completed ? s.dotActive : s.dotInactive]} />
                  {i < item.timeline.length - 1 && <View style={[s.line, step.completed ? s.lineActive : s.lineInactive]} />}
                  <Text style={[s.stepLabel, step.completed && s.stepLabelActive]}>{step.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No active claims to track</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  claimNum: { fontSize: 16, fontWeight: '700', color: '#1e293b' },
  amount: { fontSize: 16, fontWeight: '600', color: '#2563eb' },
  timelineRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stepCol: { alignItems: 'center', flex: 1 },
  dot: { width: 16, height: 16, borderRadius: 8, marginBottom: 4 },
  dotActive: { backgroundColor: '#22c55e' },
  dotInactive: { backgroundColor: '#e2e8f0' },
  line: { width: '100%', height: 2, position: 'absolute', top: 7, left: '50%' },
  lineActive: { backgroundColor: '#22c55e' },
  lineInactive: { backgroundColor: '#e2e8f0' },
  stepLabel: { fontSize: 10, color: '#94a3b8', textAlign: 'center' },
  stepLabelActive: { color: '#22c55e', fontWeight: '600' },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 16 },
});
