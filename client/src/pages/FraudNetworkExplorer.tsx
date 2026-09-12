import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Fraud network graph — real nodes/edges from fraudGraphNodes/Edges (fraudNetworkRouter). */
export default function FraudNetworkExplorer() {
  const [entityType, setEntityType] = useState("customer");
  const [entityId, setEntityId] = useState("");
  const id = Number(entityId);
  const enabled = Number.isInteger(id) && id > 0;

  const network = trpc.fraudNetwork.getNetwork.useQuery(
    { entityType, entityId: id, depth: 2 },
    { enabled, retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Fraud Network Graph</h1>
      <div className="flex gap-2 max-w-lg">
        <Input
          placeholder="Entity type (customer/agent/device)"
          value={entityType}
          onChange={e => setEntityType(e.target.value)}
        />
        <Input
          placeholder="Entity ID"
          value={entityId}
          onChange={e => setEntityId(e.target.value)}
        />
        <Button disabled={!enabled || network.isFetching} onClick={() => network.refetch()}>
          Explore
        </Button>
      </div>
      {network.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load network: {network.error.message}
        </CardContent></Card>
      )}
      {network.data && (
        <Card><CardContent className="py-4 space-y-2">
          <div>Nodes: {network.data.nodes.length} · Edges: {network.data.edges.length}</div>
          {network.data.nodes.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No fraud-graph node recorded for this entity.
            </p>
          )}
          <ul className="text-sm space-y-1">
            {network.data.edges.map(e => (
              <li key={e.id}>Edge #{e.id}: {e.edgeType} (weight {String(e.weight)})</li>
            ))}
          </ul>
        </CardContent></Card>
      )}
    </div>
  );
}
