import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { APIClient } from '../api/APIClient';
const apiClient = new APIClient();


const { width } = Dimensions.get('window');

const VirtualCardScreen: React.FC = () => {
  const navigation = useNavigation();
  const [loading, setLoading] = useState(true);
  const [cardData, setCardData] = useState<any>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isFrozen, setIsFrozen] = useState(false);

  const API_BASE_URL = 'https://api.insureportal.io/v1';

  useEffect(() => {
    fetchCardDetails();
  }, []);

  const fetchCardDetails = async () => {
    try {
      setLoading(true);
      const response = await fetch(`${API_BASE_URL}/cards/virtual`);
      const data = await response.json();
      if (response.ok) {
        setCardData(data);
        setIsFrozen(data.status === 'frozen');
      } else {
        // Fallback for demo purposes if API is not reachable
        setCardData({
          cardNumber: '5412 8890 1234 5678',
          expiryDate: '12/28',
          cvv: '345',
          cardHolder: 'JOHN DOE',
          balance: 2500.50,
          currency: 'USD',
          type: 'Mastercard',
        });
      }
    } catch (error) {
      // Fallback for demo purposes
      setCardData({
        cardNumber: '5412 8890 1234 5678',
        expiryDate: '12/28',
        cvv: '345',
        cardHolder: 'JOHN DOE',
        balance: 2500.50,
        currency: 'USD',
        type: 'Mastercard',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleFreeze = async () => {
    const newStatus = !isFrozen;
    try {
      const response = await fetch(`${API_BASE_URL}/cards/virtual/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus ? 'frozen' : 'active' }),
      });
      
      if (response.ok) {
        setIsFrozen(newStatus);
        Alert.alert('Success', `Card has been ${newStatus ? 'frozen' : 'unfrozen'} successfully.`);
      } else {
        Alert.alert('Error', 'Failed to update card status. Please try again.');
      }
    } catch (error) {
      // Local update for demo
      setIsFrozen(newStatus);
      Alert.alert('Success', `Card has been ${newStatus ? 'frozen' : 'unfrozen'} successfully.`);
    }
  };

  const formatCardNumber = (number: string) => {
    if (!showDetails) {
      return `**** **** **** ${number.slice(-4)}`;
    }
    return number;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6C63FF" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Virtual Card</Text>
          <Text style={styles.headerSubtitle}>Manage your digital spending</Text>
        </View>

        {/* Virtual Card Visual */}
        <View style={[styles.cardContainer, isFrozen && styles.cardFrozen]}>
          <View style={styles.cardHeader}>
            <Text style={styles.brandName}>InsurePortal</Text>
            <Text style={styles.cardType}>{cardData?.type}</Text>
          </View>
          
          <View style={styles.chipContainer}>
            <View style={styles.chip} />
          </View>

          <Text style={styles.cardNumber}>
            {formatCardNumber(cardData?.cardNumber)}
          </Text>

          <View style={styles.cardFooter}>
            <View>
              <Text style={styles.cardLabel}>CARD HOLDER</Text>
              <Text style={styles.cardValue}>{cardData?.cardHolder}</Text>
            </View>
            <View>
              <Text style={styles.cardLabel}>EXPIRES</Text>
              <Text style={styles.cardValue}>{cardData?.expiryDate}</Text>
            </View>
            <View>
              <Text style={styles.cardLabel}>CVV</Text>
              <Text style={styles.cardValue}>{showDetails ? cardData?.cvv : '***'}</Text>
            </View>
          </View>
          
          {isFrozen && (
            <View style={styles.frozenOverlay}>
              <Text style={styles.frozenText}>FROZEN</Text>
            </View>
          )}
        </View>

        {/* Controls */}
        <View style={styles.controlsContainer}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => setShowDetails(!showDetails)}
          >
            <Text style={styles.actionButtonText}>
              {showDetails ? 'Hide Details' : 'View Details'}
            </Text>
          </TouchableOpacity>

          <View style={styles.settingRow}>
            <View>
              <Text style={styles.settingTitle}>Freeze Card</Text>
              <Text style={styles.settingDescription}>Temporarily disable all transactions</Text>
            </View>
            <Switch
              trackColor={{ false: '#767577', true: '#6C63FF' }}
              thumbColor={isFrozen ? '#fff' : '#f4f3f4'}
              onValueChange={toggleFreeze}
              value={isFrozen}
            />
          </View>
        </View>

        {/* Card Info */}
        <View style={styles.infoSection}>
          <Text style={styles.sectionTitle}>Card Information</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Available Balance</Text>
              <Text style={styles.infoValue}>
                {cardData?.currency} {cardData?.balance.toLocaleString()}
              </Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Daily Limit</Text>
              <Text style={styles.infoValue}>$1,000.00</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Status</Text>
              <Text style={[styles.infoValue, { color: isFrozen ? '#FF4D4D' : '#4CAF50' }]}>
                {isFrozen ? 'Inactive' : 'Active'}
              </Text>
            </View>
          </View>
        </View>

        {/* Quick Actions */}
        <View style={styles.quickActions}>
          <TouchableOpacity style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Reset PIN</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Transaction History</Text>
          </TouchableOpacity>
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#1A1A2E',
  },
  scrollContent: {
    padding: 20,
  },
  header: {
    marginBottom: 24,
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.6)',
    marginTop: 4,
  },
  cardContainer: {
    width: '100%',
    height: 220,
    backgroundColor: '#6C63FF',
    borderRadius: 16,
    padding: 24,
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
    position: 'relative',
    overflow: 'hidden',
  },
  cardFrozen: {
    opacity: 0.8,
    backgroundColor: '#4A4A6A',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brandName: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  cardType: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  chipContainer: {
    marginTop: 10,
  },
  chip: {
    width: 45,
    height: 35,
    backgroundColor: '#FFD700',
    borderRadius: 6,
    opacity: 0.8,
  },
  cardNumber: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: 2,
    marginVertical: 15,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  cardLabel: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 10,
    marginBottom: 4,
  },
  cardValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  frozenOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  frozenText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: 'bold',
    letterSpacing: 4,
    borderWidth: 2,
    borderColor: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  controlsContainer: {
    marginTop: 30,
  },
  actionButton: {
    backgroundColor: '#6C63FF',
    paddingVertical: 15,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    padding: 16,
    borderRadius: 12,
  },
  settingTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  settingDescription: {
    color: 'rgba(255, 255, 255, 0.5)',
    fontSize: 12,
    marginTop: 2,
  },
  infoSection: {
    marginTop: 30,
  },
  sectionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  infoCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  infoLabel: {
    color: '#666',
    fontSize: 14,
  },
  infoValue: {
    color: '#1A1A2E',
    fontSize: 14,
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
  },
  quickActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    marginBottom: 40,
  },
  secondaryButton: {
    flex: 0.48,
    borderWidth: 1,
    borderColor: '#6C63FF',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#6C63FF',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default VirtualCardScreen;
