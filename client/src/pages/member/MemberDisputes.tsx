/**
 * MemberDisputes.tsx — /member/disputes (W7-B8, 2026-10-04)
 *
 * Wired to the REAL member disputes router
 * (server/routers/memberDisputes.ts):
 *   - memberDisputes.myDisputes  (:109 — caller-scoped via disputes.agentId
 *     = ctx.user.id; optional status filter)
 *   - memberDisputes.myDispute   (:156 — detail + messages + evidence,
 *     NOT_FOUND non-enumerating)
 *   - memberDisputes.fileDispute (:224 — the disputed transaction's ownership
 *     is verified server-side FIRST; agentId/ref/status forced server-side)
 *   - memberDisputes.replyDispute(:304 — resolved/closed reject
 *     PRECONDITION_FAILED)
 *
 * Transaction picker (2026-10-04, W7-B8): the file form selects from the
 * caller's REAL transactions via memberSavings.myTransactions (transactions
 * table rows with id/ref/amount). If the list is unavailable or empty the
 * member can still enter the numeric transaction ID manually — the server
 * re-verifies ownership either way (NOT_FOUND for foreign ids).
 *
 * No escalate/resolve/status-change UI — those are staff workflow; the
 * member router deliberately does not expose them.
 */
import { useState } from "react";

import { trpc } from "@/lib/trpc";
import MemberLayout, {
  MemberError,
  MemberLoading,
  MemberSection,
} from "./MemberLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const fmtDate = (d: string | Date | null | undefined) =>
  d ? new Date(d).toLocaleString("en-NG") : "—";

const fmtAmount = (a: string | number | null | undefined) =>
  a == null ? "—" : `₦${Number(a).toLocaleString("en-NG")}`;

function statusVariant(status: string | null | undefined) {
  switch (status) {
    case "open":
      return "default" as const;
    case "investigating":
    case "escalated":
      return "destructive" as const;
    case "resolved":
    case "closed":
      return "secondary" as const;
    default:
      return "outline" as const;
  }
}

function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="text-sm text-destructive border border-destructive/40 rounded-md p-3"
    >
      {message}
    </p>
  );
}

/** File-dispute form — zod-exact memberDisputes.fileDispute input. */
function FileDisputeForm({ onFiled }: { onFiled: () => void }) {
  const [transactionId, setTransactionId] = useState("");
  const [reason, setReason] = useState("");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  // Real caller transactions for the picker (memberSavings.myTransactions,
  // transactions-table rows). Read-only aid; ownership is still enforced
  // server-side.
  const txQuery = trpc.memberSavings.myTransactions.useQuery(
    { limit: 100, offset: 0 },
    { retry: false }
  );
  const transactions = txQuery.data?.transactions ?? [];

  const fileMutation = trpc.memberDisputes.fileDispute.useMutation({
    onSuccess: () => {
      setFormError(null);
      setTransactionId("");
      setReason("");
      setDescription("");
      setAmount("");
      onFiled();
    },
    onError: (err: { message: string }) => setFormError(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const txId = Number(transactionId);
    const amt = Number(amount);
    if (!Number.isInteger(txId) || txId <= 0) {
      setFormError("Select or enter a valid transaction ID.");
      return;
    }
    if (!reason.trim() || !description.trim()) {
      setFormError("Reason and description are required.");
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setFormError("Enter a valid disputed amount.");
      return;
    }
    // zod-exact: { transactionId: int>0, reason 1..256, description
    // 1..4000, amount number >0 ≤100_000_000 }
    fileMutation.mutate({
      transactionId: txId,
      reason: reason.trim(),
      description: description.trim(),
      amount: amt,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-w-lg">
      {formError && <FormError message={formError} />}
      <div className="space-y-2">
        <Label htmlFor="dispute-transaction">Transaction</Label>
        {transactions.length > 0 ? (
          // Native select (2026-10-04): jsdom-testable and accessible;
          // values are the numeric transactions.id as strings.
          <select
            id="dispute-transaction"
            aria-label="Transaction"
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            required
          >
            <option value="">Select a transaction</option>
            {transactions.map((t) => (
              <option key={t.id} value={String(t.id)}>
                {t.ref ?? `#${t.id}`} · {fmtAmount(t.amount)} ·{" "}
                {fmtDate(t.createdAt)}
              </option>
            ))}
          </select>
        ) : (
          <Input
            id="dispute-transaction"
            type="number"
            min={1}
            step={1}
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            placeholder="Transaction ID"
            required
          />
        )}
        {txQuery.isError && (
          <p className="text-xs text-muted-foreground">
            Could not load your transactions ({txQuery.error.message}) — enter
            the transaction ID manually.
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="dispute-reason">Reason</Label>
        <Input
          id="dispute-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={256}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dispute-description">Description</Label>
        <Textarea
          id="dispute-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          rows={4}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dispute-amount">Disputed amount (₦)</Label>
        <Input
          id="dispute-amount"
          type="number"
          // 2026-10-04 (W7-B8): no min/step attrs — positivity is enforced
          // by the client check below and the server zod schema (amount
          // >0 ≤1e8); HTML step float-math wrongly rejects round amounts.
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </div>
      <Button type="submit" disabled={fileMutation.isPending}>
        {fileMutation.isPending ? "Filing…" : "File dispute"}
      </Button>
    </form>
  );
}

/** Dispute detail: messages + evidence + reply (resolved/closed reject). */
function DisputeDetail({ disputeId }: { disputeId: number }) {
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);

  const detailQuery = trpc.memberDisputes.myDispute.useQuery(
    { id: disputeId },
    { retry: false }
  );
  const replyMutation = trpc.memberDisputes.replyDispute.useMutation({
    onSuccess: () => {
      setReply("");
      setReplyError(null);
      detailQuery.refetch();
    },
    onError: (err: { message: string }) => setReplyError(err.message),
  });

  if (detailQuery.isLoading) return <MemberLoading label="Loading dispute" />;
  if (detailQuery.isError)
    return <MemberError message={detailQuery.error.message} />;
  const dispute = detailQuery.data?.dispute;
  if (!dispute) return <MemberError message="Dispute not found" />;
  const messages = detailQuery.data?.messages ?? [];
  const evidence = detailQuery.data?.evidence ?? [];
  const closed =
    dispute.status === "resolved" || dispute.status === "closed";

  const submitReply = (e: React.FormEvent) => {
    e.preventDefault();
    setReplyError(null);
    if (!reply.trim()) {
      setReplyError("Reply text is required.");
      return;
    }
    // zod-exact: { disputeId: int>0, content: 1..4000 }
    replyMutation.mutate({ disputeId, content: reply.trim() });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">{dispute.ref}</h3>
        <Badge variant={statusVariant(dispute.status)}>{dispute.status}</Badge>
      </div>
      <p className="text-sm">{dispute.reason}</p>
      <p className="text-sm text-muted-foreground">{dispute.description}</p>
      <p className="text-xs text-muted-foreground">
        Amount {fmtAmount(dispute.amount)} · Transaction{" "}
        {dispute.transactionRef ?? `#${dispute.transactionId}`} · Filed{" "}
        {fmtDate(dispute.createdAt)}
      </p>
      {dispute.resolution && (
        <p className="text-sm border rounded-md p-3">
          Resolution: {dispute.resolution}
        </p>
      )}

      {messages.length > 0 && (
        <div className="space-y-2">
          {messages.map((m) => (
            <div
              key={m.id}
              className="border rounded-md p-3 text-sm"
              data-testid={`dispute-message-${m.id}`}
            >
              <p className="text-xs text-muted-foreground mb-1">
                {m.senderName ??
                  (m.senderType === "customer" ? "You" : "Support")}{" "}
                · {fmtDate(m.createdAt)}
              </p>
              <p>{m.content}</p>
            </div>
          ))}
        </div>
      )}

      {evidence.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-sm font-medium">Evidence</h4>
          <ul className="text-sm list-disc pl-5">
            {evidence.map((ev) => (
              <li key={ev.id}>
                {ev.fileUrl ? (
                  <a
                    href={ev.fileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    {ev.fileName ?? "Attachment"}
                  </a>
                ) : (
                  (ev.fileName ?? "Attachment")
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {closed ? (
        <p className="text-sm text-muted-foreground border rounded-md p-3">
          This dispute is {dispute.status} and no longer accepts replies.
        </p>
      ) : (
        <form onSubmit={submitReply} className="space-y-3">
          {replyError && <FormError message={replyError} />}
          <div className="space-y-2">
            <Label htmlFor="dispute-reply">Reply</Label>
            <Textarea
              id="dispute-reply"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              maxLength={4000}
              rows={3}
              required
            />
          </div>
          <Button type="submit" disabled={replyMutation.isPending}>
            {replyMutation.isPending ? "Sending…" : "Send reply"}
          </Button>
        </form>
      )}
    </div>
  );
}

export default function MemberDisputes() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showFile, setShowFile] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // zod-exact myDisputes input (optional object; status enum subset) —
  // status omitted entirely when "all".
  const listInput =
    statusFilter === "all"
      ? { limit: 50, offset: 0 }
      : {
          status: statusFilter as
            | "open"
            | "investigating"
            | "escalated"
            | "resolved"
            | "closed",
          limit: 50,
          offset: 0,
        };
  const disputesQuery = trpc.memberDisputes.myDisputes.useQuery(listInput, {
    retry: false,
  });
  const disputes = disputesQuery.data?.disputes ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Disputes"
          description="Dispute a transaction on your account and track its progress."
        >
          {disputesQuery.isLoading ? (
            <MemberLoading label="Loading your disputes" />
          ) : disputesQuery.isError ? (
            <MemberError message={disputesQuery.error.message} />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger
                    className="w-44"
                    aria-label="Filter by status"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="open">Open</SelectItem>
                    <SelectItem value="investigating">Investigating</SelectItem>
                    <SelectItem value="escalated">Escalated</SelectItem>
                    <SelectItem value="resolved">Resolved</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant={showFile ? "outline" : "default"}
                  onClick={() => setShowFile((v) => !v)}
                >
                  {showFile ? "Close form" : "File a dispute"}
                </Button>
              </div>
              {showFile && (
                <FileDisputeForm
                  onFiled={() => {
                    setShowFile(false);
                    disputesQuery.refetch();
                  }}
                />
              )}
              {disputes.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  You have no disputes.
                </p>
              ) : (
                <ul className="space-y-2">
                  {disputes.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        className={`w-full text-left border rounded-md p-3 hover:bg-accent ${
                          selectedId === d.id ? "border-primary" : ""
                        }`}
                        onClick={() =>
                          setSelectedId(selectedId === d.id ? null : d.id)
                        }
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">{d.ref}</span>
                          <Badge variant={statusVariant(d.status)}>
                            {d.status}
                          </Badge>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {d.reason} · {fmtAmount(d.amount)} ·{" "}
                          {fmtDate(d.createdAt)}
                        </span>
                      </button>
                      {selectedId === d.id && (
                        <div className="border border-t-0 rounded-b-md p-4">
                          <DisputeDetail disputeId={d.id} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
