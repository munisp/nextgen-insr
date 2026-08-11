// @ts-nocheck
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import KpiCard from "@/components/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SystemHealthDashboardPage() {
  const { data, isLoading } = trpc.systemHealth.status.useQuery(undefined, { refetchInterval: 15000 });
  const services = (data?.services as any[]) || [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>System Health</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard title="Services Healthy" value={isLoading ? "…" : String(data?.healthyCount ?? 0)} icon="✅" />
          <KpiCard title="Degraded" value={isLoading ? "…" : String(data?.degradedCount ?? 0)} icon="⚠️" />
          <KpiCard title="Offline" value={isLoading ? "…" : String(data?.offlineCount ?? 0)} icon="❌" />
          <KpiCard title="Avg Response" value={isLoading ? "…" : `${data?.avgResponseMs ?? 0}ms`} icon="⚡" />
        </div>
        <Card>
          <CardHeader><CardTitle>30-Day Uptime</CardTitle></CardHeader>
          <CardContent>
          {Array.isArray(data?.uptimeHistory) &&
          data.uptimeHistory.length > 0 ? (
            <div className="flex gap-1">
              {data.uptimeHistory.map((day: any, i: number) => {
                const up =
                  typeof day === "boolean"
                    ? day
                    : (day?.up ?? day?.status === "up");
                return (
                  <div
                    key={i}
                    className={`flex-1 h-8 rounded ${up ? "bg-green-400" : "bg-red-400"}`}
                    title={day?.date ?? `Day ${i + 1}`}
                  />
                );
              })}
            </div>
          ) : (
            <div className="flex gap-1">
              {Array.from({ length: 30 }, (_, i) => (
                <div
                  key={i}
                  className="flex-1 h-8 rounded bg-muted"
                  title="Uptime data unavailable"
                />
              ))}
            </div>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Overall uptime:{" "}
            {data?.uptime != null ? `${data.uptime}%` : "unknown"}
          </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Service Status</CardTitle></CardHeader>
          <CardContent>
            {services.length === 0 ? (
              <div className="text-sm text-muted-foreground">No service data available yet</div>
            ) : (
              <div className="space-y-2">
                {services.map((s: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">{s.responseMs ?? "—"}ms</div>
                    </div>
                    <Badge variant={s.status === "healthy" ? "default" : s.status === "degraded" ? "secondary" : "destructive"}>{s.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
