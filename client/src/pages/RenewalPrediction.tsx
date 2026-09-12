import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** J26 predictive renewal — latest real prediction for a policy (renewalPredictionRouter). */
export default function RenewalPrediction() {
  const [policyId, setPolicyId] = useState("");
  const id = Number(policyId);
  const enabled = Number.isInteger(id) && id > 0;

  const prediction = trpc.renewalPrediction.getPrediction.useQuery(
    { policyId: id },
    { enabled, retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Predictive Renewal</h1>
      <div className="max-w-md">
        <Input
          placeholder="Policy ID"
          value={policyId}
          onChange={e => setPolicyId(e.target.value)}
        />
      </div>
      {prediction.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load prediction: {prediction.error.message}
        </CardContent></Card>
      )}
      {enabled && prediction.data === null && (
        <Card><CardContent className="py-6 text-muted-foreground">
          No renewal prediction has been generated for this policy yet.
        </CardContent></Card>
      )}
      {prediction.data && (
        <Card><CardContent className="py-4">
          <pre className="text-xs overflow-auto">{JSON.stringify(prediction.data, null, 2)}</pre>
        </CardContent></Card>
      )}
    </div>
  );
}
