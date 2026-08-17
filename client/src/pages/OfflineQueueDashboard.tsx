/**
 * Sprint 92 — Offline Queue Status Dashboard
 *
 * Displays real-time offline queue status and synchronization progress
 * for agents on unstable 2G/3G networks. Shows queue size, sync progress,
 * retry status, network quality metrics, and sync history.
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowUpDown,
  Loader2,
  Signal,
  Smartphone,
  TrendingUp,
  Database,
  Zap,
  BarChart3,
} from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  if (ms < 3600000)
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

const statusConfig: Record<
  string,
  { color: string; icon: React.ReactNode; label: string }
> = {
  pending: {
    color: "bg-yellow-500/10 text-yellow-600 border-yellow-500/20",
    icon: <Clock className="h-3 w-3" />,
    label: "Pending",
  },
  syncing: {
    color: "bg-blue-500/10 text-blue-600 border-blue-500/20",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: "Syncing",
  },
  synced: {
    color: "bg-green-500/10 text-green-600 border-green-500/20",
    icon: <CheckCircle2 className="h-3 w-3" />,
    label: "Synced",
  },
  failed: {
    color: "bg-red-500/10 text-red-600 border-red-500/20",
    icon: <XCircle className="h-3 w-3" />,
    label: "Failed",
  },
  retrying: {
    color: "bg-orange-500/10 text-orange-600 border-orange-500/20",
    icon: <RefreshCw className="h-3 w-3 animate-spin" />,
    label: "Retrying",
  },
};

const networkConfig: Record<string, { color: string; speed: string }> = {
  "2g": { color: "text-red-500", speed: "~50 kbps" },
  edge: { color: "text-orange-500", speed: "~200 kbps" },
  "3g": { color: "text-yellow-500", speed: "~2 Mbps" },
  "4g": { color: "text-green-500", speed: "~20 Mbps" },
  wifi: { color: "text-blue-500", speed: "~50 Mbps" },
};

export default function OfflineQueueDashboard() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [autoRefresh, setAutoRefresh] = useState(true);

  // tRPC queries
  const queueStatus = trpc.offlineQueue.getQueueStatus.useQuery({});
  const syncHistory = trpc.offlineQueue.getSyncHistory.useQuery({
    status: statusFilter as any,
    page,
    pageSize: 15,
  });
  const networkMetrics = trpc.offlineQueue.getNetworkMetrics.useQuery({});
  const retryMutation = trpc.offlineQueue.retryFailed.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Retry initiated: ${data.retried} items queued for retry`);
      queueStatus.refetch();
      syncHistory.refetch();
    },
    onError: () => {
      toast.error("Retry failed: Could not retry failed items");
    },
  });
  const clearMutation = trpc.offlineQueue.clearSynced.useMutation({
    onSuccess: (data: any) => {
      toast.success(`Cleanup complete: ${data.cleared} synced items removed`);
      queueStatus.refetch();
      syncHistory.refetch();
    },
  });

  // Auto-refresh every 10 seconds
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      queueStatus.refetch();
      syncHistory.refetch();
      networkMetrics.refetch();
    }, 10000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const summary = queueStatus.data?.summary;
  const totalInQueue =
    (summary?.pendingCount ?? 0) +
    (summary?.syncingCount ?? 0) +
    (summary?.retryingCount ?? 0);
  const totalProcessed =
    (summary?.syncedCount ?? 0) + (summary?.failedCount ?? 0);
  const syncProgress =
    totalProcessed > 0
      ? Math.round(
          ((summary?.syncedCount ?? 0) / (totalProcessed + totalInQueue)) * 100
        )
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Signal className="h-6 w-6 text-primary" />
            Offline Queue Status
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitor synchronization progress for transactions queued during
            network outages
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={autoRefresh ? "border-green-500 text-green-600" : ""}
          >
            {autoRefresh ? (
              <Wifi className="h-4 w-4 mr-1" />
            ) : (
              <WifiOff className="h-4 w-4 mr-1" />
            )}
            {autoRefresh ? "Auto-refresh ON" : "Auto-refresh OFF"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              queueStatus.refetch();
              syncHistory.refetch();
              networkMetrics.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock className="h-4 w-4 text-yellow-500" /> Pending
            </div>
            <div className="text-2xl font-bold">
              {summary?.pendingCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Loader2 className="h-4 w-4 text-blue-500 animate-spin" /> Syncing
            </div>
            <div className="text-2xl font-bold">
              {summary?.syncingCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <CheckCircle2 className="h-4 w-4 text-green-500" /> Synced
            </div>
            <div className="text-2xl font-bold">
              {summary?.syncedCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <XCircle className="h-4 w-4 text-red-500" /> Failed
            </div>
            <div className="text-2xl font-bold text-red-600">
              {summary?.failedCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <RefreshCw className="h-4 w-4 text-orange-500" /> Retrying
            </div>
            <div className="text-2xl font-bold">
              {summary?.retryingCount ?? 0}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Database className="h-4 w-4 text-purple-500" /> Queue Size
            </div>
            <div className="text-2xl font-bold">
              {formatBytes(summary?.totalQueuedBytes ?? 0)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sync Progress Bar */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <span className="font-semibold">Synchronization Progress</span>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              {summary?.estimatedSyncTimeMs &&
                summary.estimatedSyncTimeMs > 0 && (
                  <span>
                    Est. time:{" "}
                    <strong>
                      {formatDuration(summary.estimatedSyncTimeMs)}
                    </strong>
                  </span>
                )}
              {summary?.oldestPendingAt && (
                <span>
                  Oldest: <strong>{timeAgo(summary.oldestPendingAt)}</strong>
                </span>
              )}
            </div>
          </div>
          <Progress value={syncProgress} className="h-3" />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span>{syncProgress}% complete</span>
            <span>
              {summary?.syncedCount ?? 0} of{" "}
              {(summary?.syncedCount ?? 0) +
                totalInQueue +
                (summary?.failedCount ?? 0)}{" "}
              transactions synced
            </span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="queue" className="space-y-4">
        <TabsList>
          <TabsTrigger value="queue">Queue Items</TabsTrigger>
          <TabsTrigger value="network">Network Quality</TabsTrigger>
          <TabsTrigger value="actions">Actions</TabsTrigger>
        </TabsList>

        {/* Queue Items Tab */}
        <TabsContent value="queue" className="space-y-4">
          <div className="flex items-center gap-3">
            <Select
              value={statusFilter}
              onValueChange={v => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Filter status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="syncing">Syncing</SelectItem>
                <SelectItem value="synced">Synced</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="retrying">Retrying</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">
              {syncHistory.data?.total ?? 0} items
            </span>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">Operation</th>
                  <th className="text-left p-3 font-medium">Status</th>
                  <th className="text-left p-3 font-medium">Network</th>
                  <th className="text-left p-3 font-medium">Size</th>
                  <th className="text-left p-3 font-medium">Queued</th>
                  <th className="text-left p-3 font-medium">Retries</th>
                  <th className="text-left p-3 font-medium">Error</th>
                </tr>
              </thead>
              <tbody>
                {syncHistory.data?.items.map((item: any) => {
                  const sc = statusConfig[item.status] ?? statusConfig.pending;
                  const nc = networkConfig[item.networkType ?? ""] ?? {
                    color: "text-muted-foreground",
                    speed: "?",
                  };
                  return (
                    <tr
                      key={item.id}
                      className="border-t hover:bg-muted/30 transition-colors"
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <Zap className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="font-medium capitalize">
                            {item.operationType.replace(/_/g, " ")}
                          </span>
                        </div>
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={`${sc.color} gap-1`}
                        >
                          {sc.icon} {sc.label}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <span className={`font-mono text-xs ${nc.color}`}>
                          {(item.networkType ?? "?").toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {formatBytes(item.payloadSize)}
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {timeAgo(item.queuedAt)}
                      </td>
                      <td className="p-3">
                        {item.retryCount > 0 ? (
                          <span className="text-orange-600 font-mono text-xs">
                            {item.retryCount}/5
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                      <td className="p-3 max-w-[200px]">
                        {item.errorMessage ? (
                          <span className="text-red-500 text-xs truncate block">
                            {item.errorMessage}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(!syncHistory.data?.items ||
                  syncHistory.data.items.length === 0) && (
                  <tr>
                    <td
                      colSpan={7}
                      className="p-8 text-center text-muted-foreground"
                    >
                      No queue items found
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {syncHistory.data && syncHistory.data.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Page {syncHistory.data.page} of {syncHistory.data.totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= (syncHistory.data?.totalPages ?? 1)}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Network Quality Tab */}
        <TabsContent value="network" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {networkMetrics.data?.networkBreakdown &&
              Object.entries(networkMetrics.data.networkBreakdown).map(
                ([net, metrics]: [string, any]) => {
                  const nc = networkConfig[net] ?? {
                    color: "text-muted-foreground",
                    speed: "?",
                  };
                  return (
                    <Card key={net}>
                      <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Smartphone className={`h-4 w-4 ${nc.color}`} />
                          {net.toUpperCase()}
                        </CardTitle>
                        <CardDescription>
                          Typical speed: {nc.speed}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Transactions
                          </span>
                          <span className="font-semibold">{metrics.count}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Avg payload
                          </span>
                          <span className="font-semibold">
                            {formatBytes(metrics.avgPayload)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">
                            Failure rate
                          </span>
                          <span
                            className={`font-semibold ${metrics.failRate > 20 ? "text-red-500" : metrics.failRate > 10 ? "text-yellow-500" : "text-green-500"}`}
                          >
                            {metrics.failRate}%
                          </span>
                        </div>
                        <Progress
                          value={100 - metrics.failRate}
                          className="h-2"
                        />
                        <p className="text-xs text-muted-foreground">
                          {100 - metrics.failRate}% success rate
                        </p>
                      </CardContent>
                    </Card>
                  );
                }
              )}
          </div>

          {networkMetrics.data && (
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-3">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  <span className="font-semibold">Overall Network Health</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Total records analyzed
                    </p>
                    <p className="text-xl font-bold">
                      {networkMetrics.data.totalRecords}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">
                      Overall failure rate
                    </p>
                    <p
                      className={`text-xl font-bold ${networkMetrics.data.overallFailRate > 15 ? "text-red-500" : "text-green-500"}`}
                    >
                      {networkMetrics.data.overallFailRate}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Actions Tab */}
        <TabsContent value="actions" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RefreshCw className="h-4 w-4 text-orange-500" />
                  Retry Failed Transactions
                </CardTitle>
                <CardDescription>
                  Re-queue all failed transactions for another sync attempt.
                  Items that have exceeded max retries (5) will be skipped.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => retryMutation.mutate({})}
                  disabled={
                    retryMutation.isPending || (summary?.failedCount ?? 0) === 0
                  }
                  className="w-full"
                >
                  {retryMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4 mr-2" />
                  )}
                  Retry All Failed ({summary?.failedCount ?? 0} items)
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-yellow-500" />
                  Cleanup Synced Items
                </CardTitle>
                <CardDescription>
                  Remove successfully synced items older than 24 hours from the
                  queue to free up local storage space.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant="outline"
                  onClick={() =>
                    clearMutation.mutate({ olderThanMs: 86400000 })
                  }
                  disabled={clearMutation.isPending}
                  className="w-full"
                >
                  {clearMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Database className="h-4 w-4 mr-2" />
                  )}
                  Clear Synced Items (24h+)
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Connection Tips */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wifi className="h-4 w-4 text-blue-500" />
                Tips for Low-Bandwidth Networks
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                1. Transactions are automatically queued when connectivity drops
                below threshold.
              </p>
              <p>
                2. The system uses adaptive compression to minimize payload size
                on 2G/EDGE networks.
              </p>
              <p>
                3. Critical transactions (premium collection/claim payout) are prioritized in
                the sync queue.
              </p>
              <p>
                4. Failed transactions are automatically retried up to 5 times
                with exponential backoff.
              </p>
              <p>
                5. If you see persistent failures, try moving to an area with
                better signal coverage.
              </p>
              <p>
                6. Queue data is stored locally and will sync when connectivity
                is restored.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
