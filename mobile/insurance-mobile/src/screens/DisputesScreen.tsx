import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
// 2026-10-03 (W9-B5 wave 2): disputes screen mirroring the web member portal
// MemberDisputes.tsx (W7-B8) on the REAL memberDisputes router
// (server/routers/memberDisputes.ts):
//   - myDisputes  (caller-scoped via disputes.agentId = ctx.user.id; optional
//     status filter)
//   - myDispute   (detail + messages + evidence; NOT_FOUND non-enumerating)
//   - fileDispute (the disputed transaction's ownership is verified
//     server-side FIRST; agentId/ref/status forced server-side — the input
//     carries only { transactionId, reason, description, amount } where
//     amount is the member-DECLARED disputed amount; NO funds move)
//   - replyDispute (resolved/closed reject PRECONDITION_FAILED)
// Transaction picker parity (MemberDisputes.tsx:85-92): selects from the
// caller's REAL transactions via memberSavings.myTransactions; when the list
// is unavailable/empty the member can enter the numeric transaction ID
// manually — the server re-verifies ownership either way.
// No escalate/resolve/status-change UI — staff workflow; the member router
// deliberately does not expose it.
import {
  disputesApi, savingsApi, DISPUTE_STATUSES, DisputeStatusFilter,
  MemberDisputeRow, MemberSavingsTxRow,
} from '../services/api';

const fmtAmount = (a: string | number | null | undefined) =>
  a == null ? '—' : `₦${Number(a).toLocaleString('en-NG')}`;
const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-NG') : '—';

const badgeStyleFor = (status: string | null | undefined) =>
  status === 'open' ? styles.badgeOk
    : status === 'investigating' || status === 'escalated' ? styles.badgeBad
      : status === 'resolved' || status === 'closed' ? styles.badgePending
        : styles.badgeNeutral;

/** File-dispute form — zod-exact memberDisputes.fileDispute input. */
function FileDisputeForm({ onFiled }: { onFiled: () => void }) {
  const [transactionId, setTransactionId] = useState('');
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Real caller transactions for the picker (memberSavings.myTransactions,
  // transactions-table rows). Read-only aid; ownership is enforced
  // server-side regardless.
  const txQuery = useQuery({
    queryKey: ['memberSavings.myTransactions', 'dispute-picker'],
    queryFn: () => savingsApi.myTransactions({ limit: 100, offset: 0 }),
  });
  const transactions: MemberSavingsTxRow[] = txQuery.data?.transactions ?? [];

  async function submit() {
    setFormError(null);
    const txId = Number(transactionId);
    const amt = Number(amount);
    if (!Number.isInteger(txId) || txId <= 0) { setFormError('Select or enter a valid transaction ID.'); return; }
    if (!reason.trim() || !description.trim()) { setFormError('Reason and description are required.'); return; }
    if (!Number.isFinite(amt) || amt <= 0) { setFormError('Enter a valid disputed amount.'); return; }
    setBusy(true);
    try {
      // zod-exact: { transactionId: int>0, reason 1..256, description
      // 1..4000, amount number >0 ≤100_000_000 } — amount is the declared
      // disputed amount; no funds move, nothing is computed client-side.
      await disputesApi.fileDispute({
        transactionId: txId, reason: reason.trim(), description: description.trim(), amount: amt,
      });
      setTransactionId(''); setReason(''); setDescription(''); setAmount('');
      onFiled();
    } catch (e: any) {
      setFormError(e?.message || 'Could not file the dispute.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.formCard}>
      {formError ? <Text accessibilityRole="alert" style={styles.formError}>{formError}</Text> : null}
      <Text style={styles.fieldLabel}>Transaction</Text>
      {transactions.length > 0 ? (
        // Selectable list of the caller's real transactions (values are the
        // numeric transactions.id) — same semantics as the web <select>.
        <View style={styles.txList}>
          {transactions.map((t) => (
            <TouchableOpacity
              key={t.id}
              style={[styles.txOption, transactionId === String(t.id) && styles.txOptionActive]}
              onPress={() => setTransactionId(String(t.id))}
              accessibilityLabel={`Select transaction ${t.ref ?? t.id}`}
            >
              <Text style={styles.txOptionText}>
                {t.ref ?? `#${t.id}`} · {fmtAmount(t.amount)} · {fmtDate(t.createdAt)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : (
        <TextInput
          style={styles.input}
          value={transactionId}
          onChangeText={setTransactionId}
          keyboardType="number-pad"
          placeholder="Transaction ID"
          placeholderTextColor="#94a3b8"
          accessibilityLabel="Transaction ID"
        />
      )}
      {txQuery.isError ? (
        <Text style={styles.metaLine}>
          Could not load your transactions ({(txQuery.error as Error)?.message}) — enter the transaction ID manually.
        </Text>
      ) : null}
      <Text style={styles.fieldLabel}>Reason</Text>
      <TextInput style={styles.input} value={reason} onChangeText={setReason} maxLength={256} placeholderTextColor="#94a3b8" accessibilityLabel="Dispute reason" />
      <Text style={styles.fieldLabel}>Description</Text>
      <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} maxLength={4000} multiline numberOfLines={4} placeholderTextColor="#94a3b8" accessibilityLabel="Dispute description" />
      <Text style={styles.fieldLabel}>Disputed amount (₦)</Text>
      <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholderTextColor="#94a3b8" accessibilityLabel="Disputed amount" />
      <TouchableOpacity style={[styles.submitBtn, busy && styles.submitDisabled]} disabled={busy} onPress={submit}>
        <Text style={styles.submitText}>{busy ? 'Filing…' : 'File dispute'}</Text>
      </TouchableOpacity>
    </View>
  );
}

/** Dispute detail: messages + evidence + reply (resolved/closed reject). */
function DisputeDetail({ disputeId }: { disputeId: number }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState('');
  const [replyError, setReplyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['memberDisputes.myDispute', disputeId],
    queryFn: () => disputesApi.myDispute(disputeId),
  });

  if (detailQuery.isLoading) {
    return <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading dispute…</Text></View>;
  }
  if (detailQuery.isError) {
    return <View style={styles.errorBox}><Text style={styles.errorText}>{(detailQuery.error as Error)?.message}</Text></View>;
  }
  const dispute = detailQuery.data?.dispute;
  if (!dispute) {
    return <View style={styles.errorBox}><Text style={styles.errorText}>Dispute not found</Text></View>;
  }
  const messages = detailQuery.data?.messages ?? [];
  const evidence = detailQuery.data?.evidence ?? [];
  const closed = dispute.status === 'resolved' || dispute.status === 'closed';

  async function submitReply() {
    setReplyError(null);
    if (!reply.trim()) { setReplyError('Reply text is required.'); return; }
    setBusy(true);
    try {
      // zod-exact: { disputeId: int>0, content: 1..4000 }
      await disputesApi.replyDispute({ disputeId, content: reply.trim() });
      setReply('');
      queryClient.invalidateQueries({ queryKey: ['memberDisputes.myDispute', disputeId] });
    } catch (e: any) {
      setReplyError(e?.message || 'Could not send the reply.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.detail}>
      <View style={styles.cardHeader}>
        <Text style={styles.detailRef}>{dispute.ref}</Text>
        <View style={[styles.badge, badgeStyleFor(dispute.status)]}>
          <Text style={styles.badgeText}>{dispute.status}</Text>
        </View>
      </View>
      <Text style={styles.descText}>{dispute.reason}</Text>
      <Text style={styles.metaLine}>{dispute.description}</Text>
      <Text style={styles.metaLine}>
        Amount {fmtAmount(dispute.amount)} · Transaction {dispute.transactionRef ?? `#${dispute.transactionId}`} · Filed {fmtDate(dispute.createdAt)}
      </Text>
      {dispute.resolution ? (
        <View style={styles.noteBox}><Text style={styles.noteText}>Resolution: {dispute.resolution}</Text></View>
      ) : null}

      {messages.length > 0 ? (
        <View style={{ marginTop: 8 }}>
          {messages.map((m) => (
            <View key={m.id} style={styles.messageCard} testID={`dispute-message-${m.id}`}>
              <Text style={styles.metaLine}>
                {m.senderName ?? (m.senderType === 'customer' ? 'You' : 'Support')} · {fmtDate(m.createdAt)}
              </Text>
              <Text style={styles.descText}>{m.content}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {evidence.length > 0 ? (
        <View style={{ marginTop: 8 }}>
          <Text style={styles.fieldLabel}>Evidence</Text>
          {evidence.map((ev) => (
            <Text key={ev.id} style={styles.metaLine}>• {ev.fileName ?? 'Attachment'}</Text>
          ))}
        </View>
      ) : null}

      {closed ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>This dispute is {dispute.status} and no longer accepts replies.</Text>
        </View>
      ) : (
        <View style={{ marginTop: 8 }}>
          {replyError ? <Text accessibilityRole="alert" style={styles.formError}>{replyError}</Text> : null}
          <Text style={styles.fieldLabel}>Reply</Text>
          <TextInput style={[styles.input, styles.multiline]} value={reply} onChangeText={setReply} maxLength={4000} multiline numberOfLines={3} placeholderTextColor="#94a3b8" accessibilityLabel="Dispute reply" />
          <TouchableOpacity style={[styles.submitBtn, busy && styles.submitDisabled]} disabled={busy} onPress={submitReply}>
            <Text style={styles.submitText}>{busy ? 'Sending…' : 'Send reply'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function DisputesScreen({ navigation }: { navigation: any }) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showFile, setShowFile] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | DisputeStatusFilter>('all');

  // zod-exact myDisputes input (optional object; status enum subset) —
  // status omitted entirely when "all".
  const disputesQuery = useQuery({
    queryKey: ['memberDisputes.myDisputes', statusFilter],
    queryFn: () => disputesApi.myDisputes(
      statusFilter === 'all' ? { limit: 50, offset: 0 } : { status: statusFilter, limit: 50, offset: 0 },
    ),
  });
  const disputes: MemberDisputeRow[] = disputesQuery.data?.disputes ?? [];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}><Text style={styles.back}>← Back</Text></TouchableOpacity>
        <Text style={styles.title}>Disputes</Text>
        <Text style={styles.subtitle}>Dispute a transaction on your account and track its progress.</Text>
      </View>

      <View style={styles.section}>
        {disputesQuery.isLoading ? (
          <View style={styles.stateBox}><ActivityIndicator color="#2563eb" /><Text style={styles.stateText}>Loading your disputes…</Text></View>
        ) : disputesQuery.isError ? (
          <View style={styles.errorBox}><Text style={styles.errorText}>{(disputesQuery.error as Error)?.message}</Text></View>
        ) : (
          <>
            <View style={styles.filterRow}>
              {(['all', ...DISPUTE_STATUSES] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, statusFilter === s && styles.chipActive]}
                  onPress={() => setStatusFilter(s)}
                  accessibilityLabel={`Filter ${s}`}
                >
                  <Text style={[styles.chipText, statusFilter === s && { color: '#fff' }]}>
                    {s === 'all' ? 'All' : s}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.toggleFormBtn}
              onPress={() => setShowFile((v) => !v)}
            >
              <Text style={styles.toggleFormText}>{showFile ? 'Close form' : 'File a dispute'}</Text>
            </TouchableOpacity>
            {showFile ? (
              <FileDisputeForm
                onFiled={() => {
                  setShowFile(false);
                  queryClient.invalidateQueries({ queryKey: ['memberDisputes.myDisputes'] });
                }}
              />
            ) : null}
            {disputes.length === 0 ? (
              <Text style={styles.empty}>You have no disputes.</Text>
            ) : (
              disputes.map((d) => (
                <View key={d.id} style={styles.card}>
                  <TouchableOpacity
                    onPress={() => setSelectedId(selectedId === d.id ? null : d.id)}
                    accessibilityLabel={`Dispute ${d.ref}`}
                  >
                    <View style={styles.cardHeader}>
                      <Text style={styles.detailRef}>{d.ref}</Text>
                      <View style={[styles.badge, badgeStyleFor(d.status)]}>
                        <Text style={styles.badgeText}>{d.status}</Text>
                      </View>
                    </View>
                    <Text style={styles.metaLine}>{d.reason} · {fmtAmount(d.amount)} · {fmtDate(d.createdAt)}</Text>
                  </TouchableOpacity>
                  {selectedId === d.id ? <DisputeDetail disputeId={d.id} /> : null}
                </View>
              ))
            )}
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
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  detailRef: { fontSize: 15, fontWeight: '600', color: '#0f172a' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  badgeOk: { backgroundColor: '#16a34a20' },
  badgePending: { backgroundColor: '#eab30820' },
  badgeBad: { backgroundColor: '#dc262620' },
  badgeNeutral: { backgroundColor: '#64748b20' },
  badgeText: { fontSize: 11, fontWeight: '600', color: '#334155', textTransform: 'uppercase' },
  metaLine: { fontSize: 12, color: '#64748b', marginTop: 4 },
  descText: { fontSize: 13, color: '#0f172a', marginTop: 4 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#2563eb' },
  chipText: { fontSize: 12, color: '#334155', fontWeight: '500', textTransform: 'capitalize' },
  toggleFormBtn: { backgroundColor: '#2563eb', paddingVertical: 12, borderRadius: 10, alignItems: 'center', marginBottom: 12 },
  toggleFormText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  formCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: '#e2e8f0' },
  txList: { gap: 6 },
  txOption: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 10 },
  txOptionActive: { borderColor: '#2563eb', backgroundColor: '#2563eb10' },
  txOptionText: { fontSize: 13, color: '#0f172a' },
  detail: { marginTop: 10, borderTopWidth: 1, borderTopColor: '#e2e8f0', paddingTop: 10 },
  messageCard: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 8, padding: 10, marginBottom: 6 },
  fieldLabel: { fontSize: 14, fontWeight: '600', color: '#334155', marginTop: 12, marginBottom: 6 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  formError: { fontSize: 13, color: '#dc2626', marginTop: 8 },
  submitBtn: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  submitDisabled: { opacity: 0.6 },
  submitText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  stateBox: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  stateText: { fontSize: 13, color: '#64748b' },
  errorBox: { backgroundColor: '#fef2f2', padding: 12, borderRadius: 8 },
  errorText: { fontSize: 13, color: '#dc2626' },
  empty: { textAlign: 'center', color: '#94a3b8', paddingVertical: 24, fontSize: 14 },
  noteBox: { borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10, padding: 12, marginTop: 10 },
  noteText: { fontSize: 13, color: '#64748b' },
});
