/**
 * UsageCoverActivation.tsx — Q-wave Q6 (2026-09-25)
 * Per-trip / per-day usage-based motor cover activation flow.
 * BINDING DISCLOSURE: Q3 (usageCover router) is planned in plan-q.md but not
 * deployed yet; bindings feature-detect. If the backend is absent the
 * activation action is disabled with a disclosed notice — no fake activation
 * is ever simulated client-side.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { CalendarClock, CarFront, Power } from "lucide-react";
import { usageCoverApi } from "@/services/innovationApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

type CoverType = "per_trip" | "per_day";

export default function UsageCoverActivation() {
  const queryClient = useQueryClient();
  const [coverType, setCoverType] = useState<CoverType>("per_day");

  const activations = useQuery({
    queryKey: ["innovation", "usage-cover", "activations"],
    queryFn: () => usageCoverApi.myActivations(),
    retry: 1,
  });

  const activate = useMutation({
    mutationFn: () => usageCoverApi.activate({ coverType }),
    onSuccess: result => {
      if (result === null) {
        // Forward-looking binding feature-detected an absent backend.
        toast.info(
          "Usage-based cover is not available on this deployment yet."
        );
        return;
      }
      toast.success("Cover activated. Drive safely!");
      queryClient.invalidateQueries({
        queryKey: ["innovation", "usage-cover"],
      });
    },
    onError: error => {
      toast.error(
        `Activation failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    },
  });

  const deactivate = useMutation({
    mutationFn: (activationId: number) =>
      usageCoverApi.deactivate({ activationId }),
    onSuccess: result => {
      if (result === null) {
        toast.info(
          "Usage-based cover is not available on this deployment yet."
        );
        return;
      }
      toast.success("Cover deactivated.");
      queryClient.invalidateQueries({
        queryKey: ["innovation", "usage-cover"],
      });
    },
    onError: error => {
      toast.error(
        `Deactivation failed: ${error instanceof Error ? error.message : "unknown error"}`
      );
    },
  });

  const backendAvailable = activations.data !== null && !activations.isError;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Usage-Based Cover
        </h1>
        <p className="text-sm text-stone-500">
          Switch comprehensive motor cover on only when you drive — per trip or
          per day.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Power className="h-5 w-5 text-amber-600" aria-hidden />
            Activate cover
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            role="radiogroup"
            aria-label="Cover type"
          >
            {[
              {
                value: "per_trip" as CoverType,
                title: "Per trip",
                desc: "Cover runs from ignition to arrival for a single trip.",
                icon: CarFront,
              },
              {
                value: "per_day" as CoverType,
                title: "Per day",
                desc: "Cover runs until midnight on the days you activate.",
                icon: CalendarClock,
              },
            ].map(opt => (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={coverType === opt.value}
                onClick={() => setCoverType(opt.value)}
                className={`rounded-xl border p-4 text-left transition-colors ${
                  coverType === opt.value
                    ? "border-amber-500 bg-amber-50"
                    : "border-stone-200 bg-white hover:border-stone-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <opt.icon className="h-5 w-5 text-amber-600" aria-hidden />
                  <span className="font-semibold text-stone-900">
                    {opt.title}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-500">{opt.desc}</p>
              </button>
            ))}
          </div>

          {activations.data === null &&
            !activations.isLoading &&
            !activations.isError && (
              <UnavailableState feature="Usage-based cover activation" />
            )}

          <Button
            onClick={() => activate.mutate()}
            disabled={activate.isPending || !backendAvailable}
            className="w-full sm:w-auto"
          >
            {activate.isPending
              ? "Activating…"
              : `Activate ${coverType === "per_trip" ? "trip" : "daily"} cover`}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="text-lg text-stone-800">
            Your activations
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activations.isLoading ? (
            <LoadingState label="Loading activations…" />
          ) : activations.isError ? (
            <ErrorState
              message="We couldn’t load your activations. Please try again."
              onRetry={() => activations.refetch()}
            />
          ) : activations.data === null ? (
            <UnavailableState feature="Usage-cover activations" />
          ) : (activations.data?.activations ?? []).length === 0 ? (
            <EmptyState
              title="No activations yet"
              hint="Your active and past per-trip / per-day covers will appear here."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {activations.data!.activations.map(a => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {a.coverType === "per_trip"
                        ? "Per-trip cover"
                        : "Per-day cover"}
                    </p>
                    <p className="text-xs text-stone-500">
                      Activated {new Date(a.activatedAt).toLocaleString()}
                      {a.expiresAt
                        ? ` · expires ${new Date(a.expiresAt).toLocaleString()}`
                        : ""}
                      {a.premiumQuoted
                        ? ` · ${a.currency} ${a.premiumQuoted}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-stone-100 text-stone-600 ring-1 ring-inset ring-stone-500/20">
                      {a.status}
                    </Badge>
                    {a.status === "active" && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={deactivate.isPending}
                        onClick={() => deactivate.mutate(a.id)}
                      >
                        Deactivate
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
