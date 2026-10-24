/**
 * NextActionsPanel.tsx — 2026-10-24 (W11-B3b): Phase 3 member-intelligence
 * panel for the mobile Dashboard, mirroring the web
 * client/src/pages/member/NextActionsPanel.tsx over the same W11-B3a surface
 * (memberInsights.nextBestActions via insightsApi). Renders the TOP 3
 * server-ranked suggestions with the server's explain text and a CTA that
 * NAVIGATES into the existing flow — nothing here performs an action.
 *
 *   - Empty → hidden. Error → silent degrade (console.warn, no panel).
 *   - Dismissal is CLIENT-LOCAL (W11-B3a added no server state): "Dismiss"
 *     is app-session-scoped (module-level Set — dies with the app process);
 *     the X button is "don't show again", persisted in AsyncStorage as a
 *     device-local flag (documented, not a server preference).
 *   - Instrumentation mirrors the web (services/uxTrack):
 *     recommendation_accepted on CTA tap, recommendation_dismissed /
 *     recommendation_dismissed_forever on the dismiss affordances.
 *     Metadata carries the action TYPE only.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { insightsApi, type InsightActionView } from '../services/api';
import { trackEvent } from '../services/uxTrack';

const UX_FLOW = 'member-insights';
const MAX_SHOWN = 3;
/** AsyncStorage key: action keys dismissed "forever" (device-local only). */
const FOREVER_DISMISS_KEY = 'nba-dismissed-forever';

/** App-session-scoped dismissals (module-level — the app-process session). */
const sessionDismissed = new Set<string>();

/** Stable per-action identity: type + the primary opaque ref (never
 *  member-typed text; mirrors the web insightActionKey). */
export function insightActionKey(a: InsightActionView): string {
  const ref = a.payload.policyId ?? a.payload.transactionId ?? a.payload.naturalKey ?? '';
  return `${a.type}:${String(ref)}`;
}

/** CTA destination per action type — navigation only, into existing screens
 *  (same route names as the Dashboard quick actions). */
export function insightCta(a: InsightActionView): { label: string; navigate: (nav: any) => void } {
  switch (a.type) {
    case 'policy_renewal_due': {
      const policyId = a.payload.policyId;
      return {
        label: 'Review renewal',
        navigate: (nav) =>
          nav.navigate('Policies', {
            screen: 'Renewals',
            ...(policyId != null ? { params: { policyId } } : {}),
          }),
      };
    }
    case 'failed_refund_pending':
      return {
        label: 'View payment issue',
        navigate: (nav) => nav.navigate('Policies', { screen: 'Disputes' }),
      };
    case 'recurring_bill_due':
      // Deep preselection is impossible BY DESIGN — the payload carries only
      // the blind-indexed naturalKey (HMAC), never raw identifiers. The CTA
      // lands on the rail screen where the RecentPayeePicker (W11-B1c)
      // surfaces that payee for prefill.
      return {
        label: 'Pay now',
        navigate: (nav) =>
          nav.navigate('Policies', {
            screen: a.payload.rail === 'airtime' ? 'Airtime' : 'Bills',
          }),
      };
    case 'kyc_incomplete':
      return {
        label: 'Complete KYC',
        navigate: (nav) => nav.navigate('Profile', { screen: 'KycSubmit' }),
      };
  }
}

export function NextActionsPanel({ navigation }: { navigation: any }) {
  const query = useQuery({
    queryKey: ['memberInsights.nextBestActions'],
    queryFn: () => insightsApi.nextBestActions(),
  });
  const [foreverDismissed, setForeverDismissed] = useState<Set<string>>(new Set());
  const [dismissVersion, setDismissVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(FOREVER_DISMISS_KEY)
      .then((raw) => {
        if (cancelled || !raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setForeverDismissed(new Set(parsed.filter((v) => typeof v === 'string')));
        }
      })
      .catch(() => {
        /* storage unavailable — forever-dismiss is best-effort UX */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (query.isError) {
    // Silent degrade by contract: suggestions never block the dashboard.
    console.warn('memberInsights.nextBestActions failed; panel hidden:', (query.error as Error)?.message);
    return null;
  }
  const all = query.data?.actions ?? [];
  if (all.length === 0) return null;

  const visible = all
    .filter((a) => {
      const k = insightActionKey(a);
      return !sessionDismissed.has(k) && !foreverDismissed.has(k);
    })
    .slice(0, MAX_SHOWN);
  if (visible.length === 0) return null;

  const onAccept = (a: InsightActionView) => {
    trackEvent(UX_FLOW, 'recommendation_accepted', { metadata: { action: a.type } });
    insightCta(a).navigate(navigation);
  };
  const onDismiss = (a: InsightActionView) => {
    sessionDismissed.add(insightActionKey(a));
    trackEvent(UX_FLOW, 'recommendation_dismissed', { metadata: { action: a.type } });
    setDismissVersion((v) => v + 1);
  };
  const onDismissForever = (a: InsightActionView) => {
    const next = new Set(foreverDismissed);
    next.add(insightActionKey(a));
    setForeverDismissed(next);
    AsyncStorage.setItem(FOREVER_DISMISS_KEY, JSON.stringify([...next])).catch(() => {});
    trackEvent(UX_FLOW, 'recommendation_dismissed_forever', { metadata: { action: a.type } });
    setDismissVersion((v) => v + 1);
  };
  void dismissVersion;

  return (
    <View style={styles.panel} testID="next-actions">
      <Text style={styles.title}>Suggested next steps</Text>
      <Text style={styles.subtitle}>
        Based on your account activity — nothing happens automatically; you choose what to do.
      </Text>
      {visible.map((a) => (
        <View key={insightActionKey(a)} style={styles.row} testID={`nba-${a.type}`}>
          <Text style={styles.explain}>{a.explain}</Text>
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.ctaBtn}
              onPress={() => onAccept(a)}
              accessibilityLabel={`${insightCta(a).label} (${a.type})`}
            >
              <Text style={styles.ctaText}>{insightCta(a).label}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.dismissBtn}
              onPress={() => onDismiss(a)}
              accessibilityLabel={`Dismiss suggestion ${a.type}`}
            >
              <Text style={styles.dismissText}>Dismiss</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.foreverBtn}
              onPress={() => onDismissForever(a)}
              accessibilityLabel={`Never show suggestion ${a.type} again`}
            >
              <Text style={styles.foreverText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginHorizontal: 16, marginTop: 20, backgroundColor: '#fff', borderRadius: 12, padding: 16, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  title: { fontSize: 18, fontWeight: '600', color: '#0f172a' },
  subtitle: { fontSize: 12, color: '#64748b', marginTop: 4, marginBottom: 8 },
  row: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginTop: 8 },
  explain: { fontSize: 14, color: '#0f172a' },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' },
  ctaBtn: { backgroundColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  ctaText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  dismissBtn: { borderWidth: 1, borderColor: '#2563eb', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 8 },
  dismissText: { color: '#2563eb', fontSize: 13, fontWeight: '700' },
  foreverBtn: { padding: 6 },
  foreverText: { color: '#94a3b8', fontSize: 13 },
});
