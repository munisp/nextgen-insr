/**
 * UsageCoverActivation.tsx — Q-wave Q6 (2026-09-25)
 * Per-trip / per-day usage-based motor cover activation flow.
 * BINDING: REAL — usageCover.myActivations / activateCover / cancelCover
 * (Q3 router). NOT_FOUND/FORBIDDEN → null remains only as a defensive
 * fallback for older deployments — no fake activation is ever simulated
 * client-side (2026-10-01, R2b).
 * 2026-10-01 (R2b): updated to the corrected server contract —
 * coverType is "trip" | "day" (not per_trip/per_day); activation requires a
 * real policyId (selected from the member's actual policies via the existing
 * trpc.policies.list query), a stable clientActivationId idempotency key
 * (crypto.randomUUID() held in component state per intent, so a retry replays
 * instead of double-activating), and days (day cover) or tripId (trip cover,
 * chosen from the member's real telematics trips).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { CalendarClock, CarFront, Power } from "lucide-react";
import { telematicsApi, usageCoverApi } from "@/services/innovationApi";
import { trpc } from "@/lib/trpc";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

type CoverType = "trip" | "day";

/** 2026-10-01 (R2b): one stable idempotency key per activation intent. */
function newClientActivationId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `uca-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function UsageCoverActivation() {
  const queryClient = useQueryClient();
  const [coverType, setCoverType] = useState<CoverType>("day");
  const [policyId, setPolicyId] = useState<number | null>(null);
  const [days, setDays] = useState("1");
  const [tripId, setTripId] = useState<number | null>(null);
  const [clientActivationId, setClientActivationId] = useState<string>(() =>
    newClientActivationId()
  );

  // 2026-10-01 (R2b): real policy list from the existing trpc client — no
  // fabricated policy options.
  const policies = trpc.policies.list.useQuery(undefined, { retry: 1 });

  // 2026-10-01 (R2b): trip cover attaches to a real recorded trip.
  const trips = useQuery({
    queryKey: ["innovation", "telematics", "trips", "for-activation"],
    queryFn: () => telematicsApi.myTrips({ limit: 20 }),
    retry: 1,
    enabled: coverType === "trip",
  });

  const activations = useQuery({
    queryKey: ["innovation", "usage-cover", "activations"],
    queryFn: () => usageCoverApi.myActivations(),
    retry: 1,
  });

  const activate = useMutation({
    mutationFn: () => {
      // 2026-10-01 (R2b): server contract — policyId + clientActivationId
      // required; days only for "day", tripId only for "trip".
      if (policyId == null)
        throw new Error("Select the policy this cover applies to.");
      if (coverType === "day") {
        const d = Number(days);
        if (!Number.isInteger(d) || d < 1)
          throw new Error("Enter a whole number of days (at least 1).");
        return usageCoverApi.activate({
          policyId,
          coverType,
          clientActivationId,
          days: d,
        });
      }
      if (tripId == null) throw new Error("Select the trip to cover.");
      return usageCoverApi.activate({
        policyId,
        coverType,
        clientActivationId,
        tripId,
      });
    },
    onSuccess: result => {
      if (result === null) {
        // Defensive fallback: feature-detected an absent backend.
        toast.info(
          "Usage-based cover is not available on this deployment yet."
        );
        return;
      }
      // 2026-10-01 (R2b): idempotent replay reports honestly; fresh intent
      // gets a fresh key after success.
      toast.success(
        result.idempotent
          ? "This cover was already activated (retry replayed safely)."
          : "Cover activated. Drive safely!"
      );
      setClientActivationId(newClientActivationId());
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
                value: "trip" as CoverType,
                title: "Per trip",
                desc: "Cover runs from ignition to arrival for a single trip.",
                icon: CarFront,
              },
              {
                value: "day" as CoverType,
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

          {/* 2026-10-01 (R2b): real policy selector bound to the member's
              actual policies (trpc.policies.list) — no fabricated options. */}
          <div>
            <label
              htmlFor="policy"
              className="mb-1 block text-xs font-medium text-stone-600"
            >
              Policy
            </label>
            {policies.isLoading ? (
              <p className="text-xs text-stone-500">Loading your policies…</p>
            ) : policies.isError ? (
              <p className="text-xs text-red-600">
                We couldn’t load your policies. Please retry before activating.
              </p>
            ) : (policies.data ?? []).length === 0 ? (
              <p className="text-xs text-stone-500">
                You have no policies yet — usage-based cover needs an existing
                motor policy.
              </p>
            ) : (
              <select
                id="policy"
                className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900"
                value={policyId ?? ""}
                onChange={e =>
                  setPolicyId(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Select a policy…</option>
                {(policies.data ?? []).map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name} · #{p.policyNumber} · {p.status}
                  </option>
                ))}
              </select>
            )}
          </div>

          {coverType === "day" ? (
            <div>
              <label
                htmlFor="days"
                className="mb-1 block text-xs font-medium text-stone-600"
              >
                Number of days
              </label>
              <Input
                id="days"
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                value={days}
                onChange={e => setDays(e.target.value)}
              />
            </div>
          ) : (
            <div>
              <label
                htmlFor="trip"
                className="mb-1 block text-xs font-medium text-stone-600"
              >
                Trip to cover
              </label>
              {trips.isLoading ? (
                <p className="text-xs text-stone-500">Loading your trips…</p>
              ) : trips.isError ? (
                <p className="text-xs text-red-600">
                  We couldn’t load your trips. Please retry before activating
                  per-trip cover.
                </p>
              ) : trips.data === null ? (
                <UnavailableState feature="Trip selection" />
              ) : (trips.data.trips ?? []).length === 0 ? (
                <p className="text-xs text-stone-500">
                  No trips recorded yet — per-trip cover attaches to a trip
                  recorded by the mobile app.
                </p>
              ) : (
                <select
                  id="trip"
                  className="w-full rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-900"
                  value={tripId ?? ""}
                  onChange={e =>
                    setTripId(e.target.value ? Number(e.target.value) : null)
                  }
                >
                  <option value="">Select a trip…</option>
                  {trips.data.trips.map(t => (
                    <option key={t.id} value={t.id}>
                      {new Date(t.startedAt).toLocaleString()} ·{" "}
                      {t.distanceKm.toFixed(1)} km
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {activations.data === null &&
            !activations.isLoading &&
            !activations.isError && (
              <UnavailableState feature="Usage-based cover activation" />
            )}

          <Button
            onClick={() => activate.mutate()}
            disabled={
              activate.isPending || !backendAvailable || policyId == null
            }
            className="w-full sm:w-auto"
          >
            {activate.isPending
              ? "Activating…"
              : `Activate ${coverType === "trip" ? "trip" : "daily"} cover`}
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
                      {a.coverType === "trip"
                        ? "Per-trip cover"
                        : "Per-day cover"}
                    </p>
                    {/* 2026-10-01 (R2b): premiumAmount (string|null) is a
                        recorded-not-collected estimate; no currency or
                        premiumQuoted field exists on the contract. */}
                    <p className="text-xs text-stone-500">
                      Activated {new Date(a.activatedAt).toLocaleString()}
                      {a.expiresAt
                        ? ` · expires ${new Date(a.expiresAt).toLocaleString()}`
                        : ""}
                      {a.days != null ? ` · ${a.days} day(s)` : ""}
                      {a.tripId != null ? ` · trip #${a.tripId}` : ""}
                      {a.premiumAmount
                        ? ` · estimated premium ${a.premiumAmount} (not yet collected)`
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
