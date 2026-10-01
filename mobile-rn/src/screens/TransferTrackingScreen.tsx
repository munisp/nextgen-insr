import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


interface TrackingStep {
  id: string;
  title: string;
  description: string;
  status: 'completed' | 'processing' | 'pending' | 'failed';
  timestamp?: string;
}

interface TransferDetails {
  id: string;
  amount: string;
  currency: string;
  recipientName: string;
  recipientBank: string;
  recipientAccount: string;
  reference: string;
  status: string;
  createdAt: string;
  steps: TrackingStep[];
}

const TransferTrackingScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { transferId } = (route.params as { transferId?: string }) || {};

  const [loading, setLoading] = useState(true);
  const [transfer, setTransfer] = useState<TransferDetails | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 2026-10-01 (R1b): error state replaces the fabricated transfer fallback.
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchTransferStatus = async () => {
    try {
      setLoadError(null);
      const response = await fetch(`https://api.insureportal.io/v1/transfers/${transferId || 'latest'}`);
      if (!response.ok) {
        throw new Error('Failed to fetch transfer details');
      }
      const data = await response.json();
      setTransfer(data);
    } catch (error) {
      // 2026-10-01 (R1b): FABRICATION REMOVED — previously rendered a fully
      // fabricated transfer ("John Doe", fake tracking steps showing funds
      // "secured"/"processing") on API failure. Fail-closed: no fake
      // tracking state; user sees an honest error and can retry.
      setTransfer(null);
      setLoadError('Could not load the transfer status. Please check your connection and retry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchTransferStatus();
    // Poll for updates every 10 seconds
    const interval = setInterval(fetchTransferStatus, 10000);
    return () => clearInterval(interval);
  }, [transferId]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchTransferStatus();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#4CAF50';
      case 'processing': return '#6C63FF';
      case 'failed': return '#F44336';
      default: return '#E0E0E0';
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  // 2026-10-01 (R1b): honest unavailable state instead of a fabricated transfer.
  if (!transfer) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 20, paddingHorizontal: 24 }}>
          {loadError ?? 'Transfer status is unavailable.'}
        </Text>
        <TouchableOpacity onPress={fetchTransferStatus}>
          <Text style={{ color: '#6C63FF', fontSize: 16, fontWeight: '600' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Header Section */}
        <View style={styles.headerCard}>
          <Text style={styles.label}>Amount Sent</Text>
          <Text style={styles.amountText}>
            {transfer?.currency} {transfer?.amount}
          </Text>
          <View style={styles.statusBadge}>
            <Text style={styles.statusText}>{transfer?.status}</Text>
          </View>
        </View>

        {/* Recipient Info */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Recipient Details</Text>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Name</Text>
            <Text style={styles.detailValue}>{transfer?.recipientName}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Bank</Text>
            <Text style={styles.detailValue}>{transfer?.recipientBank}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Account</Text>
            <Text style={styles.detailValue}>{transfer?.recipientAccount}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Reference</Text>
            <Text style={styles.detailValue}>{transfer?.reference}</Text>
          </View>
        </View>

        {/* Tracking Timeline */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Transfer Progress</Text>
          <View style={styles.timelineContainer}>
            {transfer?.steps.map((step, index) => (
              <View key={step.id} style={styles.timelineItem}>
                <View style={styles.timelineLeft}>
                  <View 
                    style={[
                      styles.timelineDot, 
                      { backgroundColor: getStatusColor(step.status) }
                    ]} 
                  />
                  {index !== transfer.steps.length - 1 && (
                    <View 
                      style={[
                        styles.timelineLine,
                        { backgroundColor: step.status === 'completed' ? '#6C63FF' : '#E0E0E0' }
                      ]} 
                    />
                  )}
                </View>
                <View style={styles.timelineRight}>
                  <View style={styles.stepHeader}>
                    <Text style={[
                      styles.stepTitle,
                      step.status === 'pending' && styles.pendingText
                    ]}>
                      {step.title}
                    </Text>
                    {step.timestamp && (
                      <Text style={styles.stepTime}>{step.timestamp}</Text>
                    )}
                  </View>
                  <Text style={styles.stepDescription}>{step.description}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <TouchableOpacity 
          style={styles.refreshButton} 
          onPress={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.refreshButtonText}>Refresh Status</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity 
          style={styles.backButton} 
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backButtonText}>Back to Home</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1A1A2E',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
  },
  scrollContent: {
    padding: 20,
  },
  headerCard: {
    alignItems: 'center',
    marginBottom: 24,
    paddingVertical: 20,
  },
  label: {
    color: '#FFFFFF',
    opacity: 0.7,
    fontSize: 14,
    marginBottom: 8,
  },
  amountText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  statusBadge: {
    backgroundColor: 'rgba(108, 99, 255, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#6C63FF',
  },
  statusText: {
    color: '#6C63FF',
    fontWeight: '600',
    fontSize: 14,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#1A1A2E',
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  detailLabel: {
    color: '#666',
    fontSize: 14,
  },
  detailValue: {
    color: '#1A1A2E',
    fontSize: 14,
    fontWeight: '600',
  },
  timelineContainer: {
    marginTop: 10,
  },
  timelineItem: {
    flexDirection: 'row',
    minHeight: 80,
  },
  timelineLeft: {
    alignItems: 'center',
    marginRight: 15,
    width: 20,
  },
  timelineDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    zIndex: 1,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    marginTop: -2,
    marginBottom: -2,
  },
  timelineRight: {
    flex: 1,
    paddingBottom: 20,
  },
  stepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#1A1A2E',
  },
  pendingText: {
    color: '#999',
  },
  stepTime: {
    fontSize: 12,
    color: '#666',
  },
  stepDescription: {
    fontSize: 14,
    color: '#666',
    lineHeight: 20,
  },
  refreshButton: {
    backgroundColor: '#6C63FF',
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  refreshButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
  },
  backButton: {
    height: 56,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default TransferTrackingScreen;
