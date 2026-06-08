import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Alert,
  Share,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { APIClient } from '../api/APIClient';

const apiClient = new APIClient();

interface ReferralHistory {
  id: string;
  name: string;
  date: string;
  status: 'Pending' | 'Completed';
  reward: string;
}

const ReferralProgramScreen = () => {
  const [referralCode, setReferralCode] = useState<string>('INSUREPORTAL-REF-2024');
  const [referralHistory, setReferralHistory] = useState<ReferralHistory[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [stats, setStats] = useState({
    totalReferrals: 0,
    earnedRewards: '₦0.00',
  });

  useEffect(() => {
    fetchReferralData();
  }, []);

  const fetchReferralData = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get('/referrals');
      const data = response.data;
      setReferralCode(data.referralCode ?? referralCode);
      setReferralHistory(data.history ?? []);
      setStats({
        totalReferrals: data.totalReferrals ?? 0,
        earnedRewards: data.earnedRewards ?? '₦0.00',
      });
    } catch (error) {
      console.error('Error fetching referral data:', error);
      setReferralHistory([]);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async () => {
    try {
      const result = await Share.share({
        message: `Join me on InsurePortal Agency Banking! Use my referral code ${referralCode} to get started. Download here: https://insureportal.io/download`,
      });
      if (result.action === Share.sharedAction) {
        if (result.activityType) {
          // shared with activity type of result.activityType
        } else {
          // shared
        }
      } else if (result.action === Share.dismissedAction) {
        // dismissed
      }
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  const renderHistoryItem = ({ item }: { item: ReferralHistory }) => (
    <View style={styles.historyItem}>
      <View>
        <Text style={styles.historyName}>{item.name}</Text>
        <Text style={styles.historyDate}>{item.date}</Text>
      </View>
      <View style={styles.historyRight}>
        <Text style={[styles.historyStatus, { color: item.status === 'Completed' ? '#4CAF50' : '#FF9800' }]}>
          {item.status}
        </Text>
        <Text style={styles.historyReward}>{item.reward}</Text>
      </View>
    </View>
  );

  const Header = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Referral Program</Text>
      <Text style={styles.headerSubtitle}>Invite friends and earn rewards</Text>
    </View>
  );

  const StatsCard = () => (
    <View style={styles.statsContainer}>
      <View style={styles.statBox}>
        <Text style={styles.statLabel}>Total Referrals</Text>
        <Text style={styles.statValue}>{stats.totalReferrals}</Text>
      </View>
      <View style={styles.statDivider} />
      <View style={styles.statBox}>
        <Text style={styles.statLabel}>Total Earned</Text>
        <Text style={styles.statValue}>{stats.earnedRewards}</Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Header />
        
        <View style={styles.referralCard}>
          <Text style={styles.referralLabel}>Your Referral Code</Text>
          <View style={styles.codeContainer}>
            <Text style={styles.codeText}>{referralCode}</Text>
          </View>
          <TouchableOpacity style={styles.shareButton} onPress={handleShare}>
            <Text style={styles.shareButtonText}>Share Referral Link</Text>
          </TouchableOpacity>
        </View>

        <StatsCard />

        <View style={styles.historySection}>
          <Text style={styles.sectionTitle}>Referral History</Text>
          {loading ? (
            <ActivityIndicator size="large" color="#6C63FF" style={{ marginTop: 20 }} />
          ) : referralHistory.length > 0 ? (
            referralHistory.map((item) => (
              <View key={item.id}>
                {renderHistoryItem({ item })}
              </View>
            ))
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyStateText}>No referrals yet. Start sharing!</Text>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  scrollContent: {
    paddingBottom: 30,
  },
  header: {
    padding: 24,
    paddingTop: 40,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  headerSubtitle: {
    fontSize: 16,
    color: '#A0A0B0',
    marginTop: 8,
  },
  referralCard: {
    backgroundColor: '#FFFFFF',
    margin: 20,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  referralLabel: {
    fontSize: 14,
    color: '#666',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  codeContainer: {
    backgroundColor: '#F0F0F7',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderStyle: 'dashed',
    borderWidth: 2,
    borderColor: '#6C63FF',
    marginBottom: 20,
  },
  codeText: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#1A1A2E',
    letterSpacing: 2,
  },
  shareButton: {
    backgroundColor: '#6C63FF',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  shareButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  statsContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    marginHorizontal: 20,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  statBox: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    height: '100%',
  },
  statLabel: {
    color: '#A0A0B0',
    fontSize: 12,
    marginBottom: 4,
  },
  statValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  historySection: {
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  historyItem: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 16,
    borderRadius: 12,
    marginBottom: 12,
  },
  historyName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A2E',
  },
  historyDate: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
  },
  historyRight: {
    alignItems: 'flex-end',
  },
  historyStatus: {
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  historyReward: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A2E',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyStateText: {
    color: '#A0A0B0',
    fontSize: 14,
  },
});

export default ReferralProgramScreen;
