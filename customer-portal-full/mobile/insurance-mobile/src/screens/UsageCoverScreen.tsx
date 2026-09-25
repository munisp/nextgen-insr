/**
 * UsageCoverScreen.tsx — Q-wave Q6 (2026-09-25)
 * Self-contained usage-based (per-trip / per-day) motor cover activation.
 * Reads and mutates via the Q3 usageCover.* backend (forward-looking;
 * feature-detected). If the backend is absent, activation is disabled with a
 * disclosed notice — no fake activation is ever shown.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { usageCoverApi, UsageCoverActivation } from '../services/innovation';

type CoverType = 'per_trip' | 'per_day';

export default function UsageCoverScreen() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [coverType, setCoverType] = useState<CoverType>('per_day');
  const [activations, setActivations] = useState<UsageCoverActivation[] | null>(null);
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const result = await usageCoverApi.myActivations();
      setBackendAvailable(result !== null);
      setActivations(result?.activations ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load activations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activate = async () => {
    setBusy(true);
    try {
      const result = await usageCoverApi.activate({ coverType });
      if (result === null) {
        Alert.alert('Not available yet', 'Usage-based cover is not available on this deployment yet.');
      } else {
        Alert.alert('Cover activated', 'Drive safely!');
        await load();
      }
    } catch (e) {
      Alert.alert('Activation failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (activationId: number) => {
    setBusy(true);
    try {
      const result = await usageCoverApi.deactivate({ activationId });
      if (result === null) {
        Alert.alert('Not available yet', 'Usage-based cover is not available on this deployment yet.');
      } else {
        await load();
      }
    } catch (e) {
      Alert.alert('Deactivation failed', e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator size="large" color="#b45309" />
      </View>
    );
  }

  return (
    <ScrollView style={s.container}>
      <Text style={s.title}>Usage-Based Cover</Text>
      <Text style={s.mutedLeft}>
        Switch comprehensive motor cover on only when you drive — per trip or per day.
      </Text>

      <View style={s.typeRow}>
        {([
          { value: 'per_trip' as CoverType, label: 'Per trip' },
          { value: 'per_day' as CoverType, label: 'Per day' },
        ]).map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[s.typeButton, coverType === opt.value && s.typeButtonActive]}
            onPress={() => setCoverType(opt.value)}
          >
            <Text style={[s.typeButtonText, coverType === opt.value && s.typeButtonTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {!backendAvailable && !error && (
        <View style={s.notice}>
          <Text style={s.noticeText}>
            Usage-based cover isn’t available on this deployment yet. Activation
            is disabled — nothing is simulated.
          </Text>
        </View>
      )}
      {error && <Text style={s.errorText}>{error}</Text>}

      <TouchableOpacity
        style={[s.activateButton, (!backendAvailable || busy) && s.activateButtonDisabled]}
        disabled={!backendAvailable || busy}
        onPress={activate}
      >
        <Text style={s.activateButtonText}>
          {busy ? 'Working…' : `Activate ${coverType === 'per_trip' ? 'trip' : 'daily'} cover`}
        </Text>
      </TouchableOpacity>

      <Text style={s.sectionTitle}>Your activations</Text>
      {!activations || activations.length === 0 ? (
        <View style={s.card}>
          <Text style={s.muted}>No activations yet.</Text>
        </View>
      ) : (
        activations.map((a) => (
          <View key={a.id} style={s.tripRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.tripDate}>
                {a.coverType === 'per_trip' ? 'Per-trip cover' : 'Per-day cover'} · {a.status}
              </Text>
              <Text style={s.muted}>
                Activated {new Date(a.activatedAt).toLocaleString()}
                {a.expiresAt ? ` · expires ${new Date(a.expiresAt).toLocaleString()}` : ''}
                {a.premiumQuoted ? ` · ${a.currency} ${a.premiumQuoted}` : ''}
              </Text>
            </View>
            {a.status === 'active' && (
              <TouchableOpacity
                style={s.deactivateButton}
                disabled={busy}
                onPress={() => deactivate(a.id)}
              >
                <Text style={s.deactivateText}>Deactivate</Text>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fafaf9', padding: 16 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fafaf9' },
  title: { fontSize: 24, fontWeight: '700', color: '#1c1917', marginBottom: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '700', color: '#1c1917', marginTop: 20, marginBottom: 8 },
  muted: { fontSize: 13, color: '#78716c', marginTop: 4 },
  mutedLeft: { fontSize: 13, color: '#78716c', marginBottom: 16 },
  errorText: { fontSize: 14, color: '#b91c1c', marginTop: 12 },
  typeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  typeButton: { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#e7e5e4', backgroundColor: '#fff', alignItems: 'center' },
  typeButtonActive: { borderColor: '#d97706', backgroundColor: '#fffbeb' },
  typeButtonText: { fontSize: 14, fontWeight: '600', color: '#57534e' },
  typeButtonTextActive: { color: '#92400e' },
  notice: { backgroundColor: '#fffbeb', borderWidth: 1, borderColor: '#fde68a', borderRadius: 12, padding: 12, marginBottom: 12 },
  noticeText: { fontSize: 13, color: '#92400e' },
  activateButton: { backgroundColor: '#d97706', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  activateButtonDisabled: { backgroundColor: '#d6d3d1' },
  activateButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#e7e5e4' },
  tripRow: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: '#e7e5e4', flexDirection: 'row', alignItems: 'center' },
  tripDate: { fontSize: 14, fontWeight: '600', color: '#1c1917' },
  deactivateButton: { marginLeft: 12, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#d6d3d1' },
  deactivateText: { fontSize: 12, fontWeight: '600', color: '#57534e' },
});
