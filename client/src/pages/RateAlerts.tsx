/**
 * Rate Alerts — Create, manage, and monitor exchange rate threshold alerts
 * Wired to rateAlerts tRPC router
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  Plus,
  Trash2,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Pause,
  Play,
  RotateCcw,
  TrendingUp,
  AlertTriangle,
  Clock,
  Activity,
  Search,
} from "lucide-react";
import { toast } from "sonner";

const CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "NZD",
  "CNY",
  "INR",
  "NGN",
  "KES",
  "GHS",
  "ZAR",
  "EGP",
  "TZS",
  "UGX",
  "RWF",
  "XOF",
  "XAF",
  "BRL",
  "MXN",
  "ARS",
  "COP",
  "PEN",
  "CLP",
  "SGD",
  "HKD",
  "KRW",
  "THB",
];

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  paused: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  triggered: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  expired: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

export default function RateAlerts() {
  const [filter, setFilter] = useState<
    "all" | "active" | "paused" | "triggered" | "expired"
  >("all");
  const [search, setSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  // Form state
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [targetCurrency, setTargetCurrency] = useState("NGN");
  const [targetRate, setTargetRate] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [note, setNote] = useState("");

  const utils = trpc.useUtils();

  // F-12 (verifier): real list input is {limit, offset, search}; the return
  // is {data, total} — the pageSize/.items drift is repaired below.
  const { data: alertsData, isLoading } = trpc.rateAlerts.list.useQuery({
    limit: 50,
  });

  const { data: stats } = trpc.rateAlerts.getStats.useQuery();

  const createAlert = trpc.rateAlerts.create.useMutation({
    onSuccess: () => {
      toast.success("Rate alert created");
      setShowCreate(false);
      setTargetRate("");
      setNote("");
      utils.rateAlerts.list.invalidate();
      utils.rateAlerts.getStats.invalidate();
    },
    onError: (e: any) => toast.error("Failed: " + e.message),
  });

  const toggleAlert = trpc.rateAlerts.toggle.useMutation({
    onSuccess: () => {
      utils.rateAlerts.list.invalidate();
      utils.rateAlerts.getStats.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const rearmAlert = trpc.rateAlerts.rearm.useMutation({
    onSuccess: () => {
      toast.success("Alert re-armed");
      utils.rateAlerts.list.invalidate();
      utils.rateAlerts.getStats.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteAlert = trpc.rateAlerts.delete.useMutation({
    onSuccess: () => {
      toast.success("Alert deleted");
      utils.rateAlerts.list.invalidate();
      utils.rateAlerts.getStats.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const runCheck = trpc.rateAlerts.runCheck.useMutation({
    onSuccess: (d: any) => {
      toast.success(
        `Check complete: ${d.checked} checked, ${d.triggered} triggered`
      );
      utils.rateAlerts.list.invalidate();
      utils.rateAlerts.getStats.invalidate();
      utils.rateAlerts.getCheckerStatus.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const alerts = useMemo(() => {
    if (!alertsData?.data) return [];
    if (!search) return alertsData.data;
    const q = search.toLowerCase();
    return alertsData.data.filter(
      (a: any) =>
        a.baseCurrency.toLowerCase().includes(q) ||
        a.targetCurrency.toLowerCase().includes(q) ||
        (a.note && a.note.toLowerCase().includes(q))
    );
  }, [alertsData, search]);

  const handleCreate = () => {
    if (!targetRate || isNaN(parseFloat(targetRate))) {
      toast.error("Please enter a valid target rate");
      return;
    }
    // F-12 (wave-4b): agentId comes from the session server-side — the
    // previous demo-agent fields were fabricated.
    createAlert.mutate({
      baseCurrency,
      targetCurrency,
      targetRate: parseFloat(targetRate),
      direction,
      note: note || undefined,
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6 text-blue-400" /> Rate Alerts
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Get notified when exchange rates cross your target thresholds
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            className="border-slate-600 text-slate-300"
            onClick={() => runCheck.mutate()}
            disabled={runCheck.isPending}
          >
            <RefreshCw
              className={`w-3 h-3 mr-1 ${runCheck.isPending ? "animate-spin" : ""}`}
            />
            Check Now
          </Button>
          <Button
            size="sm"
            className="bg-blue-600 hover:bg-blue-700"
            onClick={() => setShowCreate(!showCreate)}
          >
            <Plus className="w-3 h-3 mr-1" /> New Alert
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          {
            label: "Total",
            value: stats?.total ?? 0,
            icon: <Activity className="w-4 h-4" />,
            color: "text-slate-300",
          },
          {
            label: "Active",
            value: stats?.active ?? 0,
            icon: <Play className="w-4 h-4" />,
            color: "text-emerald-400",
          },
          {
            label: "Paused",
            value: stats?.paused ?? 0,
            icon: <Pause className="w-4 h-4" />,
            color: "text-amber-400",
          },
          {
            label: "Triggered",
            value: stats?.triggered ?? 0,
            icon: <Bell className="w-4 h-4" />,
            color: "text-blue-400",
          },
          {
            label: "Expired",
            value: stats?.expired ?? 0,
            icon: <Clock className="w-4 h-4" />,
            color: "text-slate-500",
          },
        ].map((s: any) => (
          <Card key={s.label} className="bg-slate-900/50 border-slate-700">
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-500">{s.label}</span>
                <span className={s.color}>{s.icon}</span>
              </div>
              <div className={`text-xl font-bold mt-1 ${s.color}`}>
                {s.value}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Checker Status — F-12 (wave-4b): checker status is fail-loud
          NOT_IMPLEMENTED (no delivered checker worker); badge omitted. */}

      {/* Create Form */}
      {showCreate && (
        <Card className="bg-slate-900/50 border-blue-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-white">
              Create Rate Alert
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">
                  Base Currency
                </label>
                <select
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white"
                  value={baseCurrency}
                  onChange={e => setBaseCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c: any) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">
                  Target Currency
                </label>
                <select
                  className="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white"
                  value={targetCurrency}
                  onChange={e => setTargetCurrency(e.target.value)}
                >
                  {CURRENCIES.map((c: any) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">
                  Target Rate
                </label>
                <Input
                  type="number"
                  step="0.0001"
                  placeholder="e.g. 1600.00"
                  value={targetRate}
                  onChange={e => setTargetRate(e.target.value)}
                  className="bg-slate-800 border-slate-600 text-white"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">
                  Direction
                </label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={direction === "above" ? "default" : "outline"}
                    className={
                      direction === "above"
                        ? "bg-emerald-600 flex-1"
                        : "border-slate-600 text-slate-400 flex-1"
                    }
                    onClick={() => setDirection("above")}
                  >
                    <ArrowUp className="w-3 h-3 mr-1" /> Above
                  </Button>
                  <Button
                    size="sm"
                    variant={direction === "below" ? "default" : "outline"}
                    className={
                      direction === "below"
                        ? "bg-red-600 flex-1"
                        : "border-slate-600 text-slate-400 flex-1"
                    }
                    onClick={() => setDirection("below")}
                  >
                    <ArrowDown className="w-3 h-3 mr-1" /> Below
                  </Button>
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">
                Note (optional)
              </label>
              <Input
                placeholder="e.g. Sell USD when rate is high"
                value={note}
                onChange={e => setNote(e.target.value)}
                className="bg-slate-800 border-slate-600 text-white"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-slate-600 text-slate-400"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-blue-600 hover:bg-blue-700"
                onClick={handleCreate}
                disabled={createAlert.isPending}
              >
                {createAlert.isPending ? "Creating..." : "Create Alert"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <Input
            placeholder="Search by currency or note..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 bg-slate-900 border-slate-700 text-white text-sm"
          />
        </div>
        <div className="flex gap-1">
          {(["all", "active", "paused", "triggered", "expired"] as const).map(
            (s: any) => (
              <Button
                key={s}
                size="sm"
                variant={filter === s ? "default" : "outline"}
                className={
                  filter === s
                    ? "bg-blue-600"
                    : "border-slate-700 text-slate-400"
                }
                onClick={() => setFilter(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            )
          )}
        </div>
      </div>

      {/* Alerts List */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-500">
          Loading alerts...
        </div>
      ) : alerts.length === 0 ? (
        <Card className="bg-slate-900/50 border-slate-700">
          <CardContent className="py-12 text-center">
            <AlertTriangle className="w-8 h-8 text-slate-600 mx-auto mb-3" />
            <p className="text-slate-500">No rate alerts found</p>
            <Button
              size="sm"
              className="mt-3 bg-blue-600"
              onClick={() => setShowCreate(true)}
            >
              <Plus className="w-3 h-3 mr-1" /> Create Your First Alert
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert: any) => (
            <Card
              key={alert.id}
              className="bg-slate-900/50 border-slate-700 hover:border-slate-600 transition-colors"
            >
              <CardContent className="p-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                        alert.direction === "above"
                          ? "bg-emerald-500/20"
                          : "bg-red-500/20"
                      }`}
                    >
                      {alert.direction === "above" ? (
                        <TrendingUp className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <ArrowDown className="w-5 h-5 text-red-400" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-white">
                          {alert.baseCurrency}/{alert.targetCurrency}
                        </span>
                        <Badge
                          variant="outline"
                          className={STATUS_COLORS[alert.status]}
                        >
                          {alert.status}
                        </Badge>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Alert when rate goes{" "}
                        <span
                          className={
                            alert.direction === "above"
                              ? "text-emerald-400"
                              : "text-red-400"
                          }
                        >
                          {alert.direction}
                        </span>{" "}
                        <span className="text-white font-medium">
                          {alert.targetRate}
                        </span>
                        {alert.currentRate && (
                          <span className="ml-2">
                            Current:{" "}
                            <span className="text-blue-400">
                              {Number(alert.currentRate).toFixed(4)}
                            </span>
                          </span>
                        )}
                      </div>
                      {alert.note && (
                        <div className="text-xs text-slate-600 mt-0.5">
                          {alert.note}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    {alert.status === "active" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-amber-400 hover:text-amber-300 h-8 w-8 p-0"
                        onClick={() => toggleAlert.mutate({ id: alert.id })}
                        title="Pause"
                      >
                        <Pause className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {alert.status === "paused" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-emerald-400 hover:text-emerald-300 h-8 w-8 p-0"
                        onClick={() => toggleAlert.mutate({ id: alert.id })}
                        title="Resume"
                      >
                        <Play className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    {alert.status === "triggered" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-blue-400 hover:text-blue-300 h-8 w-8 p-0"
                        onClick={() => rearmAlert.mutate({ id: alert.id })}
                        title="Re-arm"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-red-400 hover:text-red-300 h-8 w-8 p-0"
                      onClick={() => deleteAlert.mutate({ id: alert.id })}
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Triggered info */}
                {alert.status === "triggered" && alert.triggeredAt && (
                  <div className="mt-2 pt-2 border-t border-slate-700/50 flex items-center gap-4 text-xs">
                    <span className="text-blue-400">
                      Triggered: {new Date(alert.triggeredAt).toLocaleString()}
                    </span>
                    {alert.notifiedVia && alert.notifiedVia.length > 0 && (
                      <span className="text-slate-500">
                        Notified via: {alert.notifiedVia.join(", ")}
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

    </div>
  );
}
