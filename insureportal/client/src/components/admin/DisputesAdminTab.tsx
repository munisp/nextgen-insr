// @ts-nocheck
/**
 * DisputesAdminTab — Admin/Supervisor view of all transaction disputes
 *
 * Features:
 * - Filter by status (all / raised / reviewing / resolved / rejected)
 * - View dispute thread with full message history
 * - Resolve or reject with a written decision
 * - Add messages to the thread
 * - Issue provisional credit (immediate customer relief)
 * - Initiate chargeback (formal reversal via platform dispute service)
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  Loader2,
  MessageSquare,
  CheckCircle,
  XCircle,
  RefreshCw,
  Scale,
  AlertTriangle,
  CreditCard,
  ArrowLeftRight,
  DollarSign,
  ArrowDownLeft,
} from "lucide-react";

type DisputeStatus = "raised" | "reviewing" | "resolved" | "rejected";

function statusBadge(status: DisputeStatus) {
  const map: Record<DisputeStatus, { label: string; className: string }> = {
    raised: {
      label: "Raised",
      className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    },
    reviewing: {
      label: "Reviewing",
      className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    },
    resolved: {
      label: "Resolved",
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    },
    rejected: {
      label: "Rejected",
      className: "bg-red-500/20 text-red-400 border-red-500/30",
    },
  };
  const s = map[status] ?? map.raised;
  return (
    <Badge variant="outline" className={`text-xs ${s.className}`}>
      {s.label}
    </Badge>
  );
}

export function DisputesAdminTab() {
  const [adminTab, setAdminTab] = useState<"disputes" | "refunds">("disputes");
  const [statusFilter, setStatusFilter] = useState<"all" | DisputeStatus>(
    "all"
  );
  const [page, setPage] = useState(0);
  const limit = 20;
  const [selectedRef, setSelectedRef] = useState<string | null>(null);

  // Resolve/Reject dialog
  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [decision, setDecision] = useState<"resolved" | "rejected">("resolved");
  const [resolution, setResolution] = useState("");
  const [replyText, setReplyText] = useState("");

  // Provisional credit dialog
  const [showProvisionalDialog, setShowProvisionalDialog] = useState(false);
  const [provisionalAmount, setProvisionalAmount] = useState("");
  const [provisionalReason, setProvisionalReason] = useState("");

  // Chargeback dialog
  const [showChargebackDialog, setShowChargebackDialog] = useState(false);
  const [chargebackReason, setChargebackReason] = useState("");

  // Refund management state
  const [refundStatusFilter, setRefundStatusFilter] = useState<string>("all");
  const [refundPage, setRefundPage] = useState(0);
  const [showApproveRefundDialog, setShowApproveRefundDialog] = useState(false);
  const [showRejectRefundDialog, setShowRejectRefundDialog] = useState(false);
  const [showProcessRefundDialog, setShowProcessRefundDialog] = useState(false);
  const [selectedRefundId, setSelectedRefundId] = useState<number | null>(null);
  const [refundRejectReason, setRefundRejectReason] = useState("");
  const [refundProcessMethod, setRefundProcessMethod] =
    useState("bank_transfer");
  const [refundProcessRef, setRefundProcessRef] = useState("");

  // @ts-ignore
  const { data, isLoading, refetch } = trpc.disputes.listAll.useQuery({
    status: statusFilter,
    limit,
    offset: page * limit,
  });

  // @ts-ignore
  const { data: stats } = trpc.disputes.stats.useQuery({});
  // @ts-ignore
  const { data: overdueData } = trpc.disputes.overdueList.useQuery(
    { limit: 50 },
    { refetchInterval: 60_000 }
  );

  // Refund queries
  const {
    data: refundsData,
    isLoading: refundsLoading,
    refetch: refetchRefunds,
    // @ts-ignore
  } = trpc.disputeRefund.listRefunds.useQuery({
    status: refundStatusFilter === "all" ? undefined : refundStatusFilter,
    limit,
    offset: refundPage * limit,
  });
  // @ts-ignore
  const { data: refundStats } = trpc.disputeRefund.stats.useQuery({});
  const overdueCount = overdueData?.count ?? 0;

  const { data: disputeDetail, refetch: refetchDetail } =
    // @ts-ignore
    trpc.disputes.getDispute.useQuery(
      { ref: selectedRef! },
      { enabled: selectedRef !== null }
    );

  // @ts-ignore
  const resolve = trpc.disputes.resolve.useMutation({
    // @ts-ignore
    onSuccess: res => {
      toast.success(`Dispute ${res.status} successfully.`);
      setShowResolveDialog(false);
      setResolution("");
      refetch();
      refetchDetail();
    },
    // @ts-ignore
    onError: e => toast.error(`Failed: ${e.message}`),
  });

  // @ts-ignore
  const addMessage = trpc.disputes.addMessage.useMutation({
    onSuccess: () => {
      setReplyText("");
      refetchDetail();
    },
    // @ts-ignore
    onError: e => toast.error(e.message),
  });

  // @ts-ignore
  const issueProvisional = trpc.disputes.issueProvisionalCredit.useMutation({
    onSuccess: () => {
      toast.success("Provisional credit issued successfully.");
      setShowProvisionalDialog(false);
      setProvisionalAmount("");
      setProvisionalReason("");
      refetchDetail();
      refetch();
    },
    // @ts-ignore
    onError: e =>
      toast.error(`Failed to issue provisional credit: ${e.message}`),
  });

  // @ts-ignore
  const initiateChargeback = trpc.disputes.initiateChargeback.useMutation({
    onSuccess: () => {
      toast.success("Chargeback initiated successfully.");
      setShowChargebackDialog(false);
      setChargebackReason("");
      refetchDetail();
      refetch();
    },
    // @ts-ignore
    onError: e => toast.error(`Failed to initiate chargeback: ${e.message}`),
  });

  // Refund mutations
  // @ts-ignore
  const approveRefund = trpc.disputeRefund.approveRefund.useMutation({
    onSuccess: () => {
      toast.success("Refund approved");
      setShowApproveRefundDialog(false);
      refetchRefunds();
    },
    // @ts-ignore
    onError: e => toast.error(e.message),
  });
  // @ts-ignore
  const rejectRefund = trpc.disputeRefund.rejectRefund.useMutation({
    onSuccess: () => {
      toast.success("Refund rejected");
      setShowRejectRefundDialog(false);
      setRefundRejectReason("");
      refetchRefunds();
    },
    // @ts-ignore
    onError: e => toast.error(e.message),
  });
  // @ts-ignore
  const processRefund = trpc.disputeRefund.processRefund.useMutation({
    onSuccess: () => {
      toast.success("Refund processed");
      setShowProcessRefundDialog(false);
      setRefundProcessRef("");
      refetchRefunds();
    },
    // @ts-ignore
    onError: e => toast.error(e.message),
  });

  const handleResolve = () => {
    if (!selectedRef || resolution.trim().length < 10) {
      toast.error("Please provide a resolution of at least 10 characters.");
      return;
    }
    resolve.mutate({ disputeRef: selectedRef, decision, resolution });
  };

  const handleReply = () => {
    if (!selectedRef || !replyText.trim()) return;
    addMessage.mutate({ disputeRef: selectedRef, message: replyText.trim() });
  };

  const handleProvisionalCredit = () => {
    if (!selectedRef) return;
    const amount = parseFloat(provisionalAmount);
    if (isNaN(amount) || amount <= 0) {
      toast.error("Please enter a valid amount.");
      return;
    }
    if (provisionalReason.trim().length < 10) {
      toast.error("Please provide a reason of at least 10 characters.");
      return;
    }
    issueProvisional.mutate({
      disputeRef: selectedRef,
      amount,
      reason: provisionalReason.trim(),
    });
  };

  const handleChargeback = () => {
    if (!selectedRef) return;
    if (chargebackReason.trim().length < 10) {
      toast.error("Please provide a reason of at least 10 characters.");
      return;
    }
    // Amount is derived from the dispute's transaction amount on the server side
    // We pass 0 as a placeholder; the server uses the dispute's transaction amount
    initiateChargeback.mutate({
      disputeRef: selectedRef,
      amount: 0,
      reason: chargebackReason.trim(),
    });
  };

  return (
    <div className="space-y-6">
      {/* Admin Tab Switcher */}
      <div className="flex items-center gap-3">
        <div className="flex rounded-xl bg-slate-800/60 p-1">
          <button
            onClick={() => setAdminTab("disputes")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${adminTab === "disputes" ? "bg-blue-600 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
          >
            <Scale className="w-4 h-4" /> Disputes{" "}
            {stats?.open ? (
              <Badge
                variant="outline"
                className="text-xs bg-amber-500/20 text-amber-400 border-amber-500/30 ml-1"
              >
                {stats.open}
              </Badge>
            ) : null}
          </button>
          <button
            onClick={() => setAdminTab("refunds")}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${adminTab === "refunds" ? "bg-purple-600 text-white shadow" : "text-slate-400 hover:text-slate-200"}`}
          >
            <DollarSign className="w-4 h-4" /> Refunds{" "}
            {refundStats?.refunds?.pending ? (
              <Badge
                variant="outline"
                className="text-xs bg-yellow-500/20 text-yellow-400 border-yellow-500/30 ml-1"
              >
                {refundStats.refunds.pending}
              </Badge>
            ) : null}
          </button>
        </div>
      </div>

      {/* ═══════════ REFUNDS ADMIN TAB ═══════════ */}
      {adminTab === "refunds" && (
        <div className="space-y-6">
          {/* Refund Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              {
                label: "Total",
                value:
                  (refundStats?.refunds?.pending ?? 0) +
                  (refundStats?.refunds?.approved ?? 0) +
                  (refundStats?.refunds?.processed ?? 0) +
                  (refundStats?.refunds?.rejected ?? 0),
                color: "text-slate-300",
              },
              {
                label: "Pending",
                value: refundStats?.refunds?.pending ?? 0,
                color: "text-yellow-400",
              },
              {
                label: "Approved",
                value: refundStats?.refunds?.approved ?? 0,
                color: "text-blue-400",
              },
              {
                label: "Processed",
                value: refundStats?.refunds?.processed ?? 0,
                color: "text-emerald-400",
              },
              {
                label: "Rejected",
                value: refundStats?.refunds?.rejected ?? 0,
                color: "text-red-400",
              },
            ].map(s => (
              <Card key={s.label} className="bg-slate-800/50 border-slate-700">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-slate-400">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Refund Filter + Refresh */}
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex gap-2 flex-wrap">
              {["all", "pending", "approved", "processed", "rejected"].map(
                s => (
                  <Button
                    key={s}
                    size="sm"
                    variant={refundStatusFilter === s ? "default" : "outline"}
                    onClick={() => {
                      setRefundStatusFilter(s);
                      setRefundPage(0);
                    }}
                    className="capitalize text-xs"
                  >
                    {s}
                  </Button>
                )
              )}
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetchRefunds()}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
            </Button>
          </div>

          {/* Refund List */}
          <div className="space-y-2">
            {refundsLoading ? (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading
                refunds...
              </div>
            ) : (refundsData?.refunds ?? []).length === 0 ? (
              <div className="text-center py-16 text-slate-500">
                <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No refund requests found.
              </div>
            ) : (
              (refundsData?.refunds ?? []).map((r: any) => (
                <Card
                  key={r.refund.id}
                  className="bg-slate-800/40 border-slate-700"
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge
                            variant="outline"
                            className={`text-xs ${
                              r.refund.status === "pending"
                                ? "bg-yellow-500/20 text-yellow-400 border-yellow-500/30"
                                : r.refund.status === "approved"
                                  ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                                  : r.refund.status === "processed"
                                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                    : "bg-red-500/20 text-red-400 border-red-500/30"
                            }`}
                          >
                            {r.refund.status}
                          </Badge>
                          <span className="text-xs font-mono text-slate-400">
                            {r.refund.ref}
                          </span>
                          <Badge
                            variant="outline"
                            className="text-xs bg-slate-700/50 text-slate-300 border-slate-600"
                          >
                            {r.refund.category?.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-lg font-bold text-white">
                            ₦{(r.refund.refundAmount ?? 0).toLocaleString()}
                          </span>
                          <span className="text-xs text-slate-500">
                            of ₦
                            {(r.refund.originalAmount ?? 0).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-slate-300 mb-1">
                          {r.refund.reason}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span className="font-mono">
                            Tx: {r.refund.transactionRef}
                          </span>
                          <span>{r.refund.customerName || "Unknown"}</span>
                          <span>
                            {new Date(r.refund.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col gap-1.5 shrink-0">
                        {r.refund.status === "pending" && (
                          <>
                            <Button
                              size="sm"
                              className="text-xs bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => {
                                setSelectedRefundId(r.refund.id);
                                setShowApproveRefundDialog(true);
                              }}
                            >
                              <CheckCircle className="w-3 h-3 mr-1" /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="text-xs"
                              onClick={() => {
                                setSelectedRefundId(r.refund.id);
                                setShowRejectRefundDialog(true);
                              }}
                            >
                              <XCircle className="w-3 h-3 mr-1" /> Reject
                            </Button>
                          </>
                        )}
                        {r.refund.status === "approved" && (
                          <Button
                            size="sm"
                            className="text-xs bg-blue-600 hover:bg-blue-700"
                            onClick={() => {
                              setSelectedRefundId(r.refund.id);
                              setShowProcessRefundDialog(true);
                            }}
                          >
                            <ArrowDownLeft className="w-3 h-3 mr-1" /> Process
                          </Button>
                        )}
                        {r.refund.status === "rejected" &&
                          r.refund.rejectionReason && (
                            <div className="text-xs text-red-400 max-w-[200px]">
                              ❌ {r.refund.rejectionReason}
                            </div>
                          )}
                        {r.refund.status === "processed" && (
                          <div className="text-xs text-emerald-400">
                            ✅ {r.refund.method?.replace("_", " ")} ·{" "}
                            {new Date(
                              r.refund.processedAt
                            ).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Approve Refund Dialog */}
          <Dialog
            open={showApproveRefundDialog}
            onOpenChange={setShowApproveRefundDialog}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5 text-emerald-400" /> Approve
                  Refund
                </DialogTitle>
              </DialogHeader>
              <p className="text-sm text-slate-400">
                Are you sure you want to approve this refund? It will move to
                "approved" status and be ready for processing.
              </p>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowApproveRefundDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-emerald-600 hover:bg-emerald-700"
                  disabled={approveRefund.isPending}
                  onClick={() => {
                    if (selectedRefundId)
                      approveRefund.mutate({ ref: String(selectedRefundId) });
                  }}
                >
                  {approveRefund.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-2" />
                  )}
                  Confirm Approve
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Reject Refund Dialog */}
          <Dialog
            open={showRejectRefundDialog}
            onOpenChange={setShowRejectRefundDialog}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <XCircle className="w-5 h-5 text-red-400" /> Reject Refund
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <Label className="text-slate-300">
                  Rejection Reason (min 10 characters)
                </Label>
                <Textarea
                  value={refundRejectReason}
                  onChange={e => setRefundRejectReason(e.target.value)}
                  rows={3}
                  placeholder="Explain why this refund is being rejected..."
                  className="bg-slate-800 border-slate-600"
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowRejectRefundDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={
                    rejectRefund.isPending ||
                    refundRejectReason.trim().length < 10
                  }
                  onClick={() => {
                    if (selectedRefundId)
                      rejectRefund.mutate({
                        ref: String(selectedRefundId),
                        reason: refundRejectReason.trim(),
                      });
                  }}
                >
                  {rejectRefund.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <XCircle className="w-4 h-4 mr-2" />
                  )}
                  Confirm Reject
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Process Refund Dialog */}
          <Dialog
            open={showProcessRefundDialog}
            onOpenChange={setShowProcessRefundDialog}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ArrowDownLeft className="w-5 h-5 text-blue-400" /> Process
                  Refund
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label className="text-slate-300">Refund Method</Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {[
                      "bank_transfer",
                      "wallet_credit",
                      "cash",
                      "mobile_money",
                    ].map(m => (
                      <Button
                        key={m}
                        size="sm"
                        variant={
                          refundProcessMethod === m ? "default" : "outline"
                        }
                        onClick={() => setRefundProcessMethod(m)}
                        className="capitalize text-xs"
                      >
                        {m.replace(/_/g, " ")}
                      </Button>
                    ))}
                  </div>
                </div>
                <div>
                  <Label className="text-slate-300">
                    External Reference (optional)
                  </Label>
                  <Input
                    value={refundProcessRef}
                    onChange={e => setRefundProcessRef(e.target.value)}
                    placeholder="Bank transfer ref, wallet tx ID..."
                    className="bg-slate-800 border-slate-600 mt-1"
                  />
                </div>
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs text-blue-300">
                  Processing will mark this refund as complete and record the
                  payment method and reference for audit.
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowProcessRefundDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-blue-600 hover:bg-blue-700"
                  disabled={processRefund.isPending}
                  onClick={() => {
                    if (selectedRefundId)
                      processRefund.mutate({
                        ref: String(selectedRefundId),
                        method: refundProcessMethod as
                          | "cash"
                          | "bank_transfer"
                          | "original_method"
                          | "wallet_credit",
                      });
                  }}
                >
                  {processRefund.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <ArrowDownLeft className="w-4 h-4 mr-2" />
                  )}
                  Confirm Process
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ═══════════ DISPUTES TAB (existing) ═══════════ */}
      {adminTab === "disputes" && (
        <>
          {/* SLA Overdue Banner */}
          {overdueCount > 0 && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-red-500/40 bg-red-500/10">
              <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-bold text-red-400">
                  {overdueCount} dispute{overdueCount !== 1 ? "s" : ""} past
                  48-hour SLA deadline
                </p>
                <p className="text-xs text-slate-400">
                  NAICOM guidelines require resolution within 48 hours. Filter
                  by "Open" to prioritise.
                </p>
              </div>
              <button
                onClick={() => {
                  setStatusFilter("raised");
                  setPage(0);
                }}
                className="text-xs font-semibold text-red-300 hover:text-red-200 underline flex-shrink-0"
              >
                View Open
              </button>
            </div>
          )}

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              {
                label: "Total",
                value:
                  (stats?.raised ?? 0) +
                  (stats?.reviewing ?? 0) +
                  (stats?.resolved ?? 0) +
                  (stats?.rejected ?? 0),
                color: "text-slate-300",
              },
              {
                label: "Open",
                value: stats?.open ?? 0,
                color: "text-amber-400",
              },
              {
                label: "Reviewing",
                value: stats?.reviewing ?? 0,
                color: "text-blue-400",
              },
              {
                label: "Resolved",
                value: stats?.resolved ?? 0,
                color: "text-emerald-400",
              },
              {
                label: "Rejected",
                value: stats?.rejected ?? 0,
                color: "text-red-400",
              },
            ].map(s => (
              <Card key={s.label} className="bg-slate-800/50 border-slate-700">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-slate-400">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Filter + refresh toolbar */}
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="flex gap-2 flex-wrap">
              {(
                ["all", "raised", "reviewing", "resolved", "rejected"] as const
              ).map(s => (
                <Button
                  key={s}
                  size="sm"
                  variant={statusFilter === s ? "default" : "outline"}
                  onClick={() => {
                    setStatusFilter(s);
                    setPage(0);
                  }}
                  className="capitalize text-xs"
                >
                  {s}
                </Button>
              ))}
            </div>
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
            </Button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Disputes list */}
            <div className="space-y-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-16 text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading
                  disputes...
                </div>
              ) : (data?.disputes ?? []).length === 0 ? (
                <div className="text-center py-16 text-slate-500">
                  <Scale className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  No disputes found.
                </div>
              ) : (
                (data?.disputes ?? []).map(
                  // @ts-ignore
                  ({ dispute, agentName, agentId }) => (
                    <div
                      key={dispute.id}
                      onClick={() => setSelectedRef(dispute.ref)}
                      className={`p-4 rounded-xl border cursor-pointer transition-all ${
                        selectedRef === dispute.ref
                          ? "border-blue-500/50 bg-blue-500/10"
                          : "border-slate-700 bg-slate-800/40 hover:bg-slate-800/70"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {statusBadge(dispute.status as DisputeStatus)}
                            <span className="text-xs font-mono text-slate-400">
                              {dispute.ref}
                            </span>
                          </div>
                          <p className="text-sm text-slate-200 font-medium truncate">
                            {dispute.reason}
                          </p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {agentName ?? "Unknown"} ({agentId ?? "—"}) · Tx:{" "}
                            {dispute.transactionRef}
                          </p>
                        </div>
                        <div className="text-xs text-slate-500 shrink-0">
                          {new Date(dispute.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                    </div>
                  )
                )
              )}

              {/* Pagination */}
              {(data?.total ?? 0) > limit && (
                <div className="flex items-center justify-between pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page === 0}
                    onClick={() => setPage(p => p - 1)}
                  >
                    ← Prev
                  </Button>
                  <span className="text-xs text-slate-400">
                    Page {page + 1} of {Math.ceil((data?.total ?? 0) / limit)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={(page + 1) * limit >= (data?.total ?? 0)}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Next →
                  </Button>
                </div>
              )}
            </div>

            {/* Dispute thread panel */}
            <div>
              {!selectedRef || !disputeDetail ? (
                <div className="flex items-center justify-center h-64 text-slate-500 border border-slate-700 rounded-xl">
                  <div className="text-center">
                    <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p className="text-sm">
                      Select a dispute to view the thread
                    </p>
                  </div>
                </div>
              ) : (
                <Card className="bg-slate-800/50 border-slate-700">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <CardTitle className="text-sm text-slate-200 flex items-center gap-2">
                          <Scale className="w-4 h-4" />
                          {disputeDetail.ref}
                        </CardTitle>
                        <p className="text-xs text-slate-400 mt-1">
                          Tx:{" "}
                          <span className="font-mono">
                            {disputeDetail.transactionRef}
                          </span>
                        </p>
                      </div>
                      <div className="flex gap-2">
                        {statusBadge(disputeDetail.status as DisputeStatus)}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Reason */}
                    <div className="p-3 rounded-lg bg-slate-900/50 border border-slate-700">
                      <p className="text-xs text-slate-400 mb-1">Reason</p>
                      <p className="text-sm text-slate-200">
                        {disputeDetail.reason}
                      </p>
                      {disputeDetail.evidence && (
                        <p className="text-xs text-slate-400 mt-2 italic">
                          {disputeDetail.evidence}
                        </p>
                      )}
                    </div>

                    {/* Message thread */}
                    <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                      {(disputeDetail.messages ?? []).map((msg: any) => (
                        <div
                          key={msg.id}
                          className={`p-3 rounded-lg text-xs ${
                            msg.authorRole === "agent"
                              ? "bg-slate-700/50 border border-slate-600"
                              : "bg-blue-500/10 border border-blue-500/20 ml-4"
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-semibold text-slate-300">
                              {msg.authorName}
                            </span>
                            <span className="text-slate-500">
                              {new Date(msg.createdAt).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-slate-300 whitespace-pre-wrap">
                            {msg.message}
                          </p>
                        </div>
                      ))}
                    </div>

                    {/* Action buttons (only if not closed) */}
                    {disputeDetail.status !== "resolved" &&
                      disputeDetail.status !== "rejected" && (
                        <div className="space-y-2">
                          <Textarea
                            value={replyText}
                            onChange={e => setReplyText(e.target.value)}
                            placeholder="Add a message to this dispute thread..."
                            rows={3}
                            className="bg-slate-900 border-slate-600 text-sm"
                          />
                          {/* Primary actions: Reply / Resolve / Reject */}
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              onClick={handleReply}
                              disabled={
                                addMessage.isPending || !replyText.trim()
                              }
                            >
                              {addMessage.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                              ) : (
                                <MessageSquare className="w-3.5 h-3.5 mr-1" />
                              )}
                              Reply
                            </Button>
                            <Button
                              size="sm"
                              className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                              onClick={() => {
                                setDecision("resolved");
                                setShowResolveDialog(true);
                              }}
                            >
                              <CheckCircle className="w-3.5 h-3.5 mr-1" />{" "}
                              Resolve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-red-400 border-red-500/30"
                              onClick={() => {
                                setDecision("rejected");
                                setShowResolveDialog(true);
                              }}
                            >
                              <XCircle className="w-3.5 h-3.5 mr-1" /> Reject
                            </Button>
                          </div>
                          {/* Financial remediation actions */}
                          <div className="flex gap-2 pt-1 border-t border-slate-700">
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                              onClick={() => setShowProvisionalDialog(true)}
                              disabled={issueProvisional.isPending}
                            >
                              {issueProvisional.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                              ) : (
                                <CreditCard className="w-3.5 h-3.5 mr-1" />
                              )}
                              Provisional Credit
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1 text-purple-400 border-purple-500/30 hover:bg-purple-500/10"
                              onClick={() => setShowChargebackDialog(true)}
                              disabled={initiateChargeback.isPending}
                            >
                              {initiateChargeback.isPending ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
                              ) : (
                                <ArrowLeftRight className="w-3.5 h-3.5 mr-1" />
                              )}
                              Initiate Chargeback
                            </Button>
                          </div>
                        </div>
                      )}

                    {/* Resolution note if closed */}
                    {(disputeDetail.status === "resolved" ||
                      disputeDetail.status === "rejected") &&
                      disputeDetail.resolution && (
                        <div
                          className={`p-3 rounded-lg border text-xs ${
                            disputeDetail.status === "resolved"
                              ? "bg-emerald-500/10 border-emerald-500/30"
                              : "bg-red-500/10 border-red-500/30"
                          }`}
                        >
                          <p className="font-semibold text-slate-300 mb-1">
                            {disputeDetail.status === "resolved"
                              ? "✓ Resolution"
                              : "✗ Rejection Reason"}
                          </p>
                          <p className="text-slate-300">
                            {disputeDetail.resolution}
                          </p>
                          {disputeDetail.resolvedBy && (
                            <p className="text-slate-500 mt-1">
                              By {disputeDetail.resolvedBy} ·{" "}
                              {disputeDetail.resolvedAt
                                ? new Date(
                                    disputeDetail.resolvedAt
                                  ).toLocaleString()
                                : ""}
                            </p>
                          )}
                        </div>
                      )}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Resolve/Reject dialog */}
          <Dialog open={showResolveDialog} onOpenChange={setShowResolveDialog}>
            <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
              <DialogHeader>
                <DialogTitle
                  className={
                    decision === "resolved"
                      ? "text-emerald-400"
                      : "text-red-400"
                  }
                >
                  {decision === "resolved"
                    ? "✓ Resolve Dispute"
                    : "✗ Reject Dispute"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-slate-400">
                  {decision === "resolved"
                    ? "Provide a resolution explaining what action was taken."
                    : "Provide a reason for rejecting this dispute."}
                </p>
                <div className="space-y-1">
                  <Label className="text-slate-300">
                    Decision Notes (min 10 characters)
                  </Label>
                  <Textarea
                    value={resolution}
                    onChange={e => setResolution(e.target.value)}
                    rows={5}
                    placeholder={
                      decision === "resolved"
                        ? "Transaction has been reversed and funds returned to customer..."
                        : "Dispute rejected — transaction was verified as legitimate..."
                    }
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowResolveDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleResolve}
                  disabled={resolve.isPending || resolution.trim().length < 10}
                  className={
                    decision === "resolved"
                      ? "bg-emerald-600 hover:bg-emerald-700"
                      : "bg-red-600 hover:bg-red-700"
                  }
                >
                  {resolve.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : null}
                  {decision === "resolved"
                    ? "Confirm Resolution"
                    : "Confirm Rejection"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Provisional Credit dialog */}
          <Dialog
            open={showProvisionalDialog}
            onOpenChange={setShowProvisionalDialog}
          >
            <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
              <DialogHeader>
                <DialogTitle className="text-amber-400 flex items-center gap-2">
                  <CreditCard className="w-4 h-4" /> Issue Provisional Credit
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-slate-400">
                  Issue an immediate provisional credit to the customer's
                  account while the dispute is under review. This does not close
                  the dispute.
                </p>
                <div className="space-y-1">
                  <Label className="text-slate-300">Amount (₦)</Label>
                  <Input
                    type="number"
                    min="1"
                    value={provisionalAmount}
                    onChange={e => setProvisionalAmount(e.target.value)}
                    placeholder="e.g. 5000"
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-slate-300">
                    Reason (min 10 characters)
                  </Label>
                  <Textarea
                    value={provisionalReason}
                    onChange={e => setProvisionalReason(e.target.value)}
                    rows={3}
                    placeholder="Provisional credit issued pending investigation of failed transaction..."
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowProvisionalDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleProvisionalCredit}
                  disabled={
                    issueProvisional.isPending ||
                    !provisionalAmount ||
                    provisionalReason.trim().length < 10
                  }
                  className="bg-amber-600 hover:bg-amber-700"
                >
                  {issueProvisional.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <CreditCard className="w-4 h-4 mr-2" />
                  )}
                  Issue Provisional Credit
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Chargeback dialog */}
          <Dialog
            open={showChargebackDialog}
            onOpenChange={setShowChargebackDialog}
          >
            <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
              <DialogHeader>
                <DialogTitle className="text-purple-400 flex items-center gap-2">
                  <ArrowLeftRight className="w-4 h-4" /> Initiate Chargeback
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 text-xs text-purple-300">
                  ⚠ A chargeback initiates a formal reversal request through
                  the card network or bank. This is irreversible once submitted
                  to the platform dispute service.
                </div>
                <div className="space-y-1">
                  <Label className="text-slate-300">
                    Chargeback Reason (min 10 characters)
                  </Label>
                  <Textarea
                    value={chargebackReason}
                    onChange={e => setChargebackReason(e.target.value)}
                    rows={4}
                    placeholder="Customer did not authorise this transaction. Card was reported lost..."
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowChargebackDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleChargeback}
                  disabled={
                    initiateChargeback.isPending ||
                    chargebackReason.trim().length < 10
                  }
                  className="bg-purple-600 hover:bg-purple-700"
                >
                  {initiateChargeback.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <ArrowLeftRight className="w-4 h-4 mr-2" />
                  )}
                  Confirm Chargeback
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
