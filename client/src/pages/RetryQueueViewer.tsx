import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";

export default function RetryQueueViewer() {
  // F-12 (wave-4b): no notification retry-queue store is delivered — the
  // old proc served transactions rows mislabeled as queue entries (now
  // fail-loud), and the retryNow/purgeDeadLetters mutations never existed.
  // Honest unavailable state; the query stays wired.
  const { isError } = trpc.retryQueue.list.useQuery(undefined, {
    retry: false,
  });

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Notification Retry Queue</h1>
      <Card>
        <CardContent className="py-10 text-center text-muted-foreground">
          — a notification retry queue is not delivered on this platform
          {isError && (
            <span className="block mt-2 text-xs">
              (backend reports the retry queue as not implemented)
            </span>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
