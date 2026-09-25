/**
 * WellnessFeed.tsx — Q-wave Q6 (2026-09-25)
 * Member wellness feed + teleconsult booking, bound to the REAL Q4 backend
 * (careRetention.wellnessFeed / teleconsultList / teleconsultBook).
 * Teleconsult booking fails closed server-side when no provider is
 * configured; that honest error is surfaced verbatim.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { HeartPulse, Stethoscope } from "lucide-react";
import { careRetentionApi } from "@/services/innovationApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/innovation/states";

const CATEGORIES = [
  "all",
  "nutrition",
  "fitness",
  "mental-health",
  "prevention",
] as const;

export default function WellnessFeed() {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const [scheduledAt, setScheduledAt] = useState("");

  const feed = useQuery({
    queryKey: ["innovation", "wellness", "feed", category],
    queryFn: () =>
      careRetentionApi.wellnessFeed({
        category: category === "all" ? undefined : category,
        limit: 20,
      }),
    retry: 1,
  });

  const teleconsults = useQuery({
    queryKey: ["innovation", "teleconsult", "list"],
    queryFn: () => careRetentionApi.teleconsultList({ limit: 10 }),
    retry: 1,
  });

  const book = useMutation({
    mutationFn: () =>
      careRetentionApi.teleconsultBook({
        scheduledAt: new Date(scheduledAt).toISOString(),
      }),
    onSuccess: result => {
      if (result) {
        toast.success("Teleconsult booked.");
        setScheduledAt("");
        queryClient.invalidateQueries({
          queryKey: ["innovation", "teleconsult"],
        });
      }
    },
    onError: error => {
      // Honest server-side failure (e.g. provider not configured) — surface verbatim.
      toast.error(error instanceof Error ? error.message : "Booking failed");
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Wellness
        </h1>
        <p className="text-sm text-stone-500">
          Curated wellbeing content from your care team, plus teleconsult
          booking when available on your plan.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <HeartPulse className="h-5 w-5 text-amber-600" aria-hidden />
            Wellness feed
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex flex-wrap gap-2"
            role="tablist"
            aria-label="Feed category"
          >
            {CATEGORIES.map(c => (
              <button
                key={c}
                role="tab"
                aria-selected={category === c}
                onClick={() => setCategory(c)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                  category === c
                    ? "bg-amber-100 text-amber-800 ring-1 ring-amber-300"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                }`}
              >
                {c.replace("-", " ")}
              </button>
            ))}
          </div>

          {feed.isLoading ? (
            <LoadingState label="Loading wellness feed…" />
          ) : feed.isError ? (
            <ErrorState
              message="We couldn’t load the wellness feed. Please try again."
              onRetry={() => feed.refetch()}
            />
          ) : (feed.data?.items ?? []).length === 0 ? (
            <EmptyState
              title="No wellness content yet"
              hint="Content published by your care team will appear here."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {feed.data!.items.map(item => (
                <li
                  key={item.id}
                  className="rounded-xl border border-stone-200 bg-white p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-stone-900">{item.title}</p>
                    <Badge className="bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-500/20 capitalize">
                      {item.category}
                    </Badge>
                  </div>
                  <p className="mt-2 line-clamp-4 text-sm text-stone-600">
                    {item.body}
                  </p>
                  {item.publishedAt && (
                    <p className="mt-2 text-xs text-stone-400">
                      {new Date(item.publishedAt).toLocaleDateString()}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Stethoscope className="h-5 w-5 text-amber-600" aria-hidden />
            Teleconsult
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <form
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={e => {
              e.preventDefault();
              if (!scheduledAt) {
                toast.warning("Pick a date and time first.");
                return;
              }
              if (new Date(scheduledAt).getTime() <= Date.now()) {
                toast.warning("Please choose a future time.");
                return;
              }
              book.mutate();
            }}
          >
            <div className="flex-1">
              <label
                htmlFor="teleconsult-at"
                className="mb-1 block text-xs font-medium text-stone-600"
              >
                Book a session (date &amp; time)
              </label>
              <Input
                id="teleconsult-at"
                type="datetime-local"
                value={scheduledAt}
                onChange={e => setScheduledAt(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={book.isPending}>
              {book.isPending ? "Booking…" : "Book teleconsult"}
            </Button>
          </form>

          {teleconsults.isLoading ? (
            <LoadingState label="Loading your sessions…" />
          ) : teleconsults.isError ? (
            <ErrorState
              message="We couldn’t load your teleconsult sessions. Please try again."
              onRetry={() => teleconsults.refetch()}
            />
          ) : (teleconsults.data?.sessions ?? []).length === 0 ? (
            <EmptyState
              title="No teleconsult sessions"
              hint="Booked sessions appear here with their live status."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {teleconsults.data!.sessions.map(s => (
                <li
                  key={s.id}
                  className="flex items-center justify-between py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {new Date(s.scheduledAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-stone-500">
                      Provider: {s.providerCode}
                    </p>
                  </div>
                  <Badge className="bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-500/20">
                    {s.status}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
