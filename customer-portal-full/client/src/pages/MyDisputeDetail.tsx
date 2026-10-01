/**
 * MyDisputeDetail.tsx — R3 batch 2 (2026-10-01, R3-b2)
 * Member dispute detail + reply thread on the monolith (route
 * /my-disputes/:id).
 * BINDING: REAL — memberDisputes.myDispute / memberDisputes.replyDispute
 * (server/routers/memberDisputes.ts, protectedProcedure, ownership-scoped;
 * senderType is forced "customer" server-side and resolved/closed disputes
 * reject replies with PRECONDITION_FAILED, surfaced verbatim).
 * NOT_FOUND/FORBIDDEN → null renders the disclosed unavailable state. No
 * data is fabricated.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Gavel, MessageSquare } from "lucide-react";
import { memberDisputesApi } from "@/services/memberDisputesApi";
import {
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function statusTone(status: string): string {
  switch (status) {
    case "resolved":
    case "closed":
      return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
    case "open":
    case "investigating":
    case "escalated":
      return "bg-amber-50 text-amber-700 ring-amber-600/20";
    default:
      return "bg-stone-100 text-stone-600 ring-stone-500/20";
  }
}

export default function MyDisputeDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["memberDisputes", "myDispute", id],
    queryFn: () => memberDisputesApi.myDispute({ id }),
    retry: 1,
    enabled: Number.isInteger(id) && id > 0,
  });

  const replyMutation = useMutation({
    mutationFn: () =>
      memberDisputesApi.replyDispute({ disputeId: id, content: reply.trim() }),
    onSuccess: () => {
      setReply("");
      setReplyError(null);
      void queryClient.invalidateQueries({
        queryKey: ["memberDisputes", "myDispute", id],
      });
    },
    onError: error => {
      // Honest failure surface: e.g. "Dispute is resolved and no longer
      // accepts replies".
      setReplyError(
        error instanceof Error ? error.message : "Reply failed to send"
      );
    },
  });

  if (detail.isLoading) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <LoadingState label="Loading dispute…" />
      </div>
    );
  }
  if (detail.isError) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <ErrorState
          message="We couldn’t load this dispute. Please try again."
          onRetry={() => detail.refetch()}
        />
      </div>
    );
  }
  if (detail.data === null || detail.data === undefined) {
    return (
      <div className="mx-auto max-w-3xl p-4 md:p-8">
        <UnavailableState feature="Dispute detail" />
      </div>
    );
  }

  const { dispute, messages, evidence } = detail.data;
  const acceptsReplies =
    dispute.status !== "resolved" && dispute.status !== "closed";

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <Link
        href="/my-disputes"
        className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-stone-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to my disputes
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-stone-900">
            Dispute {dispute.ref}
          </h1>
          <p className="text-sm text-stone-500">
            Filed {new Date(dispute.createdAt).toLocaleString()}
            {dispute.transactionRef
              ? ` · transaction ${dispute.transactionRef}`
              : ""}
          </p>
        </div>
        <Badge className={`ring-1 ring-inset ${statusTone(dispute.status)}`}>
          {dispute.status}
        </Badge>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Gavel className="h-5 w-5 text-amber-600" aria-hidden />
            Details
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-stone-700">
          {dispute.reason && <p className="font-medium">{dispute.reason}</p>}
          {dispute.description && <p>{dispute.description}</p>}
          <dl className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <div className="flex justify-between gap-4">
              <dt className="text-stone-500">Disputed amount</dt>
              <dd>{dispute.amount ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-stone-500">Priority</dt>
              <dd>{dispute.priority}</dd>
            </div>
            {dispute.resolution && (
              <div className="flex justify-between gap-4 md:col-span-2">
                <dt className="text-stone-500">Resolution</dt>
                <dd className="text-right">{dispute.resolution}</dd>
              </div>
            )}
            {dispute.resolvedAt && (
              <div className="flex justify-between gap-4 md:col-span-2">
                <dt className="text-stone-500">Resolved at</dt>
                <dd>{new Date(dispute.resolvedAt).toLocaleString()}</dd>
              </div>
            )}
          </dl>
          {evidence.length > 0 && (
            <div>
              <p className="mb-1 font-medium text-stone-800">Evidence</p>
              <ul className="space-y-1">
                {evidence.map(ev => (
                  <li key={ev.id}>
                    <a
                      href={ev.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-amber-700 underline"
                    >
                      {ev.fileName}
                    </a>
                    {ev.mimeType && (
                      <span className="ml-2 text-xs text-stone-500">
                        {ev.mimeType}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <MessageSquare className="h-5 w-5 text-amber-600" aria-hidden />
            Messages
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {messages.length === 0 ? (
            <p className="text-sm text-stone-500">
              No messages yet. Replies you send appear here.
            </p>
          ) : (
            <ul className="space-y-3">
              {messages.map(m => (
                <li
                  key={m.id}
                  className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700 ring-1 ring-inset ring-stone-200"
                >
                  <p className="mb-1 text-xs text-stone-500">
                    {m.senderName ?? m.senderType ?? "Participant"} ·{" "}
                    {new Date(m.createdAt).toLocaleString()}
                  </p>
                  <p>{m.content}</p>
                </li>
              ))}
            </ul>
          )}

          {acceptsReplies ? (
            <form
              className="space-y-3 border-t border-stone-100 pt-4"
              onSubmit={e => {
                e.preventDefault();
                setReplyError(null);
                if (reply.trim().length > 0 && !replyMutation.isPending) {
                  replyMutation.mutate();
                }
              }}
            >
              <label className="block text-sm">
                <span className="mb-1 block text-stone-600">Add a reply</span>
                <textarea
                  maxLength={4000}
                  rows={3}
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                  placeholder="Write your reply…"
                  required
                />
              </label>
              {replyError && (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-inset ring-red-600/20">
                  {replyError}
                </p>
              )}
              <button
                type="submit"
                disabled={reply.trim().length === 0 || replyMutation.isPending}
                className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {replyMutation.isPending ? "Sending…" : "Send reply"}
              </button>
            </form>
          ) : (
            <p className="border-t border-stone-100 pt-4 text-sm text-stone-500">
              This dispute is {dispute.status} and no longer accepts replies.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
