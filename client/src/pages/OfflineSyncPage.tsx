import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { WifiOff, RefreshCw, CheckCircle, AlertTriangle } from "lucide-react";

export default function OfflineSyncPage() {
  const queue = trpc.offlineSync.queue.useQuery({ limit: 20 });
  const analytics = trpc.offlineSync.analytics.useQuery();
  const conflicts = trpc.offlineSync.queue.useQuery({
    status: "conflict",
    limit: 10,
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Offline Sync</h1>
          <p className="text-muted-foreground">
            Transaction queuing and conflict resolution for low-connectivity
            areas
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Queued Items
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.queued ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Synced
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.synced ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Conflicts
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-yellow-600">
                {analytics.data?.conflicts ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Sync Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.offlineAgents ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <WifiOff className="h-5 w-5" /> Sync Queue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2">ID</th>
                    <th className="text-left p-2">Agent</th>
                    <th className="text-left p-2">Type</th>
                    <th className="text-right p-2">Amount</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-right p-2">Retries</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.data?.items?.map((item: any) => (
                    <tr key={item.id} className="border-b">
                      <td className="p-2 font-mono text-xs">{item.id}</td>
                      <td className="p-2">{item.agentName}</td>
                      <td className="p-2">{item.type}</td>
                      <td className="p-2 text-right">
                        NGN {item.amount?.toLocaleString()}
                      </td>
                      <td className="p-2">
                        <Badge
                          variant={
                            item.status === "synced"
                              ? "default"
                              : item.status === "pending"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {item.status}
                        </Badge>
                      </td>
                      <td className="p-2 text-right">{item.retryCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" /> Conflicts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {conflicts.data?.items?.map((c: any) => (
                <div
                  key={c.id}
                  className="border rounded p-3 flex items-center justify-between"
                >
                  <div>
                    <p className="font-medium">{c.type}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.agentName} &bull; {c.description}
                    </p>
                  </div>
                  <Badge variant={c.resolved ? "default" : "destructive"}>
                    {c.resolved ? "Resolved" : "Pending"}
                  </Badge>
                </div>
              ))}
              {(!conflicts.data?.items ||
                conflicts.data?.items?.length === 0) && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No conflicts
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
