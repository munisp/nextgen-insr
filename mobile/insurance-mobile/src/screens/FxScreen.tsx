import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 3): FX screen mirroring the web member portal
// MemberFx.tsx (W7-B10) on the REAL read-only memberFxRates router
// (server/routers/memberFxRates.ts):
//   - rates      (published EUR-base rate book; empty map + null timestamp
//                 when none — never fabricated)
//   - convert    (EUR-base conversion over the stored book; fails loud
//                 PRECONDITION_FAILED on a missing/malformed book — surfaced
//                 verbatim)
//   - currencies (codes derived from the stored book)
//   - historical (real Frankfurter/ECB time-series)
// READ-ONLY: the base router's updateRates/refresh mutations are broken authz
// and flagged for the funds wave — never exposed or called here, so no
// rate-editing or exchange UI exists and none is faked (web parity).
import { fxApi } from '../services/api';

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString('en-NG') : '—';

function CurrencyChips({
  codes, value, onChange, labelPrefix,
}: { codes: string[]; value: string; onChange: (v: string) => void; labelPrefix: string }) {
  const shown = codes.length > 0 ? codes : ['EUR', 'NGN', 'USD'];
  return (
    <View style={styles.chipsRow}>
      {shown.map((c) => (
        <TouchableOpacity
          key={c}
          style={[styles.chip, value === c && styles.chipActive]}
          onPress={() => onChange(c)}
          accessibilityLabel={`${labelPrefix} ${c}`}
        >
          <Text style={[styles.chipText, value === c && { color: '#fff' }]}>{c}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function FxScreen({ navigation }: { navigation: any }) {
  const [from, setFrom] = useState<string>('NGN');
  const [to, setTo] = useState<string>('USD');
  const [amount, setAmount] = useState<string>('1000');
  const [convertReq, setConvertReq] = useState<{ from: string; to: string; amount: number } | null>(null);
  const [histBase, setHistBase] = useState<string>('NGN');
  const [histTarget, setHistTarget] = useState<string>('USD');
  const [histReq, setHistReq] = useState<{ base: string; target: string; days: number } | null>(null);

  const ratesQuery = useQuery({
    queryKey: ['memberFxRates.rates'],
    queryFn: () => fxApi.rates(),
  });
  const currenciesQuery = useQuery({
    queryKey: ['memberFxRates.currencies'],
    queryFn: () => fxApi.currencies(),
  });
  const convertQuery = useQuery({
    queryKey: ['memberFxRates.convert', convertReq?.from, convertReq?.to, convertReq?.amount],
    queryFn: () => fxApi.convert(convertReq!),
    enabled: convertReq !== null,
  });
  const historicalQuery = useQuery({
    queryKey: ['memberFxRates.historical', histReq?.base, histReq?.target, histReq?.days],
    queryFn: () => fxApi.historical(histReq!),
    enabled: histReq !== null,
  });

  const rates = ratesQuery.data?.rates ?? {};
  const rateEntries = Object.entries(rates).sort(([a], [b]) => a.localeCompare(b));
  const codes = (currenciesQuery.data?.currencies ?? []).map((c) => c.code);

  const onConvert = () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0 || !from || !to) return;
    setConvertReq({ from, to, amount: n });
  };
  const onLoadHistorical = () => {
    if (!histBase || !histTarget) return;
    setHistReq({ base: histBase, target: histTarget, days: 30 });
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Exchange Rates</Text>
        <Text style={styles.subtitle}>
          The published rate book (units per 1 EUR). When no rates have been published the table is empty — we never show fixture rates.
        </Text>
      </View>

      <View style={styles.section}>
        {ratesQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading exchange rates…</Text></View>
        ) : ratesQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(ratesQuery.error as Error)?.message}</Text></View>
        ) : rateEntries.length === 0 ? (
          <Text style={styles.empty}>No exchange rates have been published yet.</Text>
        ) : (
          <>
            <Text style={styles.metaLine}>
              Base: {ratesQuery.data?.baseCurrency ?? 'EUR'} · Last updated: {fmtDate(ratesQuery.data?.lastUpdated)}
            </Text>
            {rateEntries.map(([code, rate]) => (
              <View key={code} style={styles.row} testID={`fx-rate-${code}`}>
                <Text style={styles.rowName}>{code}</Text>
                <Text style={styles.rowMeta}>{Number(rate).toFixed(4)}</Text>
              </View>
            ))}
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Convert</Text>
        <Text style={styles.sectionDesc}>
          Conversion over the published rate book. If no usable rates are stored the error is shown honestly.
        </Text>
        <Text style={styles.fieldLabel}>From</Text>
        <CurrencyChips codes={codes} value={from} onChange={setFrom} labelPrefix="From" />
        <Text style={styles.fieldLabel}>To</Text>
        <CurrencyChips codes={codes} value={to} onChange={setTo} labelPrefix="To" />
        <Text style={styles.fieldLabel}>Amount</Text>
        <TextInput
          style={styles.input}
          value={amount}
          onChangeText={setAmount}
          keyboardType="decimal-pad"
          accessibilityLabel="FX amount"
        />
        <TouchableOpacity style={styles.submitBtn} onPress={onConvert} accessibilityLabel="Convert button">
          <Text style={styles.submitText}>Convert</Text>
        </TouchableOpacity>
        {convertReq ? (
          <View style={{ marginTop: 12 }} testID="convert-result">
            {convertQuery.isLoading ? (
              <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Converting…</Text></View>
            ) : convertQuery.isError ? (
              <View style={styles.errorBox}><Text style={styles.errorText}>{(convertQuery.error as Error)?.message}</Text></View>
            ) : convertQuery.data ? (
              <View style={styles.noteBox}>
                <Text style={styles.noteText}>
                  {convertQuery.data.amount} {convertQuery.data.from} = {convertQuery.data.convertedAmount.toFixed(2)} {convertQuery.data.to}
                  {'  '}(rate {convertQuery.data.rate.toFixed(6)})
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Historical Rates</Text>
        <Text style={styles.sectionDesc}>Real ECB time-series (via Frankfurter) for the last 30 days.</Text>
        <Text style={styles.fieldLabel}>Base</Text>
        <CurrencyChips codes={codes} value={histBase} onChange={setHistBase} labelPrefix="History base" />
        <Text style={styles.fieldLabel}>Target</Text>
        <CurrencyChips codes={codes} value={histTarget} onChange={setHistTarget} labelPrefix="History target" />
        <TouchableOpacity style={styles.outlineBtn} onPress={onLoadHistorical}>
          <Text style={styles.outlineBtnText}>Load history</Text>
        </TouchableOpacity>
        {histReq ? (
          <View style={{ marginTop: 12 }}>
            {historicalQuery.isLoading ? (
              <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading historical rates…</Text></View>
            ) : historicalQuery.isError ? (
              <View style={styles.errorBox}><Text style={styles.errorText}>{(historicalQuery.error as Error)?.message}</Text></View>
            ) : (historicalQuery.data?.timeseries ?? []).length === 0 ? (
              <Text style={styles.metaLine}>No historical data returned for this pair.</Text>
            ) : (
              <>
                <Text style={styles.fieldLabel}>
                  {historicalQuery.data?.base} → {historicalQuery.data?.target}
                </Text>
                {(historicalQuery.data?.timeseries ?? []).map((t) => (
                  <View key={t.date} style={styles.row}>
                    <Text style={styles.rowName}>{t.date}</Text>
                    <Text style={styles.rowMeta}>{Number(t.rate).toFixed(4)}</Text>
                  </View>
                ))}
              </>
            )}
          </View>
        ) : null}
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
  sectionTitle: { fontSize: 17, fontWeight: '600', color: '#0f172a', marginBottom: 4 },
  sectionDesc: { fontSize: 12, color: '#64748b', marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#fff', borderRadius: 10, padding: 14, marginBottom: 6 },
  rowName: { fontSize: 14, fontWeight: '600', color: '#0f172a' },
  rowMeta: { fontSize: 13, color: '#64748b' },
  metaLine: { fontSize: 12, color: '#64748b', marginBottom: 10 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 12, marginBottom: 6 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 12, color: '#334155', fontWeight: '500' },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  submitBtn: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  outlineBtn: { borderWidth: 1, borderColor: '#2563eb', paddingVertical: 12, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  outlineBtnText: { color: '#2563eb', fontSize: 14, fontWeight: '700' },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 24, fontSize: 14 },
  noteBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginBottom: 10 },
  noteText: { fontSize: 13, color: '#0f172a' },
});
