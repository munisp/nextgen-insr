import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  RefreshCw,
  Layers,
  CheckCircle,
  Clock,
  DollarSign,
  Activity,
} from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-500/20 text-emerald-400",
  processing: "bg-blue-500/20 text-blue-400",
  pending: "bg-yellow-500/20 text-yellow-400",
  failed: "bg-red-500/20 text-red-400",
};



// ─── Main Page ───────────────────────────────────────────────────────────────

export default function SettlementBatchProcessor() {
  const [statusFilter, setStatusFilter] = useState("all");

  // I2-wave 2026-02: the Socket.IO /settlement namespace is DELETED on the
  // server (H2: it was a dead, unauthenticated broadcaster; the only emitter
  // — batchProgressReporter.createSocketIOProgressHandler — is unwired). The
  // old useSettlementProgressSocket client path could never connect. Live
  // progress is now served honestly by polling the batch API.
  // @ts-ignore Sprint 85
  const statsQuery = trpc.settlementBatchProcessor.getStats.useQuery();
  // @ts-ignore Sprint 85
  const batchesQuery = trpc.settlementBatchProcessor.listBatches.useQuery(
    {
      status: statusFilter as any,
      limit: 50,
      offset: 0,
    },
    { refetchInterval: 3000 }
  );
  const stats = statsQuery.data as any;
  const batches = (batchesQuery.data as any)?.batches ?? [];
  const activeBatchCount = batches.filter(
    (b: any) => b.status === "processing" || b.status === "pending"
  ).length;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="h-6 w-6" /> Settlement Batch Processor
            </h1>
            <p className="text-muted-foreground">
              Monitor and manage settlement batch processing with real-time
              progress
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              statsQuery.refetch();
              batchesQuery.refetch();
              toast.success("Data refreshed");
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <Layers className="h-4 w-4" /> Total Batches
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats?.totalBatches ?? "—"}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats?.totalSettlements ?? 0} settlements
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <CheckCircle className="h-4 w-4" /> Settled
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">
                {stats?.settled ?? "—"}
              </div>
              <p className="text-xs text-muted-foreground">
                Reconciliation: {stats?.reconciliationRate ?? 0}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="h-4 w-4" /> Processing
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-500">
                {stats?.processing ?? "—"}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats?.pending ?? 0} pending
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-4 w-4" /> Total Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ₦{stats?.totalVolume?.toLocaleString() ?? "—"}
              </div>
              <p className="text-xs text-muted-foreground">
                Avg batch: ₦{stats?.avgBatchSize?.toLocaleString() ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Live progress (polling — the /settlement socket namespace no longer exists) */}
        <Card className={activeBatchCount > 0 ? "" : "border-dashed"}>
          <CardContent className="py-6">
            <div className="flex items-center justify-center gap-3 text-muted-foreground">
              <Activity
                className={`h-5 w-5 ${activeBatchCount > 0 ? "text-blue-400 animate-pulse" : ""}`}
              />
              <span className="text-sm">
                {activeBatchCount > 0
                  ? `${activeBatchCount} batch(es) active — list refreshes every 3s.`
                  : "No active batch processing. The list refreshes automatically every 3s."}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Batch Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Settlement Batches</CardTitle>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder="Filter" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {batchesQuery.isLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : batches.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No batches found
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-3 px-2">Batch Ref</th>
                      <th className="text-left py-3 px-2">Merchant</th>
                      <th className="text-left py-3 px-2">Amount</th>
                      <th className="text-left py-3 px-2">Status</th>
                      <th className="text-left py-3 px-2">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batches.map((b: any) => (
                      <tr key={b.id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-2 font-mono text-xs">
                          {b.ref ?? b.batchRef ?? `BATCH-${b.id}`}
                        </td>
                        <td className="py-3 px-2">
                          {b.merchantName ?? `Merchant-${b.merchantId}`}
                        </td>
                        <td className="py-3 px-2 font-mono">
                          ₦
                          {Number(
                            b.amount ?? b.totalAmount ?? 0
                          ).toLocaleString()}
                        </td>
                        <td className="py-3 px-2">
                          <Badge className={STATUS_COLORS[b.status] ?? ""}>
                            {b.status}
                          </Badge>
                        </td>
                        <td className="py-3 px-2 text-muted-foreground">
                          {b.createdAt
                            ? new Date(b.createdAt).toLocaleDateString()
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
