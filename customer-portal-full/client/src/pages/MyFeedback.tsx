/**
 * MyFeedback.tsx — R3 batch 6 (2026-10-01, R3-b6)
 * Member structured feedback (route /my-feedback).
 * BINDING: REAL — memberFeedback.submitMyFeedback / myFeedback
 * (server/routers/memberFeedback.ts, protectedProcedure over the real
 * customer_feedback_nps table; customerId is stamped server-side from the
 * caller's resolved customer — this page NEVER sends a customerId).
 * NOT_FOUND/FORBIDDEN → null is only a defensive fallback for older
 * deployments; the page shows the server's exact error on submit (e.g. no
 * customer profile). No data is fabricated.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, Star } from "lucide-react";
import { memberFeedbackApi } from "@/services/memberFeedbackApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

export default function MyFeedback() {
  const queryClient = useQueryClient();
  const [score, setScore] = useState<number>(8);
  const [feedback, setFeedback] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const listQuery = useQuery({
    queryKey: ["memberFeedback", "myFeedback"],
    queryFn: () => memberFeedbackApi.myFeedback({ limit: 20 }),
    retry: 1,
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      memberFeedbackApi.submitMyFeedback({
        score,
        feedback: feedback.trim() || undefined,
        channel: "web",
      }),
    onSuccess: () => {
      setActionError(null);
      setSubmitted(true);
      setFeedback("");
      void queryClient.invalidateQueries({ queryKey: ["memberFeedback"] });
    },
    onError: error => {
      // Honest failure surface: show the server's exact reason.
      setSubmitted(false);
      setActionError(error instanceof Error ? error.message : String(error));
    },
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          My Feedback
        </h1>
        <p className="text-sm text-stone-500">
          Tell us how we are doing. Your rating and comments go straight to
          our service team.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Star className="h-5 w-5 text-amber-600" aria-hidden />
            Rate your experience
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="space-y-4"
            onSubmit={e => {
              e.preventDefault();
              setActionError(null);
              setSubmitted(false);
              submitMutation.mutate();
            }}
          >
            <label className="block text-sm text-stone-600">
              Overall rating (1–10)
              <input
                required
                type="number"
                min={1}
                max={10}
                className="mt-1 w-32 rounded-lg border border-stone-300 px-3 py-2 text-sm"
                value={score}
                onChange={e => setScore(Number(e.target.value))}
              />
            </label>
            <label className="block text-sm text-stone-600">
              Comments (optional)
              <textarea
                maxLength={2000}
                rows={4}
                className="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-sm"
                placeholder="What went well? What should we improve?"
                value={feedback}
                onChange={e => setFeedback(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={submitMutation.isPending}
              className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {submitMutation.isPending ? "Sending…" : "Submit feedback"}
            </button>
            {submitted && (
              <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                Thank you — your feedback was recorded.
              </p>
            )}
            {actionError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {actionError}
              </p>
            )}
          </form>
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <MessageSquare className="h-5 w-5 text-amber-600" aria-hidden />
            Your previous feedback
          </CardTitle>
        </CardHeader>
        <CardContent>
          {listQuery.isLoading ? (
            <LoadingState label="Loading your feedback…" />
          ) : listQuery.isError ? (
            <ErrorState
              message="We couldn’t load your feedback. Please try again."
              onRetry={() => listQuery.refetch()}
            />
          ) : listQuery.data === null ? (
            <UnavailableState feature="Feedback history" />
          ) : (listQuery.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="No feedback yet"
              hint="Your submitted ratings will appear here."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {listQuery.data!.items.map(item => (
                <li key={item.id} className="py-3">
                  <p className="text-sm font-medium text-stone-900">
                    {item.score}/10{" "}
                    <span className="font-normal text-stone-500">
                      via {item.channel} ·{" "}
                      {new Date(item.createdAt).toLocaleDateString()}
                    </span>
                  </p>
                  {item.feedback && (
                    <p className="mt-1 text-sm text-stone-600">
                      {item.feedback}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
