import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function ScheduledEmailDelivery() {
  // F-12 (wave-4b): scheduled report delivery is not delivered — the
  // sprint23.scheduledDelivery proc is fail-loud and the getConfig/
  // updateConfig sub-procs never existed. Honest unavailable state.
  const { isError } = trpc.sprint23.scheduledDelivery.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Scheduled Email Delivery</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — scheduled report delivery is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports scheduled delivery as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
