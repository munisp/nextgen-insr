import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function BillingAnalyticsDashboardPage() {
  // F-12 (wave-4b): every data source this page used is fail-loud —
  // liveBillingDashboard.* throws NOT_IMPLEMENTED and
  // billingProduction.getCohortAnalytics/getRevenueForecast report no
  // delivered pipeline. Honest unavailable state; queries stay wired.
  const summary = trpc.liveBillingDashboard.getSummary.useQuery(undefined, {
    retry: false,
  });
  const cohort = trpc.billingProduction.getCohortAnalytics.useQuery(
    undefined,
    { retry: false }
  );
  const forecast = trpc.billingProduction.getRevenueForecast.useQuery(
    undefined,
    { retry: false }
  );
  const unavailable = summary.isError || cohort.isError || forecast.isError;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Billing Analytics</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — billing analytics (summary, cohort analysis, revenue forecast)
          are not delivered on this platform
          {unavailable && (
            <span className="block mt-2 text-xs">
              (backend reports these pipelines as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
