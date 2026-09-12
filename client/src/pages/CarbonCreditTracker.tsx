import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

/** ESG / carbon-credit insurance — real tracker summary + stats (esgCarbonTrackerRouter). */
export default function CarbonCreditTracker() {
  const summary = trpc.esgCarbonTracker.getSummary.useQuery(undefined, { retry: false });
  const stats = trpc.esgCarbonTracker.getStats.useQuery(undefined, { retry: false });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Carbon Credit Insurance</h1>
      {(summary.isError || stats.isError) && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load carbon-credit data: {(summary.error ?? stats.error)?.message}
        </CardContent></Card>
      )}
      {summary.data && (
        <Card><CardContent className="py-4">
          <pre className="text-xs overflow-auto">{JSON.stringify(summary.data, null, 2)}</pre>
        </CardContent></Card>
      )}
      {stats.data && (
        <Card><CardContent className="py-4">
          <pre className="text-xs overflow-auto">{JSON.stringify(stats.data, null, 2)}</pre>
        </CardContent></Card>
      )}
    </div>
  );
}
