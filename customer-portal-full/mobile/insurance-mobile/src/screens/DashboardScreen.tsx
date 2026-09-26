import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../store/authStore';
import { useOfflineSync } from '../services/offlineSync';
import { policyApi, claimsApi } from '../services/api';

export function DashboardScreen({ navigation }: { navigation: any }) {
  const { user } = useAuth();
  const { getCachedData, setCachedData, state: syncState } = useOfflineSync();

  const { data: policies, isLoading: loadingPolicies, refetch: refetchPolicies } = useQuery({
    queryKey: ['policies'],
    queryFn: async () => {
      try {
        const res = await policyApi.list();
        await setCachedData('policies', res.data, 60 * 60 * 1000);
        return res.data;
      } catch {
        return await getCachedData('policies') || { policies: [], stats: {} };
      }
    },
  });

  const { data: claims, isLoading: loadingClaims, refetch: refetchClaims } = useQuery({
    queryKey: ['claims'],
    queryFn: async () => {
      try {
        const res = await claimsApi.list();
        await setCachedData('claims', res.data, 60 * 60 * 1000);
        return res.data;
      } catch {
        return await getCachedData('claims') || { claims: [], stats: {} };
      }
    },
  });

  const [refreshing, setRefreshing] = React.useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refetchPolicies(), refetchClaims()]);
    setRefreshing(false);
  };

  const stats = policies?.stats || {};
  const claimStats = claims?.stats || {};

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2563eb']} />}
    >
      <View style={styles.header}>
        <Text style={styles.greeting}>Welcome back,</Text>
        <Text style={styles.userName}>{user?.firstName || 'Customer'}</Text>
      </View>

      <View style={styles.statsGrid}>
        <TouchableOpacity style={[styles.statCard, styles.primaryCard]} onPress={() => navigation.navigate('Policies')}>
          <Text style={styles.statValue}>{stats.active || 0}</Text>
          <Text style={styles.statLabel}>Active Policies</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.statCard, styles.secondaryCard]} onPress={() => navigation.navigate('Claims')}>
          <Text style={[styles.statValue, { color: '#ea580c' }]}>{claimStats.open || 0}</Text>
          <Text style={styles.statLabel}>Open Claims</Text>
        </TouchableOpacity>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>₦{((stats.totalPremium || 0) / 1000).toFixed(0)}K</Text>
          <Text style={styles.statLabel}>Total Premium</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={[styles.statValue, { color: '#16a34a' }]}>{stats.coverageScore || 0}%</Text>
          <Text style={styles.statLabel}>Coverage Score</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <View style={styles.actionsGrid}>
          {[
            { label: 'File Claim', icon: '📋', screen: 'Claims', params: { screen: 'FileClaim' } },
            { label: 'Pay Premium', icon: '💳', screen: 'Payments' },
            { label: 'Find Agent', icon: '📍', screen: 'AgentLocator' },
            { label: 'Emergency', icon: '🆘', screen: 'Emergency' },
            // Q-wave Q6 (2026-09-25): telematics + usage-cover entries
            { label: 'Driving', icon: '🚗', screen: 'TelematicsTrips' },
            { label: 'Usage Cover', icon: '⏱️', screen: 'UsageCover' },
          ].map((action) => (
            <TouchableOpacity
              key={action.label}
              style={styles.actionButton}
              onPress={() => navigation.navigate(action.screen, action.params)}
            >
              <Text style={styles.actionIcon}>{action.icon}</Text>
              <Text style={styles.actionLabel}>{action.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        {(claims?.claims || []).slice(0, 3).map((claim: any) => (
          <TouchableOpacity
            key={claim.id}
            style={styles.activityItem}
            onPress={() => navigation.navigate('Claims', { screen: 'ClaimDetail', params: { claimId: claim.id } })}
          >
            <View style={[styles.statusDot, { backgroundColor: claim.status === 'approved' ? '#16a34a' : claim.status === 'pending' ? '#eab308' : '#dc2626' }]} />
            <View style={styles.activityContent}>
              <Text style={styles.activityTitle}>{claim.type} Claim #{claim.id?.slice(-6)}</Text>
              <Text style={styles.activityDate}>{new Date(claim.filedAt).toLocaleDateString()}</Text>
            </View>
            <Text style={styles.activityAmount}>₦{(claim.amount || 0).toLocaleString()}</Text>
          </TouchableOpacity>
        ))}
        {(!claims?.claims || claims.claims.length === 0) && (
          <Text style={styles.emptyText}>No recent activity</Text>
        )}
      </View>

      {!syncState.isOnline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>📡 Offline Mode — Data may not be current</Text>
        </View>
      )}

      <View style={{ height: 32 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 20, backgroundColor: '#2563eb' },
  greeting: { fontSize: 16, color: '#bfdbfe' },
  userName: { fontSize: 28, fontWeight: '700', color: '#fff', marginTop: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, marginTop: -20 },
  statCard: { width: '47%', backgroundColor: '#fff', borderRadius: 12, padding: 16, margin: '1.5%', shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  primaryCard: { borderLeftWidth: 3, borderLeftColor: '#2563eb' },
  secondaryCard: { borderLeftWidth: 3, borderLeftColor: '#ea580c' },
  statValue: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  statLabel: { fontSize: 12, color: '#64748b', marginTop: 4 },
  section: { marginHorizontal: 16, marginTop: 20 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#0f172a', marginBottom: 12 },
  actionsGrid: { flexDirection: 'row', justifyContent: 'space-between' },
  actionButton: { alignItems: 'center', width: '23%', backgroundColor: '#fff', paddingVertical: 16, borderRadius: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  actionIcon: { fontSize: 28, marginBottom: 6 },
  actionLabel: { fontSize: 11, fontWeight: '600', color: '#334155', textAlign: 'center' },
  activityItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', padding: 14, borderRadius: 10, marginBottom: 8 },
  statusDot: { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  activityContent: { flex: 1 },
  activityTitle: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  activityDate: { fontSize: 12, color: '#94a3b8', marginTop: 2 },
  activityAmount: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  emptyText: { textAlign: 'center', color: '#94a3b8', paddingVertical: 24 },
  offlineBanner: { marginHorizontal: 16, marginTop: 16, backgroundColor: '#fef3c7', padding: 12, borderRadius: 8, alignItems: 'center' },
  offlineText: { fontSize: 12, color: '#92400e' },
});
