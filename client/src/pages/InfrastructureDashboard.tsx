import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function InfrastructureDashboard() {
  // F-12 (wave-4b): platformHealthDash.getSummary is REAL (served when
  // health data exists); networkTelemetry.* are fail-loud. Render the
  // real summary; show the honest error state when the backend is loud.
  const { data, isError } = trpc.platformHealthDash.getSummary.useQuery(
    undefined,
    { retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Infrastructure Dashboard</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          {isError
            ? "— infrastructure monitoring is not delivered on this platform"
            : `Services tracked: ${String(
                (data as { totalServices?: number } | undefined)
                  ?.totalServices ?? 0
              )}`}
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports this feature as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
