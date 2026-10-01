/**
 * MyOnboarding.tsx — R3 batch 6 (2026-10-01, R3-b6)
 * Member onboarding progress tracker (route /my-onboarding).
 * BINDING: REAL — memberOnboarding.myProgress
 * (server/routers/memberOnboarding.ts, protectedProcedure; the userId is
 * rebound server-side to ctx.user.id — this page NEVER sends a userId).
 * Read-only: stage advancement is staff tooling and is not offered here.
 * NOT_FOUND/FORBIDDEN → null is only a defensive fallback for older
 * deployments; loading/error/empty states are disclosed. No stage is ever
 * fabricated — the durable store is the only source of truth (G2 #10).
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import { memberOnboardingApi } from "@/services/memberOnboardingApi";
import {
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

const STAGE_LABELS: Record<string, string> = {
  registration: "Registration",
  kyc_submission: "KYC submission",
  kyc_review: "KYC review",
  account_setup: "Account setup",
  training: "Training",
  activation: "Activation",
  live: "Live",
};

export default function MyOnboarding() {
  const progressQuery = useQuery({
    queryKey: ["memberOnboarding", "myProgress"],
    queryFn: () => memberOnboardingApi.myProgress(),
    retry: 1,
  });

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          My Onboarding
        </h1>
        <p className="text-sm text-stone-500">
          Track where your account setup stands. Stages advance when staff
          complete each review step — you cannot skip ahead.
        </p>
      </header>

      <Card className="border-stone-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-stone-800">
            <ListChecks className="h-5 w-5 text-amber-600" aria-hidden />
            Onboarding progress
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {progressQuery.isLoading ? (
            <LoadingState label="Loading your progress…" />
          ) : progressQuery.isError ? (
            <ErrorState
              message="We couldn’t load your onboarding progress. Please try again."
              onRetry={() => progressQuery.refetch()}
            />
          ) : progressQuery.data === null ? (
            <UnavailableState feature="Onboarding progress" />
          ) : (
            <>
              <div className="space-y-1">
                <p className="text-sm font-medium text-stone-900">
                  {progressQuery.data.completionPercent}% complete · current
                  stage:{" "}
                  {STAGE_LABELS[progressQuery.data.currentStage] ??
                    progressQuery.data.currentStage}
                </p>
                <div
                  className="h-2 w-full overflow-hidden rounded-full bg-stone-100"
                  role="progressbar"
                  aria-valuenow={progressQuery.data.completionPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full rounded-full bg-amber-600"
                    style={{
                      width: `${progressQuery.data.completionPercent}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-stone-500">
                  Started{" "}
                  {new Date(progressQuery.data.startedAt).toLocaleDateString()}
                </p>
              </div>
              <ol className="space-y-2">
                {progressQuery.data.stages.map((stage, i) => {
                  const done = i < progressQuery.data!.stageIndex;
                  const current = i === progressQuery.data!.stageIndex;
                  return (
                    <li key={stage.id} className="flex items-center gap-3">
                      {done ? (
                        <CheckCircle2
                          className="h-5 w-5 text-emerald-600"
                          aria-hidden
                        />
                      ) : (
                        <Circle
                          className={`h-5 w-5 ${
                            current ? "text-amber-600" : "text-stone-300"
                          }`}
                          aria-hidden
                        />
                      )}
                      <span
                        className={`text-sm ${
                          current
                            ? "font-semibold text-stone-900"
                            : done
                              ? "text-stone-600"
                              : "text-stone-400"
                        }`}
                      >
                        {STAGE_LABELS[stage.name] ?? stage.name}
                        {stage.estimatedMinutes > 0 &&
                          ` · ~${stage.estimatedMinutes} min`}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
