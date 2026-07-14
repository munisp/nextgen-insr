import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { api } from '../services/api';

interface Beneficiary {
  id: number;
  name: string;
  relationship: string;
  phone: string;
  percentage: number;
  policyNumber?: string;
}

export default function BeneficiariesScreen() {
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', relationship: '', phone: '', percentage: '' });

  useEffect(() => { loadBeneficiaries(); }, []);

  async function loadBeneficiaries() {
    try {
      const data = await api.query('beneficiaries.list');
      setBeneficiaries(Array.isArray(data) ? data : []);
    } catch {} finally { setLoading(false); }
  }

  async function addBeneficiary() {
    if (!form.name || !form.relationship || !form.percentage) {
      Alert.alert('Error', 'Name, relationship, and percentage are required');
      return;
    }
    try {
      await api.mutate('beneficiaries.create', { ...form, percentage: Number(form.percentage) });
      setShowAdd(false);
      setForm({ name: '', relationship: '', phone: '', percentage: '' });
      loadBeneficiaries();
    } catch { Alert.alert('Error', 'Failed to add beneficiary'); }
  }

  if (loading) return <View style={s.center}><ActivityIndicator size="large" color="#2563eb" /></View>;

  return (
    <View style={s.container}>
      <View style={s.headerRow}>
        <Text style={s.title}>Beneficiaries</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => setShowAdd(!showAdd)}>
          <Text style={s.addBtnText}>{showAdd ? 'Cancel' : '+ Add'}</Text>
        </TouchableOpacity>
      </View>

      {showAdd && (
        <View style={s.formCard}>
          <TextInput style={s.input} placeholder="Full Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} />
          <TextInput style={s.input} placeholder="Relationship (Spouse, Child, Parent)" value={form.relationship} onChangeText={(v) => setForm({ ...form, relationship: v })} />
          <TextInput style={s.input} placeholder="Phone" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v })} keyboardType="phone-pad" />
          <TextInput style={s.input} placeholder="Percentage (%)" value={form.percentage} onChangeText={(v) => setForm({ ...form, percentage: v })} keyboardType="numeric" />
          <TouchableOpacity style={s.saveBtn} onPress={addBeneficiary}><Text style={s.saveBtnText}>Save</Text></TouchableOpacity>
        </View>
      )}

      <FlatList
        data={beneficiaries}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={s.card}>
            <View style={s.row}>
              <Text style={s.name}>{item.name}</Text>
              <Text style={s.pct}>{item.percentage}%</Text>
            </View>
            <Text style={s.meta}>{item.relationship} • {item.phone || 'No phone'}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={s.empty}>No beneficiaries added. Tap + Add to designate your beneficiaries.</Text>}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#1e293b' },
  addBtn: { backgroundColor: '#2563eb', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  addBtnText: { color: '#fff', fontWeight: '600' },
  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  input: { backgroundColor: '#f1f5f9', borderRadius: 8, padding: 12, fontSize: 15, marginBottom: 8, color: '#1e293b' },
  saveBtn: { backgroundColor: '#22c55e', borderRadius: 8, padding: 14, alignItems: 'center', marginTop: 4 },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
  pct: { fontSize: 18, fontWeight: '700', color: '#2563eb' },
  meta: { fontSize: 13, color: '#64748b', marginTop: 4 },
  empty: { textAlign: 'center', color: '#94a3b8', marginTop: 40, fontSize: 15, lineHeight: 22 },
});
