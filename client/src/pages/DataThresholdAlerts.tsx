import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function DataThresholdAlerts() {
  // F-12 (wave-4b): no threshold-alert store or checker is delivered —
  // every thresholdAlerts procedure is fail-loud NOT_IMPLEMENTED. Honest
  // unavailable state; the list query stays wired.
  const { isError } = trpc.thresholdAlerts.list.useQuery(
    {},
    { retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Data Threshold Alerts</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — data threshold alerts are not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports threshold alerts as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
