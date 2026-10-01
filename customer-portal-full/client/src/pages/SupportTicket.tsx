/**
 * SupportTicket.tsx — R3 batch 1 member helpdesk (2026-10-01, R3)
 * Route: /support/:id — one of the caller's tickets: message thread + reply.
 * BINDING: REAL — memberHelpDesk.myTicket / memberHelpDesk.replyTicket
 * (server/routers/memberHelpDesk.ts; ownership-checked, NOT_FOUND is
 * non-enumerating for cross-member ids — surfaced here via the disclosed
 * UnavailableState fallback, never a fabricated thread). Resolved tickets
 * hide the reply box (the server rejects replies to resolved threads).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { supportApi, type TicketStatus } from "@/services/supportApi";
import {
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function statusTone(status: TicketStatus): string {
  switch (status) {
    case "resolved":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "open":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    case "escalated":
      return "bg-red-50 text-red-700 ring-red-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

/** Sender label: the member's own messages are senderType "agent" (the
 *  account-party side of a support chat — the sender_type enum has no
 *  "customer" value); "support"/"system" are staff-side. */
function senderLabel(senderType: string, senderName: string | null): string {
  if (senderType === "agent") return senderName ?? "You";
  if (senderType === "support") return senderName ?? "Support team";
  return "System";
}

export default function SupportTicket() {
  const params = useParams<{ id: string }>();
  const ticketId = Number(params.id);
  const validId = Number.isInteger(ticketId) && ticketId > 0;

  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);

  const ticket = useQuery({
    queryKey: ["support", "ticket", ticketId],
    queryFn: () => supportApi.myTicket(ticketId),
    enabled: validId,
    retry: 1,
  });

  const send = useMutation({
    mutationFn: () =>
      supportApi.replyTicket({ ticketId, content: reply.trim() }),
    onSuccess: () => {
      setReply("");
      setReplyError(null);
      queryClient.invalidateQueries({
        queryKey: ["support", "ticket", ticketId],
      });
    },
    onError: error => {
      setReplyError(
        error instanceof Error
          ? error.message
          : "We couldn’t send your reply. Please try again."
      );
    },
  });

  const submitReply = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) {
      setReplyError("Please write a reply before sending.");
      return;
    }
    setReplyError(null);
    send.mutate();
  };

  if (!validId) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
        <ErrorState message="This ticket link is not valid." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-8">
      <Link
        href="/support"
        className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to your tickets
      </Link>

      {ticket.isLoading ? (
        <LoadingState label="Loading your ticket…" />
      ) : ticket.isError ? (
        <ErrorState
          message="We couldn’t load this ticket. Please try again."
          onRetry={() => ticket.refetch()}
        />
      ) : ticket.data === null ? (
        <UnavailableState feature="Support tickets" />
      ) : (
        <>
          <Card className="border-stone-200">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3 text-lg text-stone-800">
                <span className="flex min-w-0 items-center gap-2">
                  <MessagesSquare
                    className="h-5 w-5 shrink-0 text-amber-600"
                    aria-hidden
                  />
                  <span className="truncate">
                    {ticket.data!.ticket.subject ??
                      `Ticket ${ticket.data!.ticket.sessionRef}`}
                  </span>
                </span>
                <Badge
                  className={`shrink-0 ring-1 ring-inset ${statusTone(ticket.data!.ticket.status)}`}
                >
                  {ticket.data!.ticket.status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-stone-500">
                {ticket.data!.ticket.sessionRef} · opened{" "}
                {new Date(ticket.data!.ticket.createdAt).toLocaleString()}
                {ticket.data!.ticket.supportAgentName
                  ? ` · handled by ${ticket.data!.ticket.supportAgentName}`
                  : ""}
              </p>
            </CardContent>
          </Card>

          <Card className="border-stone-200">
            <CardHeader>
              <CardTitle className="text-base text-stone-800">
                Conversation
              </CardTitle>
            </CardHeader>
            <CardContent>
              {ticket.data!.messages.length === 0 ? (
                <p className="text-sm text-stone-500">
                  No messages on this ticket yet.
                </p>
              ) : (
                <ul className="space-y-4">
                  {ticket.data!.messages.map(m => (
                    <li
                      key={m.id}
                      className={`rounded-xl border p-3 ${
                        m.senderType === "agent"
                          ? "border-amber-200 bg-amber-50"
                          : "border-stone-200 bg-white"
                      }`}
                    >
                      <p className="text-xs font-medium text-stone-500">
                        {senderLabel(m.senderType, m.senderName)} ·{" "}
                        {new Date(m.createdAt).toLocaleString()}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-stone-800">
                        {m.content}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {ticket.data!.ticket.status === "resolved" ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              This ticket has been resolved. If you need further help, please
              open a new request.
            </p>
          ) : (
            <Card className="border-stone-200">
              <CardContent className="pt-6">
                <form className="space-y-3" onSubmit={submitReply}>
                  <Textarea
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    maxLength={4000}
                    rows={4}
                    placeholder="Write a reply to the support team…"
                    aria-label="Reply"
                  />
                  {replyError && (
                    <p className="text-sm text-red-600" role="alert">
                      {replyError}
                    </p>
                  )}
                  <Button type="submit" disabled={send.isPending}>
                    {send.isPending ? "Sending…" : "Send reply"}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
