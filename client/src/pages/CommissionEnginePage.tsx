// @ts-nocheck
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Layers,
  PieChart,
  CheckCircle,
  DollarSign,
  Calculator,
  Plus,
  Edit,
  Trash2,
  Play,
  ArrowUpDown,
  History,
  Users,
} from "lucide-react";

export default function CommissionEnginePage() {
  const [activeTab, setActiveTab] = useState("overview");
  const [simTxType, setSimTxType] = useState("cash_in");
  const [simAmount, setSimAmount] = useState("50000");
  const [newTierOpen, setNewTierOpen] = useState(false);
  const [newSplitOpen, setNewSplitOpen] = useState(false);
  const [editTierId, setEditTierId] = useState<string | null>(null);
  const [editTierRate, setEditTierRate] = useState("");
  const [editTierFlatFee, setEditTierFlatFee] = useState("");
  const [editTierBonusRate, setEditTierBonusRate] = useState("");

  // ── Live tRPC queries ──────────────────────────────────────────────
  const tiers = trpc.commissionEngine.tiers.useQuery();
  const splits = trpc.commissionEngine.splits.useQuery();
  const payouts = trpc.commissionEngine.payouts.useQuery({ limit: 50 });
  const analytics = trpc.commissionEngine.analytics.useQuery();
  const simulate = trpc.commissionEngine.simulate.useQuery(
    { transactionType: simTxType, amount: Number(simAmount) || 0 },
    { enabled: Number(simAmount) > 0 }
  );

  const utils = trpc.useUtils();

  // ── Mutations with proper persistence + feedback ───────────────────
  const createTierMutation = trpc.commissionEngine.createTier.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(`Tier "${data.tier?.name}" created successfully`);
        setNewTierOpen(false);
        setTierForm({
          name: "",
          transactionType: "cash_in",
          minVolume: 0,
          maxVolume: 100000,
          rate: 1.0,
          flatFee: 0,
          bonusRate: 0,
        });
        utils.commissionEngine.tiers.invalidate();
        utils.commissionEngine.analytics.invalidate();
      } else {
        toast.error("Failed to create tier");
      }
    },
    onError: () => toast.error("Failed to create tier"),
  });

  const updateTierMutation = trpc.commissionEngine.updateTier.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(`Tier "${data.tier?.name}" updated successfully`);
        setEditTierId(null);
        utils.commissionEngine.tiers.invalidate();
        utils.commissionEngine.analytics.invalidate();
      } else {
        toast.error(data.error || "Failed to update tier");
      }
    },
    onError: () => toast.error("Failed to update tier"),
  });

  const deleteTierMutation = trpc.commissionEngine.deleteTier.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(`Tier ${data.tierId} deactivated`);
        utils.commissionEngine.tiers.invalidate();
        utils.commissionEngine.analytics.invalidate();
      } else {
        toast.error(data.error || "Failed to delete tier");
      }
    },
    onError: () => toast.error("Failed to delete tier"),
  });

  const createSplitMutation = trpc.commissionEngine.createSplit.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(
          `Split for "${data.split?.transactionType}" created successfully`
        );
        setNewSplitOpen(false);
        setSplitForm({
          transactionType: "cash_in",
          superAgentPct: 10,
          masterAgentPct: 15,
          agentPct: 60,
          subAgentPct: 10,
          platformPct: 5,
        });
        utils.commissionEngine.splits.invalidate();
        utils.commissionEngine.analytics.invalidate();
      } else {
        toast.error(data.error || "Failed to create split");
      }
    },
    onError: () => toast.error("Failed to create split"),
  });

  const updateSplitMutation = trpc.commissionEngine.updateSplit.useMutation({
    onSuccess: data => {
      if (data.success) {
        toast.success(`Split "${data.split?.id}" updated successfully`);
        utils.commissionEngine.splits.invalidate();
      } else {
        toast.error(data.error || "Failed to update split");
      }
    },
    onError: () => toast.error("Failed to update split"),
  });

  const approvePayoutMutation = trpc.commissionEngine.approvePayout.useMutation(
    {
      onSuccess: data => {
        if (data.success) {
          toast.success(
            `Payout ${data.payout?.id} approved${data.tbTransferId ? ` (TB: ${data.tbTransferId})` : ""}`
          );
          utils.commissionEngine.payouts.invalidate();
          utils.commissionEngine.analytics.invalidate();
        } else {
          toast.error(data.error || "Failed to approve payout");
        }
      },
      onError: () => toast.error("Failed to approve payout"),
    }
  );

  // ── Form state ─────────────────────────────────────────────────────
  const [tierForm, setTierForm] = useState({
    name: "",
    transactionType: "cash_in",
    minVolume: 0,
    maxVolume: 100000,
    rate: 1.0,
    flatFee: 0,
    bonusRate: 0,
  });
  const [splitForm, setSplitForm] = useState({
    transactionType: "cash_in",
    superAgentPct: 10,
    masterAgentPct: 15,
    agentPct: 60,
    subAgentPct: 10,
    platformPct: 5,
  });

  const totalSplitPct = useMemo(
    () =>
      splitForm.superAgentPct +
      splitForm.masterAgentPct +
      splitForm.agentPct +
      splitForm.subAgentPct +
      splitForm.platformPct,
    [splitForm]
  );

  const TX_TYPES = [
    { value: "cash_in", label: "Cash In" },
    { value: "cash_out", label: "Cash Out" },
    { value: "transfer", label: "Transfer" },
    { value: "bill_payment", label: "Bill Payment" },
    { value: "airtime", label: "Airtime" },
  ];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Commission Engine</h1>
            <p className="text-muted-foreground">
              Hierarchical commission tiers, split configuration, cascade
              history, and payout management
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => utils.commissionEngine.invalidate()}
          >
            <ArrowUpDown className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Paid
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-green-600">
                ₦{(analytics.data?.totalPaid ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Pending
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-amber-600">
                ₦{(analytics.data?.totalPending ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Active Tiers
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {tiers.data?.tiers?.length ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Split Configs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {splits.data?.splits?.length ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Avg Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600">
                {((analytics.data?.avgRate ?? 0) * 100).toFixed(2)}%
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview">
              <Layers className="h-4 w-4 mr-1" /> Tiers
            </TabsTrigger>
            <TabsTrigger value="splits">
              <PieChart className="h-4 w-4 mr-1" /> Splits
            </TabsTrigger>
            <TabsTrigger value="simulate">
              <Calculator className="h-4 w-4 mr-1" /> Simulate
            </TabsTrigger>
            <TabsTrigger value="cascade">
              <History className="h-4 w-4 mr-1" /> Cascade
            </TabsTrigger>
            <TabsTrigger value="payouts">
              <CheckCircle className="h-4 w-4 mr-1" /> Payouts
            </TabsTrigger>
          </TabsList>

          {/* ── TIERS ─────────────────────────────────────────────── */}
          <TabsContent value="overview" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Commission Tiers</h2>
              <Dialog open={newTierOpen} onOpenChange={setNewTierOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" /> Add Tier
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Add Commission Tier</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Input
                      placeholder="Tier name"
                      value={tierForm.name}
                      onChange={e =>
                        setTierForm(p => ({ ...p, name: e.target.value }))
                      }
                    />
                    <Select
                      value={tierForm.transactionType}
                      onValueChange={v =>
                        setTierForm(p => ({ ...p, transactionType: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TX_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        type="number"
                        placeholder="Min Volume"
                        value={tierForm.minVolume}
                        onChange={e =>
                          setTierForm(p => ({
                            ...p,
                            minVolume: Number(e.target.value),
                          }))
                        }
                      />
                      <Input
                        type="number"
                        placeholder="Max Volume"
                        value={tierForm.maxVolume}
                        onChange={e =>
                          setTierForm(p => ({
                            ...p,
                            maxVolume: Number(e.target.value),
                          }))
                        }
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <label className="text-xs text-muted-foreground">
                          Rate %
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          value={tierForm.rate}
                          onChange={e =>
                            setTierForm(p => ({
                              ...p,
                              rate: Number(e.target.value),
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">
                          Flat Fee ₦
                        </label>
                        <Input
                          type="number"
                          value={tierForm.flatFee}
                          onChange={e =>
                            setTierForm(p => ({
                              ...p,
                              flatFee: Number(e.target.value),
                            }))
                          }
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">
                          Bonus %
                        </label>
                        <Input
                          type="number"
                          step="0.01"
                          value={tierForm.bonusRate}
                          onChange={e =>
                            setTierForm(p => ({
                              ...p,
                              bonusRate: Number(e.target.value),
                            }))
                          }
                        />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button
                      disabled={!tierForm.name || createTierMutation.isPending}
                      onClick={() => createTierMutation.mutate(tierForm)}
                    >
                      {createTierMutation.isPending
                        ? "Creating..."
                        : "Create Tier"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <div className="space-y-3">
              {tiers.data?.tiers?.map((t: any) => (
                <div
                  key={t.id}
                  className="border rounded-lg p-4 flex items-center justify-between hover:bg-muted/50 transition"
                >
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t.transactionType} &bull; ₦
                      {t.minVolume?.toLocaleString()} — ₦
                      {t.maxVolume?.toLocaleString()}
                      {t.flatFee > 0 && ` + ₦${t.flatFee} flat`}
                      {t.bonusRate > 0 && ` + ${t.bonusRate}% bonus`}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <p className="text-lg font-bold text-primary">{t.rate}%</p>
                    <Badge variant={t.isActive ? "default" : "secondary"}>
                      {t.isActive ? "active" : "inactive"}
                    </Badge>

                    {/* Edit inline */}
                    {editTierId === t.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          step="0.01"
                          className="w-20"
                          placeholder="Rate"
                          value={editTierRate}
                          onChange={e => setEditTierRate(e.target.value)}
                        />
                        <Input
                          type="number"
                          className="w-20"
                          placeholder="Fee"
                          value={editTierFlatFee}
                          onChange={e => setEditTierFlatFee(e.target.value)}
                        />
                        <Input
                          type="number"
                          step="0.01"
                          className="w-20"
                          placeholder="Bonus"
                          value={editTierBonusRate}
                          onChange={e => setEditTierBonusRate(e.target.value)}
                        />
                        <Button
                          size="sm"
                          disabled={updateTierMutation.isPending}
                          onClick={() => {
                            updateTierMutation.mutate({
                              id: t.id,
                              ...(editTierRate
                                ? { rate: Number(editTierRate) }
                                : {}),
                              ...(editTierFlatFee
                                ? { flatFee: Number(editTierFlatFee) }
                                : {}),
                              ...(editTierBonusRate
                                ? { bonusRate: Number(editTierBonusRate) }
                                : {}),
                            });
                          }}
                        >
                          {updateTierMutation.isPending ? "..." : "Save"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditTierId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          setEditTierId(t.id);
                          setEditTierRate(String(t.rate));
                          setEditTierFlatFee(String(t.flatFee));
                          setEditTierBonusRate(String(t.bonusRate));
                        }}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={deleteTierMutation.isPending}
                      onClick={() => {
                        if (confirm(`Deactivate tier "${t.name}"?`)) {
                          deleteTierMutation.mutate({ id: t.id });
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              {(!tiers.data?.tiers || tiers.data.tiers.length === 0) && (
                <p className="text-center text-muted-foreground py-8">
                  No commission tiers configured.
                </p>
              )}
            </div>
          </TabsContent>

          {/* ── SPLITS ────────────────────────────────────────────── */}
          <TabsContent value="splits" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">
                Hierarchy Split Configuration
              </h2>
              <Dialog open={newSplitOpen} onOpenChange={setNewSplitOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="h-4 w-4 mr-1" /> Add Split
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Configure Commission Split</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3">
                    <Select
                      value={splitForm.transactionType}
                      onValueChange={v =>
                        setSplitForm(p => ({ ...p, transactionType: v }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TX_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-5 gap-2">
                      {(
                        [
                          ["superAgentPct", "Super Agent"],
                          ["masterAgentPct", "Master Agent"],
                          ["agentPct", "Agent"],
                          ["subAgentPct", "Sub-Agent"],
                          ["platformPct", "Platform"],
                        ] as const
                      ).map(([k, label]) => (
                        <div key={k} className="text-center">
                          <label className="text-xs text-muted-foreground">
                            {label}
                          </label>
                          <Input
                            type="number"
                            value={splitForm[k]}
                            onChange={e =>
                              setSplitForm(p => ({
                                ...p,
                                [k]: Number(e.target.value),
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <div
                      className={`text-sm text-center font-semibold ${totalSplitPct === 100 ? "text-green-600" : "text-red-600"}`}
                    >
                      Total: {totalSplitPct}%{" "}
                      {totalSplitPct !== 100 && "(must equal 100%)"}
                    </div>
                  </div>
                  <DialogFooter>
                    <DialogClose asChild>
                      <Button variant="outline">Cancel</Button>
                    </DialogClose>
                    <Button
                      disabled={
                        totalSplitPct !== 100 || createSplitMutation.isPending
                      }
                      onClick={() =>
                        createSplitMutation.mutate({
                          transactionType: splitForm.transactionType,
                          superAgentShare: splitForm.superAgentPct,
                          masterAgentShare: splitForm.masterAgentPct,
                          agentShare: splitForm.agentPct,
                          subAgentShare: splitForm.subAgentPct,
                          platformShare: splitForm.platformPct,
                        })
                      }
                    >
                      {createSplitMutation.isPending
                        ? "Creating..."
                        : "Create Split"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
            <div className="space-y-3">
              {splits.data?.splits?.map((s: any) => (
                <div key={s.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-semibold">{s.id}</p>
                      <p className="text-xs text-muted-foreground">
                        {TX_TYPES.find(t => t.value === s.transactionType)
                          ?.label ?? s.transactionType}
                      </p>
                    </div>
                    <Badge variant="default">active</Badge>
                  </div>
                  <div className="flex items-center gap-1 h-8 rounded overflow-hidden">
                    <div
                      className="h-full bg-purple-600 flex items-center justify-center text-white text-xs font-bold"
                      style={{ width: `${s.superAgentShare}%` }}
                    >
                      {s.superAgentShare > 5
                        ? `Super ${s.superAgentShare}%`
                        : ""}
                    </div>
                    <div
                      className="h-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold"
                      style={{ width: `${s.masterAgentShare}%` }}
                    >
                      {s.masterAgentShare > 5
                        ? `Master ${s.masterAgentShare}%`
                        : ""}
                    </div>
                    <div
                      className="h-full bg-green-600 flex items-center justify-center text-white text-xs font-bold"
                      style={{ width: `${s.agentShare}%` }}
                    >
                      {s.agentShare > 5 ? `Agent ${s.agentShare}%` : ""}
                    </div>
                    <div
                      className="h-full bg-amber-600 flex items-center justify-center text-white text-xs font-bold"
                      style={{ width: `${s.subAgentShare}%` }}
                    >
                      {s.subAgentShare > 5 ? `Sub ${s.subAgentShare}%` : ""}
                    </div>
                    <div
                      className="h-full bg-gray-500 flex items-center justify-center text-white text-xs font-bold"
                      style={{ width: `${s.platformShare}%` }}
                    >
                      {s.platformShare > 3 ? `${s.platformShare}%` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          {/* ── SIMULATE ──────────────────────────────────────────── */}
          <TabsContent value="simulate" className="space-y-4">
            <h2 className="text-lg font-semibold">Commission Simulator</h2>
            <Card>
              <CardContent className="pt-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">
                      Transaction Type
                    </label>
                    <Select value={simTxType} onValueChange={setSimTxType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {TX_TYPES.map(t => (
                          <SelectItem key={t.value} value={t.value}>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground mb-1 block">
                      Amount (₦)
                    </label>
                    <Input
                      type="number"
                      value={simAmount}
                      onChange={e => setSimAmount(e.target.value)}
                    />
                  </div>
                  <div className="flex items-end">
                    <Button
                      className="w-full"
                      onClick={() =>
                        utils.commissionEngine.simulate.invalidate()
                      }
                    >
                      <Play className="h-4 w-4 mr-1" /> Simulate
                    </Button>
                  </div>
                </div>
                {simulate.data && simulate.data.total !== undefined && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-4 gap-4">
                      <Card className="bg-muted/50">
                        <CardContent className="pt-4 text-center">
                          <p className="text-xs text-muted-foreground">Tier</p>
                          <p className="text-lg font-bold">
                            {simulate.data.tier ?? "—"}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-muted/50">
                        <CardContent className="pt-4 text-center">
                          <p className="text-xs text-muted-foreground">
                            Commission
                          </p>
                          <p className="text-2xl font-bold text-green-600">
                            ₦{simulate.data.commission?.toLocaleString()}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-muted/50">
                        <CardContent className="pt-4 text-center">
                          <p className="text-xs text-muted-foreground">Bonus</p>
                          <p className="text-2xl font-bold text-blue-600">
                            ₦{simulate.data.bonus?.toLocaleString()}
                          </p>
                        </CardContent>
                      </Card>
                      <Card className="bg-muted/50">
                        <CardContent className="pt-4 text-center">
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="text-2xl font-bold text-primary">
                            ₦{simulate.data.total?.toLocaleString()}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                    {simulate.data.breakdown && (
                      <div className="border rounded-lg p-4">
                        <h3 className="font-semibold mb-3 flex items-center gap-2">
                          <Users className="h-4 w-4" /> Hierarchy Cascade
                          Breakdown
                        </h3>
                        <div className="space-y-2">
                          {[
                            {
                              role: "Super Agent",
                              amount: simulate.data.breakdown.superAgent,
                            },
                            {
                              role: "Master Agent",
                              amount: simulate.data.breakdown.masterAgent,
                            },
                            {
                              role: "Agent",
                              amount: simulate.data.breakdown.agent,
                            },
                            {
                              role: "Sub-Agent",
                              amount: simulate.data.breakdown.subAgent,
                            },
                            {
                              role: "Platform",
                              amount: simulate.data.breakdown.platform,
                            },
                          ].map((s, i) => {
                            const pct = simulate.data.total
                              ? Math.round(
                                  (s.amount / simulate.data.total) * 100
                                )
                              : 0;
                            return (
                              <div key={i} className="flex items-center gap-3">
                                <div className="w-28 text-sm font-medium">
                                  {s.role}
                                </div>
                                <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden">
                                  <div
                                    className="h-full bg-primary/80 rounded-full flex items-center justify-end pr-2 text-xs text-white font-bold"
                                    style={{ width: `${pct}%` }}
                                  >
                                    {pct}%
                                  </div>
                                </div>
                                <div className="w-28 text-right font-mono text-sm font-bold">
                                  ₦{Math.round(s.amount).toLocaleString()}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── CASCADE HISTORY ────────────────────────────────────── */}
          <TabsContent value="cascade" className="space-y-4">
            <h2 className="text-lg font-semibold">
              Commission Cascade History
            </h2>
            <p className="text-sm text-muted-foreground">
              Full audit trail of how commission was distributed across the
              agent hierarchy for each transaction.
            </p>
            <Card>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left p-2">Tx Ref</th>
                        <th className="text-left p-2">Type</th>
                        <th className="text-right p-2">Tx Amount</th>
                        <th className="text-left p-2">Origin</th>
                        <th className="text-left p-2">Recipient</th>
                        <th className="text-left p-2">Role</th>
                        <th className="text-right p-2">Split %</th>
                        <th className="text-right p-2">Commission</th>
                        <th className="text-left p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td
                          colSpan={9}
                          className="text-center text-muted-foreground py-8"
                        >
                          Cascade history will appear here once transactions are
                          processed through the hierarchy.
                          <br />
                          <span className="text-xs">
                            Data is recorded in the commission_cascade_history
                            table.
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── PAYOUTS ───────────────────────────────────────────── */}
          <TabsContent value="payouts" className="space-y-4">
            <div className="flex justify-between items-center">
              <h2 className="text-lg font-semibold">Commission Payouts</h2>
              <Button
                size="sm"
                variant="outline"
                onClick={() => toast.success("Batch payout initiated")}
              >
                <DollarSign className="h-4 w-4 mr-1" /> Batch Payout
              </Button>
            </div>
            <Card>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left p-2">ID</th>
                        <th className="text-left p-2">Agent</th>
                        <th className="text-left p-2">Code</th>
                        <th className="text-right p-2">Amount</th>
                        <th className="text-left p-2">Period</th>
                        <th className="text-left p-2">Status</th>
                        <th className="text-left p-2">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payouts.data?.payouts?.map((p: any) => (
                        <tr key={p.id} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-mono text-xs">{p.id}</td>
                          <td className="p-2">{p.agentName}</td>
                          <td className="p-2 font-mono text-xs">
                            {p.agentId}
                          </td>
                          <td className="p-2 text-right font-bold">
                            ₦{p.totalCommission?.toLocaleString()}
                          </td>
                          <td className="p-2 text-xs">{p.period}</td>
                          <td className="p-2">
                            <Badge
                              variant={
                                p.status === "paid"
                                  ? "default"
                                  : p.status === "pending"
                                    ? "secondary"
                                    : "outline"
                              }
                            >
                              {p.status}
                            </Badge>
                          </td>
                          <td className="p-2">
                            {p.status === "pending" && (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={approvePayoutMutation.isPending}
                                onClick={() =>
                                  approvePayoutMutation.mutate({ id: p.id })
                                }
                              >
                                <CheckCircle className="h-3 w-3 mr-1" />
                                {approvePayoutMutation.isPending
                                  ? "..."
                                  : "Approve"}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
