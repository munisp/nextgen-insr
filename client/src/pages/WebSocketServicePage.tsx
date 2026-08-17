import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function WebSocketServicePage() {
  // F-12 (wave-4b): no WebSocket telemetry store is delivered — the
  // websocketService dashboard is fail-loud NOT_IMPLEMENTED. Honest
  // unavailable state; the query stays wired.
  const { isError } = trpc.websocketService.dashboard.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">WebSocket Service</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — WebSocket service telemetry is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports WebSocket telemetry as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
