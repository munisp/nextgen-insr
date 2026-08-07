/**
 * WellnessScreen.tsx
 * Health & Wellness rewards dashboard for mobile.
 * Shows wellness score, wearable data, reward points, and premium discounts.
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
  TextInput,
  Alert,
} from "react-native";

interface WellnessSummary {
  score: number;
  readings: number;
  totalRewardPoints: number;
  premiumDiscountPct: number;
  latestReading?: {
    steps?: number;
    activeMinutes?: number;
    sleepHours?: string;
    heartRateAvg?: number;
    wellnessScore?: string;
    readingDate?: string;
  };
}

const WellnessScreen: React.FC = () => {
  const [summary, setSummary] = useState<WellnessSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualData, setManualData] = useState({
    steps: "",
    activeMinutes: "",
    sleepHours: "",
    heartRateAvg: "",
    bmi: "",
  });

  const fetchData = async () => {
    try {
      const res = await fetch("/api/trpc/healthWearables.getWellnessSummary?input=" +
        encodeURIComponent(JSON.stringify({ periodDays: 30 })));
      if (res.ok) {
        const data = await res.json();
        setSummary(data.result?.data ?? null);
      }
    } catch (err) {
      console.error("Failed to fetch wellness data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const submitManualReading = async () => {
    try {
      const res = await fetch("/api/trpc/healthWearables.ingestReading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceType: "manual",
          readingDate: new Date().toISOString().split("T")[0],
          steps: manualData.steps ? parseInt(manualData.steps) : undefined,
          activeMinutes: manualData.activeMinutes ? parseInt(manualData.activeMinutes) : undefined,
          sleepHours: manualData.sleepHours ? parseFloat(manualData.sleepHours) : undefined,
          heartRateAvg: manualData.heartRateAvg ? parseInt(manualData.heartRateAvg) : undefined,
          bmi: manualData.bmi ? parseFloat(manualData.bmi) : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const result = data.result?.data;
        Alert.alert(
          "Reading Submitted",
          `Wellness score: ${result?.wellnessScore}/100\nReward points earned: ${result?.rewardPoints}`,
          [{ text: "OK" }]
        );
        setShowManualEntry(false);
        setManualData({ steps: "", activeMinutes: "", sleepHours: "", heartRateAvg: "", bmi: "" });
        fetchData();
      }
    } catch (err) {
      Alert.alert("Error", "Failed to submit reading. Please try again.");
    }
  };

  const getScoreColor = (score: number) => score >= 80 ? "#22c55e" : score >= 60 ? "#f59e0b" : "#ef4444";

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#22c55e" />
        <Text style={styles.loadingText}>Loading wellness data...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} />}
    >
      {/* Wellness Score Card */}
      <View style={styles.scoreCard}>
        <Text style={styles.cardTitle}>Wellness Score</Text>
        <View style={[styles.scoreCircle, { borderColor: getScoreColor(summary?.score ?? 0) }]}>
          <Text style={[styles.scoreNumber, { color: getScoreColor(summary?.score ?? 0) }]}>
            {summary?.score ?? "--"}
          </Text>
          <Text style={styles.scoreMax}>/100</Text>
        </View>
        <View style={styles.rewardRow}>
          <View style={styles.rewardBadge}>
            <Text style={styles.rewardPoints}>{summary?.totalRewardPoints ?? 0}</Text>
            <Text style={styles.rewardLabel}>Reward Points</Text>
          </View>
          {(summary?.premiumDiscountPct ?? 0) > 0 && (
            <View style={[styles.rewardBadge, { backgroundColor: "#dcfce7" }]}>
              <Text style={[styles.rewardPoints, { color: "#16a34a" }]}>{summary?.premiumDiscountPct}%</Text>
              <Text style={[styles.rewardLabel, { color: "#16a34a" }]}>Premium Discount</Text>
            </View>
          )}
        </View>
      </View>

      {/* Latest Reading */}
      {summary?.latestReading && (
        <View style={styles.readingCard}>
          <Text style={styles.sectionTitle}>Latest Reading ({summary.latestReading.readingDate})</Text>
          <View style={styles.metricsGrid}>
            {summary.latestReading.steps && (
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{summary.latestReading.steps.toLocaleString()}</Text>
                <Text style={styles.metricLabel}>Steps</Text>
              </View>
            )}
            {summary.latestReading.activeMinutes && (
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{summary.latestReading.activeMinutes}</Text>
                <Text style={styles.metricLabel}>Active Min</Text>
              </View>
            )}
            {summary.latestReading.sleepHours && (
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{summary.latestReading.sleepHours}h</Text>
                <Text style={styles.metricLabel}>Sleep</Text>
              </View>
            )}
            {summary.latestReading.heartRateAvg && (
              <View style={styles.metric}>
                <Text style={styles.metricValue}>{summary.latestReading.heartRateAvg}</Text>
                <Text style={styles.metricLabel}>Heart Rate</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Manual Entry */}
      <TouchableOpacity
        style={styles.addButton}
        onPress={() => setShowManualEntry(!showManualEntry)}
      >
        <Text style={styles.addButtonText}>
          {showManualEntry ? "Cancel" : "+ Log Today's Health Data"}
        </Text>
      </TouchableOpacity>

      {showManualEntry && (
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>Log Health Data</Text>
          {[
            { key: "steps", label: "Steps", placeholder: "e.g. 8500" },
            { key: "activeMinutes", label: "Active Minutes", placeholder: "e.g. 45" },
            { key: "sleepHours", label: "Sleep Hours", placeholder: "e.g. 7.5" },
            { key: "heartRateAvg", label: "Avg Heart Rate (bpm)", placeholder: "e.g. 72" },
            { key: "bmi", label: "BMI", placeholder: "e.g. 22.5" },
          ].map(({ key, label, placeholder }) => (
            <View key={key} style={styles.inputGroup}>
              <Text style={styles.inputLabel}>{label}</Text>
              <TextInput
                style={styles.input}
                placeholder={placeholder}
                keyboardType="numeric"
                value={manualData[key as keyof typeof manualData]}
                onChangeText={(v) => setManualData(prev => ({ ...prev, [key]: v }))}
              />
            </View>
          ))}
          <TouchableOpacity style={styles.submitButton} onPress={submitManualReading}>
            <Text style={styles.submitButtonText}>Submit Reading</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Tips */}
      <View style={styles.tipsCard}>
        <Text style={styles.tipsTitle}>How to Earn More Rewards</Text>
        <Text style={styles.tip}>• Walk 10,000+ steps daily (+15 points)</Text>
        <Text style={styles.tip}>• Get 30+ active minutes daily (+10 points)</Text>
        <Text style={styles.tip}>• Sleep 7-9 hours nightly (+10 points)</Text>
        <Text style={styles.tip}>• Maintain healthy BMI 18.5-24.9 (+15 points)</Text>
        <Text style={styles.tip}>• Score 80+ for 15% premium discount</Text>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0fdf4", padding: 16 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 8, color: "#6b7280" },
  scoreCard: { backgroundColor: "#fff", borderRadius: 16, padding: 24, alignItems: "center", marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: "600", color: "#374151", marginBottom: 16 },
  scoreCircle: { width: 120, height: 120, borderRadius: 60, borderWidth: 8, alignItems: "center", justifyContent: "center", marginBottom: 16 },
  scoreNumber: { fontSize: 36, fontWeight: "800" },
  scoreMax: { fontSize: 14, color: "#9ca3af" },
  rewardRow: { flexDirection: "row", gap: 12 },
  rewardBadge: { backgroundColor: "#fef3c7", borderRadius: 12, padding: 12, alignItems: "center", minWidth: 100 },
  rewardPoints: { fontSize: 20, fontWeight: "800", color: "#d97706" },
  rewardLabel: { fontSize: 11, color: "#d97706", marginTop: 2 },
  readingCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: "#374151", marginBottom: 12 },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  metric: { flex: 1, minWidth: "40%", backgroundColor: "#f9fafb", borderRadius: 8, padding: 12, alignItems: "center" },
  metricValue: { fontSize: 20, fontWeight: "700", color: "#1f2937" },
  metricLabel: { fontSize: 11, color: "#6b7280", marginTop: 2 },
  addButton: { backgroundColor: "#22c55e", borderRadius: 12, padding: 16, alignItems: "center", marginBottom: 16 },
  addButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  formCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: "#000", shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  formTitle: { fontSize: 16, fontWeight: "700", color: "#374151", marginBottom: 16 },
  inputGroup: { marginBottom: 12 },
  inputLabel: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 4 },
  input: { borderWidth: 1, borderColor: "#e5e7eb", borderRadius: 8, padding: 12, fontSize: 14, color: "#1f2937" },
  submitButton: { backgroundColor: "#22c55e", borderRadius: 8, padding: 14, alignItems: "center", marginTop: 8 },
  submitButtonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  tipsCard: { backgroundColor: "#f0fdf4", borderRadius: 12, padding: 16, marginBottom: 16 },
  tipsTitle: { fontSize: 14, fontWeight: "700", color: "#16a34a", marginBottom: 8 },
  tip: { fontSize: 13, color: "#374151", marginBottom: 4 },
});

export default WellnessScreen;
