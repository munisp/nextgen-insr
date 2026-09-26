/**
 * DrivingScore.tsx — Q-wave Q6 (2026-09-25)
 * Member telematics driving score + trip history.
 * BINDING DISCLOSURE: Q3 (telematicsScore router) is planned in plan-q.md but
 * not deployed yet; bindings feature-detect and this page renders a disclosed
 * "not available yet" state until the backend lands. No data is fabricated.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Gauge, Route } from "lucide-react";
import { telematicsApi } from "@/services/innovationApi";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

function scoreColor(score: number): string {
  if (score >= 80) return "text-emerald-700";
  if (score >= 60) return "text-amber-600";
  return "text-red-600";
}

export default function DrivingScore() {
  const score = useQuery({
    queryKey: ["innovation", "telematics", "score"],
    queryFn: () => telematicsApi.myScore(),
    retry: 1,
  });
  const trips = useQuery({
    queryKey: ["innovation", "telematics", "trips"],
    queryFn: () => telematicsApi.myTrips({ limit: 30 }),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Driving Score &amp; Trips
        </h1>
        <p className="text-sm text-stone-500">
          Your telematics driving score, computed from real trip data uploaded
          by the mobile app, and how it affects your motor premium.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Gauge className="h-5 w-5 text-amber-600" aria-hidden />
            Current score
          </CardTitle>
        </CardHeader>
        <CardContent>
          {score.isLoading ? (
            <LoadingState label="Loading your driving score…" />
          ) : score.isError ? (
            <ErrorState
              message="We couldn’t load your driving score. Please try again."
              onRetry={() => score.refetch()}
            />
          ) : score.data === null ? (
            <UnavailableState feature="Telematics driving score" />
          ) : !score.data ? (
            <EmptyState
              title="No driving score yet"
              hint="Scores are computed once the mobile app has uploaded scored trips."
            />
          ) : (
            <div className="flex flex-col items-center gap-2 py-6">
              <p
                className={`text-6xl font-extrabold ${scoreColor(score.data.score)}`}
              >
                {score.data.score}
              </p>
              <p className="text-sm text-stone-500">out of 100</p>
              <dl className="mt-4 grid grid-cols-1 gap-x-8 gap-y-1 text-sm text-stone-600 sm:grid-cols-2">
                <div className="flex justify-between gap-4">
                  <dt>Trips scored</dt>
                  <dd className="font-medium text-stone-900">
                    {score.data.tripsScored}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Premium impact</dt>
                  <dd className="font-medium text-stone-900">
                    {score.data.ratingFactorApplied
                      ? "Applied to your motor premium"
                      : "Not yet applied to pricing"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt>Period</dt>
                  <dd>
                    {new Date(score.data.periodStart).toLocaleDateString()} –{" "}
                    {new Date(score.data.periodEnd).toLocaleDateString()}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <Route className="h-5 w-5 text-amber-600" aria-hidden />
            Recent trips
          </CardTitle>
        </CardHeader>
        <CardContent>
          {trips.isLoading ? (
            <LoadingState label="Loading trips…" />
          ) : trips.isError ? (
            <ErrorState
              message="We couldn’t load your trips. Please try again."
              onRetry={() => trips.refetch()}
            />
          ) : trips.data === null ? (
            <UnavailableState feature="Trip history" />
          ) : (trips.data?.trips ?? []).length === 0 ? (
            <EmptyState
              title="No trips recorded yet"
              hint="Trips recorded by the mobile app will sync here automatically."
            />
          ) : (
            <ul className="divide-y divide-stone-100">
              {trips.data!.trips.map(t => (
                <li
                  key={t.id}
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {new Date(t.startedAt).toLocaleString()}
                    </p>
                    <p className="text-xs text-stone-500">
                      {t.distanceKm.toFixed(1)} km · braking{" "}
                      {t.events.harshBraking} · accel{" "}
                      {t.events.harshAcceleration} · speeding{" "}
                      {t.events.speeding}
                    </p>
                  </div>
                  <span
                    className={`text-lg font-bold ${
                      t.score == null ? "text-stone-400" : scoreColor(t.score)
                    }`}
                  >
                    {t.score == null ? "—" : t.score}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
