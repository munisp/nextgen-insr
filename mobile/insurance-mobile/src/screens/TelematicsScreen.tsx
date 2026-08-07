/**
 * TelematicsScreen.tsx
 * UBI (Usage-Based Insurance) telematics dashboard for mobile.
 * Shows driving score, trip history, and premium adjustment.
 */
import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from "react-native";

interface TripEvent {
  id: number;
  eventType: string;
  drivingScore: number;
  distanceKm: number;
  recordedAt: string;
}

interface DrivingScoreData {
  score: number;
  events: number;
  hardBrakes: number;
  speedingEvents: number;
  premiumAdjustmentPct: number;
  recommendation: string;
}

const TelematicsScreen: React.FC = () => {
  const [scoreData, setScoreData] = useState<DrivingScoreData | null>(null);
  const [trips, setTrips] = useState<TripEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tracking, setTracking] = useState(false);

  const fetchData = async () => {
    try {
      // Fetch driving score from tRPC
      const scoreRes = await fetch("/api/trpc/telematics.getDrivingScore?input=" +
        encodeURIComponent(JSON.stringify({ policyId: 1, periodDays: 30 })));
      if (scoreRes.ok) {
        const data = await scoreRes.json();
        setScoreData(data.result?.data ?? null);
      }

      // Fetch trip history
      const historyRes = await fetch("/api/trpc/telematics.getHistory?input=" +
        encodeURIComponent(JSON.stringify({ policyId: 1, limit: 20 })));
      if (historyRes.ok) {
        const data = await historyRes.json();
        setTrips(data.result?.data ?? []);
      }
    } catch (err) {
      console.error("Failed to fetch telematics data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const getScoreColor = (score: number) => {
    if (score >= 85) return "#22c55e";
    if (score >= 70) return "#f59e0b";
    return "#ef4444";
  };

  const getScoreLabel = (score: number) => {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Good";
    if (score >= 55) return "Fair";
    return "Needs Improvement";
  };

  const startTracking = () => {
    setTracking(true);
    Alert.alert(
      "Trip Tracking Started",
      "Your driving is being monitored. Drive safely to earn discounts!",
      [{ text: "OK" }]
    );
  };

  const stopTracking = async () => {
    setTracking(false);
    // Record a simulated trip event
    try {
      await fetch("/api/trpc/telematics.recordEvent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policyId: 1,
          deviceId: "mobile-gps",
          eventType: "trip_end",
          distanceKm: 12.5,
          durationSeconds: 1800,
        }),
      });
      fetchData();
    } catch {}
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#3b82f6" />
        <Text style={styles.loadingText}>Loading telematics data...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}
    >
      {/* Driving Score Card */}
      <View style={styles.scoreCard}>
        <Text style={styles.scoreTitle}>Your Driving Score</Text>
        <View style={[styles.scoreCircle, { borderColor: getScoreColor(scoreData?.score ?? 0) }]}>
          <Text style={[styles.scoreNumber, { color: getScoreColor(scoreData?.score ?? 0) }]}>
            {scoreData?.score ?? "--"}
          </Text>
          <Text style={styles.scoreMax}>/100</Text>
        </View>
        <Text style={[styles.scoreLabel, { color: getScoreColor(scoreData?.score ?? 0) }]}>
          {getScoreLabel(scoreData?.score ?? 0)}
        </Text>

        {/* Premium Adjustment */}
        {scoreData && (
          <View style={[
            styles.adjustmentBadge,
            { backgroundColor: scoreData.premiumAdjustmentPct < 0 ? "#dcfce7" : scoreData.premiumAdjustmentPct > 0 ? "#fee2e2" : "#f3f4f6" }
          ]}>
            <Text style={[
              styles.adjustmentText,
              { color: scoreData.premiumAdjustmentPct < 0 ? "#16a34a" : scoreData.premiumAdjustmentPct > 0 ? "#dc2626" : "#6b7280" }
            ]}>
              {scoreData.premiumAdjustmentPct < 0
                ? `${Math.abs(scoreData.premiumAdjustmentPct)}% Premium Discount`
                : scoreData.premiumAdjustmentPct > 0
                ? `${scoreData.premiumAdjustmentPct}% Premium Loading`
                : "No Premium Change"}
            </Text>
          </View>
        )}
      </View>

      {/* Stats Row */}
      {scoreData && (
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{scoreData.events}</Text>
            <Text style={styles.statLabel}>Total Events</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: "#ef4444" }]}>{scoreData.hardBrakes}</Text>
            <Text style={styles.statLabel}>Hard Brakes</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: "#f59e0b" }]}>{scoreData.speedingEvents}</Text>
            <Text style={styles.statLabel}>Speeding</Text>
          </View>
        </View>
      )}

      {/* Trip Tracking Button */}
      <TouchableOpacity
        style={[styles.trackButton, { backgroundColor: tracking ? "#ef4444" : "#3b82f6" }]}
        onPress={tracking ? stopTracking : startTracking}
      >
        <Text style={styles.trackButtonText}>
          {tracking ? "Stop Trip" : "Start Trip Tracking"}
        </Text>
      </TouchableOpacity>

      {/* Tips */}
      <View style={styles.tipsCard}>
        <Text style={styles.tipsTitle}>Tips to Improve Your Score</Text>
        <Text style={styles.tip}>• Avoid hard braking — leave more following distance</Text>
        <Text style={styles.tip}>• Stay within speed limits, especially at night</Text>
        <Text style={styles.tip}>• Drive during off-peak hours when possible</Text>
        <Text style={styles.tip}>• Score 85+ to earn a 15% premium discount</Text>
      </View>

      {/* Trip History */}
      <Text style={styles.sectionTitle}>Recent Trips</Text>
      {trips.length === 0 ? (
        <Text style={styles.emptyText}>No trips recorded yet. Start tracking to earn discounts.</Text>
      ) : (
        trips.slice(0, 10).map((trip) => (
          <View key={trip.id} style={styles.tripCard}>
            <View style={styles.tripRow}>
              <Text style={styles.tripType}>{trip.eventType.replace("_", " ").toUpperCase()}</Text>
              <Text style={[styles.tripScore, { color: getScoreColor(trip.drivingScore) }]}>
                Score: {trip.drivingScore}/100
              </Text>
            </View>
            <Text style={styles.tripMeta}>
              {trip.distanceKm ? `${trip.distanceKm} km` : ""} •{" "}
              {new Date(trip.recordedAt).toLocaleDateString()}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f8fafc", padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 8, color: "#6b7280" },
  scoreCard: { backgroundColor: "#fff", borderRadius: 16, padding: 24, alignItems: "center", marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  scoreTitle: { fontSize: 16, fontWeight: "600", color: "#374151", marginBottom: 16 },
  scoreCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 8, alignItems: "center", justifyContent: "center", marginBottom: 12 },
  scoreNumber: { fontSize: 36, fontWeight: "800" },
  scoreMax: { fontSize: 14, color: "#9ca3af" },
  scoreLabel: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  adjustmentBadge: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  adjustmentText: { fontSize: 14, fontWeight: "600" },
  statsRow: { flexDirection: "row", gap: 12, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: "#fff", borderRadius: 12, padding: 16, alignItems: "center", shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  statValue: { fontSize: 24, fontWeight: "700", color: "#1f2937" },
  statLabel: { fontSize: 12, color: "#6b7280", marginTop: 4 },
  trackButton: { borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 16 },
  trackButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  tipsCard: { backgroundColor: "#eff6ff", borderRadius: 12, padding: 16, marginBottom: 16 },
  tipsTitle: { fontSize: 14, fontWeight: "700", color: "#1d4ed8", marginBottom: 8 },
  tip: { fontSize: 13, color: "#374151", marginBottom: 4 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: "#1f2937", marginBottom: 12 },
  emptyText: { color: "#9ca3af", textAlign: "center", padding: 24 },
  tripCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 8, shadowColor: "#000", shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  tripRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  tripType: { fontSize: 14, fontWeight: "600", color: "#374151" },
  tripScore: { fontSize: 14, fontWeight: "600" },
  tripMeta: { fontSize: 12, color: "#9ca3af" },
});

export default TelematicsScreen;
