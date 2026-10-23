/**
 * RecentPayeePicker.tsx — 2026-10-06 (W11-B1c): RN port of the web
 * client/src/pages/member/RecentPayeePicker.tsx (W11-B1b) over the same
 * W11-B1a server surface (server/routers/memberPayees.ts), via
 * payeesApi.list/remove (src/services/api.ts — memberTrpc Bearer + the
 * superjson envelope unwrap in config.ts):
 *
 *   - payeesApi.list(rail) → the caller's recent payees for one rail (≤50
 *     server-side, most-recently-used first, decrypted server-side). The
 *     picker shows the top 5 as selectable chips with the provenance line
 *     "last paid ₦X · <date>".
 *   - payeesApi.remove(id) → delete one of the CALLER'S payees (ownership
 *     enforced server-side; foreign ids are NOT_FOUND).
 *
 * Hard rules (mirrored by the callers, web parity):
 *   - Selecting a payee prefills ONLY the identifier fields for the rail
 *     (biller/meter, network/phone, provider) via the onSelect callback. The
 *     AMOUNT IS NEVER PREFILLED — the last amount is a provenance hint only,
 *     and the member always types the amount explicitly before any submit.
 *   - Prefill NEVER blocks the payment UX: a list error degrades silently
 *     (console.warn, no picker — the form stays fully usable), and an empty
 *     directory renders an honest "will appear here" note. Payees are
 *     recorded SERVER-SIDE on successful captures — the client never writes
 *     payee rows.
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { payeesApi, type PayeeRail, type RecentPayee } from '../services/api';

const MAX_SHOWN = 5;

const fmtNgnFromKobo = (kobo: number) => `₦${(kobo / 100).toLocaleString('en-NG')}`;

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : null;

/** The rail-specific destination identifier shown under the payee label. */
function identifier(p: RecentPayee): string {
  switch (p.rail) {
    case 'bill':
      return [p.billerCode, p.meterNumber].filter(Boolean).join(' · ');
    case 'airtime':
      return [p.network, p.phone].filter(Boolean).join(' · ');
    case 'momo':
      return [p.provider, p.walletNumber].filter(Boolean).join(' · ');
  }
}

export function RecentPayeePicker({
  rail,
  onSelect,
}: {
  rail: PayeeRail;
  /** Called with the chosen payee; the PARENT applies the identifier
   *  prefill (and clears the amount — the amount is never carried over). */
  onSelect: (payee: RecentPayee) => void;
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['memberPayees.list', rail],
    queryFn: () => payeesApi.list(rail),
  });

  const onRemove = async (id: string) => {
    try {
      await payeesApi.remove(id);
      // Refresh every rail-scoped list cache entry (web parity: invalidate).
      await queryClient.invalidateQueries({ queryKey: ['memberPayees.list'] });
    } catch (e: any) {
      // Removal is a convenience affordance; a failure must not disturb the
      // surrounding payment form.
      console.warn('memberPayees.remove failed:', e?.message);
    }
  };

  if (query.isError) {
    // 2026-10-06 (W11-B1c): silent degrade by contract — prefill failure
    // never blocks the payment UX.
    console.warn(
      `memberPayees.list(${rail}) failed; prefill disabled:`,
      (query.error as Error)?.message,
    );
    return null;
  }
  if (query.isLoading) return null;

  const payees = (query.data?.payees ?? []).slice(0, MAX_SHOWN);
  if (payees.length === 0) {
    return (
      <Text style={styles.hint} testID="recent-payees-empty">
        Your recent payees will appear here after a successful payment.
      </Text>
    );
  }

  return (
    <View style={styles.wrap} testID="recent-payees">
      <Text style={styles.hint}>
        From your recent payments — select one to prefill the details below
        (you can still edit everything; the amount is never prefilled).
      </Text>
      <View style={styles.chipsRow}>
        {payees.map((p) => {
          const used = fmtDate(p.lastUsedAt);
          const provenance =
            p.lastAmountKobo != null
              ? `last paid ${fmtNgnFromKobo(p.lastAmountKobo)}${used ? ` · ${used}` : ''}`
              : used
                ? `last used ${used}`
                : null;
          return (
            <View key={p.id} style={styles.chipWrap}>
              <TouchableOpacity
                style={styles.chip}
                testID={`payee-chip-${p.id}`}
                accessibilityLabel={`Payee ${p.label}`}
                onPress={() => onSelect(p)}
              >
                <Text style={styles.chipLabel}>{p.label}</Text>
                {identifier(p) ? (
                  <Text style={styles.chipMeta}>{identifier(p)}</Text>
                ) : null}
                {provenance ? (
                  <Text style={styles.chipMeta}>{provenance}</Text>
                ) : null}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.removeBtn}
                accessibilityLabel={`Remove payee ${p.label}`}
                onPress={() => onRemove(p.id)}
              >
                <Text style={styles.removeText}>✕</Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, gap: 6 },
  hint: { fontSize: 12, color: '#64748b', marginTop: 12 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  chip: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  chipLabel: { fontSize: 13, fontWeight: '600', color: '#0f172a' },
  chipMeta: { fontSize: 11, color: '#64748b', marginTop: 2 },
  removeBtn: { padding: 4 },
  removeText: { fontSize: 12, color: '#94a3b8' },
});
