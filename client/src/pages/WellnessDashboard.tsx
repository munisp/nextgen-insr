import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

/** J24 wellness rewards — real wearable readings aggregate (healthWearablesRouter). */
export default function WellnessDashboard() {
  const summary = trpc.healthWearables.getWellnessSummary.useQuery(
    { periodDays: 30 },
    { retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Wellness &amp; Wearables</h1>
      {summary.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load wellness summary: {summary.error.message}
        </CardContent></Card>
      )}
      {summary.data && (
        <Card><CardContent className="py-6 space-y-1">
          <div className="text-3xl font-bold">{summary.data.score}/100</div>
          <div>Readings (30d): {summary.data.readings}</div>
          <div>Reward points earned: {summary.data.totalRewardPoints}</div>
          {"premiumDiscountPct" in summary.data && summary.data.premiumDiscountPct != null && (
            <div>Premium discount: {summary.data.premiumDiscountPct}%</div>
          )}
          {summary.data.readings === 0 && (
            <p className="text-sm text-muted-foreground">
              No wearable readings yet — connect a device to start earning rewards.
            </p>
          )}
        </CardContent></Card>
      )}
    </div>
  );
}
