/**
 * Admin System Health — InsurePortal InsurePortal Platform (Sprint 89)
 * Real-time system health monitoring for admin users.
 */
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Server,
  Activity,
  Database,
  Cpu,
  HardDrive,
  RefreshCw,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function AdminSystemHealth() {
  const { user } = useAuth();

  if (user && user.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="text-center py-20">
          <Shield className="h-16 w-16 text-red-500/30 mx-auto mb-4" />
          <h1 className="text-xl font-bold">Access Denied</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Administrator privileges required.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const {
    data: health,
    refetch,
    isLoading,
  } = trpc.adminDashboard.getSystemHealth.useQuery(undefined, {
    refetchInterval: 30000,
  });
  const { data: stats } = trpc.adminDashboard.getSystemStats.useQuery();
  const { data: pipeline } = trpc.analyticsQuery.getPipelineHealth.useQuery();

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  };

  const statusColor = (status: string) => {
    if (status === "healthy" || status === "green")
      return "bg-green-500/20 text-green-400";
    if (status === "degraded" || status === "yellow")
      return "bg-amber-500/20 text-amber-400";
    return "bg-red-500/20 text-red-400";
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-6xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Activity className="h-6 w-6 text-primary" />
              System Health
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time platform health monitoring
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetch();
              toast.info("Refreshed");
            }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>

        {health && (
          <>
            {/* Core Services */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Database className="h-5 w-5 text-blue-400" />
                    <span className="text-sm font-semibold">Database</span>
                  </div>
                  <Badge className={statusColor(health.database)}>
                    {health.database}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">PostgreSQL</p>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Server className="h-5 w-5 text-green-400" />
                    <span className="text-sm font-semibold">Server</span>
                  </div>
                  <Badge className={statusColor(health.server)}>
                    {health.server}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">Express + tRPC</p>
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-5 w-5 text-purple-400" />
                    <span className="text-sm font-semibold">Uptime</span>
                  </div>
                </div>
                <p className="text-lg font-bold">
                  {formatUptime(health.uptime)}
                </p>
              </div>
            </div>

            {/* Memory */}
            <div className="rounded-xl border border-border bg-card p-5">
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" />
                Memory Usage
              </h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Heap Used
                  </p>
                  <p className="text-xl font-bold">
                    {health.memory.heapUsed} MB
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">
                    Heap Total
                  </p>
                  <p className="text-xl font-bold">
                    {health.memory.heapTotal} MB
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">RSS</p>
                  <p className="text-xl font-bold">{health.memory.rss} MB</p>
                </div>
              </div>
              <div className="mt-3 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{
                    width: `${Math.min((health.memory.heapUsed / health.memory.heapTotal) * 100, 100)}%`,
                  }}
                />
              </div>
              <p className="text-[10px] text-muted-foreground mt-1">
                {Math.round(
                  (health.memory.heapUsed / health.memory.heapTotal) * 100
                )}
                % heap utilization
              </p>
            </div>
          </>
        )}

        {/* Pipeline Health */}
        {pipeline && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <Wifi className="h-4 w-4 text-primary" />
              Data Pipeline Health
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-3 rounded-lg bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">Fluvio</p>
                <Badge className={statusColor(pipeline.fluvio.status)}>
                  {pipeline.fluvio.status}
                </Badge>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {pipeline.fluvio.endpoint}
                </p>
              </div>
              <div className="p-3 rounded-lg bg-muted/30">
                <p className="text-xs text-muted-foreground mb-1">OpenSearch</p>
                <Badge className={statusColor(pipeline.opensearch.status)}>
                  {pipeline.opensearch.status}
                </Badge>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {pipeline.opensearch.endpoint}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Server Info */}
        {stats && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3">Server Info</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">Node.js</span>
                <p className="font-medium">{stats.nodeVersion}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total Users</span>
                <p className="font-medium">{stats.totalUsers}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Admin Users</span>
                <p className="font-medium">{stats.adminUsers}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Last Check</span>
                <p className="font-medium">
                  {new Date(stats.timestamp).toLocaleTimeString()}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
