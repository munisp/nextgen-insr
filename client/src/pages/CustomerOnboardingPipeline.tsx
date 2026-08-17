import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function CustomerOnboardingPipeline() {
  // F-12 (wave-4b): the customer onboarding pipeline is not delivered — the stats/dashboard proc was
  // a zero-payload (fake health check + unconditional zeros) and is now
  // fail-loud. Honest unavailable state; the query stays wired.
  const { isError } = trpc.customerOnboardingPipeline.getStats.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Customer Onboarding Pipeline</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — the customer onboarding pipeline is not delivered on this platform
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
