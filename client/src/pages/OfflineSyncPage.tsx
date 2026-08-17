import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function OfflineSyncPage() {
  // F-12 (wave-4b): no offline-sync queue store is delivered — offlineSync.queue/.analytics are fail-loud. Honest unavailable state; the query stays wired.
  const { isError } = trpc.offlineSync.queue.useQuery(undefined, { retry: false });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Offline Sync</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — offline sync are not delivered on this platform
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
