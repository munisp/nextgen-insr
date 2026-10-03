import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { claimsApi } from '../services/api';
import { useOfflineSync } from '../services/offlineSync';

export function ClaimDetailScreen({ route, navigation }: { route: any; navigation: any }) {
  const { claimId } = route.params;
  const { getCachedData, setCachedData } = useOfflineSync();

  const { data: claim } = useQuery({
    queryKey: ['claim', claimId],
    queryFn: async () => {
      try { const res = await claimsApi.getById(claimId); await setCachedData(`claim_${claimId}`, res.data); return res.data; }
      catch { return await getCachedData(`claim_${claimId}`); }
    },
  });

  // 2026-10-01 (W9-B3): no claim-timeline endpoint exists for members (the
  // old call hit a nonexistent BFF route and fell back to a fabricated
  // `{events: []}`). Rendered as an honest unavailable state below.
  const timelineUnavailable = true;

  if (!claim) return <View style={s.center}><Text>Loading...</Text></View>;

  return (
    <ScrollView style={s.container}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={s.back}>← Back</Text></TouchableOpacity>
        {/* 2026-10-01 (W9-B3): field names match the real memberClaims rows
            (claimType/claimedAmount) with legacy-shape tolerance. claimId is
            numeric — String() before slice (was a crash on .slice). */}
        <Text style={s.title}>{claim.claimType ?? claim.type} Claim</Text>
        <Text style={s.claimId}>#{String(claimId).slice(-8)}</Text>
      </View>
      <View style={s.card}>
        {[['Status', claim.status], ['Amount', `₦${(claim.claimedAmount ?? claim.amount)?.toLocaleString()}`], ['Filed', new Date(claim.filedAt ?? claim.createdAt).toLocaleDateString()], ['Policy', claim.policyNumber]].map(([l, v]) => (
          <View key={l} style={s.row}><Text style={s.label}>{l}</Text><Text style={s.value}>{v}</Text></View>
        ))}
      </View>
      <View style={s.card}>
        <Text style={s.cardTitle}>Timeline</Text>
        {timelineUnavailable && (
          <Text style={s.eventDesc}>Status timeline is not available in the app yet. Contact your agent for a detailed claim history.</Text>
        )}
      </View>
      {/* 2026-10-01 (W9-B3): evidence upload has no real endpoint — show an
          honest explanation instead of a button that silently fails. */}
      <TouchableOpacity style={s.evidenceBtn} onPress={() => Alert.alert('Evidence Upload', 'Evidence upload is not available in the app yet — your agent can attach documents to your claim.')}>
        <Text style={s.evidenceBtnText}>Add Evidence</Text>
      </TouchableOpacity>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' }, center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 }, back: { fontSize: 16, color: '#2563eb', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' }, claimId: { fontSize: 13, color: '#94a3b8', fontFamily: 'monospace', marginTop: 4 },
  card: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 16, borderRadius: 12, padding: 16 },
  cardTitle: { fontSize: 16, fontWeight: '600', marginBottom: 12, color: '#0f172a' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  label: { fontSize: 14, color: '#64748b' }, value: { fontSize: 14, fontWeight: '500', color: '#0f172a' },
  timelineItem: { flexDirection: 'row', marginBottom: 16 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2563eb', marginTop: 4, marginRight: 12 },
  eventTitle: { fontSize: 14, fontWeight: '600', color: '#0f172a' }, eventDate: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  eventDesc: { fontSize: 13, color: '#64748b', marginTop: 4 },
  evidenceBtn: { marginHorizontal: 16, backgroundColor: '#eff6ff', paddingVertical: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#2563eb' },
  evidenceBtnText: { color: '#2563eb', fontWeight: '600', fontSize: 14 },
});
