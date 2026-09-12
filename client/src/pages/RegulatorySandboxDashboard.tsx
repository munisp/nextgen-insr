import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Regulatory sandbox — wired to the real regulatorySandbox router. The
 * dashboard/stats procedures currently fail loud (NOT_IMPLEMENTED), so this
 * page renders the honest unavailable state.
 */
export default function RegulatorySandboxDashboard() {
  const { isError, error } = trpc.regulatorySandbox.dashboard.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Regulatory Sandbox</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — regulatory sandbox dashboard is not available on this deployment
          {isError && (
            <span className="block mt-2 text-xs">
              (backend: {error.message})
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
