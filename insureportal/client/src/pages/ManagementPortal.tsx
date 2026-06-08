/**
 * ManagementPortal.tsx — Full management dashboard with live CRUD actions
 * Tabs: Dashboard · Agents · Transactions · KYC · Commissions · Settings
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { usePosStore } from "../store/posStore";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Users,
  TrendingUp,
  CreditCard,
  Shield,
  Settings,
  BarChart3,
  AlertTriangle,
  Database,
  Wifi,
  Package,
  DollarSign,
  FileText,
  MapPin,
  Layers,
  Activity,
  RefreshCw,
  Search,
  CheckCircle,
  XCircle,
  Edit,
} from "lucide-react";

type Tab =
  | "dashboard"
  | "agents"
  | "transactions"
  | "kyc"
  | "commissions"
  | "settings";

const NAV_ITEMS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "dashboard", label: "Dashboard", icon: <BarChart3 size={16} /> },
  { id: "agents", label: "Agents", icon: <Users size={16} /> },
  { id: "transactions", label: "Transactions", icon: <CreditCard size={16} /> },
  { id: "kyc", label: "KYC / KYB", icon: <Shield size={16} /> },
  { id: "commissions", label: "Commissions", icon: <DollarSign size={16} /> },
  { id: "settings", label: "Settings", icon: <Settings size={16} /> },
];

const fmt = (n: number | string) =>
  Number(n).toLocaleString("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  });

export default function ManagementPortal() {
  const agent = usePosStore(s => s.agent);
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [agentSearch, setAgentSearch] = useState("");
  const [agentPage, setAgentPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const [editAgent, setEditAgent] = useState<any>(null);
  const [editTier, setEditTier] = useState<string>("Bronze");
  const [editActive, setEditActive] = useState(true);

  // Role guard
  useEffect(() => {
    if (agent && agent.role !== "admin" && agent.role !== "supervisor") {
      navigate("/");
    }
  }, [agent, navigate]);

  // ── Queries ──────────────────────────────────────────────────────────────
  const statsQ = trpc.management.dashboard.stats.useQuery(undefined, {
    retry: false,
  });
  const agentsQ = trpc.management.agents.list.useQuery(
    { page: agentPage, limit: 20, search: agentSearch || undefined },
    { enabled: tab === "agents", retry: false }
  );
  const txQ = trpc.management.transactions.list.useQuery(
    { page: txPage, limit: 20 },
    { enabled: tab === "transactions", retry: false }
  );
  const kycQ = trpc.management.kyc.list.useQuery(
    { page: 1, limit: 20 },
    { enabled: tab === "kyc", retry: false }
  );
  const commQ = trpc.management.commissions.rules.useQuery(undefined, {
    enabled: tab === "commissions",
    retry: false,
  });
  const settingsQ = trpc.management.settings.get.useQuery(undefined, {
    enabled: tab === "settings",
    retry: false,
  });

  // ── Mutations ─────────────────────────────────────────────────────────────
  const utils = trpc.useUtils();

  const updateAgent = trpc.management.agents.update.useMutation({
    onSuccess: () => {
      toast.success("Agent updated", {
        description: "Changes saved successfully.",
      });
      utils.management.agents.list.invalidate();
      setEditAgent(null);
    },
    onError: e => toast.error("Update failed", { description: e.message }),
  });

  const reviewKyc = trpc.management.kyc.review.useMutation({
    onSuccess: (_data, vars) => {
      toast.success(
        vars.status === "completed" ? "KYC approved" : "KYC rejected"
      );
      utils.management.kyc.list.invalidate();
    },
    onError: (e: any) => toast.error("Error", { description: e.message }),
  });

  const updateSetting = trpc.management.settings.update.useMutation({
    onSuccess: () => {
      toast.success("Setting saved");
      utils.management.settings.get.invalidate();
    },
    onError: e => toast.error("Error", { description: e.message }),
  });

  const stats = statsQ.data ?? ({} as any);

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-card border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h1 className="text-sm font-bold text-primary">InsurePortal Management</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Back-office Portal
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {NAV_ITEMS.map((item: any) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-xs transition-colors text-left ${
                tab === item.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="p-3 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => navigate("/")}
          >
            ← Back to POS
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          {/* ── Dashboard ── */}
          {tab === "dashboard" && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Management Dashboard</h2>
                  <p className="text-sm text-muted-foreground">
                    {new Date().toLocaleDateString("en-NG", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="text-xs">
                    {agent?.role === "admin" ? "Administrator" : "Supervisor"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => statsQ.refetch()}
                    className="gap-1.5 text-xs"
                  >
                    <RefreshCw
                      size={12}
                      className={statsQ.isFetching ? "animate-spin" : ""}
                    />{" "}
                    Refresh
                  </Button>
                </div>
              </div>
              {statsQ.isLoading ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Card key={i} className="animate-pulse">
                      <CardContent className="p-4 h-20 bg-muted/30 rounded" />
                    </Card>
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    {
                      label: "Total Agents",
                      value: stats.totalAgents ?? stats.agents ?? 0,
                      icon: <Users size={20} />,
                    },
                    {
                      label: "Active Agents",
                      value: stats.activeAgents ?? 0,
                      icon: <Activity size={20} />,
                    },
                    {
                      label: "Today Transactions",
                      value: stats.todayTransactions ?? stats.transactions ?? 0,
                      icon: <CreditCard size={20} />,
                    },
                    {
                      label: "Today Volume",
                      value: fmt(stats.todayVolume ?? stats.volume ?? 0),
                      icon: <TrendingUp size={20} />,
                    },
                    {
                      label: "Pending KYC",
                      value: stats.pendingKyc ?? 0,
                      icon: <Shield size={20} />,
                    },
                    {
                      label: "Open Disputes",
                      value: stats.openDisputes ?? 0,
                      icon: <AlertTriangle size={20} />,
                    },
                    {
                      label: "Fraud Alerts",
                      value: stats.fraudAlerts ?? 0,
                      icon: <AlertTriangle size={20} />,
                    },
                    {
                      label: "Insurance Services",
                      value: stats.terminals ?? 0,
                      icon: <Database size={20} />,
                    },
                  ].map((s: any) => (
                    <Card key={s.label} className="bg-card border-border">
                      <CardContent className="p-4 flex items-center gap-4">
                        <div className="p-2 rounded-lg bg-primary/10 text-primary">
                          {s.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-muted-foreground truncate">
                            {s.label}
                          </p>
                          <p className="text-xl font-bold">{s.value}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
              {/* Quick nav */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Quick Actions</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                    {NAV_ITEMS.slice(1).map((item: any) => (
                      <Button
                        key={item.id}
                        variant="outline"
                        size="sm"
                        className="flex flex-col h-16 gap-1 text-xs"
                        onClick={() => setTab(item.id)}
                      >
                        {item.icon}
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* ── Agents ── */}
          {tab === "agents" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Agents</h2>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search
                      size={13}
                      className="absolute left-2.5 top-2.5 text-muted-foreground"
                    />
                    <Input
                      className="pl-8 h-8 text-sm w-52"
                      placeholder="Search agents…"
                      value={agentSearch}
                      onChange={e => {
                        setAgentSearch(e.target.value);
                        setAgentPage(1);
                      }}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => agentsQ.refetch()}
                    className="gap-1"
                  >
                    <RefreshCw
                      size={12}
                      className={agentsQ.isFetching ? "animate-spin" : ""}
                    />
                  </Button>
                </div>
              </div>
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground text-xs uppercase">
                        <th className="px-4 py-3 text-left">Agent</th>
                        <th className="px-4 py-3 text-left">Code</th>
                        <th className="px-4 py-3 text-left">Tier</th>
                        <th className="px-4 py-3 text-left">Float</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentsQ.isLoading ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            Loading…
                          </td>
                        </tr>
                      ) : agentsQ.data?.items.length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            No agents found
                          </td>
                        </tr>
                      ) : (
                        agentsQ.data?.items.map((a: any) => (
                          <tr
                            key={a.id}
                            className="border-b border-border/50 hover:bg-accent/30"
                          >
                            <td className="px-4 py-3">
                              <p className="font-medium">{a.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {a.phone}
                              </p>
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                              {a.agentCode}
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant="outline" className="text-xs">
                                {a.tier ?? "Bronze"}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {fmt(a.floatBalance ?? 0)}
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                className={`text-xs ${a.isActive ? "bg-green-900/50 text-green-400 border-green-800" : "bg-red-900/50 text-red-400 border-red-800"}`}
                              >
                                {a.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex gap-1.5">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs gap-1"
                                  onClick={() => {
                                    setEditAgent(a);
                                    setEditTier(a.tier ?? "Bronze");
                                    setEditActive(a.isActive ?? true);
                                  }}
                                >
                                  <Edit size={11} /> Edit
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={`h-7 px-2 text-xs gap-1 ${a.isActive ? "text-destructive hover:text-destructive" : "text-green-500 hover:text-green-400"}`}
                                  onClick={() =>
                                    updateAgent.mutate({
                                      id: a.id,
                                      isActive: !a.isActive,
                                    })
                                  }
                                  disabled={updateAgent.isPending}
                                >
                                  {a.isActive ? (
                                    <>
                                      <XCircle size={11} /> Suspend
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle size={11} /> Activate
                                    </>
                                  )}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
                    <span>Total: {agentsQ.data?.total ?? 0}</span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        disabled={agentPage <= 1}
                        onClick={() => setAgentPage(p => p - 1)}
                      >
                        Prev
                      </Button>
                      <span className="px-2">Page {agentPage}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        disabled={
                          !agentsQ.data || agentPage * 20 >= agentsQ.data.total
                        }
                        onClick={() => setAgentPage(p => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* ── Transactions ── */}
          {tab === "transactions" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Transactions</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => txQ.refetch()}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw
                    size={12}
                    className={txQ.isFetching ? "animate-spin" : ""}
                  />{" "}
                  Refresh
                </Button>
              </div>
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground text-xs uppercase">
                        <th className="px-4 py-3 text-left">Reference</th>
                        <th className="px-4 py-3 text-left">Type</th>
                        <th className="px-4 py-3 text-left">Amount</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Date</th>
                      </tr>
                    </thead>
                    <tbody>
                      {txQ.isLoading ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            Loading…
                          </td>
                        </tr>
                      ) : txQ.data?.items.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            No transactions
                          </td>
                        </tr>
                      ) : (
                        txQ.data?.items.map((t: any) => (
                          <tr
                            key={t.id}
                            className="border-b border-border/50 hover:bg-accent/30"
                          >
                            <td className="px-4 py-3 font-mono text-xs">
                              {t.reference ?? t.ref}
                            </td>
                            <td className="px-4 py-3 text-xs capitalize">
                              {(t.txType ?? t.type ?? "").replace(/_/g, " ")}
                            </td>
                            <td className="px-4 py-3 text-sm font-medium">
                              {fmt(t.amount ?? 0)}
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                className={`text-xs ${
                                  t.status === "success"
                                    ? "bg-green-900/50 text-green-400 border-green-800"
                                    : t.status === "failed"
                                      ? "bg-red-900/50 text-red-400 border-red-800"
                                      : "bg-yellow-900/50 text-yellow-400 border-yellow-800"
                                }`}
                              >
                                {t.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-xs text-muted-foreground">
                              {t.createdAt
                                ? new Date(t.createdAt).toLocaleString()
                                : "—"}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                  <div className="flex items-center justify-between px-4 py-3 border-t border-border text-xs text-muted-foreground">
                    <span>Total: {txQ.data?.total ?? 0}</span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        disabled={txPage <= 1}
                        onClick={() => setTxPage(p => p - 1)}
                      >
                        Prev
                      </Button>
                      <span className="px-2">Page {txPage}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs"
                        disabled={!txQ.data || txPage * 20 >= txQ.data.total}
                        onClick={() => setTxPage(p => p + 1)}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* ── KYC ── */}
          {tab === "kyc" && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">KYC Applications</h2>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => kycQ.refetch()}
                  className="gap-1.5 text-xs"
                >
                  <RefreshCw
                    size={12}
                    className={kycQ.isFetching ? "animate-spin" : ""}
                  />{" "}
                  Refresh
                </Button>
              </div>
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground text-xs uppercase">
                        <th className="px-4 py-3 text-left">Session ID</th>
                        <th className="px-4 py-3 text-left">Doc Type</th>
                        <th className="px-4 py-3 text-left">Liveness</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {kycQ.isLoading ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            Loading…
                          </td>
                        </tr>
                      ) : kycQ.data?.items.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            No KYC applications
                          </td>
                        </tr>
                      ) : (
                        kycQ.data?.items.map((k: any) => (
                          <tr
                            key={k.id}
                            className="border-b border-border/50 hover:bg-accent/30"
                          >
                            <td className="px-4 py-3 font-mono text-xs">
                              {k.sessionId}
                            </td>
                            <td className="px-4 py-3 text-xs capitalize">
                              {(k.docType ?? "").replace(/_/g, " ") || "—"}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {k.livenessScore != null
                                ? `${(Number(k.livenessScore) * 100).toFixed(0)}%`
                                : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                className={`text-xs ${
                                  k.status === "completed"
                                    ? "bg-green-900/50 text-green-400 border-green-800"
                                    : k.status === "rejected"
                                      ? "bg-red-900/50 text-red-400 border-red-800"
                                      : "bg-yellow-900/50 text-yellow-400 border-yellow-800"
                                }`}
                              >
                                {k.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">
                              {k.status === "pending" && (
                                <div className="flex gap-1.5">
                                  <Button
                                    size="sm"
                                    className="h-7 px-2 text-xs gap-1 bg-green-700 hover:bg-green-600 text-white"
                                    onClick={() =>
                                      reviewKyc.mutate({
                                        id: k.id,
                                        status: "completed",
                                        note: "Approved via management portal",
                                      })
                                    }
                                    disabled={reviewKyc.isPending}
                                  >
                                    <CheckCircle size={11} /> Approve
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    className="h-7 px-2 text-xs gap-1"
                                    onClick={() =>
                                      reviewKyc.mutate({
                                        id: k.id,
                                        status: "rejected",
                                        note: "Rejected via management portal",
                                      })
                                    }
                                    disabled={reviewKyc.isPending}
                                  >
                                    <XCircle size={11} /> Reject
                                  </Button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}

          {/* ── Commissions ── */}
          {tab === "commissions" && (
            <>
              <h2 className="text-2xl font-bold">Commission Rules</h2>
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground text-xs uppercase">
                        <th className="px-4 py-3 text-left">
                          Transaction Type
                        </th>
                        <th className="px-4 py-3 text-left">Rule Type</th>
                        <th className="px-4 py-3 text-left">Rate / Flat</th>
                        <th className="px-4 py-3 text-left">Min Tx</th>
                        <th className="px-4 py-3 text-left">Max Tx</th>
                        <th className="px-4 py-3 text-left">Active</th>
                      </tr>
                    </thead>
                    <tbody>
                      {commQ.isLoading ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            Loading…
                          </td>
                        </tr>
                      ) : (commQ.data ?? []).length === 0 ? (
                        <tr>
                          <td
                            colSpan={6}
                            className="px-4 py-8 text-center text-muted-foreground"
                          >
                            No commission rules
                          </td>
                        </tr>
                      ) : (
                        (commQ.data ?? []).map((r: any) => (
                          <tr key={r.id} className="border-b border-border/50">
                            <td className="px-4 py-3 text-xs capitalize">
                              {(r.txType ?? "").replace(/_/g, " ")}
                            </td>
                            <td className="px-4 py-3 text-xs">{r.ruleType}</td>
                            <td className="px-4 py-3 text-xs font-mono">
                              {r.ruleType === "percentage"
                                ? `${r.rate}%`
                                : fmt(r.flatAmount ?? 0)}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {r.minTxAmount ? fmt(r.minTxAmount) : "—"}
                            </td>
                            <td className="px-4 py-3 text-xs">
                              {r.maxTxAmount ? fmt(r.maxTxAmount) : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                className={`text-xs ${r.isActive ? "bg-green-900/50 text-green-400 border-green-800" : "bg-muted text-muted-foreground"}`}
                              >
                                {r.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            </>
          )}

          {/* ── Settings ── */}
          {tab === "settings" && (
            <>
              <h2 className="text-2xl font-bold">Platform Settings</h2>
              {settingsQ.isLoading ? (
                <p className="text-muted-foreground text-sm">
                  Loading settings…
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {settingsQ.data &&
                    Object.entries(settingsQ.data).map(([key, value]) => (
                      <Card key={key}>
                        <CardContent className="p-4">
                          <Label className="text-xs text-muted-foreground uppercase tracking-wide">
                            {key}
                          </Label>
                          <div className="flex gap-2 mt-2">
                            <Input
                              defaultValue={String(value)}
                              className="text-sm h-8"
                              id={`setting-${key}`}
                            />
                            <Button
                              size="sm"
                              className="h-8 px-3 text-xs"
                              onClick={() => {
                                const el = document.getElementById(
                                  `setting-${key}`
                                ) as HTMLInputElement;
                                if (el)
                                  updateSetting.mutate({
                                    key,
                                    value: el.value,
                                  });
                              }}
                              disabled={updateSetting.isPending}
                            >
                              Save
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  {!settingsQ.data && (
                    <p className="text-muted-foreground text-sm col-span-2">
                      No platform settings configured.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Edit Agent Dialog */}
      <Dialog open={!!editAgent} onOpenChange={o => !o && setEditAgent(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Agent — {editAgent?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label className="text-xs text-muted-foreground">Tier</Label>
              <Select value={editTier} onValueChange={setEditTier}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["Bronze", "Silver", "Gold", "Platinum"].map((t: any) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="agent-active"
                checked={editActive}
                onChange={e => setEditActive(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <Label htmlFor="agent-active" className="text-sm">
                Active
              </Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditAgent(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                updateAgent.mutate({
                  id: editAgent.id,
                  tier: editTier as any,
                  isActive: editActive,
                })
              }
              disabled={updateAgent.isPending}
            >
              {updateAgent.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
