import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function RetryQueueViewer() {
  const queueQ = trpc.retryQueue.list.useQuery({});
  const retryNow = trpc.retryQueue.retryNow.useMutation({
    onSuccess: () => {
      queueQ.refetch();
      toast.success("Retry successful");
    },
  });
  const purge = trpc.retryQueue.purgeDeadLetters.useMutation({
    onSuccess: d => {
      queueQ.refetch();
      toast.success(`Purged ${d.purged} dead letters`);
    },
  });

  const statusColor: Record<string, string> = {
    pending: "bg-yellow-500",
    retrying: "bg-blue-500 animate-pulse",
    delivered: "bg-green-500",
    dead_letter: "bg-red-500",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Notification Retry Queue</h1>
            <p className="text-gray-400">
              Monitor failed notifications and manage retries
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="destructive"
              onClick={() => purge.mutate()}
            >
              Purge Dead Letters
            </Button>
            <a href="/" className="text-sm text-gray-400 hover:text-white">
              ← Back
            </a>
          </div>
        </div>

        {/* Stats */}
        {queueQ.data?.stats && (
          <div className="grid grid-cols-4 gap-4">
            {Object.entries(queueQ.data.stats).map(([key, value]) => (
              <Card key={key} className="bg-gray-900 border-gray-800">
                <CardContent className="pt-4">
                  <div className="text-2xl font-bold text-white">{value}</div>
                  <div className="text-sm text-gray-400 capitalize">
                    {key.replace(/([A-Z])/g, " $1")}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Queue entries */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Queue Entries</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {queueQ.data?.entries.map(entry => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between bg-gray-800 rounded-lg p-4"
                >
                  <div className="flex items-center gap-4">
                    <Badge
                      className={`${statusColor[entry.status]} text-white`}
                    >
                      {entry.status.replace(/_/g, " ")}
                    </Badge>
                    <div>
                      <div className="text-sm font-medium text-white">
                        {entry.channel.toUpperCase()} → {entry.recipient}
                      </div>
                      <div className="text-xs text-gray-400">
                        Attempt {entry.attempt}/{entry.maxAttempts} · Backoff:{" "}
                        {(entry.backoffMs / 1000).toFixed(0)}s
                      </div>
                      <div className="text-xs text-red-400 mt-0.5">
                        Error: {entry.lastError}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {entry.nextRetryAt && (
                      <span className="text-xs text-gray-500">
                        Next: {new Date(entry.nextRetryAt).toLocaleTimeString()}
                      </span>
                    )}
                    {(entry.status === "pending" ||
                      entry.status === "dead_letter") && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => retryNow.mutate({ id: entry.id })}
                      >
                        Retry Now
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {queueQ.data?.entries.length === 0 && (
                <p className="text-gray-500 text-center py-8">Queue is empty</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
