/**
 * MemberSupport.tsx — /member/support (W7-B8, 2026-10-04)
 *
 * Wired to the REAL member helpdesk + feedback routers:
 *   - memberHelpDesk.myTickets     (server/routers/memberHelpDesk.ts:103)
 *   - memberHelpDesk.myTicket      (:135 — ticket + message thread)
 *   - memberHelpDesk.createTicket  (:167 — owner forced server-side)
 *   - memberHelpDesk.replyTicket   (:224 — resolved tickets reject)
 *   - memberFeedback.submitMyFeedback (server/routers/memberFeedback.ts:88)
 *   - memberFeedback.myFeedback         (:117 — caller's own rows only)
 *
 * DESIGN DECISION (2026-10-04, W7-B8): feedback is a SECTION on this page
 * (not a separate page) — both are member→platform contact surfaces and a
 * single "Support" nav entry keeps the member nav compact.
 *
 * All identity is resolved server-side from the session; the client never
 * sends a userId/customerId. Inputs are zod-exact (subject/description/
 * priority enum; score 1..10 int; channel fixed to the "web" default).
 * Server error messages are surfaced verbatim; no fabricated rows.
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

function statusVariant(status: string | null | undefined) {
  switch (status) {
    case "open":
      return "default" as const;
    case "resolved":
      return "secondary" as const;
    case "escalated":
      return "destructive" as const;
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

/** Create-ticket form — zod-exact memberHelpDesk.createTicket input. */
function CreateTicketForm({ onCreated }: { onCreated: () => void }) {
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("low");
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = trpc.memberHelpDesk.createTicket.useMutation({
    onSuccess: () => {
      setFormError(null);
      setSubject("");
      setDescription("");
      setPriority("low");
      onCreated();
    },
    onError: (err: { message: string }) => setFormError(err.message),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!subject.trim() || !description.trim()) {
      setFormError("Subject and description are required.");
      return;
    }
    createMutation.mutate({
      subject: subject.trim(),
      description: description.trim(),
      priority,
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 max-w-lg">
      {formError && <FormError message={formError} />}
      <div className="space-y-2">
        <Label htmlFor="ticket-subject">Subject</Label>
        <Input
          id="ticket-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={256}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ticket-description">Description</Label>
        <Textarea
          id="ticket-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={4000}
          rows={4}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="ticket-priority">Priority</Label>
        <Select
          value={priority}
          onValueChange={(v) => setPriority(v as "low" | "medium" | "high")}
        >
          <SelectTrigger id="ticket-priority" aria-label="Priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={createMutation.isPending}>
        {createMutation.isPending ? "Submitting…" : "Submit ticket"}
      </Button>
    </form>
  );
}

/** Ticket detail: full thread + member reply (resolved threads reject). */
function TicketDetail({ ticketId }: { ticketId: number }) {
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);

  const detailQuery = trpc.memberHelpDesk.myTicket.useQuery(
    { id: ticketId },
    { retry: false }
  );
  const replyMutation = trpc.memberHelpDesk.replyTicket.useMutation({
    onSuccess: () => {
      setReply("");
      setReplyError(null);
      detailQuery.refetch();
    },
    onError: (err: { message: string }) => setReplyError(err.message),
  });

  if (detailQuery.isLoading) return <MemberLoading label="Loading ticket" />;
  if (detailQuery.isError)
    return <MemberError message={detailQuery.error.message} />;
  const ticket = detailQuery.data?.ticket;
  if (!ticket) return <MemberError message="Ticket not found" />;
  const messages = detailQuery.data?.messages ?? [];

  const submitReply = (e: React.FormEvent) => {
    e.preventDefault();
    setReplyError(null);
    if (!reply.trim()) {
      setReplyError("Reply text is required.");
      return;
    }
    // zod-exact: { ticketId: int>0, content: 1..4000 }
    replyMutation.mutate({ ticketId, content: reply.trim() });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold">{ticket.subject ?? "—"}</h3>
        <Badge variant={statusVariant(ticket.status)}>{ticket.status}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Reference {ticket.sessionRef ?? `#${ticket.id}`} · Opened{" "}
        {fmtDate(ticket.createdAt)}
      </p>
      <div className="space-y-2">
        {messages.map((m) => (
          <div
            key={m.id}
            className="border rounded-md p-3 text-sm"
            data-testid={`ticket-message-${m.id}`}
          >
            <p className="text-xs text-muted-foreground mb-1">
              {m.senderName ??
                (m.senderType === "support" ? "Support" : "You")}{" "}
              · {fmtDate(m.createdAt)}
            </p>
            <p>{m.content}</p>
          </div>
        ))}
      </div>
      {ticket.status === "resolved" ? (
        <p className="text-sm text-muted-foreground border rounded-md p-3">
          This ticket is resolved and no longer accepts replies. Open a new
          ticket if you need further help.
        </p>
      ) : (
        <form onSubmit={submitReply} className="space-y-3">
          {replyError && <FormError message={replyError} />}
          <div className="space-y-2">
            <Label htmlFor="ticket-reply">Reply</Label>
            <Textarea
              id="ticket-reply"
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

/** Feedback submit + own history (memberFeedback router). */
function FeedbackSection() {
  const [score, setScore] = useState("8");
  const [feedback, setFeedback] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const historyQuery = trpc.memberFeedback.myFeedback.useQuery(
    { limit: 20, offset: 0 },
    { retry: false }
  );
  const submitMutation = trpc.memberFeedback.submitMyFeedback.useMutation({
    onSuccess: () => {
      setFormError(null);
      setFeedback("");
      setSubmitted(true);
      historyQuery.refetch();
    },
    onError: (err: { message: string }) => {
      setSubmitted(false);
      setFormError(err.message);
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setSubmitted(false);
    const parsed = Number(score);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 10) {
      setFormError("Score must be a whole number between 1 and 10.");
      return;
    }
    // zod-exact: score int 1..10, feedback optional ≤2000 (omitted when
    // blank), channel defaults to "web" server-side.
    submitMutation.mutate({
      score: parsed,
      ...(feedback.trim() ? { feedback: feedback.trim() } : {}),
    });
  };

  const items = historyQuery.data?.items ?? [];

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="space-y-4 max-w-lg">
        {formError && <FormError message={formError} />}
        {submitted && (
          <p className="text-sm border rounded-md p-3" role="status">
            Thank you — your feedback was submitted.
          </p>
        )}
        <div className="space-y-2">
          <Label htmlFor="feedback-score">Score (1–10)</Label>
          <Input
            id="feedback-score"
            type="number"
            min={1}
            max={10}
            step={1}
            value={score}
            onChange={(e) => setScore(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="feedback-text">Feedback (optional)</Label>
          <Textarea
            id="feedback-text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            maxLength={2000}
            rows={3}
          />
        </div>
        <Button type="submit" disabled={submitMutation.isPending}>
          {submitMutation.isPending ? "Submitting…" : "Submit feedback"}
        </Button>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Your previous feedback</h3>
        {historyQuery.isLoading ? (
          <MemberLoading label="Loading feedback history" />
        ) : historyQuery.isError ? (
          <MemberError message={historyQuery.error.message} />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            You have not submitted any feedback yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {items.map((f) => (
              <li key={f.id} className="border rounded-md p-3 text-sm">
                <p className="text-xs text-muted-foreground mb-1">
                  Score {f.score}/10 · {f.channel ?? "web"} ·{" "}
                  {fmtDate(f.createdAt)}
                </p>
                <p>{f.feedback ?? "—"}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function MemberSupport() {
  const [selectedTicketId, setSelectedTicketId] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const ticketsQuery = trpc.memberHelpDesk.myTickets.useQuery(undefined, {
    retry: false,
  });
  const tickets = ticketsQuery.data?.tickets ?? [];

  return (
    <MemberLayout>
      <div className="space-y-6">
        <MemberSection
          title="Support Tickets"
          description="Your conversations with our support team."
        >
          {ticketsQuery.isLoading ? (
            <MemberLoading label="Loading your tickets" />
          ) : ticketsQuery.isError ? (
            <MemberError message={ticketsQuery.error.message} />
          ) : (
            <div className="space-y-4">
              <div className="flex justify-end">
                <Button
                  variant={showCreate ? "outline" : "default"}
                  onClick={() => setShowCreate((v) => !v)}
                >
                  {showCreate ? "Close form" : "New ticket"}
                </Button>
              </div>
              {showCreate && (
                <CreateTicketForm
                  onCreated={() => {
                    setShowCreate(false);
                    ticketsQuery.refetch();
                  }}
                />
              )}
              {tickets.length === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  You have no support tickets yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {tickets.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        className={`w-full text-left border rounded-md p-3 hover:bg-accent ${
                          selectedTicketId === t.id ? "border-primary" : ""
                        }`}
                        onClick={() =>
                          setSelectedTicketId(
                            selectedTicketId === t.id ? null : t.id
                          )
                        }
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {t.subject ?? "—"}
                          </span>
                          <Badge variant={statusVariant(t.status)}>
                            {t.status}
                          </Badge>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {t.sessionRef ?? `#${t.id}`} · {fmtDate(t.createdAt)}
                        </span>
                      </button>
                      {selectedTicketId === t.id && (
                        <div className="border border-t-0 rounded-b-md p-4">
                          <TicketDetail ticketId={t.id} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </MemberSection>

        <MemberSection
          title="Feedback"
          description="Rate your experience — your feedback goes straight to the platform team."
        >
          <FeedbackSection />
        </MemberSection>
      </div>
    </MemberLayout>
  );
}
