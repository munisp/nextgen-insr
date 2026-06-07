// @ts-nocheck
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function WebSocketServicePage() {
  const { data, isLoading } = trpc.websocketService.dashboard.useQuery();

  if (isLoading)
    return (
      <div className="p-6 animate-pulse">Loading WebSocket Dashboard...</div>
    );

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            WebSocket — Real-Time Push Service
          </h1>
          <p className="text-muted-foreground">
            Live event streaming, fraud alerts, and transaction notifications
          </p>
        </div>
        <Badge variant={data?.status === "running" ? "default" : "destructive"}>
          {data?.status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Total Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.totalConnections ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Messages/min</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.messagesPerMinute ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Channels</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {data?.channels?.length ?? 0}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connection Types</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <div className="text-center p-3 border rounded">
              <div className="text-xl font-bold">
                {data?.connectionsByType?.serviceNode ?? 0}
              </div>
              <div className="text-xs text-muted-foreground">Service Nodes</div>
            </div>
            <div className="text-center p-3 border rounded">
              <div className="text-xl font-bold">
                {data?.connectionsByType?.dashboard ?? 0}
              </div>
              <div className="text-xs text-muted-foreground">Dashboards</div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active Channels</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Channel</th>
                  <th className="text-left p-2">Subscribers</th>
                  <th className="text-left p-2">Messages/min</th>
                  <th className="text-left p-2">Priority</th>
                </tr>
              </thead>
              <tbody>
                {(data?.channels || []).map((c: any) => (
                  <tr key={c.id} className="border-b">
                    <td className="p-2 font-mono text-xs">{c.name}</td>
                    <td className="p-2">{c.subscribers}</td>
                    <td className="p-2">{c.messagesPerMin}</td>
                    <td className="p-2">
                      <Badge
                        variant={
                          c.priority === "critical"
                            ? "destructive"
                            : c.priority === "high"
                              ? "default"
                              : "outline"
                        }
                      >
                        {c.priority}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
