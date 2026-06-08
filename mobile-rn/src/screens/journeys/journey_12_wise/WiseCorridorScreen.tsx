/**
 * WiseInsuranceRegionScreen
 * Journey: Float Top-up
 * ID: journey_12
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { APIClient } from '../../api/APIClient';
const apiClient = new APIClient();


interface WiseInsuranceRegionScreenProps {
  navigation: any;
  route: any;
}

export const WiseInsuranceRegionScreen: React.FC<WiseInsuranceRegionScreenProps> = ({ navigation, route }) => {
  const [isLoading, setIsLoading] = useState(false);

  const handleContinue = async () => {
    setIsLoading(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
    navigation.navigate('Home');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Wise InsuranceRegion</Text>
      <Text style={styles.subtitle}>Float Top-up</Text>

      <TouchableOpacity
        style={[styles.primaryButton, isLoading && styles.primaryButtonDisabled]}
        onPress={handleContinue}
        disabled={isLoading}
      >
        <Text style={styles.buttonText}>{isLoading ? 'Processing...' : 'Continue'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 28, fontWeight: 'bold', color: '#1C1C1E', marginBottom: 6 },
  subtitle: { fontSize: 15, color: '#8E8E93', marginBottom: 24 },
  primaryButton: { backgroundColor: '#34C759', padding: 16, borderRadius: 14, alignItems: 'center', marginTop: 24 },
  primaryButtonDisabled: { opacity: 0.6 },
  buttonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },

  label: { fontSize: 14, fontWeight: '600', color: '#3C3C43', marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1.5, borderColor: '#E5E5EA', borderRadius: 12, padding: 14, fontSize: 16, color: '#1C1C1E', backgroundColor: '#FAFAFA' },
  summaryCard: { backgroundColor: '#F2F2F7', borderRadius: 14, padding: 16, marginTop: 16 },
  summaryTitle: { fontSize: 16, fontWeight: '700', color: '#1C1C1E', marginBottom: 8 },
  summaryRow: { fontSize: 14, color: '#3C3C43', lineHeight: 22 },
  successIcon: { alignItems: 'center', marginTop: 40, marginBottom: 20 },
  successEmoji: { fontSize: 64 },
  successTitle: { fontSize: 24, fontWeight: 'bold', color: '#1C1C1E', textAlign: 'center', marginBottom: 8 },
  successSubtitle: { fontSize: 15, color: '#8E8E93', textAlign: 'center', lineHeight: 22 },
  billerList: { marginTop: 8 },
  billerItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F2F2F7' },
  billerName: { fontSize: 16, color: '#1C1C1E' },
  billerArrow: { fontSize: 20, color: '#C7C7CC' },
  amountGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  amountBtn: { width: '30%', borderWidth: 1.5, borderColor: '#E5E5EA', borderRadius: 12, padding: 14, alignItems: 'center', backgroundColor: '#FAFAFA' },
  amountBtnSelected: { borderColor: '#0066FF', backgroundColor: '#EBF3FF' },
  amountBtnText: { fontSize: 15, fontWeight: '600', color: '#3C3C43' },
  amountBtnTextSelected: { color: '#0066FF' },
  qrPlaceholder: { height: 200, backgroundColor: '#F2F2F7', borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  qrText: { fontSize: 18, fontWeight: '600', color: '#1C1C1E' },
  qrSub: { fontSize: 13, color: '#8E8E93', marginTop: 4 },
  scannerPlaceholder: { height: 280, backgroundColor: '#1C1C1E', borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  scannerText: { fontSize: 18, fontWeight: '600', color: '#FFFFFF' },
  scannerSub: { fontSize: 13, color: '#EBEBF5', marginTop: 4 },
  progressContainer: { alignItems: 'center', paddingVertical: 32 },
  progressTitle: { fontSize: 18, fontWeight: '600', color: '#1C1C1E', marginBottom: 20 },
  progressBar: { width: '100%', height: 8, backgroundColor: '#E5E5EA', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#0066FF', borderRadius: 4 },
  progressSub: { fontSize: 13, color: '#8E8E93', marginTop: 12 },
  rateCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F2F2F7', borderRadius: 12, padding: 14, marginTop: 12 },
  rateLabel: { fontSize: 14, color: '#8E8E93' },
  rateValue: { fontSize: 16, fontWeight: '700', color: '#FF9500' },
  checkRow: { flexDirection: 'row', alignItems: 'center', marginTop: 20, gap: 12 },
  checkbox: { width: 24, height: 24, borderWidth: 2, borderColor: '#C7C7CC', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  checkboxChecked: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  checkmark: { color: '#FFFFFF', fontSize: 14, fontWeight: 'bold' },
  checkLabel: { flex: 1, fontSize: 14, color: '#3C3C43', lineHeight: 20 },
  alertCard: { backgroundColor: '#FFF3CD', borderWidth: 1, borderColor: '#FFCC00', borderRadius: 14, padding: 20, alignItems: 'center', marginTop: 16 },
  alertIcon: { fontSize: 40, marginBottom: 12 },
  alertTitle: { fontSize: 18, fontWeight: '700', color: '#1C1C1E', marginBottom: 8, textAlign: 'center' },
  alertBody: { fontSize: 14, color: '#3C3C43', textAlign: 'center', lineHeight: 20 },
  pinRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginTop: 24, marginBottom: 8 },
  pinDot: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#C7C7CC', backgroundColor: 'transparent' },
  pinDotFilled: { backgroundColor: '#0066FF', borderColor: '#0066FF' },
  tenureRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  tenureBtn: { flex: 1, borderWidth: 1.5, borderColor: '#E5E5EA', borderRadius: 10, padding: 12, alignItems: 'center', backgroundColor: '#FAFAFA' },
  tenureBtnSelected: { borderColor: '#0066FF', backgroundColor: '#EBF3FF' },
  tenureBtnText: { fontSize: 14, fontWeight: '600', color: '#3C3C43' },
  tenureBtnTextSelected: { color: '#0066FF' },

});
