import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function FalkorDBGraphPage() {
  // F-12 (wave-4b): no FalkorDB/graph backend is delivered — every
  // falkordbGraph procedure is fail-loud NOT_IMPLEMENTED (shortestPath does
  // not exist at all). Honest unavailable state; health query stays wired.
  const { isError } = trpc.falkordbGraph.health.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Graph Explorer</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — graph exploration is not delivered on this platform (no graph
          database backend)
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports the graph service as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
