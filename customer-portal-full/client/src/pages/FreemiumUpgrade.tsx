/**
 * FreemiumUpgrade.tsx — Q-wave Q6 (2026-09-25)
 * Freemium ladder: current tier + upgrade flow.
 * BINDING: REAL — freemiumTiers.myTier / listTiers / upgrade (Q6 member
 * router). NOT_FOUND/FORBIDDEN → null remains only as a defensive fallback
 * for older deployments (2026-10-01, R2b).
 * 2026-10-01 (R2b): updated to the corrected FreemiumTier contract
 * (coverageType/isFree/monthlyPremium/coverLimit — no description/benefits).
 * Paid-tier upgrades require msisdn for premium collection (fail-closed);
 * the collection-declined reason is surfaced verbatim when success=false.
 * No tiers or prices are fabricated client-side.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { freemiumApi } from "@/services/innovationApi";
import type { FreemiumTier } from "@/services/innovationApi";
import {
  ErrorState,
  LoadingState,
  UnavailableState,
} from "@/components/innovation/states";

export default function FreemiumUpgrade() {
  const queryClient = useQueryClient();
  // 2026-10-01 (R2b): paid-tier upgrade collects premium via mobile money —
  // the member's msisdn is required by the server contract (fail-closed).
  const [msisdn, setMsisdn] = useState("");
  const [pendingTier, setPendingTier] = useState<FreemiumTier | null>(null);

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
    mutationFn: (input: { tierCode: string; msisdn?: string }) =>
      freemiumApi.upgrade({ ...input, channel: "mobile_money" }),
    onSuccess: result => {
      if (result === null) {
        toast.info("Plan upgrades are not available on this deployment yet.");
        return;
      }
      // 2026-10-01 (R2b): surface the server's honest decline reason verbatim
      // when premium collection failed (success=false + reason).
      if (!result.success) {
        toast.error(
          result.reason ??
            result.message ??
            "Upgrade could not be completed."
        );
        return;
      }
      toast.success(result.message ?? "Plan upgraded.");
      setPendingTier(null);
      setMsisdn("");
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
                    {t.isFree ? (
                      "Free"
                    ) : (
                      <>
                        {t.currency} {t.monthlyPremium}
                        <span className="text-sm font-normal text-stone-500">
                          /month
                        </span>
                      </>
                    )}
                  </p>
                  {/* 2026-10-01 (R2b): contract has coverageType/isFree —
                      no description/benefits fields exist. */}
                  <p className="mt-1 text-xs text-stone-500">
                    {t.coverageType} cover · up to {t.currency} {t.coverLimit}
                  </p>
                  <div className="mt-3 flex-1" />
                  {/* 2026-10-01 (R2b): paid tiers require msisdn for premium
                      collection (fail-closed server-side). */}
                  {!isCurrent && !t.isFree && pendingTier?.code === t.code && (
                    <div className="mb-3 space-y-2">
                      <label
                        htmlFor={`msisdn-${t.code}`}
                        className="block text-xs font-medium text-stone-600"
                      >
                        Mobile-money number for premium collection
                      </label>
                      <Input
                        id={`msisdn-${t.code}`}
                        type="tel"
                        inputMode="tel"
                        placeholder="e.g. 2348012345678"
                        value={msisdn}
                        onChange={e => setMsisdn(e.target.value)}
                      />
                    </div>
                  )}
                  <Button
                    className="mt-4"
                    variant={isCurrent ? "outline" : "default"}
                    disabled={isCurrent || upgrade.isPending}
                    onClick={() => {
                      if (t.isFree) {
                        upgrade.mutate({ tierCode: t.code });
                        return;
                      }
                      if (pendingTier?.code !== t.code) {
                        setPendingTier(t);
                        setMsisdn("");
                        return;
                      }
                      if (!msisdn.trim()) {
                        toast.warning(
                          "Enter your mobile-money number to pay the premium."
                        );
                        return;
                      }
                      upgrade.mutate({ tierCode: t.code, msisdn: msisdn.trim() });
                    }}
                  >
                    {isCurrent
                      ? "Your plan"
                      : upgrade.isPending
                        ? "Upgrading…"
                        : t.isFree
                          ? "Enroll free"
                          : pendingTier?.code === t.code
                            ? "Pay & upgrade"
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
