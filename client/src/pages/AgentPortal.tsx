/**
 * AgentPortal.tsx
 *
 * Agent-facing portal accessible at /agent.
 * Uses the tRPC agentBanking router (nested procedures).
 */
import { useState } from "react";
import { useLocation } from "wouter";
import { usePosStore } from "../store/posStore";
import { GdprConsentBanner } from "../components/GdprConsentBanner";
import { EnableNotificationsButton } from "../components/EnableNotificationsButton";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  TrendingUp,
  Star,
  BookOpen,
  CreditCard,
  ArrowUpRight,
  ArrowDownLeft,
  RefreshCw,
  ChevronLeft,
  QrCode,
  AlertTriangle,
  User,
} from "lucide-react";

export default function AgentPortal() {
  const agent = usePosStore(s => s.agent);
  const [, navigate] = useLocation();
  const [tab, setTab] = useState("wallet");
  // Transaction search/filter/pagination state
  const [txSearch, setTxSearch] = useState("");
  const [txStatus, setTxStatus] = useState("all");
  const [txType, setTxType] = useState("all");
  const [txPage, setTxPage] = useState(1);

  const agentId = agent?.id ?? 0;

  // agentBanking.dashboard.summary
  const dashboardQuery = trpc.agentBanking.dashboard.summary.useQuery(
    { agentId },
    { enabled: agentId > 0, retry: false }
  );

  // agentBanking.transactions.list
  const txQuery = trpc.agentBanking.transactions.list.useQuery(
    {
      agentId,
      page: txPage,
      limit: 15,
      ...(txStatus !== "all" ? { status: txStatus as any } : {}),
      ...(txType !== "all" ? { type: txType as any } : {}),
    },
    { enabled: agentId > 0, retry: false }
  );

  // agentBanking.profile.get
  const profileQuery = trpc.agentBanking.profile.get.useQuery(
    { agentId },
    { enabled: agentId > 0, retry: false }
  );

  // Additional queries
  const floatHistoryQ = trpc.agentBanking.float.history.useQuery(
    { agentId, page: 1, limit: 10 },
    { enabled: agentId > 0 && tab === "wallet", retry: false }
  );
  const disputesQ = trpc.agentBanking.disputes.list.useQuery(
    { agentId, page: 1, limit: 10 },
    { enabled: agentId > 0 && tab === "disputes", retry: false }
  );
  const loyaltyQ = trpc.agentBanking.loyalty.history.useQuery(
    { agentId, page: 1, limit: 10 },
    { enabled: agentId > 0 && tab === "scorecard", retry: false }
  );
  const qrCodesQ = trpc.agentBanking.qr.myQrCodes.useQuery(
    { agentId, page: 1, limit: 5 },
    { enabled: agentId > 0 && tab === "qr", retry: false }
  );

  const utils = trpc.useUtils();

  // Mutations
  const [floatOpen, setFloatOpen] = useState(false);
  const [floatAmount, setFloatAmount] = useState("");
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [disputeForm, setDisputeForm] = useState({
    transactionRef: "",
    transactionId: 0,
    reason: "",
    evidence: "",
  });
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({
    name: "",
    phone: "",
    email: "",
  });

  const requestFloat = trpc.agentBanking.float.requestTopUp.useMutation({
    onSuccess: () => {
      toast.success("Float request submitted");
      utils.agentBanking.dashboard.summary.invalidate();
      utils.agentBanking.float.history.invalidate();
      setFloatOpen(false);
      setFloatAmount("");
    },
    onError: e => toast.error("Request failed", { description: e.message }),
  });
  const raiseDispute = trpc.agentBanking.disputes.raise.useMutation({
    onSuccess: () => {
      toast.success("Dispute raised");
      utils.agentBanking.disputes.list.invalidate();
      setDisputeOpen(false);
      setDisputeForm({
        transactionRef: "",
        transactionId: 0,
        reason: "",
        evidence: "",
      });
    },
    onError: e => toast.error("Error", { description: e.message }),
  });
  const generateQr = trpc.agentBanking.qr.generate.useMutation({
    onSuccess: () => {
      toast.success("QR code generated");
      utils.agentBanking.qr.myQrCodes.invalidate();
    },
    onError: e => toast.error("Error", { description: e.message }),
  });
  const updateProfile = trpc.agentBanking.profile.update.useMutation({
    onSuccess: () => {
      toast.success("Profile updated");
      utils.agentBanking.profile.get.invalidate();
      setProfileOpen(false);
    },
    onError: e => toast.error("Error", { description: e.message }),
  });

  const dashData = dashboardQuery.data;
  const wallet = {
    premiumReserve: dashData?.premiumReserve ?? agent?.premiumReserve ?? "0",
    commissionBalance:
      (dashData as any)?.commissionBalance ?? agent?.commissionBalance ?? "0",
    loyaltyPoints: dashData?.loyaltyPoints ?? agent?.loyaltyPoints ?? 0,
  };

  const profile = profileQuery.data ?? agent;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* GDPR/NDPR Consent Banner */}
      <GdprConsentBanner agentId={agent?.agentId} />
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ChevronLeft size={18} />
          </Button>
          <div>
            <h1 className="text-sm font-bold">Agent Portal</h1>
            <p className="text-xs text-muted-foreground">
              {agent?.name ?? "Agent"} · {agent?.agentId}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            {agent?.tier ?? "Bronze"}
          </Badge>
          <EnableNotificationsButton />
        </div>
      </header>

      {/* Balance cards */}
      <div className="p-4 grid grid-cols-3 gap-3">
        <Card className="bg-primary text-primary-foreground">
          <CardContent className="p-3">
            <p className="text-xs opacity-80">Float Balance</p>
            <p className="text-lg font-bold">
              ₦{Number(wallet.premiumReserve).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Commission</p>
            <p className="text-lg font-bold">
              ₦{Number(wallet.commissionBalance).toLocaleString()}
            </p>
          </CardContent>
        </Card>
        <Card className="bg-card">
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Loyalty Pts</p>
            <p className="text-lg font-bold">
              {Number(wallet.loyaltyPoints).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <div className="px-4">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full grid grid-cols-6 mb-4">
            <TabsTrigger value="wallet" className="text-xs">
              <Wallet size={12} className="mr-1" />
              Float
            </TabsTrigger>
            <TabsTrigger value="transactions" className="text-xs">
              <CreditCard size={12} className="mr-1" />
              Txns
            </TabsTrigger>
            <TabsTrigger value="scorecard" className="text-xs">
              <Star size={12} className="mr-1" />
              Score
            </TabsTrigger>
            <TabsTrigger value="disputes" className="text-xs">
              <AlertTriangle size={12} className="mr-1" />
              Disputes
            </TabsTrigger>
            <TabsTrigger value="qr" className="text-xs">
              <QrCode size={12} className="mr-1" />
              QR
            </TabsTrigger>
            <TabsTrigger value="profile" className="text-xs">
              <User size={12} className="mr-1" />
              Profile
            </TabsTrigger>
          </TabsList>

          {/* Wallet tab */}
          <TabsContent value="wallet" className="space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Float Management</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 text-xs gap-1"
                    onClick={() => {
                      setFloatAmount("");
                      setFloatOpen(true);
                    }}
                  >
                    <ArrowUpRight size={12} /> Request Float
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="flex-1 text-xs gap-1"
                    onClick={() => dashboardQuery.refetch()}
                  >
                    <RefreshCw size={12} /> Refresh
                  </Button>
                </div>
                <div className="rounded-lg bg-muted/30 p-3 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Float Limit</span>
                    <span className="font-medium">
                      ₦{Number(agent?.floatLimit ?? 1000000).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Available</span>
                    <span className="font-medium text-green-500">
                      ₦{Number(wallet.premiumReserve).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Utilisation</span>
                    <span className="font-medium">
                      {agent?.floatLimit
                        ? Math.round(
                            (Number(wallet.premiumReserve) /
                              Number(agent.floatLimit)) *
                              100
                          )
                        : 0}
                      %
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Transactions tab */}
          <TabsContent value="transactions">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Transaction History</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Search + Filter row */}
                <div className="flex flex-wrap gap-2">
                  <Input
                    placeholder="Search by ref or type…"
                    value={txSearch}
                    onChange={e => {
                      setTxSearch(e.target.value);
                      setTxPage(1);
                    }}
                    className="flex-1 min-w-[120px] h-7 text-xs"
                  />
                  <select
                    value={txStatus}
                    onChange={e => {
                      setTxStatus(e.target.value);
                      setTxPage(1);
                    }}
                    className="h-7 text-xs px-2 rounded-md border border-input bg-background"
                  >
                    <option value="all">All Status</option>
                    <option value="success">Success</option>
                    <option value="pending">Pending</option>
                    <option value="failed">Failed</option>
                    <option value="reversed">Reversed</option>
                  </select>
                  <select
                    value={txType}
                    onChange={e => {
                      setTxType(e.target.value);
                      setTxPage(1);
                    }}
                    className="h-7 text-xs px-2 rounded-md border border-input bg-background"
                  >
                    <option value="all">All Types</option>
                    <option value="cash_in">Cash In</option>
                    <option value="cash_out">Cash Out</option>
                    <option value="transfer">Transfer</option>
                    <option value="bill_payment">Bill Payment</option>
                    <option value="airtime">Airtime</option>
                  </select>
                </div>

                {txQuery.isLoading ? (
                  <div className="p-4 text-xs text-muted-foreground text-center">
                    Loading…
                  </div>
                ) : (
                  <div className="divide-y divide-border rounded-md border">
                    {(txQuery.data?.items ?? [])
                      .filter(
                        (t: any) =>
                          !txSearch ||
                          t.ref
                            ?.toLowerCase()
                            .includes(txSearch.toLowerCase()) ||
                          t.type?.toLowerCase().includes(txSearch.toLowerCase())
                      )
                      .map((t: any) => (
                        <div
                          key={t.id}
                          className="flex items-center justify-between p-3"
                        >
                          <div>
                            <p className="text-xs font-medium capitalize">
                              {t.type?.replace(/_/g, " ")}
                            </p>
                            <p className="text-xs text-muted-foreground font-mono">
                              {t.ref}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {t.createdAt
                                ? new Date(t.createdAt).toLocaleDateString(
                                    "en-NG"
                                  )
                                : ""}
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
                                  : t.status === "failed"
                                    ? "destructive"
                                    : "secondary"
                              }
                              className="text-xs"
                            >
                              {t.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    {(txQuery.data?.items ?? []).length === 0 && (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        No transactions found
                      </div>
                    )}
                  </div>
                )}

                {/* Pagination */}
                {(txQuery.data?.total ?? 0) > 15 && (
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      Page {txPage} of{" "}
                      {Math.ceil((txQuery.data?.total ?? 0) / 15)}
                    </span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        disabled={txPage === 1}
                        onClick={() => setTxPage(p => p - 1)}
                      >
                        Prev
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs"
                        disabled={
                          txPage >= Math.ceil((txQuery.data?.total ?? 0) / 15)
                        }
                        onClick={() => setTxPage(p => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Scorecard tab */}
          <TabsContent value="scorecard" className="space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <TrendingUp size={14} className="text-primary" /> Performance
                  Scorecard
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Current Tier", value: agent?.tier ?? "Bronze" },
                    { label: "Platform Rank", value: `#${agent?.rank ?? 0}` },
                    {
                      label: "Active Streak",
                      value: `${agent?.streak ?? 0} days`,
                    },
                    {
                      label: "Loyalty Points",
                      value: Number(agent?.loyaltyPoints ?? 0).toLocaleString(),
                    },
                  ].map((item: any) => (
                    <div
                      key={item.label}
                      className="rounded-lg bg-muted/30 p-3"
                    >
                      <p className="text-xs text-muted-foreground">
                        {item.label}
                      </p>
                      <p className="text-sm font-bold">{item.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Disputes tab */}
          <TabsContent value="disputes" className="space-y-3">
            <div className="flex justify-end">
              <Button
                size="sm"
                className="text-xs gap-1"
                onClick={() => setDisputeOpen(true)}
              >
                <AlertTriangle size={12} /> Raise Dispute
              </Button>
            </div>
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
                            {d.description?.slice(0, 60)}
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
                        No disputes
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* QR tab */}
          <TabsContent value="qr" className="space-y-3">
            <div className="flex justify-end">
              <Button
                size="sm"
                className="text-xs gap-1"
                onClick={() => generateQr.mutate({ agentId, type: "payment" })}
                disabled={generateQr.isPending}
              >
                <QrCode size={12} /> Generate QR
              </Button>
            </div>
            <Card>
              <CardContent className="p-0">
                {qrCodesQ.isLoading ? (
                  <div className="p-4 text-xs text-center text-muted-foreground">
                    Loading…
                  </div>
                ) : (
                  <div className="divide-y divide-border">
                    {(qrCodesQ.data?.items ?? []).map((q: any) => (
                      <div
                        key={q.id}
                        className="flex items-center justify-between p-3"
                      >
                        <div>
                          <p className="text-xs font-medium font-mono">
                            {q.code}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {q.label ?? "QR Code"}
                          </p>
                        </div>
                        <Badge
                          variant={q.isActive ? "default" : "secondary"}
                          className="text-xs"
                        >
                          {q.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    ))}
                    {(qrCodesQ.data?.items ?? []).length === 0 && (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        No QR codes yet
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Profile tab */}
          <TabsContent value="profile" className="space-y-3">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Agent Profile</CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs gap-1"
                    onClick={() => {
                      setProfileForm({
                        name: (profile as any)?.name ?? "",
                        phone: (profile as any)?.phone ?? "",
                        email: (profile as any)?.email ?? "",
                      });
                      setProfileOpen(true);
                    }}
                  >
                    <User size={11} /> Edit
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {[
                  { label: "Name", value: (profile as any)?.name },
                  { label: "Agent Code", value: (profile as any)?.agentId },
                  { label: "Phone", value: (profile as any)?.phone },
                  { label: "Email", value: (profile as any)?.email },
                  { label: "Tier", value: (profile as any)?.tier },
                  { label: "KYC Level", value: (profile as any)?.kycLevel },
                  { label: "Status", value: (profile as any)?.status },
                ].map(
                  (f: any) =>
                    f.value && (
                      <div
                        key={f.label}
                        className="flex justify-between py-1.5 border-b border-border/50"
                      >
                        <span className="text-muted-foreground">{f.label}</span>
                        <span className="font-medium">{f.value}</span>
                      </div>
                    )
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Float Request Dialog */}
      <Dialog open={floatOpen} onOpenChange={setFloatOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Request Float Top-Up</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Label className="text-xs text-muted-foreground">
              Amount (NGN)
            </Label>
            <Input
              className="mt-1 h-8 text-sm"
              type="number"
              placeholder="50000"
              value={floatAmount}
              onChange={e => setFloatAmount(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setFloatOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                requestFloat.mutate({ agentId, amount: floatAmount })
              }
              disabled={requestFloat.isPending || !floatAmount}
            >
              {requestFloat.isPending ? "Submitting…" : "Submit Request"}
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
              <Label className="text-xs text-muted-foreground">
                Transaction ID
              </Label>
              <Input
                className="mt-1 h-8 text-sm"
                type="number"
                value={disputeForm.transactionId || ""}
                onChange={e =>
                  setDisputeForm(f => ({
                    ...f,
                    transactionId: Number(e.target.value),
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
            <div>
              <Label className="text-xs text-muted-foreground">
                Evidence (optional)
              </Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={disputeForm.evidence}
                onChange={e =>
                  setDisputeForm(f => ({ ...f, evidence: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDisputeOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                raiseDispute.mutate({
                  agentId,
                  transactionRef: disputeForm.transactionRef,
                  transactionId: disputeForm.transactionId,
                  reason: disputeForm.reason,
                  evidence: disputeForm.evidence || undefined,
                })
              }
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

      {/* Profile Edit Dialog */}
      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Profile</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={profileForm.name}
                onChange={e =>
                  setProfileForm(f => ({ ...f, name: e.target.value }))
                }
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Phone</Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={profileForm.phone}
                onChange={e =>
                  setProfileForm(f => ({ ...f, phone: e.target.value }))
                }
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email</Label>
              <Input
                className="mt-1 h-8 text-sm"
                value={profileForm.email}
                onChange={e =>
                  setProfileForm(f => ({ ...f, email: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setProfileOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => updateProfile.mutate({ agentId, ...profileForm })}
              disabled={updateProfile.isPending}
            >
              {updateProfile.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
