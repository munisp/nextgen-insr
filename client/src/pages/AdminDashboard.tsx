/**
 * Admin Dashboard — InsurePortal InsurePortal Platform (Sprint 89)
 *
 * Role-gated admin dashboard with system stats, user management,
 * billing ledger summary, and system health monitoring.
 * Only accessible to users with role=admin.
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Shield,
  Users,
  Activity,
  Server,
  Database,
  Clock,
  BarChart3,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function AdminDashboard() {
  const { user } = useAuth();
  const [userFilter, setUserFilter] = useState<"admin" | "user" | undefined>(
    undefined
  );
  const [showAudit, setShowAudit] = useState(false);

  // Guard: only admin users
  if (user && user.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="text-center py-20">
          <Shield className="h-16 w-16 text-red-500/30 mx-auto mb-4" />
          <h1 className="text-xl font-bold">Access Denied</h1>
          <p className="text-sm text-muted-foreground mt-2">
            You need administrator privileges to access this page.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const {
    data: stats,
    isLoading: statsLoading,
    refetch: refetchStats,
  } = trpc.adminDashboard.getSystemStats.useQuery();
  const { data: usersData, refetch: refetchUsers } =
    trpc.adminDashboard.listUsers.useQuery({
      limit: 50,
      offset: 0,
      role: userFilter,
    });
  const { data: healthData } = trpc.adminDashboard.getSystemHealth.useQuery();
  const { data: auditData } = trpc.adminDashboard.getAuditLog.useQuery(
    { limit: 20, offset: 0 },
    { enabled: showAudit }
  );
  const { data: ledgerData } =
    trpc.adminDashboard.getBillingLedgerSummary.useQuery();

  const updateRole = trpc.adminDashboard.updateUserRole.useMutation({
    onSuccess: () => {
      toast.success("User role updated");
      refetchUsers();
      refetchStats();
    },
    onError: err => toast.error(err.message),
  });

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${d}d ${h}h ${m}m`;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              Admin Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Platform administration and monitoring
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchStats();
              refetchUsers();
              toast.info("Refreshed");
            }}
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-blue-400" />
              <span className="text-xs text-muted-foreground">Total Users</span>
            </div>
            <p className="text-2xl font-bold">{stats?.totalUsers ?? "—"}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Shield className="h-4 w-4 text-amber-400" />
              <span className="text-xs text-muted-foreground">Admin Users</span>
            </div>
            <p className="text-2xl font-bold">{stats?.adminUsers ?? "—"}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <BarChart3 className="h-4 w-4 text-green-400" />
              <span className="text-xs text-muted-foreground">
                Recent Signups (30d)
              </span>
            </div>
            <p className="text-2xl font-bold">{stats?.recentSignups ?? "—"}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-purple-400" />
              <span className="text-xs text-muted-foreground">
                Stripe Linked
              </span>
            </div>
            <p className="text-2xl font-bold">
              {stats?.stripeLinkedUsers ?? "—"}
            </p>
          </div>
        </div>

        {/* System Health */}
        {healthData && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Server className="h-4 w-4 text-primary" />
              System Health
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
              <div>
                <span className="text-muted-foreground">Database</span>
                <Badge
                  className={cn(
                    "ml-2",
                    healthData.database === "healthy"
                      ? "bg-green-500/20 text-green-400"
                      : "bg-red-500/20 text-red-400"
                  )}
                >
                  {healthData.database}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Server</span>
                <Badge className="ml-2 bg-green-500/20 text-green-400">
                  {healthData.server}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Uptime</span>
                <span className="ml-2 font-medium">
                  {formatUptime(healthData.uptime)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Memory</span>
                <span className="ml-2 font-medium">
                  {healthData.memory.heapUsed}MB / {healthData.memory.heapTotal}
                  MB
                </span>
              </div>
            </div>
          </div>
        )}

        {/* User Management */}
        <div className="rounded-xl border border-border bg-card">
          <div className="p-4 border-b border-border flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              User Management ({usersData?.total ?? 0})
            </h3>
            <div className="flex gap-2">
              {(["all", "admin", "user"] as const).map(f => (
                <Button
                  key={f}
                  size="sm"
                  variant={
                    (!userFilter && f === "all") || userFilter === f
                      ? "default"
                      : "ghost"
                  }
                  className="text-xs h-7"
                  onClick={() => setUserFilter(f === "all" ? undefined : f)}
                >
                  {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
                </Button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                    ID
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                    Name
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                    Email
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                    Role
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                    Stripe
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                    MFA
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                    Joined
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {usersData?.users.map(u => (
                  <tr key={u.id} className="hover:bg-muted/20">
                    <td className="px-4 py-2 font-mono">{u.id}</td>
                    <td className="px-4 py-2">{u.name || "—"}</td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {u.email || "—"}
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px]",
                          u.role === "admin"
                            ? "text-amber-400 border-amber-500/30"
                            : "text-blue-400 border-blue-500/30"
                        )}
                      >
                        {u.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      {u.stripeCustomerId ? (
                        <Badge className="bg-green-500/20 text-green-400 text-[10px]">
                          Linked
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {u.mfaEnabled ? (
                        <Badge className="bg-green-500/20 text-green-400 text-[10px]">
                          On
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Off</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {u.createdAt
                        ? new Date(u.createdAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {u.id !== user?.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-[10px] h-6"
                          onClick={() =>
                            updateRole.mutate({
                              userId: u.id,
                              role: u.role === "admin" ? "user" : "admin",
                            })
                          }
                          disabled={updateRole.isPending}
                        >
                          {u.role === "admin" ? "Demote" : "Promote"}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Billing Ledger Summary */}
        {ledgerData && (
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              Billing Ledger ({ledgerData.totalEntries} entries)
            </h3>
            {ledgerData.recentEntries.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                        Tenant
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                        Type
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                        Gross
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                        Status
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">
                        Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ledgerData.recentEntries.slice(0, 10).map((entry: any) => (
                      <tr key={entry.id} className="hover:bg-muted/20">
                        <td className="px-3 py-2">{entry.tenantId}</td>
                        <td className="px-3 py-2">{entry.transactionType}</td>
                        <td className="px-3 py-2 font-medium">
                          {entry.grossAmount} {entry.currency}
                        </td>
                        <td className="px-3 py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {entry.status}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {entry.createdAt
                            ? new Date(entry.createdAt).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                No ledger entries yet
              </p>
            )}
          </div>
        )}

        {/* Audit Log Toggle */}
        <div className="rounded-xl border border-border bg-card">
          <button
            className="w-full p-4 flex items-center justify-between text-sm font-semibold"
            onClick={() => setShowAudit(!showAudit)}
          >
            <span className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Audit Log ({auditData?.total ?? "..."})
            </span>
            {showAudit ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
          {showAudit && auditData && (
            <div className="px-4 pb-4 space-y-2">
              {auditData.logs.length > 0 ? (
                auditData.logs.map((log: any) => (
                  <div
                    key={log.id}
                    className="text-xs p-2 rounded bg-muted/30 flex items-center justify-between"
                  >
                    <div>
                      <span className="font-medium">{log.action}</span>
                      <span className="text-muted-foreground ml-2">
                        by {log.userName}
                      </span>
                      <span className="text-muted-foreground ml-2">
                        on {log.resourceType}:{log.resourceId}
                      </span>
                    </div>
                    <span className="text-muted-foreground">
                      {log.createdAt
                        ? new Date(log.createdAt).toLocaleString()
                        : "—"}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4">
                  No audit logs
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </DashboardLayout>
  );
}
