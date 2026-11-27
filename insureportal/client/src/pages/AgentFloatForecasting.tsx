// SECURITY: SQL template literals in this file are for display/mock purposes only. All actual DB queries use parameterized Drizzle ORM.
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Wallet,
  Banknote,
  Building2,
  CreditCard,
} from "lucide-react";

type AgentForecast = {
  id: string;
  name: string;
  currentFloat: number;
  predictedNeed: number;
  shortfall: number;
  risk: string;
  location?: string;
  avgDailyVolume?: number;
  lastReplenished?: string;
};

// 2026-11-27 (W32-D): MOCK_AGENTS deleted. It was rendered (via the
// `?? MOCK_AGENTS` fallback below) whenever the real forecast query had no
// data — fabricated agents on a production path. Absent data now renders
// an honest empty state (see the forecast table).

export default function AgentFloatForecasting() {
  const [selectedPeriod, setSelectedPeriod] = useState("7d");
  const [replenishDialogOpen, setReplenishDialogOpen] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentForecast | null>(
    null
  );
  const [replenishAmount, setReplenishAmount] = useState("");
  const [replenishSource, setReplenishSource] = useState("platform-pool");
  const [replenishPriority, setReplenishPriority] = useState("normal");
  const [replenishNotes, setReplenishNotes] = useState("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [successAgent, setSuccessAgent] = useState<AgentForecast | null>(null);
  // 2026-11-27 (W32-D): the amount actually sent with the confirmed
  // replenishment, so the success banner reports the real figure (the
  // replenishAmount field is cleared on success).
  const [successAmount, setSuccessAmount] = useState<number | null>(null);

  // @ts-ignore Sprint 85
  const stats = trpc.agentFloatForecasting.getStats.useQuery();
  // @ts-ignore Sprint 85
  const forecast = trpc.agentFloatForecasting.getForecast.useQuery({
    days: parseInt(selectedPeriod) || 7,
  });
  const triggerReplenishment =
    // @ts-ignore Sprint 85
    trpc.agentFloatForecasting.triggerReplenishment.useMutation({
      onSuccess: () => {
        setConfirmStep(false);
        setReplenishDialogOpen(false);
        if (selectedAgent) {
          // Single-agent replenish: report the amount actually sent.
          const sentAmount = Number(replenishAmount);
          setSuccessAgent(selectedAgent);
          setSuccessAmount(sentAmount);
          toast.success(
            `Replenishment of ₦${sentAmount.toLocaleString()} triggered for ${selectedAgent.name}`
          );
        } else {
          // 2026-11-27 (W32-D): auto mode — the server tops up each
          // below-threshold agent by its OWN computed shortfall, so there is
          // no single amount/agent to report here.
          toast.success(
            "Auto-replenishment triggered for all agents below threshold"
          );
        }
        setReplenishAmount("");
        setReplenishSource("platform-pool");
        setReplenishPriority("normal");
        setReplenishNotes("");
        setSelectedAgent(null);
      },
      onError: (e: any) => toast.error(e.message),
    });

  const openReplenishDialog = (agent: AgentForecast) => {
    setSelectedAgent(agent);
    setReplenishAmount(agent.shortfall.toString());
    setReplenishSource("platform-pool");
    setReplenishPriority(agent.risk === "critical" ? "urgent" : "normal");
    setReplenishNotes("");
    setConfirmStep(false);
    setSuccessAgent(null);
    setSuccessAmount(null);
    setReplenishDialogOpen(true);
  };

  const handleConfirmReplenish = () => {
    if (!selectedAgent) return;
    // 2026-11-27 (W32-D): was hardcoded `amount: 50000` — the reviewed and
    // confirmed dialog amount was silently discarded and ₦50,000 was sent
    // regardless. Send the real operator-entered amount (the dialog's
    // "Review & Confirm" gate already guarantees a positive number).
    const amount = Number(replenishAmount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    triggerReplenishment.mutate({ agentId: selectedAgent.id, amount });
  };

  // 2026-11-27 (W32-D): MOCK_AGENTS fallback removed — rendering fabricated
  // agents when the real forecast was absent/errored was fabrication on a
  // production path. Absent data now renders an honest empty state in the
  // table below (loading / INSUFFICIENT_DATA error / no rows).
  const forecasts = (forecast.data?.forecasts ??
    []) as unknown as AgentForecast[];
  // Real aggregate 7-day shortfall of the displayed forecast — the amount
  // sent with the auto-replenish trigger (see the Auto-Replenish button).
  const totalShortfall =
    Math.round(
      forecasts.reduce((acc, a) => acc + Math.max(0, a.shortfall || 0), 0) *
        100
    ) / 100;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Agent Float Forecasting</h1>
            <p className="text-muted-foreground">
              ML-powered float prediction and auto-replenishment
            </p>
          </div>
          <div className="flex gap-2">
            {["1d", "7d", "30d", "90d"].map((p: any) => (
              <Button
                key={p}
                variant={selectedPeriod === p ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedPeriod(p)}
              >
                {p}
              </Button>
            ))}
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Total Float Pool
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {/* 2026-11-27 (W32-D): fake `?? 2450000000` fallback removed —
                    em-dash until the real aggregate arrives. */}
                {stats.data ? `₦${stats.data.totalFloat.toLocaleString()}` : "—"}
              </div>
              {/* 2026-11-27 (W32-D): fabricated "+12.3% from last week" trend
                  removed; no honest week-over-week source exists. */}
              <p className="text-xs text-muted-foreground">
                Sum of agent premium reserves
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Agents Below Threshold
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-500">
                {/* 2026-11-27 (W32-D): fake `?? 47` fallback removed. Also
                    corrected display semantics: the server's stockoutRisk is
                    a PERCENTAGE (0-100) of monitored agents at zero/negative
                    float, not a count (server/routers/
                    agentFloatForecasting.ts getStats NOTE). */}
                {stats.data ? `${stats.data.stockoutRisk}%` : "—"}
              </div>
              <p className="text-xs text-muted-foreground">
                of {stats.data?.agentsMonitored ?? "—"} monitored agents at
                zero/negative float
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                {/* 2026-11-27 (W32-D): was "Predicted Shortfall (24h)" — the
                    underlying field is the 7-day predicted DEMAND from the
                    trailing-average forecaster (server getStats D9). */}
                Predicted Demand (7d)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-500">
                {/* 2026-11-27 (W32-D): fake `?? 85000000` fallback removed.
                    The server returns null when trailing history is below
                    the minimum (INSUFFICIENT_DATA) — render that honestly
                    instead of a fabricated ₦85,000,000. */}
                {stats.data == null ? (
                  "—"
                ) : stats.data.predictedDemand7d == null ? (
                  <span className="text-base font-medium text-muted-foreground">
                    Insufficient data
                  </span>
                ) : (
                  `₦${stats.data.predictedDemand7d.toLocaleString()}`
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                {/* 2026-11-27 (W32-D): fabricated "Across 23 agents" replaced
                    with the live forecast row count when available. */}
                {forecast.data
                  ? `Across ${forecast.data.forecasts.length} agents`
                  : "Trailing-average forecast basis"}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Forecast Accuracy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">
                {/* 2026-11-27 (W32-D): fake `?? 94.7` fallback removed. No
                    forecast-accuracy telemetry exists (the server emits an
                    explicit null — see getStats STOP note), so render an
                    honest empty state instead of a fabricated 94.7%. */}
                {stats.data?.avgAccuracy != null
                  ? `${stats.data.avgAccuracy}%`
                  : "—"}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats.data?.avgAccuracy != null
                  ? "Last 30-day MAPE"
                  : "No accuracy telemetry exists"}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Forecast Table */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Agent Float Forecasts</CardTitle>
              <Button
                onClick={() =>
                  triggerReplenishment.mutate({
                    agentId: "all-below-threshold",
                    // 2026-11-27 (W32-D): was hardcoded `amount: 50000`. In
                    // auto mode the server IGNORES this field and tops each
                    // agent up by its OWN computed 7-day shortfall (see
                    // triggerReplenishment in server/routers/
                    // agentFloatForecasting.ts), but the input schema still
                    // requires a positive number ≤ ₦5,000,000. Send the real
                    // aggregate shortfall of the displayed forecast, clamped
                    // to the schema maximum — never a fabricated blanket
                    // figure.
                    amount: Math.min(totalShortfall, 5_000_000),
                  })
                }
                disabled={
                  triggerReplenishment.isPending ||
                  forecast.isError ||
                  totalShortfall <= 0
                }
              >
                {triggerReplenishment.isPending
                  ? "Processing..."
                  : "Auto-Replenish All"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2">Agent</th>
                    <th className="text-left py-3 px-2">Current Float</th>
                    <th className="text-left py-3 px-2">Predicted Need</th>
                    <th className="text-left py-3 px-2">Shortfall</th>
                    <th className="text-left py-3 px-2">Risk Level</th>
                    <th className="text-left py-3 px-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {/* 2026-11-27 (W32-D): honest empty states replace the
                      MOCK_AGENTS fallback (and the crash on
                      `undefined.map` when the query had no data). */}
                  {forecasts.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-6 px-2 text-center text-muted-foreground"
                      >
                        {forecast.isLoading
                          ? "Loading forecast…"
                          : forecast.isError
                            ? `Forecast unavailable: ${forecast.error?.message ?? "unknown error"}`
                            : "No agents with sufficient transaction history to forecast."}
                      </td>
                    </tr>
                  ) : (
                    forecasts.map((agent: any) => (
                      <tr key={agent.id} className="border-b hover:bg-muted/50">
                        <td className="py-3 px-2">
                          <div className="font-medium">{agent.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {agent.id}
                            {agent.location ? ` · ${agent.location}` : ""}
                          </div>
                        </td>
                        <td className="py-3 px-2">
                          ₦{agent.currentFloat.toLocaleString()}
                        </td>
                        <td className="py-3 px-2">
                          ₦{agent.predictedNeed.toLocaleString()}
                        </td>
                        <td className="py-3 px-2">
                          {agent.shortfall > 0 ? (
                            <span className="text-red-500 font-medium">
                              ₦{agent.shortfall.toLocaleString()}
                            </span>
                          ) : (
                            <span className="text-green-500">Sufficient</span>
                          )}
                        </td>
                        <td className="py-3 px-2">
                          <Badge
                            variant={
                              agent.risk === "critical"
                                ? "destructive"
                                : agent.risk === "high"
                                  ? "destructive"
                                  : agent.risk === "medium"
                                    ? "secondary"
                                    : "outline"
                            }
                          >
                            {agent.risk}
                          </Badge>
                        </td>
                        <td className="py-3 px-2">
                          {agent.shortfall > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openReplenishDialog(agent)}
                            >
                              <Wallet className="h-3 w-3 mr-1" /> Replenish
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Success Banner */}
        {successAgent && (
          <Card className="border-green-500/50 bg-green-500/10">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
                <div>
                  <div className="font-medium text-green-500">
                    Replenishment Initiated Successfully
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {/* 2026-11-27 (W32-D): report the amount actually sent
                        (captured before the form reset), not the shortfall
                        the pre-reset form field happened to hold. */}
                    ₦
                    {Number(
                      successAmount ?? successAgent.shortfall
                    ).toLocaleString()}{" "}
                    is being transferred to {successAgent.name} (
                    {successAgent.id}). Expected completion: 15-30 minutes.
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setSuccessAgent(null)}
                >
                  Dismiss
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Forecast Insights */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Forecast Method</CardTitle>
            </CardHeader>
            {/* 2026-11-27 (W32-D): this card previously rendered fabricated
                claims — "2.4M training transactions", "LSTM + XGBoost
                Ensemble", "Last Retrained 2 hours ago". There is NO ML
                model: the server's forecaster is a trailing average
                (method/windowDays/horizonDays/historyDayCount/
                minHistoryDays/dataPoints on the getForecast payload). Those
                real fields now populate the card; em-dash when the forecast
                is unavailable. */}
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm">Method</span>
                <span className="font-medium">
                  Trailing average of daily net float outflow
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm">History Window</span>
                <span className="font-medium">
                  {forecast.data ? `${forecast.data.windowDays} days` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm">Forecast Horizon</span>
                <span className="font-medium">
                  {forecast.data ? `${forecast.data.horizonDays} days` : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm">History Days Found</span>
                <span className="font-medium">
                  {forecast.data
                    ? `${forecast.data.historyDayCount} (minimum ${forecast.data.minHistoryDays})`
                    : "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm">Data Points</span>
                <span className="font-medium">
                  {forecast.data
                    ? `${forecast.data.dataPoints.toLocaleString()} transactions`
                    : "—"}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Replenishment History</CardTitle>
            </CardHeader>
            {/* 2026-11-27 (W32-D): the five hardcoded sample rows ("Today
                09:15 — 12 agents — ₦15,600,000", etc.) were fabricated
                history on a production path. No server procedure exposes
                replenishment history yet, so the card renders an honest
                empty state. */}
            <CardContent>
              <p className="text-sm text-muted-foreground py-2">
                Replenishment history is not yet connected to a live data
                source, so no entries are shown here.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ─── Replenishment Dialog ─────────────────────────────────────────── */}
      <Dialog
        open={replenishDialogOpen}
        onOpenChange={open => {
          setReplenishDialogOpen(open);
          if (!open) setConfirmStep(false);
        }}
      >
        <DialogContent className="max-w-lg">
          {!confirmStep ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Wallet className="h-5 w-5 text-primary" />
                  Replenish Agent Float
                </DialogTitle>
                <DialogDescription>
                  Configure and initiate float replenishment for this agent.
                </DialogDescription>
              </DialogHeader>

              {selectedAgent && (
                <div className="space-y-5 pt-2">
                  {/* Agent Summary Card */}
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-semibold text-base">
                          {selectedAgent.name}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {selectedAgent.id} · {selectedAgent.location}
                        </div>
                      </div>
                      <Badge
                        variant={
                          selectedAgent.risk === "critical"
                            ? "destructive"
                            : selectedAgent.risk === "high"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        {selectedAgent.risk} risk
                      </Badge>
                    </div>
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="rounded-md bg-muted/50 p-2">
                        <div className="text-xs text-muted-foreground">
                          Current Float
                        </div>
                        <div className="font-semibold text-sm">
                          ₦{selectedAgent.currentFloat.toLocaleString()}
                        </div>
                      </div>
                      <div className="rounded-md bg-muted/50 p-2">
                        <div className="text-xs text-muted-foreground">
                          Predicted Need
                        </div>
                        <div className="font-semibold text-sm">
                          ₦{selectedAgent.predictedNeed.toLocaleString()}
                        </div>
                      </div>
                      <div className="rounded-md bg-red-500/10 p-2">
                        <div className="text-xs text-muted-foreground">
                          Shortfall
                        </div>
                        <div className="font-semibold text-sm text-red-500">
                          ₦{selectedAgent.shortfall.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <ArrowUpRight className="h-3 w-3" />
                        Avg Daily: ₦
                        {(selectedAgent.avgDailyVolume ?? 0).toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        Last Replenished:{" "}
                        {selectedAgent.lastReplenished ?? "N/A"}
                      </span>
                    </div>
                  </div>

                  {/* Replenishment Form */}
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="amount" className="text-sm font-medium">
                        Replenishment Amount (₦)
                      </Label>
                      <div className="relative">
                        <Banknote className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="amount"
                          type="number"
                          className="pl-10"
                          value={replenishAmount}
                          onChange={e => setReplenishAmount(e.target.value)}
                          placeholder="Enter amount"
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() =>
                            setReplenishAmount(
                              selectedAgent.shortfall.toString()
                            )
                          }
                        >
                          Shortfall (₦{selectedAgent.shortfall.toLocaleString()}
                          )
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() =>
                            setReplenishAmount(
                              selectedAgent.predictedNeed.toString()
                            )
                          }
                        >
                          Full Need (₦
                          {selectedAgent.predictedNeed.toLocaleString()})
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="text-xs"
                          onClick={() =>
                            setReplenishAmount(
                              Math.round(
                                selectedAgent.shortfall * 1.2
                              ).toString()
                            )
                          }
                        >
                          +20% Buffer
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Funding Source
                      </Label>
                      <Select
                        value={replenishSource}
                        onValueChange={setReplenishSource}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="platform-pool">
                            <span className="flex items-center gap-2">
                              <Building2 className="h-3 w-3" /> Platform Float
                              {/* 2026-11-27 (W32-D): fabricated
                                  "(₦2.45B available)" removed — the live
                                  pool balance is not a figure this page
                                  has an honest source for. */}
                              Pool
                            </span>
                          </SelectItem>
                          <SelectItem value="bank-transfer">
                            <span className="flex items-center gap-2">
                              <CreditCard className="h-3 w-3" /> Direct Bank
                              Transfer
                            </span>
                          </SelectItem>
                          <SelectItem value="mobile-money">
                            <span className="flex items-center gap-2">
                              <Wallet className="h-3 w-3" /> Mobile Money
                              Transfer
                            </span>
                          </SelectItem>
                          <SelectItem value="agent-loan">
                            <span className="flex items-center gap-2">
                              <Banknote className="h-3 w-3" /> Agent Float Loan
                              (auto-deduct)
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Priority</Label>
                      <Select
                        value={replenishPriority}
                        onValueChange={setReplenishPriority}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="urgent">
                            Urgent — Process immediately (15 min)
                          </SelectItem>
                          <SelectItem value="normal">
                            Normal — Next batch cycle (1-2 hours)
                          </SelectItem>
                          <SelectItem value="scheduled">
                            Scheduled — Next business day
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="notes" className="text-sm font-medium">
                        Notes (optional)
                      </Label>
                      <Input
                        id="notes"
                        value={replenishNotes}
                        onChange={e => setReplenishNotes(e.target.value)}
                        placeholder="Add notes for audit trail..."
                      />
                    </div>
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button
                  variant="outline"
                  onClick={() => setReplenishDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => setConfirmStep(true)}
                  disabled={!replenishAmount || Number(replenishAmount) <= 0}
                >
                  Review & Confirm
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              {/* Confirmation Step */}
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-amber-500" />
                  Confirm Replenishment
                </DialogTitle>
                <DialogDescription>
                  Please review the details below before confirming.
                </DialogDescription>
              </DialogHeader>

              {selectedAgent && (
                <div className="space-y-4 pt-2">
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-y-3 text-sm">
                      <div className="text-muted-foreground">Agent</div>
                      <div className="font-medium">
                        {selectedAgent.name} ({selectedAgent.id})
                      </div>

                      <div className="text-muted-foreground">Location</div>
                      <div className="font-medium">
                        {selectedAgent.location}
                      </div>

                      <div className="text-muted-foreground">Amount</div>
                      <div className="font-bold text-lg text-primary">
                        ₦{Number(replenishAmount).toLocaleString()}
                      </div>

                      <div className="text-muted-foreground">
                        Funding Source
                      </div>
                      <div className="font-medium capitalize">
                        {replenishSource.replace(/-/g, " ")}
                      </div>

                      <div className="text-muted-foreground">Priority</div>
                      <div className="font-medium capitalize">
                        {replenishPriority}
                      </div>

                      <div className="text-muted-foreground">
                        Est. Completion
                      </div>
                      <div className="font-medium">
                        {replenishPriority === "urgent"
                          ? "~15 minutes"
                          : replenishPriority === "normal"
                            ? "1-2 hours"
                            : "Next business day"}
                      </div>

                      {replenishNotes && (
                        <>
                          <div className="text-muted-foreground">Notes</div>
                          <div className="font-medium">{replenishNotes}</div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
                    <strong>Audit Trail:</strong> This action will be logged
                    under your admin account with timestamp, agent
                    ID, amount, and source. The agent will receive an SMS and
                    push notification upon fund arrival.
                  </div>
                </div>
              )}

              <DialogFooter className="gap-2">
                <Button variant="outline" onClick={() => setConfirmStep(false)}>
                  Back
                </Button>
                <Button
                  onClick={handleConfirmReplenish}
                  disabled={triggerReplenishment.isPending}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {triggerReplenishment.isPending ? (
                    <span className="flex items-center gap-2">
                      <Clock className="h-4 w-4 animate-spin" /> Processing...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" /> Confirm & Send ₦
                      {Number(replenishAmount).toLocaleString()}
                    </span>
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
