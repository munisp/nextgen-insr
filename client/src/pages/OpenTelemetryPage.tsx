import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function OpenTelemetryPage() {
  // F-12 (wave-4b): no OTEL collector/exporter backend is delivered — both
  // openTelemetry procedures are fail-loud NOT_IMPLEMENTED. Honest
  // unavailable state; the dashboard query stays wired.
  const { isError } = trpc.openTelemetry.dashboard.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">OpenTelemetry</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — OpenTelemetry export is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports OpenTelemetry as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
