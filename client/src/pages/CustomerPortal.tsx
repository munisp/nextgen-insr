/**
 * CustomerPortal.tsx
 *
 * Customer-facing portal accessible at /customer.
 * Uses the tRPC customer router (nested procedures):
 *   - customer.account.me
 *   - customer.account.balance
 *   - customer.transactions.list
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Wallet,
  CreditCard,
  User,
  ChevronLeft,
  ArrowUpRight,
  ArrowDownLeft,
  Bell,
  Shield,
  AlertTriangle,
  RefreshCw,
  CheckCircle,
  Clock,
} from "lucide-react";

export default function CustomerPortal() {
  const [, navigate] = useLocation();
  const [tab, setTab] = useState("accounts");
  const [txSearch, setTxSearch] = useState("");
  const [txTypeFilter, setTxTypeFilter] = useState("all");
  const [txStatusFilter, setTxStatusFilter] = useState("all");
  const [txPage, setTxPage] = useState(1);

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    address: "",
    dateOfBirth: "",
  });
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeForm, setDisputeForm] = useState({
    transactionRef: "",
    reason: "",
  });
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundForm, setRefundForm] = useState({
    transactionRef: "",
    reason: "",
    category: "failed_transaction",
    amount: "",
  });
  const [disputeSubTab, setDisputeSubTab] = useState<"disputes" | "refunds">(
    "disputes"
  );

  const utils = trpc.useUtils();

  const profileQuery = trpc.customer.account.me.useQuery(undefined, {
    retry: false,
  });
  const balanceQuery = trpc.customer.account.balance.useQuery(undefined, {
    retry: false,
  });
  const txQuery = trpc.customer.transactions.list.useQuery(
    { page: txPage, limit: 20 },
    { retry: false }
  );
  const txStatsQ = trpc.customer.transactions.stats.useQuery(
    { period: "month" },
    { enabled: tab === "accounts", retry: false }
  );
  const disputesQ = trpc.customer.disputes.list.useQuery(
    { page: 1, limit: 10 },
    {
      enabled: tab === "disputes" && disputeSubTab === "disputes",
      retry: false,
    }
  );
  // @ts-ignore Sprint 85
  const refundsQ = trpc.disputeRefund.listRefunds.useQuery(
    { limit: 20 },
    { enabled: tab === "disputes" && disputeSubTab === "refunds" }
  );
  // @ts-ignore Sprint 85
  const refundStatsQ = trpc.disputeRefund.stats.useQuery(
    {},
    { enabled: tab === "disputes" }
  );
  const kycQ = trpc.customer.kyc.status.useQuery(undefined, {
    enabled: tab === "kyc",
    retry: false,
  });

  const updateProfile = trpc.customer.account.update.useMutation({
    onSuccess: () => {
      toast.success("Profile updated");
      utils.customer.account.me.invalidate();
      setProfileOpen(false);
    },
    onError: e => toast.error("Error", { description: e.message }),
  });
  const raiseDispute = trpc.customer.disputes.raise.useMutation({
    onSuccess: () => {
      toast.success("Dispute raised");
      utils.customer.disputes.list.invalidate();
      setDisputeOpen(false);
      setDisputeForm({ transactionRef: "", reason: "" });
    },
    onError: e => toast.error("Error", { description: e.message }),
  });
  // @ts-ignore Sprint 85
  const requestRefund = trpc.disputeRefund.requestRefund.useMutation({
    // @ts-ignore Sprint 85
    onSuccess: res => {
      toast.success("Refund requested: " + res.refundRef);
      // @ts-ignore Sprint 85
      utils.disputeRefund.listRefunds.invalidate();
      // @ts-ignore Sprint 85
      utils.disputeRefund.stats.invalidate();
      setRefundOpen(false);
      setRefundForm({
        transactionRef: "",
        reason: "",
        category: "failed_transaction",
        amount: "",
      });
    },
    // @ts-ignore Sprint 85
    onError: e => toast.error("Error", { description: e.message }),
  });
  const initiateKyc = trpc.customer.kyc.initiate.useMutation({
    onSuccess: () => {
      toast.success("KYC session started");
      utils.customer.kyc.status.invalidate();
    },
    onError: e => toast.error("Error", { description: e.message }),
  });

  const profile = profileQuery.data;
  const balance = balanceQuery.data;
  const initials = profile
    ? `${profile.firstName?.[0] ?? ""}${profile.lastName?.[0] ?? ""}`.toUpperCase()
    : "CU";

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ChevronLeft size={18} />
          </Button>
          <h1 className="text-sm font-bold">Customer Portal</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon">
            <Bell size={16} />
          </Button>
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-xs bg-primary text-primary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
        </div>
      </header>

      {/* Profile card */}
      {profileQuery.isLoading ? (
        <div className="m-4 h-24 rounded-xl bg-muted animate-pulse" />
      ) : profile ? (
        <div className="m-4 rounded-xl bg-gradient-to-r from-primary to-primary/70 p-4 text-primary-foreground">
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="text-lg bg-white/20 text-white">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-bold">
                {profile.firstName} {profile.lastName}
              </p>
              <p className="text-xs opacity-80">{profile.phone}</p>
              <Badge
                variant="secondary"
                className="text-xs mt-1 bg-white/20 text-white border-0"
              >
                KYC Level {profile.kycLevel}
              </Badge>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-white/20 flex justify-between">
            <div>
              <p className="text-xs opacity-70">Wallet Balance</p>
              <p className="text-xl font-bold">
                ₦
                {Number(
                  balance?.walletBalance ?? profile.walletBalance
                ).toLocaleString()}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs opacity-70">Daily Limit</p>
              <p className="text-sm font-medium">
                ₦
                {Number(
                  balance?.dailyLimit ?? profile.dailyLimit
                ).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="m-4 rounded-xl bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          Please log in to view your profile
        </div>
      )}

      {/* Quick actions */}
      <div className="px-4 grid grid-cols-4 gap-2 mb-4">
        {[
          { icon: <ArrowUpRight size={18} />, label: "Send" },
          { icon: <ArrowDownLeft size={18} />, label: "Receive" },
          { icon: <CreditCard size={18} />, label: "Pay" },
          { icon: <Wallet size={18} />, label: "Top Up" },
        ].map((action: any) => (
          <button
            key={action.label}
            className="flex flex-col items-center gap-1 p-3 rounded-xl bg-card border border-border hover:bg-accent transition-colors"
          >
            <span className="text-primary">{action.icon}</span>
            <span className="text-xs text-muted-foreground">
              {action.label}
            </span>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="px-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full grid grid-cols-5 mb-4">
            <TabsTrigger value="accounts" className="text-xs">
              <Wallet size={12} className="mr-1" />
              Account
            </TabsTrigger>
            <TabsTrigger value="transactions" className="text-xs">
              <CreditCard size={12} className="mr-1" />
              Txns
            </TabsTrigger>
            <TabsTrigger value="disputes" className="text-xs">
              <AlertTriangle size={12} className="mr-1" />
              Disputes
            </TabsTrigger>
            <TabsTrigger value="kyc" className="text-xs">
              <Shield size={12} className="mr-1" />
              KYC
            </TabsTrigger>
            <TabsTrigger value="profile" className="text-xs">
              <User size={12} className="mr-1" />
              Profile
            </TabsTrigger>
          </TabsList>

          <TabsContent value="accounts">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">My Accounts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {profile ? (
                  <div className="rounded-lg bg-muted/30 p-3 space-y-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Wallet Balance
                      </span>
                      <span className="font-bold text-green-500">
                        ₦{Number(balance?.walletBalance ?? 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Daily Limit</span>
                      <span>
                        ₦{Number(balance?.dailyLimit ?? 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Monthly Limit
                      </span>
                      <span>
                        ₦{Number(balance?.monthlyLimit ?? 0).toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">KYC Status</span>
                      <Badge
                        variant={
                          profile.status === "active" ? "default" : "secondary"
                        }
                        className="text-xs"
                      >
                        {profile.status}
                      </Badge>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-4">
                    No account data available
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="transactions">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Transaction History</CardTitle>
                <div className="flex flex-wrap gap-2 mt-2">
                  <input
                    type="text"
                    placeholder="Search ref or amount…"
                    value={txSearch}
                    onChange={e => {
                      setTxSearch(e.target.value);
                      setTxPage(1);
                    }}
                    className="flex-1 min-w-[120px] text-xs px-2 py-1 rounded border border-border bg-background text-foreground"
                  />
                  <select
                    value={txTypeFilter}
                    onChange={e => {
                      setTxTypeFilter(e.target.value);
                      setTxPage(1);
                    }}
                    className="text-xs px-2 py-1 rounded border border-border bg-background text-foreground"
                  >
                    <option value="all">All Types</option>
                    {[
                      "Premium Payment",
                      "Claim Payout",
                      "Transfer",
                      "Airtime",
                      "Bills",
                      "Card Payment",
                    ].map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <select
                    value={txStatusFilter}
                    onChange={e => {
                      setTxStatusFilter(e.target.value);
                      setTxPage(1);
                    }}
                    className="text-xs px-2 py-1 rounded border border-border bg-background text-foreground"
                  >
                    <option value="all">All Status</option>
                    <option value="success">Success</option>
                    <option value="failed">Failed</option>
                    <option value="pending">Pending</option>
                    <option value="reversed">Reversed</option>
                  </select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {txQuery.isLoading ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">
                    Loading…
                  </div>
                ) : (
                  <>
                    <div className="divide-y divide-border">
                      {(txQuery.data?.items ?? [])
                        .filter((t: any) => {
                          const matchSearch =
                            !txSearch ||
                            (t.ref ?? "")
                              .toLowerCase()
                              .includes(txSearch.toLowerCase()) ||
                            String(t.amount).includes(txSearch);
                          const matchType =
                            txTypeFilter === "all" || t.type === txTypeFilter;
                          const matchStatus =
                            txStatusFilter === "all" ||
                            t.status === txStatusFilter;
                          return matchSearch && matchType && matchStatus;
                        })
                        .map((t: any) => (
                          <div
                            key={t.id}
                            className="flex items-center justify-between p-3"
                          >
                            <div>
                              <p className="text-xs font-medium">{t.type}</p>
                              <p className="text-xs text-muted-foreground font-mono">
                                {t.ref}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {new Date(t.createdAt).toLocaleDateString()}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-xs font-bold">
                                ₦{Number(t.amount).toLocaleString()}
                              </p>
                              <Badge
                                variant={
                                  t.status === "success"
                                    ? "default"
                                    : "secondary"
                                }
                                className="text-xs"
                              >
                                {t.status}
                              </Badge>
                            </div>
                          </div>
                        ))}
                      {(txQuery.data?.items ?? []).filter((t: any) => {
                        const matchSearch =
                          !txSearch ||
                          (t.ref ?? "")
                            .toLowerCase()
                            .includes(txSearch.toLowerCase()) ||
                          String(t.amount).includes(txSearch);
                        const matchType =
                          txTypeFilter === "all" || t.type === txTypeFilter;
                        const matchStatus =
                          txStatusFilter === "all" ||
                          t.status === txStatusFilter;
                        return matchSearch && matchType && matchStatus;
                      }).length === 0 && (
                        <div className="p-6 text-center text-xs text-muted-foreground">
                          No transactions match your filters
                        </div>
                      )}
                    </div>
                    {(txQuery.data?.total ?? 0) > 20 && (
                      <div className="flex items-center justify-between px-3 py-2 border-t border-border">
                        <span className="text-xs text-muted-foreground">
                          Page {txPage} of{" "}
                          {Math.ceil((txQuery.data?.total ?? 0) / 20)}
                        </span>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-6 px-2"
                            disabled={txPage === 1}
                            onClick={() => setTxPage(p => p - 1)}
                          >
                            Prev
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-xs h-6 px-2"
                            disabled={
                              txPage >=
                              Math.ceil((txQuery.data?.total ?? 0) / 20)
                            }
                            onClick={() => setTxPage(p => p + 1)}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="profile">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Shield size={14} className="text-primary" /> Profile &
                  Security
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs">
                {profile ? (
                  <>
                    <div className="space-y-2">
                      {[
                        {
                          label: "Full Name",
                          value: `${profile.firstName} ${profile.lastName}`,
                        },
                        { label: "Phone", value: profile.phone },
                        { label: "Email", value: profile.email ?? "Not set" },
                        {
                          label: "KYC Level",
                          value: `Level ${profile.kycLevel}`,
                        },
                        { label: "Account Status", value: profile.status },
                      ].map((field: any) => (
                        <div
                          key={field.label}
                          className="flex justify-between py-1.5 border-b border-border/50"
                        >
                          <span className="text-muted-foreground">
                            {field.label}
                          </span>
                          <span className="font-medium">{field.value}</span>
                        </div>
                      ))}
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full text-xs gap-1"
                      onClick={() => {
                        setProfileForm({
                          firstName: profile.firstName ?? "",
                          lastName: profile.lastName ?? "",
                          email: profile.email ?? "",
                          address: (profile as any).address ?? "",
                          dateOfBirth: (profile as any).dateOfBirth ?? "",
                        });
                        setProfileOpen(true);
                      }}
                    >
                      <User size={11} /> Update Profile
                    </Button>
                  </>
                ) : (
                  <p className="text-muted-foreground text-center py-4">
                    Please log in to view profile
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          {/* Disputes & Refunds tab */}
          <TabsContent value="disputes" className="space-y-3">
            {/* Sub-tab switcher */}
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg bg-muted/30 p-0.5 flex-1">
                <button
                  onClick={() => setDisputeSubTab("disputes")}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-all ${disputeSubTab === "disputes" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  Disputes{" "}
                  {refundStatsQ.data?.disputes?.open
                    ? `(${refundStatsQ.data.disputes.open})`
                    : ""}
                </button>
                <button
                  onClick={() => setDisputeSubTab("refunds")}
                  className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-all ${disputeSubTab === "refunds" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  Refunds{" "}
                  {refundStatsQ.data?.refunds?.pending
                    ? `(${refundStatsQ.data.refunds.pending})`
                    : ""}
                </button>
              </div>
              <Button
                size="sm"
                className="text-xs gap-1"
                onClick={() =>
                  disputeSubTab === "disputes"
                    ? setDisputeOpen(true)
                    : setRefundOpen(true)
                }
              >
                {disputeSubTab === "disputes" ? (
                  <>
                    <AlertTriangle size={12} /> Dispute
                  </>
                ) : (
                  <>
                    <ArrowDownLeft size={12} /> Refund
                  </>
                )}
              </Button>
            </div>
            {/* Refund summary cards */}
            {disputeSubTab === "refunds" && refundStatsQ.data && (
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-2 text-center">
                  <div className="text-sm font-bold text-yellow-500">
                    {refundStatsQ.data.refunds?.pending ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Pending
                  </div>
                </div>
                <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-2 text-center">
                  <div className="text-sm font-bold text-green-500">
                    {refundStatsQ.data.refunds?.processed ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Processed
                  </div>
                </div>
                <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-2 text-center">
                  <div className="text-sm font-bold text-red-500">
                    {refundStatsQ.data.refunds?.rejected ?? 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    Rejected
                  </div>
                </div>
              </div>
            )}
            {/* Disputes list */}
            {disputeSubTab === "disputes" && (
              <Card>
                <CardContent className="p-0">
                  {disputesQ.isLoading ? (
                    <div className="p-4 text-xs text-center text-muted-foreground">
                      Loading…
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {(disputesQ.data?.items ?? []).map((d: any) => (
                        <div
                          key={d.id}
                          className="flex items-center justify-between p-3"
                        >
                          <div>
                            <p className="text-xs font-medium">
                              {d.type ?? "Dispute"}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {d.transactionRef}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {d.reason?.slice(0, 60)}
                            </p>
                          </div>
                          <Badge
                            variant={
                              d.status === "resolved" ? "default" : "secondary"
                            }
                            className="text-xs"
                          >
                            {d.status}
                          </Badge>
                        </div>
                      ))}
                      {(disputesQ.data?.items ?? []).length === 0 && (
                        <div className="p-6 text-center text-xs text-muted-foreground">
                          No disputes yet
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
            {/* Refunds list */}
            {disputeSubTab === "refunds" && (
              <Card>
                <CardContent className="p-0">
                  {refundsQ.isLoading ? (
                    <div className="p-4 text-xs text-center text-muted-foreground">
                      Loading…
                    </div>
                  ) : (
                    <div className="divide-y divide-border">
                      {(refundsQ.data?.refunds ?? []).map((r: any) => (
                        <div key={r.refund.id} className="p-3 space-y-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono text-primary">
                              {r.refund.ref}
                            </span>
                            <Badge
                              variant={
                                r.refund.status === "processed"
                                  ? "default"
                                  : r.refund.status === "rejected"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className="text-xs capitalize"
                            >
                              {r.refund.status === "pending"
                                ? "⏳"
                                : r.refund.status === "processed"
                                  ? "✅"
                                  : r.refund.status === "rejected"
                                    ? "❌"
                                    : "✅"}{" "}
                              {r.refund.status}
                            </Badge>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold">
                              ₦{(r.refund.refundAmount ?? 0).toLocaleString()}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              of ₦
                              {(r.refund.originalAmount ?? 0).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {r.refund.reason?.slice(0, 80)}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-muted-foreground font-mono">
                              Tx: {r.refund.transactionRef}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              {new Date(
                                r.refund.createdAt
                              ).toLocaleDateString()}
                            </span>
                          </div>
                          {r.refund.status === "rejected" &&
                            r.refund.rejectionReason && (
                              <div className="text-xs text-red-500 bg-red-500/10 rounded p-1.5 mt-1">
                                ❌ {r.refund.rejectionReason}
                              </div>
                            )}
                          {r.refund.status === "processed" && (
                            <div className="text-xs text-green-500 bg-green-500/10 rounded p-1.5 mt-1">
                              ✅ Processed on{" "}
                              {new Date(
                                r.refund.processedAt
                              ).toLocaleDateString()}{" "}
                              via {r.refund.method?.replace("_", " ")}
                            </div>
                          )}
                        </div>
                      ))}
                      {(refundsQ.data?.refunds ?? []).length === 0 && (
                        <div className="p-6 text-center text-xs text-muted-foreground">
                          No refund requests yet
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* KYC tab */}
          <TabsContent value="kyc" className="space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Shield size={14} className="text-primary" /> KYC Status
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => kycQ.refetch()}
                  >
                    <RefreshCw
                      size={12}
                      className={kycQ.isFetching ? "animate-spin" : ""}
                    />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {kycQ.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading…</p>
                ) : (
                  <>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30">
                      {(kycQ.data as any)?.status === "approved" ? (
                        <CheckCircle size={20} className="text-green-500" />
                      ) : (
                        <Clock size={20} className="text-yellow-500" />
                      )}
                      <div>
                        <p className="text-sm font-medium capitalize">
                          {(kycQ.data as any)?.status ?? "Not started"}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          KYC Level: {profile?.kycLevel ?? "0"}
                        </p>
                      </div>
                    </div>
                    {(kycQ.data as any)?.status !== "approved" && (
                      <Button
                        size="sm"
                        className="w-full text-xs gap-1"
                        onClick={() => initiateKyc.mutate({ docType: "NIN" })}
                        disabled={initiateKyc.isPending}
                      >
                        <Shield size={12} />{" "}
                        {initiateKyc.isPending
                          ? "Starting…"
                          : "Start KYC Verification"}
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Profile Edit Dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {(
              [
                "firstName",
                "lastName",
                "email",
                "address",
                "dateOfBirth",
              ] as const
            ).map((key: any) => (
              <div key={key}>
                <Label className="text-xs text-muted-foreground capitalize">
                  {key.replace(/([A-Z])/g, " $1")}
                </Label>
                <Input
                  className="mt-1 h-8 text-sm"
                  // @ts-ignore Sprint 85
                  value={profileForm[key]}
                  onChange={e =>
                    setProfileForm(f => ({ ...f, [key]: e.target.value }))
                  }
                />
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProfileOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateProfile.mutate(profileForm)}
              disabled={updateProfile.isPending}
            >
              {updateProfile.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispute Dialog */}
      <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Raise a Dispute</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">
                Transaction Ref
              </Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={disputeForm.transactionRef}
                onChange={e =>
                  setDisputeForm(f => ({
                    ...f,
                    transactionRef: e.target.value,
                  }))
                }
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Reason</Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={disputeForm.reason}
                onChange={e =>
                  setDisputeForm(f => ({ ...f, reason: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDisputeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => raiseDispute.mutate(disputeForm as any)}
              disabled={
                raiseDispute.isPending ||
                !disputeForm.transactionRef ||
                !disputeForm.reason
              }
            >
              {raiseDispute.isPending ? "Submitting…" : "Raise Dispute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Refund Request Dialog */}
      <Dialog open={refundOpen} onOpenChange={setRefundOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowDownLeft size={16} className="text-primary" /> Request a
              Refund
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">
                Transaction Reference *
              </Label>
              <Input
                className="mt-1 h-8 text-sm font-mono"
                placeholder="e.g. TXN-2024-001847"
                value={refundForm.transactionRef}
                onChange={e =>
                  setRefundForm(f => ({ ...f, transactionRef: e.target.value }))
                }
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                Refund Category *
              </Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {[
                  "failed_transaction",
                  "wrong_amount",
                  "duplicate_charge",
                  "service_not_received",
                  "other",
                ].map(cat => (
                  <button
                    key={cat}
                    onClick={() =>
                      setRefundForm(f => ({ ...f, category: cat }))
                    }
                    className={`px-2 py-1 rounded-md text-[10px] font-medium border transition-all ${refundForm.category === cat ? "bg-primary/15 text-primary border-primary/30" : "bg-muted/30 text-muted-foreground border-border"}`}
                  >
                    {cat.replace(/_/g, " ")}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                Refund Amount (₦) — leave blank for full refund
              </Label>
              <Input
                className="mt-1 h-8 text-sm font-mono"
                placeholder="e.g. 5000"
                value={refundForm.amount}
                onChange={e =>
                  setRefundForm(f => ({
                    ...f,
                    amount: e.target.value.replace(/[^0-9]/g, ""),
                  }))
                }
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                Reason for Refund *
              </Label>
              <Input
                className="mt-1 h-8 text-sm"
                placeholder="Describe why this refund is needed"
                value={refundForm.reason}
                onChange={e =>
                  setRefundForm(f => ({ ...f, reason: e.target.value }))
                }
              />
            </div>
            <div className="rounded-lg bg-muted/30 p-2.5 text-[10px] text-muted-foreground">
              Refund requests are reviewed by admin within 24 hours. Amount
              cannot exceed the original transaction value.
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRefundOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                requestRefund.mutate({
                  transactionRef: refundForm.transactionRef,
                  reason: refundForm.reason,
                  category: refundForm.category as any,
                  refundAmount: refundForm.amount
                    ? parseInt(refundForm.amount)
                    : undefined,
                })
              }
              disabled={
                requestRefund.isPending ||
                !refundForm.transactionRef.trim() ||
                refundForm.reason.trim().length < 10
              }
            >
              {requestRefund.isPending ? "Submitting…" : "Request Refund"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
