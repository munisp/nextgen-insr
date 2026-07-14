import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';

interface HealthMetrics {
  daily_steps: number;
  resting_heart_rate: number;
  sleep_hours: number;
  active_minutes: number;
  health_score: number;
  health_tier: string;
  premium_discount: number;
  streak_days: number;
}

interface Challenge {
  id: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unit: string;
  reward_points: number;
  category: string;
}

export default function HealthWellnessScreen() {
  const [metrics, setMetrics] = useState<HealthMetrics>({
    daily_steps: 7850,
    resting_heart_rate: 68,
    sleep_hours: 7.2,
    active_minutes: 35,
    health_score: 75.5,
    health_tier: 'good',
    premium_discount: 20,
    streak_days: 12,
  });

  const [challenges, setChallenges] = useState<Challenge[]>([
    { id: 'WC-001', title: '10K Steps Challenge', description: 'Walk 10,000 steps daily', progress: 7850, target: 10000, unit: 'steps', reward_points: 500, category: 'activity' },
    { id: 'WC-002', title: 'Sleep Champion', description: 'Get 7+ hours of sleep', progress: 4, target: 5, unit: 'nights', reward_points: 300, category: 'sleep' },
    { id: 'WC-003', title: 'Hydration Hero', description: 'Drink 2.5L daily', progress: 1800, target: 2500, unit: 'ml', reward_points: 400, category: 'hydration' },
  ]);

  const getTierColor = (tier: string) => {
    switch (tier) {
      case 'excellent': return '#10b981';
      case 'good': return '#3b82f6';
      case 'average': return '#f59e0b';
      default: return '#ef4444';
    }
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Health & Wellness</Text>
        <Text style={styles.headerSubtitle}>Your health score earns premium discounts</Text>
      </View>

      {/* Health Score Card */}
      <View style={styles.scoreCard}>
        <View style={styles.scoreCircle}>
          <Text style={styles.scoreNumber}>{metrics.health_score}</Text>
          <Text style={styles.scoreLabel}>Health Score</Text>
        </View>
        <View style={styles.scoreDetails}>
          <View style={[styles.tierBadge, { backgroundColor: getTierColor(metrics.health_tier) }]}>
            <Text style={styles.tierText}>{metrics.health_tier.toUpperCase()}</Text>
          </View>
          <Text style={styles.discountText}>-{metrics.premium_discount}% Premium</Text>
          <Text style={styles.streakText}>🔥 {metrics.streak_days} day streak</Text>
        </View>
      </View>

      {/* Metrics Grid */}
      <View style={styles.metricsGrid}>
        <View style={styles.metricCard}>
          <Text style={styles.metricIcon}>👟</Text>
          <Text style={styles.metricValue}>{metrics.daily_steps.toLocaleString()}</Text>
          <Text style={styles.metricLabel}>Steps</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricIcon}>❤️</Text>
          <Text style={styles.metricValue}>{metrics.resting_heart_rate}</Text>
          <Text style={styles.metricLabel}>Heart Rate</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricIcon}>😴</Text>
          <Text style={styles.metricValue}>{metrics.sleep_hours}h</Text>
          <Text style={styles.metricLabel}>Sleep</Text>
        </View>
        <View style={styles.metricCard}>
          <Text style={styles.metricIcon}>⚡</Text>
          <Text style={styles.metricValue}>{metrics.active_minutes}</Text>
          <Text style={styles.metricLabel}>Active Min</Text>
        </View>
      </View>

      {/* Wellness Challenges */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Active Challenges</Text>
        {challenges.map(challenge => (
          <View key={challenge.id} style={styles.challengeCard}>
            <View style={styles.challengeHeader}>
              <Text style={styles.challengeTitle}>{challenge.title}</Text>
              <Text style={styles.challengePoints}>+{challenge.reward_points} pts</Text>
            </View>
            <Text style={styles.challengeDesc}>{challenge.description}</Text>
            <View style={styles.progressBar}>
              <View style={[styles.progressFill, { width: `${Math.min(100, (challenge.progress / challenge.target) * 100)}%` }]} />
            </View>
            <Text style={styles.progressText}>{challenge.progress}/{challenge.target} {challenge.unit}</Text>
          </View>
        ))}
      </View>

      {/* Connect Wearable */}
      <TouchableOpacity style={styles.connectButton}>
        <Text style={styles.connectButtonText}>Connect Wearable Device</Text>
        <Text style={styles.connectSubtext}>Google Health Connect • Apple HealthKit • Samsung Health</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { padding: 16, backgroundColor: '#059669', paddingTop: 48 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  headerSubtitle: { fontSize: 14, color: '#d1fae5', marginTop: 4 },
  scoreCard: { flexDirection: 'row', margin: 16, padding: 20, backgroundColor: '#fff', borderRadius: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  scoreCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#ecfdf5', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#059669' },
  scoreNumber: { fontSize: 28, fontWeight: 'bold', color: '#059669' },
  scoreLabel: { fontSize: 10, color: '#6b7280' },
  scoreDetails: { flex: 1, marginLeft: 16, justifyContent: 'center' },
  tierBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  tierText: { fontSize: 12, fontWeight: 'bold', color: '#fff' },
  discountText: { fontSize: 18, fontWeight: 'bold', color: '#059669', marginTop: 8 },
  streakText: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 },
  metricCard: { width: '25%', padding: 8, alignItems: 'center' },
  metricIcon: { fontSize: 24 },
  metricValue: { fontSize: 16, fontWeight: 'bold', color: '#1f2937', marginTop: 4 },
  metricLabel: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  section: { padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1f2937', marginBottom: 12 },
  challengeCard: { backgroundColor: '#fff', padding: 16, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  challengeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  challengeTitle: { fontSize: 15, fontWeight: '600', color: '#1f2937' },
  challengePoints: { fontSize: 13, color: '#059669', fontWeight: '600' },
  challengeDesc: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  progressBar: { height: 6, backgroundColor: '#e5e7eb', borderRadius: 3, marginTop: 12 },
  progressFill: { height: 6, backgroundColor: '#059669', borderRadius: 3 },
  progressText: { fontSize: 12, color: '#6b7280', marginTop: 4 },
  connectButton: { margin: 16, padding: 16, backgroundColor: '#1f2937', borderRadius: 12, alignItems: 'center' },
  connectButtonText: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  connectSubtext: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
});
