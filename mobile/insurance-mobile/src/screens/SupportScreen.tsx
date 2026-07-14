import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, Alert, Linking } from 'react-native';

export function SupportScreen() {
  const [message, setMessage] = React.useState('');
  const [category, setCategory] = React.useState('general');

  const categories = [
    { key: 'general', label: 'General Inquiry' },
    { key: 'claim', label: 'Claims Help' },
    { key: 'policy', label: 'Policy Questions' },
    { key: 'payment', label: 'Payment Issues' },
    { key: 'kyc', label: 'KYC / Verification' },
    { key: 'technical', label: 'Technical Support' },
  ];

  const faqItems = [
    { q: 'How do I file a claim?', a: 'Go to Claims tab → File New Claim → Select your policy → Describe the incident → Upload evidence → Submit' },
    { q: 'How long does claim processing take?', a: 'Standard claims: 3-5 business days. Auto-approved claims under ₦100,000: instant. High-value claims: 7-14 business days.' },
    { q: 'How do I verify my identity (KYC)?', a: 'Go to KYC Verification → Enter your BVN (11 digits) → Enter your NIN → Complete phone verification → Upload ID document' },
    { q: 'What payment methods are supported?', a: 'Paystack (card/bank), Flutterwave (card/bank/USSD), Bank Transfer, USSD (*904#), Wallet balance' },
    { q: 'How do I renew my policy?', a: 'You will receive a notification 30 days before expiry. Tap the notification or go to Policies → Select expiring policy → Renew' },
  ];

  const [expandedFaq, setExpandedFaq] = React.useState<number | null>(null);

  const submitTicket = () => {
    if (!message.trim()) return Alert.alert('Error', 'Please enter a message');
    Alert.alert('Ticket Submitted', `Your ${category} support ticket has been created. Reference: TKT-${Date.now().toString(36).toUpperCase()}. We will respond within 24 hours.`);
    setMessage('');
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Support</Text>

      <View style={styles.contactRow}>
        <TouchableOpacity style={styles.contactBtn} onPress={() => Linking.openURL('tel:+2349012345678')}>
          <Text style={styles.contactIcon}>📞</Text>
          <Text style={styles.contactLabel}>Call</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.contactBtn} onPress={() => Linking.openURL('mailto:support@insureportal.ng')}>
          <Text style={styles.contactIcon}>✉️</Text>
          <Text style={styles.contactLabel}>Email</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.contactBtn} onPress={() => Linking.openURL('https://wa.me/2349012345678')}>
          <Text style={styles.contactIcon}>💬</Text>
          <Text style={styles.contactLabel}>WhatsApp</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Submit a Ticket</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.catScroll}>
          {categories.map((c) => (
            <TouchableOpacity key={c.key} style={[styles.catBtn, category === c.key && styles.catActive]} onPress={() => setCategory(c.key)}>
              <Text style={[styles.catText, category === c.key && styles.catTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TextInput style={styles.input} placeholder="Describe your issue..." multiline numberOfLines={4} textAlignVertical="top" value={message} onChangeText={setMessage} />
        <TouchableOpacity style={styles.button} onPress={submitTicket}>
          <Text style={styles.buttonText}>Submit Ticket</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Frequently Asked Questions</Text>
        {faqItems.map((faq, i) => (
          <TouchableOpacity key={i} style={styles.faqItem} onPress={() => setExpandedFaq(expandedFaq === i ? null : i)}>
            <Text style={styles.faqQ}>{faq.q}</Text>
            {expandedFaq === i && <Text style={styles.faqA}>{faq.a}</Text>}
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  contactRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 },
  contactBtn: { alignItems: 'center', backgroundColor: '#fff', padding: 16, borderRadius: 12, width: '30%', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 1 },
  contactIcon: { fontSize: 28, marginBottom: 8 },
  contactLabel: { fontSize: 13, fontWeight: '600', color: '#475569' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b', marginBottom: 12 },
  catScroll: { marginBottom: 12 },
  catBtn: { backgroundColor: '#f1f5f9', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, marginRight: 8 },
  catActive: { backgroundColor: '#2563eb' },
  catText: { fontSize: 12, color: '#475569', fontWeight: '600' },
  catTextActive: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 12, fontSize: 14, marginBottom: 12, minHeight: 100 },
  button: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  faqItem: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9', paddingVertical: 12 },
  faqQ: { fontSize: 14, fontWeight: '600', color: '#1e293b' },
  faqA: { fontSize: 13, color: '#64748b', marginTop: 8, lineHeight: 18 },
});
