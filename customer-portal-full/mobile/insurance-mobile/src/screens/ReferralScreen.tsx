import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, FlatList, StyleSheet, Share, Alert } from 'react-native';
import { api } from '../services/api';

export default function ReferralScreen() {
  const [referralCode, setReferralCode] = useState('');
  const [referrals, setReferrals] = useState<any[]>([]);
  const [totalEarnings, setTotalEarnings] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await api.query('referral.myStats');
        setReferralCode(data?.referralCode || 'INSURE-REF');
        setReferrals(data?.referrals || []);
        setTotalEarnings(data?.totalEarnings || 0);
      } catch {}
    };
    fetchData();
  }, []);

  const shareCode = async () => {
    try {
      await Share.share({
        message: `Join InsurePortal and get ₦500 off your first premium! Use my referral code: ${referralCode}\n\nDownload: https://insureportal.ng/invite/${referralCode}`,
      });
    } catch {}
  };

  return (
    <View style={styles.container}>
      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>Refer & Earn</Text>
        <Text style={styles.heroSub}>Earn ₦500 for every friend who buys a policy</Text>
        <View style={styles.codeBox}>
          <Text style={styles.code}>{referralCode}</Text>
        </View>
        <TouchableOpacity style={styles.shareBtn} onPress={shareCode}>
          <Text style={styles.shareText}>Share Referral Link</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{referrals.length}</Text>
          <Text style={styles.statLabel}>Referrals</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>₦{totalEarnings.toLocaleString()}</Text>
          <Text style={styles.statLabel}>Earned</Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{referrals.filter(r => r.status === 'converted').length}</Text>
          <Text style={styles.statLabel}>Converted</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Your Referrals</Text>
      <FlatList
        data={referrals}
        keyExtractor={(item, i) => String(i)}
        renderItem={({ item }) => (
          <View style={styles.refCard}>
            <Text style={styles.refName}>{item.name}</Text>
            <View style={[styles.badge, item.status === 'converted' ? styles.badgeGreen : styles.badgeYellow]}>
              <Text style={styles.badgeText}>{item.status}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>No referrals yet. Share your code to get started!</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  heroCard: { backgroundColor: '#1e40af', padding: 24, alignItems: 'center' },
  heroTitle: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  heroSub: { color: '#93c5fd', marginTop: 4 },
  codeBox: { backgroundColor: '#fff', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8, marginTop: 16 },
  code: { fontSize: 20, fontWeight: 'bold', letterSpacing: 2 },
  shareBtn: { backgroundColor: '#3b82f6', paddingVertical: 12, paddingHorizontal: 32, borderRadius: 8, marginTop: 12 },
  shareText: { color: '#fff', fontWeight: '600' },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: '#fff', padding: 16, marginTop: 8 },
  stat: { alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: 'bold' },
  statLabel: { color: '#666', fontSize: 12, marginTop: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '600', padding: 16 },
  refCard: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', padding: 16, marginHorizontal: 16, marginBottom: 8, borderRadius: 8 },
  refName: { fontWeight: '500' },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 12 },
  badgeGreen: { backgroundColor: '#dcfce7' },
  badgeYellow: { backgroundColor: '#fef9c3' },
  badgeText: { fontSize: 12, fontWeight: '500', textTransform: 'capitalize' },
  empty: { textAlign: 'center', padding: 40, color: '#999' },
});
