import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { api } from '../services/api';

export default function InsuranceScoreScreen() {
  const [score, setScore] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadScore(); }, []);

  async function loadScore() {
    try {
      const data = await api.query('insuranceScore.get');
      setScore(data);
    } catch {} finally { setLoading(false); }
  }

  const getScoreColor = (s: number) => s >= 80 ? '#22c55e' : s >= 60 ? '#f59e0b' : '#ef4444';

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#2563eb" /></View>;

  const scoreValue = score?.overallScore || score?.score || 0;

  return (
    <ScrollView style={s.container}>
      <Text style={s.title}>Insurance Score</Text>

      <View style={s.scoreCard}>
        <View style={[s.scoreCircle, { borderColor: getScoreColor(scoreValue) }]}>
          <Text style={[s.scoreNumber, { color: getScoreColor(scoreValue) }]}>{scoreValue}</Text>
          <Text style={s.scoreMax}>/100</Text>
        </View>
        <Text style={s.scoreLabel}>
          {scoreValue >= 80 ? 'Excellent' : scoreValue >= 60 ? 'Good' : scoreValue >= 40 ? 'Fair' : 'Needs Improvement'}
        </Text>
      </View>

      {score?.factors && (
        <View style={s.factorsCard}>
          <Text style={s.sectionTitle}>Score Factors</Text>
          {Object.entries(score.factors).map(([key, val]: [string, any]) => (
            <View key={key} style={s.factorRow}>
              <Text style={s.factorName}>{key.replace(/([A-Z])/g, ' $1').trim()}</Text>
              <View style={s.barContainer}>
                <View style={[s.bar, { width: `${Math.min(100, Number(val?.score || val || 0))}%`, backgroundColor: getScoreColor(Number(val?.score || val || 0)) }]} />
              </View>
              <Text style={s.factorScore}>{val?.score || val || 0}</Text>
            </View>
          ))}
        </View>
      )}

      <View style={s.tipsCard}>
        <Text style={s.sectionTitle}>How to Improve</Text>
        <Text style={s.tip}>• Pay premiums on time</Text>
        <Text style={s.tip}>• Maintain continuous coverage</Text>
        <Text style={s.tip}>• Bundle multiple policies</Text>
        <Text style={s.tip}>• Complete KYC verification</Text>
        <Text style={s.tip}>• Reduce claim frequency</Text>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  scoreCard: { backgroundColor: '#fff', borderRadius: 16, padding: 32, alignItems: 'center', marginBottom: 16 },
  scoreCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 6, justifyContent: 'center', alignItems: 'center' },
  scoreNumber: { fontSize: 40, fontWeight: '800' },
  scoreMax: { fontSize: 14, color: '#94a3b8' },
  scoreLabel: { marginTop: 12, fontSize: 18, fontWeight: '600', color: '#475569' },
  factorsCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#1e293b', marginBottom: 12 },
  factorRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  factorName: { width: 100, fontSize: 13, color: '#64748b' },
  barContainer: { flex: 1, height: 8, backgroundColor: '#f1f5f9', borderRadius: 4, marginHorizontal: 8, overflow: 'hidden' },
  bar: { height: '100%', borderRadius: 4 },
  factorScore: { width: 30, textAlign: 'right', fontSize: 13, fontWeight: '600', color: '#1e293b' },
  tipsCard: { backgroundColor: '#eff6ff', borderRadius: 12, padding: 16 },
  tip: { fontSize: 14, color: '#1e40af', lineHeight: 24 },
});
