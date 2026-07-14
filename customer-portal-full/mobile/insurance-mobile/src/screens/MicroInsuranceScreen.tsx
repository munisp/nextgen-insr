import React, { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';

interface MicroProduct {
  id: string;
  name: string;
  category: string;
  icon: string;
  min_premium: number;
  description: string;
  duration_type: string;
}

export default function MicroInsuranceScreen() {
  const [activePolicies, setActivePolicies] = useState<string[]>([]);

  const products: MicroProduct[] = [
    { id: 'micro-ride-motor', name: 'Per-Ride Motor', category: 'motor', icon: '🚗', min_premium: 100, description: 'Coverage for a single ride', duration_type: 'rides' },
    { id: 'micro-flight-delay', name: 'Flight Delay', category: 'travel', icon: '✈️', min_premium: 500, description: 'Auto-payout if delayed >2hrs', duration_type: 'hours' },
    { id: 'micro-gadget-day', name: 'Gadget Daily', category: 'gadget', icon: '📱', min_premium: 200, description: 'Protect phone/laptop today', duration_type: 'days' },
    { id: 'micro-delivery', name: 'Delivery Cover', category: 'logistics', icon: '📦', min_premium: 50, description: 'Protect your package', duration_type: 'hours' },
    { id: 'micro-event-cancel', name: 'Event Cancel', category: 'event', icon: '🎉', min_premium: 1000, description: 'Event cancellation cover', duration_type: 'days' },
  ];

  const activate = (product: MicroProduct) => {
    setActivePolicies(prev => [...prev, product.id]);
    Alert.alert(
      '⚡ Activated!',
      `${product.name} is now active.\nPremium: ₦${product.min_premium}\nCoverage starts immediately.`,
      [{ text: 'OK' }]
    );
  };

  const deactivate = (productId: string) => {
    setActivePolicies(prev => prev.filter(id => id !== productId));
    Alert.alert('Deactivated', 'Policy deactivated. Pro-rata refund will be processed.');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Micro Insurance</Text>
        <Text style={styles.headerSubtitle}>Instant coverage — activate in 1 tap</Text>
      </View>

      <View style={styles.activeSection}>
        <Text style={styles.activeCount}>{activePolicies.length} Active</Text>
      </View>

      {products.map(product => {
        const isActive = activePolicies.includes(product.id);
        return (
          <View key={product.id} style={[styles.productCard, isActive && styles.activeCard]}>
            <View style={styles.productHeader}>
              <Text style={styles.productIcon}>{product.icon}</Text>
              <View style={styles.productInfo}>
                <Text style={styles.productName}>{product.name}</Text>
                <Text style={styles.productDesc}>{product.description}</Text>
              </View>
              <Text style={styles.productPrice}>₦{product.min_premium}</Text>
            </View>
            <TouchableOpacity
              style={[styles.actionButton, isActive ? styles.deactivateButton : styles.activateButton]}
              onPress={() => isActive ? deactivate(product.id) : activate(product)}
            >
              <Text style={[styles.actionButtonText, isActive && styles.deactivateText]}>
                {isActive ? 'Deactivate' : '⚡ Activate Now'}
              </Text>
            </TouchableOpacity>
            {isActive && <Text style={styles.activeIndicator}>● ACTIVE — Coverage running</Text>}
          </View>
        );
      })}

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>How it works</Text>
        <Text style={styles.infoText}>1. Tap "Activate" to start coverage instantly</Text>
        <Text style={styles.infoText}>2. Coverage lasts for your selected duration</Text>
        <Text style={styles.infoText}>3. Tap "Deactivate" anytime — pro-rata refund</Text>
        <Text style={styles.infoText}>4. GPS auto-trigger available for travel products</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { padding: 16, backgroundColor: '#7c3aed', paddingTop: 48 },
  headerTitle: { fontSize: 22, fontWeight: 'bold', color: '#fff' },
  headerSubtitle: { fontSize: 14, color: '#e0d4ff', marginTop: 4 },
  activeSection: { padding: 16 },
  activeCount: { fontSize: 14, color: '#6b7280', fontWeight: '600' },
  productCard: { margin: 12, marginTop: 0, padding: 16, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e5e7eb' },
  activeCard: { borderColor: '#7c3aed', borderWidth: 2, backgroundColor: '#faf5ff' },
  productHeader: { flexDirection: 'row', alignItems: 'center' },
  productIcon: { fontSize: 32 },
  productInfo: { flex: 1, marginLeft: 12 },
  productName: { fontSize: 16, fontWeight: '600', color: '#1f2937' },
  productDesc: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  productPrice: { fontSize: 16, fontWeight: 'bold', color: '#7c3aed' },
  actionButton: { marginTop: 12, padding: 12, borderRadius: 8, alignItems: 'center' },
  activateButton: { backgroundColor: '#7c3aed' },
  deactivateButton: { backgroundColor: '#fee2e2', borderWidth: 1, borderColor: '#fca5a5' },
  actionButtonText: { fontSize: 15, fontWeight: 'bold', color: '#fff' },
  deactivateText: { color: '#dc2626' },
  activeIndicator: { fontSize: 12, color: '#059669', fontWeight: '600', marginTop: 8 },
  infoBox: { margin: 16, padding: 16, backgroundColor: '#f0f9ff', borderRadius: 12, borderWidth: 1, borderColor: '#bae6fd' },
  infoTitle: { fontSize: 15, fontWeight: 'bold', color: '#0369a1', marginBottom: 8 },
  infoText: { fontSize: 13, color: '#0369a1', marginBottom: 4 },
});
