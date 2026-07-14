import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Linking } from 'react-native';
import { api } from '../services/api';

export default function SupportScreen() {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!subject || !message) return Alert.alert('Error', 'Please fill all fields');
    setSubmitting(true);
    try {
      await api.mutate('support.createTicket', { subject, message });
      Alert.alert('Submitted', 'Your support ticket has been created. We will respond within 24 hours.');
      setSubject('');
      setMessage('');
    } catch {
      Alert.alert('Error', 'Failed to submit ticket');
    }
    setSubmitting(false);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.header}>Support Center</Text>

      <View style={styles.quickActions}>
        <TouchableOpacity style={styles.quickBtn} onPress={() => Linking.openURL('tel:+2349012345678')}>
          <Text style={styles.quickIcon}>📞</Text>
          <Text style={styles.quickLabel}>Call Us</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => Linking.openURL('https://wa.me/2349012345678')}>
          <Text style={styles.quickIcon}>💬</Text>
          <Text style={styles.quickLabel}>WhatsApp</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.quickBtn} onPress={() => Linking.openURL('mailto:support@insureportal.ng')}>
          <Text style={styles.quickIcon}>📧</Text>
          <Text style={styles.quickLabel}>Email</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.faqSection}>
        <Text style={styles.sectionTitle}>FAQ</Text>
        {[
          { q: 'How do I file a claim?', a: 'Go to Claims → File New Claim → upload photos → submit' },
          { q: 'How long does KYC take?', a: 'BVN/NIN verification is instant. ID documents take 24-48 hours.' },
          { q: 'Can I cancel my policy?', a: 'Yes, go to Policies → select policy → Request Cancellation. Pro-rata refund applies.' },
          { q: 'How do I add a beneficiary?', a: 'Go to Profile → Beneficiaries → Add New Beneficiary' },
        ].map((faq, i) => (
          <View key={i} style={styles.faqItem}>
            <Text style={styles.faqQ}>{faq.q}</Text>
            <Text style={styles.faqA}>{faq.a}</Text>
          </View>
        ))}
      </View>

      <View style={styles.ticketForm}>
        <Text style={styles.sectionTitle}>Submit a Ticket</Text>
        <TextInput style={styles.input} placeholder="Subject" value={subject} onChangeText={setSubject} />
        <TextInput style={[styles.input, styles.textarea]} placeholder="Describe your issue..." value={message} onChangeText={setMessage} multiline numberOfLines={4} />
        <TouchableOpacity style={[styles.submitBtn, submitting && styles.disabled]} onPress={submit} disabled={submitting}>
          <Text style={styles.submitText}>{submitting ? 'Submitting...' : 'Submit Ticket'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { fontSize: 24, fontWeight: 'bold', padding: 16, backgroundColor: '#fff' },
  quickActions: { flexDirection: 'row', justifyContent: 'space-around', padding: 16, backgroundColor: '#fff', marginTop: 8 },
  quickBtn: { alignItems: 'center', padding: 12 },
  quickIcon: { fontSize: 28 },
  quickLabel: { marginTop: 4, fontWeight: '500' },
  sectionTitle: { fontSize: 18, fontWeight: '600', marginBottom: 12 },
  faqSection: { padding: 16, backgroundColor: '#fff', marginTop: 8 },
  faqItem: { marginBottom: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  faqQ: { fontWeight: '600', fontSize: 15 },
  faqA: { color: '#666', marginTop: 4 },
  ticketForm: { padding: 16, backgroundColor: '#fff', marginTop: 8, marginBottom: 24 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 16, marginBottom: 12 },
  textarea: { height: 100, textAlignVertical: 'top' },
  submitBtn: { backgroundColor: '#2563eb', padding: 16, borderRadius: 8, alignItems: 'center' },
  disabled: { opacity: 0.5 },
  submitText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
