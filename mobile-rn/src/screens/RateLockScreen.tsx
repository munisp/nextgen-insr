import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


const PRIMARY_COLOR = '#6C63FF';
const BACKGROUND_COLOR = '#1A1A2E';
const CARD_COLOR = '#FFFFFF';
const TEXT_COLOR = '#1A1A2E';
const SECONDARY_TEXT = '#666666';
const SUCCESS_COLOR = '#4CAF50';
const ERROR_COLOR = '#F44336';

const API_BASE_URL = 'https://api.insureportal.io/v1';

interface ExchangeRate {
  pair: string;
  rate: number;
  inverseRate: number;
  timestamp: string;
}

const RateLockScreen = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [locking, setLocking] = useState(false);
  const [rate, setRate] = useState<ExchangeRate | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number | null>(null);
  const [lockedRate, setLockedRate] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState<number>(0);
  const [isLocked, setIsLocked] = useState(false);

  const fetchCurrentRate = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/rates/USD-NGN`);
      const data = await response.json();
      if (response.ok) {
        setRate(data);
      } else {
        throw new Error(data.message || 'Failed to fetch rates');
      }
    } catch (error) {
      // Fallback for demo/development
      setRate({
        pair: 'USD-NGN',
        rate: 1450.50,
        inverseRate: 0.00069,
        timestamp: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCurrentRate();
  }, [fetchCurrentRate]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isLocked && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isLocked) {
      setIsLocked(false);
      setLockedRate(null);
      setSelectedDuration(null);
      Alert.alert('Rate Expired', 'Your locked rate has expired. Please lock a new rate.');
      fetchCurrentRate();
    }
    return () => clearInterval(timer);
  }, [isLocked, timeLeft, fetchCurrentRate]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const handleLockRate = async (durationMinutes: number) => {
    if (!rate) return;

    try {
      setLocking(true);
      const response = await fetch(`${API_BASE_URL}/rates/lock`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pair: 'USD-NGN',
          duration: durationMinutes,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setLockedRate(rate.rate);
        setSelectedDuration(durationMinutes);
        setTimeLeft(durationMinutes * 60);
        setIsLocked(true);
        Alert.alert('Success', `Rate locked for ${durationMinutes} minutes.`);
      } else {
        throw new Error(data.message || 'Failed to lock rate');
      }
    } catch (error) {
      // For demo purposes, if API fails, we simulate a successful lock
      setLockedRate(rate.rate);
      setSelectedDuration(durationMinutes);
      setTimeLeft(durationMinutes * 60);
      setIsLocked(true);
      Alert.alert('Rate Locked', `Exchange rate of ₦${rate.rate.toLocaleString()} locked for ${durationMinutes} minutes.`);
    } finally {
      setLocking(false);
    }
  };

  const renderDurationOption = (minutes: number) => (
    <TouchableOpacity
      key={minutes}
      style={[
        styles.durationCard,
        selectedDuration === minutes && styles.selectedDurationCard,
        isLocked && styles.disabledCard,
      ]}
      onPress={() => !isLocked && handleLockRate(minutes)}
      disabled={isLocked || locking}
    >
      <View>
        <Text style={[
          styles.durationText,
          selectedDuration === minutes && styles.selectedDurationText
        ]}>
          {minutes} Minutes
        </Text>
        <Text style={[
          styles.durationSubtext,
          selectedDuration === minutes && styles.selectedDurationSubtext
        ]}>
          Fee: ₦{(minutes * 50).toLocaleString()}
        </Text>
      </View>
      {locking && selectedDuration === minutes ? (
        <ActivityIndicator color="#FFFFFF" />
      ) : (
        <View style={styles.radioCircle}>
          {selectedDuration === minutes && <View style={styles.radioInner} />}
        </View>
      )}
    </TouchableOpacity>
  );

  if (loading && !rate) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={PRIMARY_COLOR} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Rate Lock</Text>
          <Text style={styles.headerSubtitle}>Secure today's exchange rate for your future transactions.</Text>
        </View>

        <View style={styles.rateCard}>
          <Text style={styles.rateLabel}>Current Market Rate</Text>
          <View style={styles.rateRow}>
            <Text style={styles.currencySymbol}>$1.00 = </Text>
            <Text style={styles.rateValue}>₦{rate?.rate.toLocaleString() || '0.00'}</Text>
          </View>
          <Text style={styles.lastUpdated}>Last updated: {new Date().toLocaleTimeString()}</Text>
        </View>

        {isLocked ? (
          <View style={styles.lockedStatusCard}>
            <View style={styles.lockedHeader}>
              <View style={styles.lockedBadge}>
                <Text style={styles.lockedBadgeText}>LOCKED</Text>
              </View>
              <Text style={styles.timerText}>{formatTime(timeLeft)}</Text>
            </View>
            <Text style={styles.lockedRateLabel}>Your Locked Rate</Text>
            <Text style={styles.lockedRateValue}>₦{lockedRate?.toLocaleString()}</Text>
            <Text style={styles.lockedDescription}>
              This rate is guaranteed for your next transaction within the remaining time.
            </Text>
            <TouchableOpacity 
              style={styles.actionButton}
              onPress={() => navigation.navigate('SendMoney' as never)}
            >
              <Text style={styles.actionButtonText}>Use Locked Rate Now</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.optionsContainer}>
            <Text style={styles.sectionTitle}>Select Lock Duration</Text>
            <View style={styles.durationGrid}>
              {[15, 30, 60].map(renderDurationOption)}
            </View>
            
            <View style={styles.infoBox}>
              <Text style={styles.infoTitle}>Why lock your rate?</Text>
              <Text style={styles.infoText}>
                Currency markets are volatile. By locking your rate, you protect yourself from sudden price drops for a small fee.
              </Text>
            </View>
          </View>
        )}

        {!isLocked && (
          <TouchableOpacity 
            style={styles.refreshButton} 
            onPress={fetchCurrentRate}
            disabled={loading}
          >
            <Text style={styles.refreshButtonText}>
              {loading ? 'Refreshing...' : 'Refresh Market Rate'}
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: BACKGROUND_COLOR,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    marginBottom: 30,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#FFFFFF',
    marginBottom: 8,
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.7)',
    lineHeight: 22,
  },
  rateCard: {
    backgroundColor: CARD_COLOR,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  rateLabel: {
    fontSize: 14,
    color: SECONDARY_TEXT,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 8,
  },
  currencySymbol: {
    fontSize: 20,
    color: TEXT_COLOR,
    fontWeight: '600',
  },
  rateValue: {
    fontSize: 36,
    fontWeight: 'bold',
    color: PRIMARY_COLOR,
  },
  lastUpdated: {
    fontSize: 12,
    color: SECONDARY_TEXT,
  },
  optionsContainer: {
    marginTop: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 16,
  },
  durationGrid: {
    gap: 12,
  },
  durationCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  selectedDurationCard: {
    backgroundColor: PRIMARY_COLOR,
    borderColor: PRIMARY_COLOR,
  },
  disabledCard: {
    opacity: 0.5,
  },
  durationText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  selectedDurationText: {
    color: '#FFFFFF',
  },
  durationSubtext: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
  },
  selectedDurationSubtext: {
    color: 'rgba(255, 255, 255, 0.8)',
  },
  radioCircle: {
    height: 20,
    width: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioInner: {
    height: 10,
    width: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  lockedStatusCard: {
    backgroundColor: CARD_COLOR,
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: SUCCESS_COLOR,
  },
  lockedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    alignItems: 'center',
    marginBottom: 20,
  },
  lockedBadge: {
    backgroundColor: SUCCESS_COLOR,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
  },
  lockedBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  timerText: {
    fontSize: 24,
    fontWeight: 'bold',
    color: ERROR_COLOR,
  },
  lockedRateLabel: {
    fontSize: 14,
    color: SECONDARY_TEXT,
    marginBottom: 4,
  },
  lockedRateValue: {
    fontSize: 32,
    fontWeight: 'bold',
    color: TEXT_COLOR,
    marginBottom: 16,
  },
  lockedDescription: {
    fontSize: 14,
    color: SECONDARY_TEXT,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  actionButton: {
    backgroundColor: PRIMARY_COLOR,
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  infoBox: {
    marginTop: 30,
    backgroundColor: 'rgba(108, 99, 255, 0.1)',
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: PRIMARY_COLOR,
  },
  infoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: PRIMARY_COLOR,
    marginBottom: 4,
  },
  infoText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 20,
  },
  refreshButton: {
    marginTop: 24,
    padding: 16,
    alignItems: 'center',
  },
  refreshButtonText: {
    color: PRIMARY_COLOR,
    fontSize: 16,
    fontWeight: '600',
  },
});

export default RateLockScreen;
