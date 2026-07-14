import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { api } from '../services/api';

export default function QuoteScreen() {
  const [product, setProduct] = useState('Motor Comprehensive');
  const [sumAssured, setSumAssured] = useState('5000000');
  const [age, setAge] = useState('35');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const products = ['Motor Comprehensive', 'Motor Third Party', 'Home Contents', 'Health Individual', 'Life Term', 'Travel'];

  async function calculateQuote() {
    setLoading(true);
    try {
      const data = await api.query('premium.calculate', { product, sumAssured: Number(sumAssured), age: Number(age) });
      setResult(data);
    } catch {
      Alert.alert('Error', 'Failed to calculate premium');
    } finally {
      setLoading(false);
    }
  }

  return (
    <ScrollView style={s.container}>
      <Text style={s.title}>Get a Quote</Text>
      <Text style={s.subtitle}>Calculate your premium instantly</Text>

      <Text style={s.label}>Product</Text>
      <View style={s.productGrid}>
        {products.map((p) => (
          <TouchableOpacity key={p} style={[s.productBtn, product === p && s.productBtnActive]} onPress={() => setProduct(p)}>
            <Text style={[s.productBtnText, product === p && s.productBtnTextActive]}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={s.label}>Sum Assured (₦)</Text>
      <TextInput style={s.input} value={sumAssured} onChangeText={setSumAssured} keyboardType="numeric" placeholder="e.g. 5000000" />

      <Text style={s.label}>Age</Text>
      <TextInput style={s.input} value={age} onChangeText={setAge} keyboardType="numeric" placeholder="e.g. 35" />

      <TouchableOpacity style={[s.btn, loading && s.btnDisabled]} onPress={calculateQuote} disabled={loading}>
        <Text style={s.btnText}>{loading ? 'Calculating...' : 'Calculate Premium'}</Text>
      </TouchableOpacity>

      {result && (
        <View style={s.resultCard}>
          <Text style={s.resultTitle}>Your Quote</Text>
          <View style={s.resultRow}>
            <Text style={s.resultLabel}>Annual Premium</Text>
            <Text style={s.resultValue}>₦{Number(result.annualPremium || result.premium || 0).toLocaleString()}</Text>
          </View>
          <View style={s.resultRow}>
            <Text style={s.resultLabel}>Monthly</Text>
            <Text style={s.resultValue}>₦{Math.round(Number(result.annualPremium || result.premium || 0) / 12).toLocaleString()}</Text>
          </View>
          <View style={s.resultRow}>
            <Text style={s.resultLabel}>Coverage</Text>
            <Text style={s.resultValue}>₦{Number(sumAssured).toLocaleString()}</Text>
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b' },
  subtitle: { fontSize: 15, color: '#64748b', marginBottom: 24 },
  label: { fontSize: 14, fontWeight: '600', color: '#475569', marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: '#fff', borderRadius: 12, padding: 14, fontSize: 16, borderWidth: 1, borderColor: '#e2e8f0', color: '#1e293b' },
  productGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  productBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: '#e2e8f0', backgroundColor: '#fff' },
  productBtnActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  productBtnText: { fontSize: 13, color: '#64748b' },
  productBtnTextActive: { color: '#fff', fontWeight: '600' },
  btn: { backgroundColor: '#2563eb', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 24 },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  resultCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginTop: 24, borderWidth: 2, borderColor: '#2563eb' },
  resultTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b', marginBottom: 16 },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  resultLabel: { fontSize: 15, color: '#64748b' },
  resultValue: { fontSize: 15, fontWeight: '700', color: '#1e293b' },
});
