import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function OfflineQueueDashboard() {
  // F-12 (wave-4b): the offline-sync queue has no delivered server store —
  // every offlineQueue procedure is fail-loud NOT_IMPLEMENTED and retryFailed
  // does not exist at all. Honest unavailable state; the status query stays
  // wired so a loud backend error surfaces if the queue is ever delivered.
  const { isError } = trpc.offlineQueue.getQueueStatus.useQuery(
    undefined,
    { retry: false }
  );

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Offline Queue</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — offline-sync queue monitoring is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports queue status as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
