/**
 * FreemiumUpgrade.tsx — Q-wave Q6 (2026-09-25)
 * Freemium ladder: current tier + upgrade flow.
 * BINDING DISCLOSURE: Q1 (freemiumTiers router, feat/innov-embedded) is
 * planned in plan-q.md but not deployed yet; bindings feature-detect and the
 * upgrade action is disabled with a disclosed notice until the backend lands.
 * No tiers or prices are fabricated client-side.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Sparkles, Check } from "lucide-react";
import { freemiumApi } from "@/services/innovationApi";
import {
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

export default function FreemiumUpgrade() {
  const queryClient = useQueryClient();

  const myTier = useQuery({
    queryKey: ["innovation", "freemium", "my-tier"],
    queryFn: () => freemiumApi.myTier(),
    retry: 1,
  });
  const tiers = useQuery({
    queryKey: ["innovation", "freemium", "tiers"],
    queryFn: () => freemiumApi.listTiers(),
    retry: 1,
  });

  const upgrade = useMutation({
    mutationFn: (tierCode: string) => freemiumApi.upgrade({ tierCode }),
    onSuccess: result => {
      if (result === null) {
        toast.info("Plan upgrades are not available on this deployment yet.");
        return;
      }
      toast.success("Plan upgraded.");
      queryClient.invalidateQueries({ queryKey: ["innovation", "freemium"] });
    },
    onError: error => {
      toast.error(error instanceof Error ? error.message : "Upgrade failed");
    },
  });

  const loading = myTier.isLoading || tiers.isLoading;
  const errored = myTier.isError || tiers.isError;
  const unavailable =
    !loading && !errored && (myTier.data === null || tiers.data === null);
  const currentTier = myTier.data?.tier ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">
          Your Plan &amp; Upgrades
        </h1>
        <p className="text-sm text-stone-500">
          Start on free basic cover and upgrade when you need higher limits —
          premiums collect via your usual payment method.
        </p>
      </header>

      {loading ? (
        <LoadingState label="Loading plans…" />
      ) : errored ? (
        <ErrorState
          message="We couldn’t load plan information. Please try again."
          onRetry={() => {
            myTier.refetch();
            tiers.refetch();
          }}
        />
      ) : unavailable ? (
        <UnavailableState feature="Freemium plans and upgrades" />
      ) : (
        <>
          {currentTier && (
            <p className="text-sm text-stone-600">
              Current plan:{" "}
              <Badge className="bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300">
                {currentTier}
              </Badge>
            </p>
          )}
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {(tiers.data?.tiers ?? []).map(t => {
              const isCurrent = t.code === currentTier;
              return (
                <li
                  key={t.code}
                  className={`flex flex-col rounded-xl border bg-white p-5 ${
                    isCurrent ? "border-amber-400" : "border-stone-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="flex items-center gap-2 font-semibold text-stone-900">
                      <Sparkles
                        className="h-4 w-4 text-amber-600"
                        aria-hidden
                      />
                      {t.name}
                    </p>
                    {isCurrent && (
                      <Badge className="bg-amber-100 text-amber-800 ring-1 ring-inset ring-amber-300">
                        Current
                      </Badge>
                    )}
                  </div>
                  <p className="mt-2 text-2xl font-bold text-stone-900">
                    {t.currency} {t.monthlyPremium}
                    <span className="text-sm font-normal text-stone-500">
                      /month
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    Cover up to {t.currency} {t.coverLimit}
                  </p>
                  <p className="mt-2 text-sm text-stone-600">{t.description}</p>
                  <ul className="mt-3 flex-1 space-y-1">
                    {t.benefits.map(b => (
                      <li
                        key={b}
                        className="flex items-start gap-2 text-sm text-stone-600"
                      >
                        <Check
                          className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600"
                          aria-hidden
                        />
                        {b}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-4"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent || upgrade.isPending}
                    onClick={() => upgrade.mutate(t.code)}
                  >
                    {isCurrent
                      ? "Your plan"
                      : upgrade.isPending
                        ? "Upgrading…"
                        : "Upgrade"}
                  </Button>
                </li>
              );
            })}
          </ul>
          {(tiers.data?.tiers ?? []).length === 0 && (
            <p className="text-sm text-stone-500">
              No upgrade tiers are published for your account yet.
            </p>
          )}
        </>
      )}
    </div>
  );
}
