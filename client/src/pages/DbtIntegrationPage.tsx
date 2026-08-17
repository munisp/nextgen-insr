import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function DbtIntegrationPage() {
  // F-12 (wave-4b): no dbt runner/backend is delivered — every
  // dbtIntegration procedure is fail-loud NOT_IMPLEMENTED. Honest
  // unavailable state; the project-info query stays wired.
  const { isError } = trpc.dbtIntegration.getProjectInfo.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">dbt Integration</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — dbt integration is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports dbt integration as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
