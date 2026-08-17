import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function MultiTenancyPage() {
  // F-12 (wave-4b): multi-tenancy management is not delivered — the procs are fail-loud
  // NOT_IMPLEMENTED. Honest unavailable state; the query stays wired.
  const { isError } = trpc.multiTenancy.dashboard.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Multi-Tenancy</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — multi-tenancy management is not delivered on this platform
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
