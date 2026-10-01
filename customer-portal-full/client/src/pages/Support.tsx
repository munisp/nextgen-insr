/**
 * Support.tsx — R3 batch 1 member helpdesk (2026-10-01, R3)
 * Route: /support — the caller's support tickets + create-ticket form.
 * BINDING: REAL — memberHelpDesk.myTickets / memberHelpDesk.createTicket
 * (server/routers/memberHelpDesk.ts; strictly caller-scoped, ticket owner
 * forced server-side). NOT_FOUND/FORBIDDEN → null remains only as a
 * defensive fallback for deployments that predate the mount. No tickets or
 * FAQs are fabricated.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LifeBuoy, MessageSquarePlus } from "lucide-react";
import {
  supportApi,
  type TicketStatus,
} from "@/services/supportApi";
import {
  EmptyState,
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

export default function Support() {
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high">("low");
  const [formError, setFormError] = useState<string | null>(null);

  const tickets = useQuery({
    queryKey: ["support", "tickets"],
    queryFn: () => supportApi.myTickets({ limit: 50 }),
    retry: 1,
  });

  const create = useMutation({
    mutationFn: () =>
      supportApi.createTicket({
        subject: subject.trim(),
        description: description.trim(),
        priority,
      }),
    onSuccess: result => {
      // A null result means the mount feature-detected unavailable; the list
      // refetch below surfaces that state honestly.
      if (result !== null) {
        setSubject("");
        setDescription("");
        setPriority("low");
        setFormError(null);
      }
      queryClient.invalidateQueries({ queryKey: ["support", "tickets"] });
    },
    onError: error => {
      setFormError(
        error instanceof Error
          ? error.message
          : "We couldn’t send your request. Please try again."
      );
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !description.trim()) {
      setFormError("Please enter both a subject and a description.");
      return;
    }
    setFormError(null);
    create.mutate();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Support
        </h1>
        <p className="text-sm text-stone-500">
          Raise a request with our support team and follow the conversation
          here. Replies from the team appear in the ticket thread.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <LifeBuoy className="h-5 w-5 text-amber-600" aria-hidden />
            Your tickets
          </CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.isLoading ? (
            <LoadingState label="Loading your tickets…" />
          ) : tickets.isError ? (
            <ErrorState
              message="We couldn’t load your tickets. Please try again."
              onRetry={() => tickets.refetch()}
            />
          ) : tickets.data === null ? (
            <UnavailableState feature="Support tickets" />
          ) : (tickets.data?.tickets ?? []).length === 0 ? (
            <EmptyState
              title="No support tickets yet"
              hint="When you raise a request below, it will appear here with its live status."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {tickets.data!.tickets.map(t => (
                <li key={t.id}>
                  <Link
                    href={`/support/${t.id}`}
                    className="flex items-center justify-between gap-3 py-3 hover:bg-stone-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-stone-900">
                        {t.subject ?? `Ticket ${t.sessionRef}`}
                      </p>
                      <p className="text-xs text-stone-500">
                        {t.sessionRef} · opened{" "}
                        {new Date(t.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Badge
                      className={`shrink-0 ring-1 ring-inset ${statusTone(t.status)}`}
                    >
                      {t.status}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <MessageSquarePlus className="h-5 w-5 text-amber-600" aria-hidden />
            New support request
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={submit}>
            <div className="space-y-1">
              <label
                htmlFor="support-subject"
                className="text-sm font-medium text-stone-700"
              >
                Subject
              </label>
              <Input
                id="support-subject"
                value={subject}
                onChange={e => setSubject(e.target.value)}
                maxLength={256}
                placeholder="What do you need help with?"
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="support-description"
                className="text-sm font-medium text-stone-700"
              >
                Description
              </label>
              <Textarea
                id="support-description"
                value={description}
                onChange={e => setDescription(e.target.value)}
                maxLength={4000}
                rows={5}
                placeholder="Describe the issue, including any policy or claim reference."
              />
            </div>
            <div className="space-y-1">
              <label
                htmlFor="support-priority"
                className="text-sm font-medium text-stone-700"
              >
                Priority
              </label>
              <select
                id="support-priority"
                value={priority}
                onChange={e =>
                  setPriority(e.target.value as "low" | "medium" | "high")
                }
                className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            {formError && (
              <p className="text-sm text-red-600" role="alert">
                {formError}
              </p>
            )}
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Sending…" : "Submit request"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
