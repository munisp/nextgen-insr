import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cpu, HardDrive, Activity, Gauge } from "lucide-react";

export default function PerformanceProfilerPage() {
  const { data } = trpc.performanceProfiler.dashboard.useQuery();
  const { data: mem } = trpc.performanceProfiler.memoryProfile.useQuery();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Performance Profiler</h1>
        <p className="text-muted-foreground">
          System metrics, slow queries, endpoint tracing
        </p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          {
            label: "CPU Usage",
            value: `${data?.system?.cpuUsage ?? 0}%`,
            icon: Cpu,
          },
          {
            label: "Memory",
            value: `${data?.system?.memoryUsage ?? 0}%`,
            icon: HardDrive,
          },
          {
            label: "Requests/sec",
            value: data?.application?.requestsPerSec ?? 0,
            icon: Activity,
          },
          {
            label: "Avg Response",
            value: `${data?.application?.avgResponseMs ?? 0}ms`,
            icon: Gauge,
          },
        ].map((s, i) => (
          <Card key={i}>
            <CardContent className="pt-4 flex items-center gap-3">
              <s.icon className="w-8 h-8 text-blue-500" />
              <div>
                <p className="text-2xl font-bold">{s.value}</p>
                <p className="text-xs text-muted-foreground">{s.label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Slow Endpoints</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(data?.topSlowEndpoints ?? []).map((e: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 rounded bg-muted/50"
                >
                  <span className="text-sm font-mono truncate max-w-[60%]">
                    {e.endpoint}
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={e.avgMs > 1000 ? "destructive" : "secondary"}
                    >
                      {e.avgMs}ms
                    </Badge>
                    <span className="text-xs">{e.calls} calls</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Memory Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Heap Used</span>
                <span>{mem?.heapUsed ?? 0} MB</span>
              </div>
              <div className="flex justify-between">
                <span>Heap Total</span>
                <span>{mem?.heapTotal ?? 0} MB</span>
              </div>
              <div className="flex justify-between">
                <span>RSS</span>
                <span>{mem?.rss ?? 0} MB</span>
              </div>
              <div className="flex justify-between">
                <span>GC Pauses</span>
                <span>
                  {mem?.gcPauses?.count ?? 0} (avg {mem?.gcPauses?.avgMs ?? 0}
                  ms)
                </span>
              </div>
              <div className="flex justify-between">
                <span>Leak Suspects</span>
                <Badge
                  variant={
                    mem?.leakSuspects?.length === 0 ? "default" : "destructive"
                  }
                >
                  {mem?.leakSuspects?.length ?? 0}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
