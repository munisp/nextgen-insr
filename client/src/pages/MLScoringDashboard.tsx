import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function MLScoringDashboard() {
  // F-12 (wave-4b): ML scoring is not configured on this platform — the
  // procs are fail-loud. Honest unavailable state; the query stays wired.
  const { isError } = trpc.mlScoring.scoringHistory.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">ML Scoring Dashboard</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — ML scoring is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports this feature as not configured)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
