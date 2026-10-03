import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 1): quote cart mirroring the web member portal
// MemberQuotes.tsx (W7-B5) on the REAL memberQuotes router
// (server/routers/memberQuotes.ts):
//   - myQuoteCart / quoteSummary (reads, honest empty cart)
//   - addToQuoteCart (premium priced by the fail-closed server rating
//     engine — mobile NEVER computes or displays a premium the server did
//     not return; PRECONDITION_FAILED is surfaced verbatim and nothing is
//     added)
//   - removeQuoteItem / clearQuoteCart
// The product picker reads the real insuranceProductCatalog.listProducts
// (same procedure ProductBrowserScreen and the web portal use).
import { quotesApi, MemberQuoteRow } from '../services/api';
import { memberQuery } from '../services/memberTrpc';

const fmtNgn = (n: number) => `₦${(n || 0).toLocaleString('en-NG')}`;
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : '—';

export function QuotesScreen({ navigation }: { navigation: any }) {
  const queryClient = useQueryClient();
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [sumInsured, setSumInsured] = useState('');
  const [durationMonths, setDurationMonths] = useState('12');
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const cartQuery = useQuery({
    queryKey: ['memberQuotes.myQuoteCart'],
    queryFn: () => quotesApi.cart(),
  });
  const summaryQuery = useQuery({
    queryKey: ['memberQuotes.quoteSummary'],
    queryFn: () => quotesApi.summary(),
  });
  const productsQuery = useQuery<any[]>({
    queryKey: ['insuranceProductCatalog.listProducts'],
    queryFn: async () => {
      const res = await memberQuery<{ data: any[]; total: number }>(
        'insuranceProductCatalog.listProducts', { limit: 100, offset: 0, productType: 'all', isActive: true },
      );
      return res?.data ?? [];
    },
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['memberQuotes.myQuoteCart'] });
    queryClient.invalidateQueries({ queryKey: ['memberQuotes.quoteSummary'] });
  };

  async function handleAdd() {
    setFormError(null);
    setSuccessMessage(null);
    const sum = Number(sumInsured);
    const dur = Number(durationMonths);
    if (selectedProductId == null) { setFormError('Select a product.'); return; }
    if (!Number.isFinite(sum) || sum <= 0) { setFormError('Enter a valid sum insured.'); return; }
    if (!Number.isInteger(dur) || dur < 1 || dur > 120) { setFormError('Enter a duration between 1 and 120 months.'); return; }
    setBusy(true);
    try {
      // Input shape = server zod schema exactly (memberQuotes.addToQuoteCart):
      // { productId, sumInsured, durationMonths } — NO premium; the rating
      // engine prices it server-side.
      const res = await quotesApi.add({ productId: selectedProductId, sumInsured: sum, durationMonths: dur });
      setSumInsured('');
      setSuccessMessage(`Quote added — premium ${fmtNgn(res.premiumAmount)} (${res.currency})`);
      invalidate();
    } catch (e: any) {
      // Fail-closed rating engine: PRECONDITION_FAILED means NO quote was
      // added — surface the server message honestly.
      setFormError(e?.message || 'Quote request failed — no quote was added.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(quoteId: number) {
    setFormError(null);
    setBusy(true);
    try {
      await quotesApi.remove(quoteId);
      invalidate();
    } catch (e: any) {
      setFormError(e?.message || 'Could not remove the quote.');
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    setFormError(null);
    setBusy(true);
    try {
      const res = await quotesApi.clear();
      setSuccessMessage(`Cart cleared (${res.cancelled} quote(s) cancelled)`);
      invalidate();
    } catch (e: any) {
      setFormError(e?.message || 'Could not clear the cart.');
    } finally {
      setBusy(false);
    }
  }

  const items: MemberQuoteRow[] = cartQuery.data?.items ?? [];
  const products = productsQuery.data ?? [];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>My Quotes</Text>
        <Text style={styles.subtitle}>
          Pending quote cart. Premiums are priced from filed rating tables; if pricing is unavailable no quote is created.
        </Text>
      </View>

      <View style={styles.section}>
        {cartQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading your quote cart…</Text></View>
        ) : cartQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(cartQuery.error as Error)?.message}</Text></View>
        ) : items.length === 0 ? (
          <Text style={styles.empty}>Your quote cart is empty. Use the form below to request a quote.</Text>
        ) : (
          <>
            {items.map((q) => (
              <View key={q.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.productName}>{q.productName ?? `Quote #${q.id}`}</Text>
                  <View style={styles.badge}><Text style={styles.badgeText}>{q.status}</Text></View>
                </View>
                <View style={styles.row}><Text style={styles.label}>Sum insured</Text><Text style={styles.value}>{fmtNgn(Number(q.sumInsured ?? 0))}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Premium</Text><Text style={styles.value}>{fmtNgn(Number(q.premiumAmount ?? 0))}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Total payable</Text><Text style={styles.value}>{fmtNgn(Number(q.totalPayable ?? 0))}</Text></View>
                <View style={styles.row}><Text style={styles.label}>Duration</Text><Text style={styles.value}>{q.durationMonths ?? '—'} mo</Text></View>
                <View style={styles.row}><Text style={styles.label}>Valid until</Text><Text style={styles.value}>{fmtDate(q.validUntil)}</Text></View>
                <TouchableOpacity
                  accessibilityLabel={`Remove quote ${q.id}`}
                  style={styles.removeBtn}
                  disabled={busy}
                  onPress={() => handleRemove(q.id)}
                >
                  <Text style={styles.removeText}>Remove</Text>
                </TouchableOpacity>
              </View>
            ))}
            <View style={styles.summaryRow}>
              <Text style={styles.summaryText}>
                {summaryQuery.isError
                  ? 'Summary unavailable.'
                  : `${summaryQuery.data?.count ?? items.length} item(s) — total premium ${fmtNgn(summaryQuery.data?.totalPremium ?? cartQuery.data?.totalPremium ?? 0)} ${cartQuery.data?.currency ?? 'NGN'}`}
              </Text>
              <TouchableOpacity style={styles.clearBtn} disabled={busy} onPress={handleClear}>
                <Text style={styles.clearText}>Clear cart</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Request a Quote</Text>
        <Text style={styles.sectionDesc}>Pick a product and sum insured. The premium is computed by the server rating engine.</Text>
        {productsQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading products…</Text></View>
        ) : productsQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(productsQuery.error as Error)?.message}</Text></View>
        ) : products.length === 0 ? (
          <Text style={styles.empty}>No insurance products are currently available.</Text>
        ) : (
          <>
            <View style={styles.chipGrid}>
              {products.map((p: any) => (
                <TouchableOpacity
                  key={p.id}
                  style={[styles.chip, selectedProductId === Number(p.id) && styles.chipActive]}
                  onPress={() => setSelectedProductId(Number(p.id))}
                >
                  <Text style={[styles.chipText, selectedProductId === Number(p.id) && { color: '#fff' }]}>{p.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.fieldLabel}>Sum insured (NGN)</Text>
            <TextInput
              style={styles.input}
              value={sumInsured}
              onChangeText={setSumInsured}
              keyboardType="numeric"
              placeholder="e.g. 5000000"
              placeholderTextColor="#94a3b8"
              accessibilityLabel="Sum insured"
            />
            <Text style={styles.fieldLabel}>Duration (months)</Text>
            <TextInput
              style={styles.input}
              value={durationMonths}
              onChangeText={setDurationMonths}
              keyboardType="numeric"
              placeholder="12"
              placeholderTextColor="#94a3b8"
              accessibilityLabel="Duration in months"
            />
            {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}
            {successMessage ? <Text style={styles.formSuccess}>{successMessage}</Text> : null}
            <TouchableOpacity style={[styles.submitBtn, busy && styles.submitDisabled]} disabled={busy} onPress={handleAdd}>
              <Text style={styles.submitText}>{busy ? 'Working…' : 'Add to quote cart'}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  header: { paddingHorizontal: 20, paddingTop: 60, paddingBottom: 16 },
  back: { fontSize: 16, color: '#2563eb', marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '700', color: '#0f172a' },
  subtitle: { fontSize: 13, color: '#64748b', marginTop: 6 },
  section: { marginHorizontal: 16, marginTop: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#0f172a', marginBottom: 4 },
  sectionDesc: { fontSize: 13, color: '#64748b', marginBottom: 12 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  productName: { fontSize: 16, fontWeight: '600', color: '#0f172a', flex: 1 },
  badge: { backgroundColor: '#eab30820', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#eab308', textTransform: 'uppercase' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  label: { fontSize: 13, color: '#64748b' },
  value: { fontSize: 13, fontWeight: '500', color: '#0f172a' },
  removeBtn: { marginTop: 8, alignSelf: 'flex-end', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, backgroundColor: '#fef2f2' },
  removeText: { fontSize: 13, fontWeight: '600', color: '#dc2626' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8 },
  summaryText: { fontSize: 13, color: '#64748b', flex: 1, marginRight: 8 },
  clearBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  clearText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 13, color: '#334155', fontWeight: '500' },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 16, marginBottom: 8 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  formError: { fontSize: 13, color: '#dc2626', marginTop: 12 },
  formSuccess: { fontSize: 13, color: '#16a34a', marginTop: 12 },
  submitBtn: { backgroundColor: '#2563eb', paddingVertical: 16, borderRadius: 12, alignItems: 'center', marginTop: 20 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 24, fontSize: 14 },
});
