/**
 * TelematicsTripsScreen.tsx — Q-wave Q6 (2026-09-25)
 * Self-contained telematics screen: driving score + trip history read from
 * the backend (telematicsScore.* — Q3, forward-looking; feature-detected).
 * Trip data recorded on-device syncs via the backend ingestion endpoint —
 * this screen only READS; there is no local trip fabrication and no
 * dependency on the (missing) offlineSync service.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { telematicsApi, DrivingScoreResult, TripItem } from '../services/innovation';

function scoreColor(score: number): string {
  if (score >= 80) return '#15803d';
  if (score >= 60) return '#b45309';
  return '#b91c1c';
}

export default function TelematicsTripsScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // null score/trips (after a successful call) = backend not deployed yet.
  const [score, setScore] = useState<DrivingScoreResult | null | undefined>(undefined);
  const [trips, setTrips] = useState<TripItem[] | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [scoreResult, tripsResult] = await Promise.all([
        telematicsApi.myScore(),
        telematicsApi.myTrips({ limit: 30 }),
      ]);
      setScore(scoreResult);
      setTrips(tripsResult?.trips ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load telematics data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#b45309" />
        <Text style={s.muted}>Loading driving data…</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={s.center}>
        <Text style={s.errorText}>{error}</Text>
        <Text style={s.retryHint} onPress={() => { setLoading(true); load(); }}>
          Tap to retry
        </Text>
      </View>
    );
  }

  // Disclosed not-yet-available state (feature-detected absent backend).
  if (score === null && trips === null) {
    return (
      <View style={s.center}>
        <Text style={s.title}>Driving Score &amp; Trips</Text>
        <Text style={s.muted}>
          Telematics isn’t available on this deployment yet. Nothing here is
          simulated — this screen activates automatically once the service is
          live for your account.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={s.container}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); load(); }}
        />
      }
    >
      <Text style={s.title}>Driving Score &amp; Trips</Text>

      <View style={s.scoreCard}>
        {score ? (
          <>
            <Text style={[s.scoreNumber, { color: scoreColor(score.score) }]}>
              {score.score}
            </Text>
            <Text style={s.scoreMax}>/100 · {score.tripsScored} trips scored</Text>
            <Text style={s.muted}>
              {score.ratingFactorApplied
                ? 'Applied to your motor premium'
                : 'Not yet applied to pricing'}
            </Text>
          </>
        ) : (
          <Text style={s.muted}>
            No driving score yet — scores appear after the app uploads scored trips.
          </Text>
        )}
      </View>

      <Text style={s.sectionTitle}>Recent trips</Text>
      {!trips || trips.length === 0 ? (
        <View style={s.card}>
          <Text style={s.muted}>No trips recorded yet.</Text>
        </View>
      ) : (
        trips.map((t) => (
          <View key={t.id} style={s.tripRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.tripDate}>{new Date(t.startedAt).toLocaleString()}</Text>
              <Text style={s.muted}>
                {t.distanceKm.toFixed(1)} km · braking {t.events.harshBraking} · accel{' '}
                {t.events.harshAcceleration} · speeding {t.events.speeding}
              </Text>
            </View>
            <Text
              style={[
                s.tripScore,
                { color: t.score == null ? '#a8a29e' : scoreColor(t.score) },
              ]}
            >
              {t.score == null ? '—' : t.score}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fafaf9', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#fafaf9' },
  title: { fontSize: 24, fontWeight: '700', color: '#1c1917', marginBottom: 16 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#1c1917', marginTop: 8, marginBottom: 8 },
  muted: { fontSize: 13, color: '#78716c', textAlign: 'center', marginTop: 6 },
  errorText: { fontSize: 14, color: '#b91c1c', textAlign: 'center' },
  retryHint: { fontSize: 14, color: '#b45309', marginTop: 12, fontWeight: '600' },
  scoreCard: { backgroundColor: '#fff', borderRadius: 16, padding: 28, alignItems: 'center', marginBottom: 16, borderWidth: 1, borderColor: '#e7e5e4' },
  scoreNumber: { fontSize: 48, fontWeight: '800' },
  scoreMax: { fontSize: 13, color: '#78716c', marginTop: 4 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e7e5e4' },
  tripRow: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e7e5e4', flexDirection: 'row', alignItems: 'center' },
  tripDate: { fontSize: 14, fontWeight: '600', color: '#1c1917' },
  tripScore: { fontSize: 20, fontWeight: '800', marginLeft: 12 },
});
