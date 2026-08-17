import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function EventDrivenArchPage() {
  const { data, isLoading } = trpc.eventDrivenArch.dashboard.useQuery();
  const dlq = trpc.eventDrivenArch.getDeadLetterQueue.useQuery({ limit: 20 });

  if (isLoading)
    return (
      <div className="p-6 animate-pulse">Loading Event Architecture...</div>
    );

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Event-Driven Architecture</h1>
        <p className="text-muted-foreground">
          Kafka topics, event sourcing, CQRS patterns, and saga orchestration
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Topics</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.totalTopics ?? 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Subscribers</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.totalSubscribers ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Messages/sec</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.totalMessagesPerSec ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Dead Letters</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">
              {data?.deadLetterCount ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Kafka Topics</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Topic</th>
                  <th className="text-left p-2">Partitions</th>
                  <th className="text-left p-2">Messages/sec</th>
                  <th className="text-left p-2">Subscribers</th>
                </tr>
              </thead>
              <tbody>
                {(data?.topics || []).map((t: any) => (
                  <tr key={t.name} className="border-b">
                    <td className="p-2 font-mono text-xs">{t.name}</td>
                    <td className="p-2">{t.partitions}</td>
                    <td className="p-2">{t.messagesPerSec}</td>
                    <td className="p-2">{t.subscribers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {dlq.data && dlq.data.items.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Dead Letter Queue ({dlq.data.total})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {dlq.data.items.map((item: any) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 p-2 border rounded text-sm"
                >
                  <Badge variant="destructive">DLQ</Badge>
                  <span className="font-medium">{item.topic}</span>
                  <span className="text-muted-foreground truncate flex-1">
                    {item.error}
                  </span>
                  <span className="text-xs">{item.retryCount} retries</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
