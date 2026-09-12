import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** J22 UBI — real telematics driving score + event history (telematicsRouter). */
export default function TelematicsDashboard() {
  const [policyId, setPolicyId] = useState("");
  const id = Number(policyId);
  const enabled = Number.isInteger(id) && id > 0;

  const score = trpc.telematics.getDrivingScore.useQuery(
    { policyId: id, periodDays: 30 },
    { enabled, retry: false }
  );
  const history = trpc.telematics.getHistory.useQuery(
    { policyId: id, limit: 20 },
    { enabled, retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Telematics &amp; Usage-Based Insurance</h1>
      <div className="flex gap-2 max-w-md">
        <Input
          placeholder="Policy ID"
          value={policyId}
          onChange={e => setPolicyId(e.target.value)}
        />
        <Button disabled={!enabled || score.isFetching} onClick={() => score.refetch()}>
          Load
        </Button>
      </div>
      {score.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load driving score: {score.error.message}
        </CardContent></Card>
      )}
      {score.data && (
        <Card><CardContent className="py-6 space-y-1">
          <div className="text-3xl font-bold">{score.data.score}/100</div>
          <div>Events (30d): {score.data.events}</div>
          {"premiumAdjustmentPct" in score.data && (
            <div>Premium adjustment: {score.data.premiumAdjustmentPct}%</div>
          )}
          <div className="text-sm text-muted-foreground">
            Recommendation: {score.data.recommendation}
          </div>
        </CardContent></Card>
      )}
      {history.data && history.data.length > 0 && (
        <Card><CardContent className="py-4">
          <h2 className="font-semibold mb-2">Recent events</h2>
          <ul className="text-sm space-y-1">
            {history.data.map(e => (
              <li key={e.id}>
                {String(e.recordedAt)} — {e.eventType}
                {e.speedKmh != null ? ` @ ${e.speedKmh} km/h` : ""}
              </li>
            ))}
          </ul>
        </CardContent></Card>
      )}
      {enabled && score.data?.events === 0 && (
        <p className="text-sm text-muted-foreground">
          No telematics events recorded for this policy yet.
        </p>
      )}
    </div>
  );
}
