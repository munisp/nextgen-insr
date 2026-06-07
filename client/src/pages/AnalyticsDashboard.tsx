/**
 * AnalyticsDashboard.tsx
 *
 * Real-time analytics dashboard for InsurePortal InsurePortal Platform.
 * Shows:
 *  - MQTT message throughput (messages/min over time)
 *  - ERP sync success rate (pie + trend)
 *  - Live stats cards (total messages, avg throughput, sync rate, pending retries)
 *  - Auto-refresh every 30 seconds with manual refresh button
 */
import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  RefreshCw,
  Activity,
  CheckCircle2,
  XCircle,
  Clock,
  Wifi,
} from "lucide-react";
import { format } from "date-fns";

// ── Colour palette ────────────────────────────────────────────────────────────
const COLOURS = {
  sent: "#22c55e",
  buffered: "#f59e0b",
  failed: "#ef4444",
  pending: "#6366f1",
  synced: "#22c55e",
  primary: "#3b82f6",
};

const PIE_COLOURS = [COLOURS.synced, COLOURS.failed, COLOURS.pending];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtTime(ts: number) {
  return format(new Date(ts), "HH:mm");
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  colour,
}: {
  icon: React.ElementType;
  label: string;
  value: string | number;
  sub?: string;
  colour?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg flex items-center justify-center"
            style={{ backgroundColor: colour ? `${colour}20` : "#3b82f620" }}
          >
            <Icon className="w-5 h-5" style={{ color: colour ?? "#3b82f6" }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-muted-foreground truncate">{label}</p>
            <p className="text-xl font-bold leading-tight">{value}</p>
            {sub && (
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AnalyticsDashboard() {
  const [mqttMinutes, setMqttMinutes] = useState(60);
  const [erpHours, setErpHours] = useState(24);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  // ── tRPC queries ──────────────────────────────────────────────────────────
  const { data: throughputData, isLoading: loadingThroughput } =
    trpc.analytics.getMqttThroughput.useQuery(
      { minutes: mqttMinutes },
      { refetchInterval: 30_000 }
    );

  const { data: erpStats, isLoading: loadingErp } =
    trpc.analytics.getErpSyncStats.useQuery(
      { hours: erpHours },
      { refetchInterval: 30_000 }
    );

  const { data: liveStats, isLoading: loadingLive } =
    trpc.analytics.getLiveStats.useQuery(undefined, {
      refetchInterval: 15_000,
    });

  const [sentFromMs] = useState(() => Date.now() - mqttMinutes * 60 * 1000);
  const [bufferedFromMs] = useState(() => Date.now() - mqttMinutes * 60 * 1000);

  const { data: sentSeries } = trpc.analytics.getTimeSeries.useQuery(
    {
      metricName: "mqtt.messages.sent",
      fromMs: sentFromMs,
      toMs: Date.now(),
    },
    { refetchInterval: 30_000 }
  );

  const { data: bufferedSeries } = trpc.analytics.getTimeSeries.useQuery(
    {
      metricName: "mqtt.messages.buffered",
      fromMs: bufferedFromMs,
      toMs: Date.now(),
    },
    { refetchInterval: 30_000 }
  );

  // ── Merge sent + buffered into a combined chart series ────────────────────
  const combinedSeries = (() => {
    const sentMap = new Map<number, number>();
    const bufferedMap = new Map<number, number>();
    for (const p of sentSeries?.series ?? [])
      sentMap.set(new Date(p.bucket).getTime(), p.value);
    for (const p of bufferedSeries?.series ?? [])
      bufferedMap.set(new Date(p.bucket).getTime(), p.value);
    const allBuckets = Array.from(
      new Set([
        ...Array.from(sentMap.keys()),
        ...Array.from(bufferedMap.keys()),
      ])
    );
    return allBuckets
      .sort((a: any, b: any) => a - b)
      .map(ts => ({
        ts,
        label: fmtTime(ts),
        sent: sentMap.get(ts) ?? 0,
        buffered: bufferedMap.get(ts) ?? 0,
        total: (sentMap.get(ts) ?? 0) + (bufferedMap.get(ts) ?? 0),
      }));
  })();

  // ── ERP pie data ──────────────────────────────────────────────────────────
  const erpPieData = erpStats
    ? [
        { name: "Synced", value: erpStats.synced },
        { name: "Failed", value: erpStats.failed },
        { name: "Pending", value: erpStats.pending },
      ].filter(d => d.value > 0)
    : [];

  // ── Live stat lookups ─────────────────────────────────────────────────────
  const liveMap = new Map<string, number>();
  for (const s of liveStats?.stats ?? [])
    liveMap.set(s.metricName, s.totalValue);

  const totalSent = liveMap.get("mqtt.messages.sent") ?? 0;
  const totalBuffered = liveMap.get("mqtt.messages.buffered") ?? 0;
  const totalAll =
    (liveMap.get("mqtt.messages.total") ?? 0) || totalSent + totalBuffered;
  const avgPerMin = throughputData?.avgPerMinute ?? 0;

  const loading = loadingThroughput || loadingErp || loadingLive;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-500" />
            Real-Time Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            MQTT throughput · ERP sync success rate · Live metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={loading ? "secondary" : "default"} className="gap-1">
            <Wifi className="w-3 h-3" />
            {loading ? "Refreshing…" : "Live"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw
              className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={Activity}
          label="MQTT Messages (5 min)"
          value={totalAll.toLocaleString()}
          sub={`${totalSent} sent · ${totalBuffered} buffered`}
          colour={COLOURS.primary}
        />
        <StatCard
          icon={Wifi}
          label="Avg Throughput"
          value={`${avgPerMin.toFixed(1)}/min`}
          sub={`Last ${mqttMinutes} min`}
          colour={COLOURS.sent}
        />
        <StatCard
          icon={CheckCircle2}
          label="ERP Sync Rate"
          value={`${erpStats?.successRate ?? 0}%`}
          sub={`${erpStats?.synced ?? 0} synced / ${erpStats?.total ?? 0} total`}
          colour={
            erpStats && erpStats.successRate >= 90
              ? COLOURS.synced
              : COLOURS.failed
          }
        />
        <StatCard
          icon={Clock}
          label="Pending Retries"
          value={erpStats?.pending ?? 0}
          sub={`${erpStats?.failed ?? 0} permanently failed`}
          colour={COLOURS.pending}
        />
      </div>

      {/* ── MQTT Throughput Chart ─────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-500" />
              MQTT Message Throughput
            </CardTitle>
            <Select
              value={String(mqttMinutes)}
              onValueChange={v => setMqttMinutes(Number(v))}
            >
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">Last 30 min</SelectItem>
                <SelectItem value="60">Last 1 hour</SelectItem>
                <SelectItem value="180">Last 3 hours</SelectItem>
                <SelectItem value="720">Last 12 hours</SelectItem>
                <SelectItem value="1440">Last 24 hours</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {combinedSeries.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              No MQTT data yet. Messages will appear here as events are
              produced.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart
                data={combinedSeries}
                margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
              >
                <defs>
                  <linearGradient id="gradSent" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={COLOURS.sent}
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor={COLOURS.sent}
                      stopOpacity={0}
                    />
                  </linearGradient>
                  <linearGradient id="gradBuffered" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor={COLOURS.buffered}
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor={COLOURS.buffered}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  formatter={(value: number, name: string) => [
                    value,
                    name === "sent" ? "Sent" : "Buffered",
                  ]}
                  labelFormatter={label => `Time: ${label}`}
                />
                <Legend
                  formatter={v =>
                    v === "sent" ? "Sent to Fluvio" : "Buffered (offline)"
                  }
                />
                <Area
                  type="monotone"
                  dataKey="sent"
                  stroke={COLOURS.sent}
                  fill="url(#gradSent)"
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="buffered"
                  stroke={COLOURS.buffered}
                  fill="url(#gradBuffered)"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* ── ERP Sync Charts ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Pie chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                ERP Sync Breakdown
              </CardTitle>
              <Select
                value={String(erpHours)}
                onValueChange={v => setErpHours(Number(v))}
              >
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Last 1 hour</SelectItem>
                  <SelectItem value="6">Last 6 hours</SelectItem>
                  <SelectItem value="24">Last 24 hours</SelectItem>
                  <SelectItem value="72">Last 3 days</SelectItem>
                  <SelectItem value="168">Last 7 days</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {erpPieData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
                No ERP sync data in this period.
              </div>
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie
                      data={erpPieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                    >
                      {erpPieData.map((_, i) => (
                        <Cell
                          key={i}
                          fill={PIE_COLOURS[i % PIE_COLOURS.length]}
                        />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {[
                    {
                      label: "Synced",
                      value: erpStats?.synced ?? 0,
                      colour: COLOURS.synced,
                      icon: CheckCircle2,
                    },
                    {
                      label: "Failed",
                      value: erpStats?.failed ?? 0,
                      colour: COLOURS.failed,
                      icon: XCircle,
                    },
                    {
                      label: "Pending",
                      value: erpStats?.pending ?? 0,
                      colour: COLOURS.pending,
                      icon: Clock,
                    },
                  ].map(({ label, value, colour, icon: Icon }: any) => (
                    <div
                      key={label}
                      className="flex items-center gap-2 text-sm"
                    >
                      <Icon
                        className="w-4 h-4 flex-shrink-0"
                        style={{ color: colour }}
                      />
                      <span className="flex-1 text-muted-foreground">
                        {label}
                      </span>
                      <span className="font-semibold tabular-nums">
                        {value.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  <div className="pt-2 border-t">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">
                        Success rate
                      </span>
                      <span
                        className="font-bold text-base"
                        style={{
                          color:
                            (erpStats?.successRate ?? 0) >= 90
                              ? COLOURS.synced
                              : COLOURS.failed,
                        }}
                      >
                        {erpStats?.successRate ?? 0}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ERP trend line */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <XCircle className="w-4 h-4 text-red-500" />
              ERP Sync Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ErpTrendChart hours={erpHours} refreshKey={refreshKey} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── ERP Trend Chart (separate component to isolate query) ─────────────────────
function ErpTrendChart({ hours }: { hours: number; refreshKey: number }) {
  const [fromMs] = useState(() => Date.now() - hours * 60 * 60 * 1000);
  const { data: syncedSeries } = trpc.analytics.getTimeSeries.useQuery(
    { metricName: "erp.sync.synced", fromMs, toMs: Date.now() },
    { refetchInterval: 30_000 }
  );
  const { data: failedSeries } = trpc.analytics.getTimeSeries.useQuery(
    { metricName: "erp.sync.failed", fromMs, toMs: Date.now() },
    { refetchInterval: 30_000 }
  );
  const combined = (() => {
    const sm = new Map<number, number>();
    const fm = new Map<number, number>();
    for (const p of syncedSeries?.series ?? [])
      sm.set(new Date(p.bucket).getTime(), p.value);
    for (const p of failedSeries?.series ?? [])
      fm.set(new Date(p.bucket).getTime(), p.value);
    const all = Array.from(
      new Set([...Array.from(sm.keys()), ...Array.from(fm.keys())])
    );
    return all
      .sort((a: any, b: any) => a - b)
      .map(ts => ({
        ts,
        label: fmtTime(ts),
        synced: sm.get(ts) ?? 0,
        failed: fm.get(ts) ?? 0,
      }));
  })();

  if (combined.length === 0) {
    return (
      <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
        No trend data yet. ERP sync events will appear here.
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart
        data={combined}
        margin={{ top: 5, right: 10, left: -10, bottom: 0 }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip />
        <Legend />
        <Line
          type="monotone"
          dataKey="synced"
          stroke={COLOURS.synced}
          strokeWidth={2}
          dot={false}
          name="Synced"
        />
        <Line
          type="monotone"
          dataKey="failed"
          stroke={COLOURS.failed}
          strokeWidth={2}
          dot={false}
          name="Failed"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
