import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

/**
 * J27 embedded insurance — the real journey definition (J27_Embedded…) plus
 * live execution history from the Temporal journey orchestrator.
 */
export default function EmbeddedInsurance() {
  const definitions = trpc.journeyOrchestratorV2.getDefinitions.useQuery(undefined, { retry: false });
  const executions = trpc.journeyOrchestratorV2.listExecutions.useQuery(
    { limit: 10 },
    { retry: false }
  );

  const embedded = (definitions.data as { id?: string; name?: string }[] | undefined)
    ?.filter(d => String(d.id ?? "").startsWith("J27") || String(d.name ?? "").toLowerCase().includes("embedded"));

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Embedded Insurance</h1>
      {definitions.isError && (
        <Card><CardContent className="py-6 text-destructive">
          Failed to load journey definitions: {definitions.error.message}
        </CardContent></Card>
      )}
      {definitions.data && (
        <Card><CardContent className="py-4 space-y-2">
          <h2 className="font-semibold">Journey definition</h2>
          {embedded && embedded.length > 0 ? (
            <pre className="text-xs overflow-auto">{JSON.stringify(embedded, null, 2)}</pre>
          ) : (
            <p className="text-sm text-muted-foreground">
              No embedded-insurance journey (J27) is registered in the orchestrator.
            </p>
          )}
        </CardContent></Card>
      )}
      {executions.data && (
        <Card><CardContent className="py-4 space-y-2">
          <h2 className="font-semibold">Recent J27 executions</h2>
          <pre className="text-xs overflow-auto">{JSON.stringify(executions.data, null, 2)}</pre>
        </CardContent></Card>
      )}
    </div>
  );
}
