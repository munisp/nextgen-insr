import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import DashboardLayout from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Clock,
  Search,
} from "lucide-react";

export default function SettlementReconciliation() {
  const { loading, isAuthenticated } = useAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("all");
  const [reconcileDate, setReconcileDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [resolveId, setResolveId] = useState<number | null>(null);
  const [resolution, setResolution] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.settlementRecon.list.useQuery({
    page,
    limit: 20,
    status: statusFilter === "all" ? undefined : (statusFilter as any),
  });
  const { data: stats } = trpc.settlementRecon.stats.useQuery();

  const reconcileMutation = trpc.settlementRecon.reconcileDate.useMutation({
    onSuccess: d => {
      utils.settlementRecon.list.invalidate();
      utils.settlementRecon.stats.invalidate();
      toast.success(`Reconciled ${d.processed} settlement(s)`);
    },
    onError: e => toast.error(e.message),
  });

  const resolveMutation = trpc.settlementRecon.resolve.useMutation({
    onSuccess: () => {
      utils.settlementRecon.list.invalidate();
      utils.settlementRecon.stats.invalidate();
      setResolveId(null);
      setResolution("");
      toast.success("Discrepancy resolved");
    },
    onError: e => toast.error(e.message),
  });

  if (loading)
    return (
      <div className="flex items-center justify-center h-screen">
        Loading...
      </div>
    );
  if (!isAuthenticated) {
    window.location.href = getLoginUrl();
    return null;
  }

  const statusIcon = (s: string) => {
    if (s === "matched")
      return <CheckCircle className="w-4 h-4 text-green-600" />;
    if (s === "discrepancy")
      return <AlertTriangle className="w-4 h-4 text-red-600" />;
    if (s === "resolved")
      return <CheckCircle className="w-4 h-4 text-blue-600" />;
    return <Clock className="w-4 h-4 text-yellow-600" />;
  };

  const statusColor = (s: string) =>
    s === "matched"
      ? "bg-green-100 text-green-800"
      : s === "discrepancy"
        ? "bg-red-100 text-red-800"
        : s === "resolved"
          ? "bg-blue-100 text-blue-800"
          : "bg-yellow-100 text-yellow-800";

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              Settlement Reconciliation
            </h1>
            <p className="text-muted-foreground text-sm">
              Match settlement batches against transaction records
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={reconcileDate}
              onChange={e => setReconcileDate(e.target.value)}
              className="w-40"
            />
            <Button
              onClick={() =>
                reconcileMutation.mutate({ settlementDate: reconcileDate })
              }
              disabled={reconcileMutation.isPending}
            >
              <RefreshCw
                className={`w-4 h-4 mr-2 ${reconcileMutation.isPending ? "animate-spin" : ""}`}
              />
              Run Reconciliation
            </Button>
          </div>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              { label: "Total", value: stats.total },
              {
                label: "Matched",
                value: stats.matched,
                color: "text-green-600",
              },
              {
                label: "Discrepancy",
                value: stats.discrepancy,
                color: "text-red-600",
              },
              {
                label: "Resolved",
                value: stats.resolved,
                color: "text-blue-600",
              },
              {
                label: "Pending",
                value: stats.pending,
                color: "text-yellow-600",
              },
            ].map((s: any) => (
              <Card key={s.label}>
                <CardContent className="pt-4">
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color ?? ""}`}>
                    {s.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filter */}
        <div className="flex gap-3">
          <Select
            value={statusFilter}
            onValueChange={v => {
              setStatusFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="matched">Matched</SelectItem>
              <SelectItem value="discrepancy">Discrepancy</SelectItem>
              <SelectItem value="resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Reconciliation Records ({data?.total ?? 0})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-left py-2 px-3">Agent/Merchant</th>
                    <th className="text-right py-2 px-3">Expected</th>
                    <th className="text-right py-2 px-3">Actual</th>
                    <th className="text-right py-2 px-3">Discrepancy</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-left py-2 px-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td
                        colSpan={7}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Loading...
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    data?.items.map((r: any) => (
                      <tr key={r.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-3 text-xs">
                          {r.settlementDate}
                        </td>
                        <td className="py-2 px-3 text-xs font-mono">
                          {r.agentId}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          ₦{Number(r.expectedAmount).toLocaleString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          ₦{Number(r.actualAmount).toLocaleString()}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-mono font-medium ${Number(r.discrepancy) > 0 ? "text-red-600" : "text-green-600"}`}
                        >
                          {Number(r.discrepancy) > 0
                            ? `-₦${Number(r.discrepancy).toLocaleString()}`
                            : "✓"}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-1">
                            {statusIcon(r.status)}
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor(r.status)}`}
                            >
                              {r.status}
                            </span>
                          </div>
                        </td>
                        <td className="py-2 px-3">
                          {r.status === "discrepancy" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => setResolveId(r.id)}
                            >
                              Resolve
                            </Button>
                          )}
                          {r.resolutionNote && (
                            <span className="text-xs text-muted-foreground truncate max-w-24 block">
                              {r.resolutionNote}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  {!isLoading && data?.items.length === 0 && (
                    <tr>
                      <td
                        colSpan={7}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No reconciliation records. Run reconciliation for a date
                        to populate.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {data && data.total > 20 && (
              <div className="flex justify-between items-center pt-4">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  Previous
                </Button>
                <span className="text-xs text-muted-foreground">
                  Page {page} of {Math.ceil(data.total / 20)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page * 20 >= data.total}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Resolve dialog */}
        <Dialog
          open={!!resolveId}
          onOpenChange={() => {
            setResolveId(null);
            setResolution("");
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Resolve Discrepancy</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Provide a resolution note explaining how the discrepancy was
              addressed.
            </p>
            <div>
              <Label>Resolution Notes</Label>
              <Input
                placeholder="e.g. Variance due to timing difference in batch processing..."
                value={resolution}
                onChange={e => setResolution(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setResolveId(null);
                  setResolution("");
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={() =>
                  resolveMutation.mutate({ id: resolveId!, resolution })
                }
                disabled={!resolution || resolveMutation.isPending}
              >
                {resolveMutation.isPending ? "Saving..." : "Mark Resolved"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
