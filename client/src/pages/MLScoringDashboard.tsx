import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function MLScoringDashboard() {
  // B11 (wave-2c): wired to the REAL heuristic-v1 scoring history
  // (ml_score_results rows persisted by mlScoring.scoreClaim). The model is a
  // transparent weighted formula — honestly labeled, never presented as
  // trained ML. Empty history is shown as an honest empty state.
  const history = trpc.mlScoring.scoringHistory.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">ML Scoring Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          model: heuristic-v1 — transparent weighted-formula claim risk (not
          trained ML)
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Scoring History</CardTitle>
        </CardHeader>
        <CardContent>
          {history.isError && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Scoring unavailable: {history.error.message}
            </p>
          )}
          {history.data && history.data.items.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No claims scored yet — scores appear here once
              mlScoring.scoreClaim runs against real claims.
            </p>
          )}
          {history.data?.items.map(row => (
            <div
              key={row.id}
              className="flex items-center justify-between py-2 border-b last:border-0"
            >
              <div>
                <p className="text-sm font-medium">
                  {row.subjectType} #{row.subjectId}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(row.createdAt).toLocaleString()}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    row.riskBand === "high"
                      ? "destructive"
                      : row.riskBand === "medium"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {row.riskBand}
                </Badge>
                <span className="text-sm font-mono">
                  {Number(row.score).toFixed(3)}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
