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
import { DollarSign, CheckCircle, XCircle, Clock, Search } from "lucide-react";

export default function CommissionPayouts() {
  const { loading, isAuthenticated } = useAuth();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [approveId, setApproveId] = useState<number | null>(null);
  const [rejectId, setRejectId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.commissionPayouts.list.useQuery({
    page,
    limit: 20,
    status: statusFilter === "all" ? undefined : (statusFilter as any),
    agentId: search || undefined,
  });
  const { data: stats } = trpc.commissionPayouts.stats.useQuery();

  const approveMutation = trpc.commissionPayouts.approve.useMutation({
    onSuccess: () => {
      utils.commissionPayouts.list.invalidate();
      utils.commissionPayouts.stats.invalidate();
      setApproveId(null);
      toast.success("Payout approved");
    },
    onError: e => toast.error(e.message),
  });

  const rejectMutation = trpc.commissionPayouts.reject.useMutation({
    onSuccess: () => {
      utils.commissionPayouts.list.invalidate();
      utils.commissionPayouts.stats.invalidate();
      setRejectId(null);
      setRejectReason("");
      toast.success("Payout rejected");
    },
    onError: e => toast.error(e.message),
  });

  const processMutation = trpc.commissionPayouts.process.useMutation({
    onSuccess: () => {
      utils.commissionPayouts.list.invalidate();
      utils.commissionPayouts.stats.invalidate();
      toast.success("Payout processed");
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

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      pending: "bg-yellow-100 text-yellow-800",
      approved: "bg-blue-100 text-blue-800",
      processing: "bg-purple-100 text-purple-800",
      completed: "bg-green-100 text-green-800",
      failed: "bg-red-100 text-red-800",
      rejected: "bg-gray-100 text-gray-700",
    };
    return map[s] ?? "bg-gray-100 text-gray-700";
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Commission Payouts
          </h1>
          <p className="text-muted-foreground text-sm">
            Manage agent commission payout lifecycle
          </p>
        </div>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {[
              {
                label: "Pending",
                value: stats.pending,
                icon: Clock,
                color: "text-yellow-600",
              },
              {
                label: "Approved",
                value: stats.approved,
                icon: CheckCircle,
                color: "text-blue-600",
              },
              {
                label: "Completed",
                value: stats.completed,
                icon: DollarSign,
                color: "text-green-600",
              },
              {
                label: "Rejected",
                value: (stats as any).rejected ?? 0,
                icon: XCircle,
                color: "text-red-600",
              },
              {
                label: "Total Paid (₦)",
                value: `₦${Number(stats.totalPaid ?? 0).toLocaleString()}`,
                icon: DollarSign,
                color: "text-foreground",
              },
            ].map((s: any) => (
              <Card key={s.label}>
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2">
                    <s.icon className={`w-4 h-4 ${s.color}`} />
                    <p className="text-xs text-muted-foreground">{s.label}</p>
                  </div>
                  <p className={`text-xl font-bold mt-1 ${s.color}`}>
                    {s.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search agent ID or name..."
              value={search}
              onChange={e => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </div>
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
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="processing">Processing</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Table */}
        <Card>
          <CardHeader>
            <CardTitle>Payout Requests ({data?.total ?? 0})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground text-xs">
                    <th className="text-left py-2 px-3">Agent</th>
                    <th className="text-left py-2 px-3">Period</th>
                    <th className="text-right py-2 px-3">Amount</th>
                    <th className="text-left py-2 px-3">Status</th>
                    <th className="text-left py-2 px-3">Requested</th>
                    <th className="text-left py-2 px-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Loading...
                      </td>
                    </tr>
                  )}
                  {!isLoading &&
                    data?.items.map((p: any) => (
                      <tr key={p.id} className="border-b hover:bg-muted/30">
                        <td className="py-2 px-3">
                          <p className="font-medium">{p.agentId}</p>
                          {p.accountNumber && (
                            <p className="text-xs text-muted-foreground">
                              {p.bankCode} · {p.accountNumber}
                            </p>
                          )}
                        </td>
                        <td className="py-2 px-3 text-xs">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-3 text-right font-mono font-medium">
                          ₦{Number(p.amount).toLocaleString()}
                        </td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(p.status)}`}
                          >
                            {p.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-xs text-muted-foreground">
                          {new Date(p.createdAt).toLocaleDateString()}
                        </td>
                        <td className="py-2 px-3">
                          <div className="flex gap-1">
                            {p.status === "pending" && (
                              <>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-green-700 border-green-300"
                                  onClick={() => setApproveId(p.id)}
                                >
                                  Approve
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 text-xs text-red-700 border-red-300"
                                  onClick={() => setRejectId(p.id)}
                                >
                                  Reject
                                </Button>
                              </>
                            )}
                            {p.status === "approved" && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() =>
                                  processMutation.mutate({ id: p.id })
                                }
                              >
                                Process
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  {!isLoading && data?.items.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="text-center py-8 text-muted-foreground"
                      >
                        No payout requests found
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

        {/* Approve confirm */}
        <Dialog open={!!approveId} onOpenChange={() => setApproveId(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve Payout</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Are you sure you want to approve this payout request?
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setApproveId(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => approveMutation.mutate({ id: approveId! })}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? "Approving..." : "Approve"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Reject dialog */}
        <Dialog
          open={!!rejectId}
          onOpenChange={() => {
            setRejectId(null);
            setRejectReason("");
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject Payout</DialogTitle>
            </DialogHeader>
            <div>
              <Label>Reason for rejection</Label>
              <Input
                placeholder="Enter reason..."
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  setRejectId(null);
                  setRejectReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() =>
                  rejectMutation.mutate({ id: rejectId!, reason: rejectReason })
                }
                disabled={!rejectReason || rejectMutation.isPending}
              >
                {rejectMutation.isPending ? "Rejecting..." : "Reject"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
