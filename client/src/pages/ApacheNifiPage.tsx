import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

export default function ApacheNifiPage() {
  const { data, isLoading } = trpc.apacheNifi.dashboard.useQuery();
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);

  if (isLoading)
    return <div className="p-6 animate-pulse">Loading NiFi Dashboard...</div>;

  const overview = data?.overview;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Apache NiFi — Data Flow Engine</h1>
          <p className="text-muted-foreground">
            Real-time data ingestion, routing, and transformation pipelines
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={
              data?.clusterStatus === "connected" ? "default" : "destructive"
            }
          >
            {data?.clusterStatus || "disconnected"}
          </Badge>
          <Badge variant="outline">v{data?.nifiVersion}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Process Groups</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overview?.totalProcessGroups ?? 0}
            </div>
            <div className="text-xs text-muted-foreground">
              {overview?.runningGroups ?? 0} running /{" "}
              {overview?.stoppedGroups ?? 0} stopped
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Processors</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overview?.totalProcessors ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Active Threads</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overview?.totalActiveThreads ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Throughput</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {overview?.throughputBytesPerSec ?? 0} B/s
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Process Groups</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-2">Name</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Processors</th>
                  <th className="text-left p-2">Queue</th>
                  <th className="p-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.processGroups || []).map((g: any) => (
                  <tr key={g.id} className="border-b">
                    <td className="p-2 font-medium">{g.name}</td>
                    <td className="p-2">
                      <Badge
                        variant={
                          g.status === "running" ? "default" : "secondary"
                        }
                      >
                        {g.status}
                      </Badge>
                    </td>
                    <td className="p-2">{g.processors}</td>
                    <td className="p-2">{g.queuedCount}</td>
                    <td className="p-2 text-center">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedGroup(g.id)}
                      >
                        Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {data?.recentBulletins && data.recentBulletins.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Bulletins</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.recentBulletins.map((b: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-2 border rounded text-sm"
                >
                  <Badge
                    variant={b.level === "ERROR" ? "destructive" : "outline"}
                  >
                    {b.level}
                  </Badge>
                  <span className="flex-1">{b.message}</span>
                  <span className="text-xs text-muted-foreground">
                    {b.sourceComponent}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {selectedGroup && (
        <Card>
          <CardHeader>
            <CardTitle>Group Details: {selectedGroup}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              Detailed processor metrics, back-pressure status, and connection
              health.
            </p>
            <Button
              className="mt-4"
              variant="outline"
              onClick={() => setSelectedGroup(null)}
            >
              Close
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
