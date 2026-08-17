import { CheckCircle2, AlertTriangle, XCircle, Activity } from "lucide-react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import KpiCard from "@/components/KpiCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function SystemHealthDashboardPage() {
  const { data, isLoading } = trpc.systemHealthDashboard.getStatus.useQuery(undefined, { refetchInterval: 15000 });
  // F-12 (wave-4b): real getStatus shape {services, overallStatus,
  // unhealthyCount} — no phantom healthy/degraded/offline counts, responseMs,
  // or uptimeHistory; those render "—"/honest placeholders.
  const services = data?.services ?? [];
  const healthyCount = services.filter(sv => sv.status !== "error").length;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>System Health</h1>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard title="Services Healthy" value={isLoading ? "…" : String(healthyCount)} icon={CheckCircle2} />
          <KpiCard title="Unhealthy" value={isLoading ? "…" : String(data?.unhealthyCount ?? 0)} icon={XCircle} />
          <KpiCard title="Overall" value={isLoading ? "…" : (data?.overallStatus ?? "—")} icon={Activity} />
          <KpiCard title="Avg Response" value="—" icon={AlertTriangle} />
        </div>
        <Card>
          <CardHeader><CardTitle>30-Day Uptime</CardTitle></CardHeader>
          <CardContent>
          {/* F-12: no uptime-history source is delivered — honest placeholder */}
          <div className="flex gap-1">
            {Array.from({ length: 30 }, (_, i) => (
              <div
                key={i}
                className="flex-1 h-8 rounded bg-muted"
                title="Uptime data unavailable"
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Overall status:{" "}
            {data?.overallStatus ?? "unknown"}
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
                {services.map((s, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-muted-foreground">—</div>
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
