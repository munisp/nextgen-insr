import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Shield,
  TrendingUp,
  ArrowUpRight,
} from "lucide-react";

const statusColor: Record<string, string> = {
  filed: "bg-blue-500/20 text-blue-400",
  investigating: "bg-amber-500/20 text-amber-400",
  resolved: "bg-green-500/20 text-green-400",
  escalated: "bg-red-500/20 text-red-400",
};

const priorityColor: Record<string, string> = {
  critical: "destructive",
  high: "destructive",
  medium: "secondary",
  low: "outline",
};

export default function CustomerDisputePortal() {
  const [activeTab, setActiveTab] = useState("overview");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [fileOpen, setFileOpen] = useState(false);
  const [fileForm, setFileForm] = useState({
    transactionId: "",
    reason: "",
    description: "",
  });

  // ── Live tRPC queries ──────────────────────────────────────────────
  const stats = trpc.customerDisputePortal.getStats.useQuery();
  const disputes = trpc.customerDisputePortal.listDisputes.useQuery(
    statusFilter === "all" ? undefined : { status: statusFilter }
  );
  const utils = trpc.useUtils();

  // ── Mutations ──────────────────────────────────────────────────────
  const fileMutation = trpc.customerDisputePortal.fileDispute.useMutation({
    onSuccess: data => {
      toast.success(`Dispute ${data.id} filed successfully`);
      setFileOpen(false);
      setFileForm({ transactionId: "", reason: "", description: "" });
      utils.customerDisputePortal.listDisputes.invalidate();
      utils.customerDisputePortal.getStats.invalidate();
    },
    onError: () => toast.error("Failed to file dispute"),
  });

  const updateMutation = trpc.customerDisputePortal.updateDispute.useMutation({
    onSuccess: data => {
      toast.success(`Dispute ${data.disputeId} updated to ${data.status}`);
      utils.customerDisputePortal.listDisputes.invalidate();
      utils.customerDisputePortal.getStats.invalidate();
    },
    onError: () => toast.error("Failed to update dispute"),
  });

  const escalateMutation =
    trpc.customerDisputePortal.escalateDispute.useMutation({
      onSuccess: data => {
        toast.success(`Dispute ${data.disputeId} escalated`);
        utils.customerDisputePortal.listDisputes.invalidate();
        utils.customerDisputePortal.getStats.invalidate();
      },
      onError: () => toast.error("Failed to escalate dispute"),
    });

  // ── Derived data ───────────────────────────────────────────────────
  const filteredDisputes = (disputes.data?.disputes ?? []).filter(
    (d: any) =>
      !search ||
      d.id.toLowerCase().includes(search.toLowerCase()) ||
      d.customerName.toLowerCase().includes(search.toLowerCase()) ||
      d.transactionId.toLowerCase().includes(search.toLowerCase())
  );

  const isLoading = stats.isLoading || disputes.isLoading;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="h-6 w-6 text-primary" />
              Customer Dispute Portal
            </h1>
            <p className="text-muted-foreground">
              Self-service dispute filing, tracking, and resolution
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                utils.customerDisputePortal.invalidate();
                toast.success("Data refreshed");
              }}
            >
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Dialog open={fileOpen} onOpenChange={setFileOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> File Dispute
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>File New Dispute</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">
                      Transaction ID
                    </label>
                    <Input
                      placeholder="TXN-XXXXX"
                      value={fileForm.transactionId}
                      onChange={e =>
                        setFileForm(p => ({
                          ...p,
                          transactionId: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">
                      Reason
                    </label>
                    <Select
                      value={fileForm.reason}
                      onValueChange={v =>
                        setFileForm(p => ({ ...p, reason: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select reason" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unauthorized">
                          Unauthorized Transaction
                        </SelectItem>
                        <SelectItem value="duplicate">
                          Duplicate Charge
                        </SelectItem>
                        <SelectItem value="not_received">
                          Service Not Received
                        </SelectItem>
                        <SelectItem value="defective">
                          Defective Service
                        </SelectItem>
                        <SelectItem value="wrong_amount">
                          Wrong Amount
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">
                      Description
                    </label>
                    <Textarea
                      placeholder="Describe the issue in detail..."
                      value={fileForm.description}
                      onChange={e =>
                        setFileForm(p => ({
                          ...p,
                          description: e.target.value,
                        }))
                      }
                      rows={4}
                    />
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <Button
                    disabled={
                      !fileForm.transactionId ||
                      !fileForm.reason ||
                      !fileForm.description ||
                      fileMutation.isPending
                    }
                    onClick={() => fileMutation.mutate(fileForm)}
                  >
                    {fileMutation.isPending ? "Filing..." : "Submit Dispute"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* KPI Cards — Live from tRPC */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <FileText className="h-3 w-3" /> Total Disputes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? "—" : stats.data?.totalDisputes?.toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">All time</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> Open
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">
                {isLoading ? "—" : stats.data?.open}
              </div>
              <p className="text-xs text-muted-foreground">Awaiting action</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Investigating
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">
                {isLoading ? "—" : stats.data?.investigating}
              </div>
              <p className="text-xs text-muted-foreground">In progress</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <CheckCircle className="h-3 w-3" /> Resolved
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {isLoading ? "—" : stats.data?.resolved}
              </div>
              <p className="text-xs text-muted-foreground">Closed</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <TrendingUp className="h-3 w-3" /> SLA Compliance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {isLoading ? "—" : `${stats.data?.slaCompliance}%`}
              </div>
              <p className="text-xs text-muted-foreground">
                Avg {stats.data?.avgResolutionDays ?? "—"} days
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Additional stats row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="bg-muted/30">
            <CardContent className="pt-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Refund Rate</p>
                <p className="text-xl font-bold">
                  {isLoading ? "—" : `${stats.data?.refundRate}%`}
                </p>
              </div>
              <ArrowUpRight className="h-5 w-5 text-green-500" />
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="pt-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Escalation Rate</p>
                <p className="text-xl font-bold">
                  {isLoading ? "—" : `${stats.data?.escalationRate}%`}
                </p>
              </div>
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="pt-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">Pending Amount</p>
                <p className="text-xl font-bold">
                  ₦
                  {isLoading
                    ? "—"
                    : (stats.data?.pendingAmount ?? 0).toLocaleString()}
                </p>
              </div>
              <Shield className="h-5 w-5 text-primary" />
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview">All Disputes</TabsTrigger>
            <TabsTrigger value="open">Open / Investigating</TabsTrigger>
            <TabsTrigger value="resolved">Resolved</TabsTrigger>
          </TabsList>

          {/* Filters */}
          <div className="flex items-center gap-3 mt-4">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by ID, customer, or transaction..."
                className="pl-9"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="filed">Filed</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* All Disputes Table */}
          <TabsContent value="overview">
            <DisputeTable
              disputes={filteredDisputes}
              isLoading={isLoading}
              onUpdate={(id, status) =>
                updateMutation.mutate({ disputeId: id, status })
              }
              onEscalate={id =>
                escalateMutation.mutate({
                  disputeId: id,
                  reason: "Requires senior review",
                })
              }
              updatePending={updateMutation.isPending}
              escalatePending={escalateMutation.isPending}
            />
          </TabsContent>

          {/* Open / Investigating */}
          <TabsContent value="open">
            <DisputeTable
              disputes={filteredDisputes.filter(
                (d: any) => d.status === "filed" || d.status === "investigating"
              )}
              isLoading={isLoading}
              onUpdate={(id, status) =>
                updateMutation.mutate({ disputeId: id, status })
              }
              onEscalate={id =>
                escalateMutation.mutate({
                  disputeId: id,
                  reason: "Requires senior review",
                })
              }
              updatePending={updateMutation.isPending}
              escalatePending={escalateMutation.isPending}
            />
          </TabsContent>

          {/* Resolved */}
          <TabsContent value="resolved">
            <DisputeTable
              disputes={filteredDisputes.filter(
                (d: any) => d.status === "resolved"
              )}
              isLoading={isLoading}
              onUpdate={(id, status) =>
                updateMutation.mutate({ disputeId: id, status })
              }
              onEscalate={id =>
                escalateMutation.mutate({
                  disputeId: id,
                  reason: "Requires senior review",
                })
              }
              updatePending={updateMutation.isPending}
              escalatePending={escalateMutation.isPending}
            />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}

/* ── Reusable Dispute Table ─────────────────────────────────────────── */
function DisputeTable({
  disputes,
  isLoading,
  onUpdate,
  onEscalate,
  updatePending,
  escalatePending,
}: {
  disputes: any[];
  isLoading: boolean;
  onUpdate: (id: string, status: string) => void;
  onEscalate: (id: string) => void;
  updatePending: boolean;
  escalatePending: boolean;
}) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="text-left p-2">Dispute ID</th>
                <th className="text-left p-2">Transaction</th>
                <th className="text-left p-2">Customer</th>
                <th className="text-right p-2">Amount</th>
                <th className="text-left p-2">Reason</th>
                <th className="text-left p-2">Priority</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">SLA Deadline</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td
                    colSpan={9}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Loading disputes...
                  </td>
                </tr>
              ) : disputes.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No disputes found.
                  </td>
                </tr>
              ) : (
                disputes.map((d: any) => {
                  const slaRemaining = d.slaDeadline
                    ? Math.max(
                        0,
                        Math.ceil((d.slaDeadline - Date.now()) / 86400000)
                      )
                    : null;
                  const slaBreach = slaRemaining !== null && slaRemaining <= 0;
                  return (
                    <tr
                      key={d.id}
                      className="border-b hover:bg-muted/50 transition"
                    >
                      <td className="p-2 font-mono text-xs font-bold">
                        {d.id}
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {d.transactionId}
                      </td>
                      <td className="p-2">{d.customerName}</td>
                      <td className="p-2 text-right font-bold">
                        ₦{d.amount?.toLocaleString()}
                      </td>
                      <td className="p-2 capitalize">
                        {d.reason?.replace(/_/g, " ")}
                      </td>
                      <td className="p-2">
                        <Badge
                          variant={
                            (priorityColor[d.priority] ?? "secondary") as any
                          }
                        >
                          {d.priority}
                        </Badge>
                      </td>
                      <td className="p-2">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor[d.status] ?? "bg-gray-500/20 text-gray-400"}`}
                        >
                          {d.status}
                        </span>
                      </td>
                      <td className="p-2 text-xs">
                        {slaRemaining !== null && (
                          <span
                            className={
                              slaBreach
                                ? "text-red-500 font-bold"
                                : slaRemaining <= 2
                                  ? "text-amber-500"
                                  : "text-muted-foreground"
                            }
                          >
                            {slaBreach
                              ? "BREACHED"
                              : `${slaRemaining}d remaining`}
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          {d.status === "filed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updatePending}
                              onClick={() => onUpdate(d.id, "investigating")}
                            >
                              Investigate
                            </Button>
                          )}
                          {d.status === "investigating" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={updatePending}
                              onClick={() => onUpdate(d.id, "resolved")}
                            >
                              Resolve
                            </Button>
                          )}
                          {!d.escalated && d.status !== "resolved" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-500"
                              disabled={escalatePending}
                              onClick={() => onEscalate(d.id)}
                            >
                              Escalate
                            </Button>
                          )}
                          {d.resolution && (
                            <Badge variant="outline" className="ml-1">
                              {d.resolution}
                            </Badge>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
