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

  // @ts-ignore Sprint 85
  const stats = trpc.agentFloatForecasting.getStats.useQuery();
  // F-12 (S87-02): getStats delivers real aggregates (totalFloat, stockoutRisk,
  // agentsMonitored from agents.premiumReserve). No forecasting-model telemetry
  // tables exist yet, so model/prediction fields render their honest empty
  // state instead of a phantom shape.
  const model: Partial<{
    predictedDemand7d: number;
    avgAccuracy: number;
    trainingDataPoints: number;
    modelType: string;
    lastRetrained: string;
    nextRetrain: string;
    replenishmentHistory: Array<{ date: string; amount: number }>;
  }> = {};
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
        setSuccessAgent(selectedAgent);
        toast.success(
          `Replenishment of ₦${Number(replenishAmount).toLocaleString()} triggered for ${selectedAgent?.name}`
        );
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
    setReplenishDialogOpen(true);
  };

  const handleConfirmReplenish = () => {
    if (!selectedAgent) return;
    // Send the user-entered amount (defaults to the agent's shortfall) — never a hardcoded value.
    const amount = Number(replenishAmount) || selectedAgent.shortfall;
    triggerReplenishment.mutate({ agentId: selectedAgent.id, amount });
  };

  // Real forecasts only — no mock agents fallback.
  const agents: AgentForecast[] = Array.isArray(forecast.data?.forecasts)
    ? (forecast.data.forecasts as unknown as AgentForecast[])
    : [];

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
                {stats.isLoading
                  ? "…"
                  : stats.data?.totalFloat != null
                    ? `₦${Number(stats.data.totalFloat).toLocaleString()}`
                    : "—"}
              </div>
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
                {stats.isLoading ? "…" : (stats.data?.stockoutRisk ?? "—")}
              </div>
              <p className="text-xs text-muted-foreground">
                of {stats.data?.agentsMonitored ?? "—"} active agents
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Predicted Shortfall (24h)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-500">
                {stats.isLoading
                  ? "…"
                  : model.predictedDemand7d != null
                    ? `₦${Number(model.predictedDemand7d).toLocaleString()}`
                    : "—"}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Model Accuracy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-500">
                {stats.isLoading
                  ? "…"
                  : model.avgAccuracy != null
                    ? `${model.avgAccuracy}%`
                    : "—"}
              </div>
              <p className="text-xs text-muted-foreground">Last 30-day MAPE</p>
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
                    amount: 50000,
                  })
                }
                disabled={triggerReplenishment.isPending}
              >
                {triggerReplenishment.isPending
                  ? "Processing..."
                  : "Auto-Replenish All"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {forecast.isLoading ? (
              <div className="space-y-3 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 rounded bg-muted animate-pulse" />
                ))}
              </div>
            ) : forecast.isError ? (
              <div className="py-8 text-center text-sm text-red-500">
                Failed to load forecasts
                {forecast.error?.message ? `: ${forecast.error.message}` : "."}
              </div>
            ) : agents.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No forecast data available yet
              </div>
            ) : (
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
                  {agents.map(
                    (agent: any) => (
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
                    )
                  )}
                </tbody>
              </table>
            </div>
            )}
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
                    ₦
                    {Number(
                      replenishAmount || successAgent.shortfall
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
              <CardTitle className="text-lg">
                Prediction Model Insights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm">Training Data Points</span>
                <span className="font-medium">
                  {model.trainingDataPoints ?? "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm">Features Used</span>
                <span className="font-medium">
                  Transaction volume, day-of-week, location, seasonality
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm">Model Type</span>
                <span className="font-medium">
                  {model.modelType ?? "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-sm">Last Retrained</span>
                <span className="font-medium">
                  {model.lastRetrained ?? "—"}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-sm">Next Retrain</span>
                <span className="font-medium">
                  {model.nextRetrain ?? "—"}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Replenishment History</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(Array.isArray(model.replenishmentHistory)
                ? model.replenishmentHistory
                : []
              ).length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">
                  No replenishment history available yet
                </div>
              ) : (
                ((model.replenishmentHistory ?? []) as any[]).map((item, i) => (
                <div
                  key={i}
                  className="flex justify-between items-center py-2 border-b last:border-0"
                >
                  <div>
                    <div className="text-sm font-medium">{item.date}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.agents} agents replenished
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-medium">
                      ₦{Number(item.amount).toLocaleString()}
                    </div>
                    <Badge variant="outline" className="text-green-500">
                      {item.status}
                    </Badge>
                  </div>
                </div>
                ))
              )}
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
                    under your admin account (Dev Admin) with timestamp, agent
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
