import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/** J21 parametric insurance — real triggers for a policy (parametricRouter). */
export default function ParametricTriggers() {
  const [policyId, setPolicyId] = useState("");
  const id = Number(policyId);
  const enabled = Number.isInteger(id) && id > 0;

  const triggers = trpc.parametric.getTriggers.useQuery(
    { policyId: id },
    { enabled, retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Parametric Insurance Triggers</h1>
      <div className="max-w-md">
        <Input
          placeholder="Policy ID"
          value={policyId}
          onChange={e => setPolicyId(e.target.value)}
        />
      </div>
      {triggers.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load triggers: {triggers.error.message}
        </CardContent></Card>
      )}
      {triggers.data && triggers.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No parametric triggers configured for this policy.
        </p>
      )}
      {triggers.data?.map(t => (
        <Card key={t.id}><CardContent className="py-4 space-y-1">
          <div className="font-semibold">{t.triggerType}</div>
          <div className="text-sm">Threshold: {String(t.thresholdValue)} {t.thresholdUnit} ({t.thresholdDirection})</div>
          <div className="text-sm text-muted-foreground">Status: {t.status}</div>
        </CardContent></Card>
      ))}
    </div>
  );
}
