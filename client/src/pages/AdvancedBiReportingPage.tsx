import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function AdvancedBiReportingPage() {
  // F-12 (wave-4b): the BI reporting backend was fixtures — every
  // advancedBiReporting procedure is now fail-loud NOT_IMPLEMENTED. Honest
  // unavailable state; the dashboard query stays wired.
  const { isError } = trpc.advancedBiReporting.dashboard.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Advanced BI Reporting</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — advanced BI reporting is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports BI reporting as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
