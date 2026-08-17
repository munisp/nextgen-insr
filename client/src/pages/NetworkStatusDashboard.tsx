/**
 * Network Status Dashboard — Sprint 75
 * Real-time connectivity charts per carrier and region
 * Uses the networkStatusDashboard tRPC router
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  Legend,
} from "recharts";

const COLORS = {
  bg: "#0a0e1a",
  card: "#111827",
  border: "#1f2937",
  blue: "#3b82f6",
  green: "#10b981",
  gold: "#f59e0b",
  red: "#ef4444",
  cyan: "#06b6d4",
  purple: "#8b5cf6",
  gray: "#6b7280",
};

const CARRIER_COLORS: Record<string, string> = {
  MTN: "#f59e0b",
  Airtel: "#ef4444",
  Safaricom: "#10b981",
  Glo: "#3b82f6",
  "9mobile": "#8b5cf6",
  MTN_GH: "#f97316",
  Vodafone_GH: "#ec4899",
  Orange_SN: "#f97316",
  MTN_ZA: "#eab308",
  Vodacom_ZA: "#06b6d4",
};

function QualityBadge({ score }: { score: number }) {
  const color =
    score >= 80 ? COLORS.green : score >= 60 ? COLORS.gold : COLORS.red;
  const grade =
    score >= 90
      ? "A+"
      : score >= 80
        ? "A"
        : score >= 70
          ? "B"
          : score >= 60
            ? "C"
            : score >= 50
              ? "D"
              : "F";
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold"
      style={{ background: `${color}20`, color }}
    >
      {grade} · {score}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const color =
    severity === "critical"
      ? COLORS.red
      : severity === "warning"
        ? COLORS.gold
        : COLORS.green;
  return (
    <span
      className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
      style={{ background: `${color}20`, color }}
    >
      {severity}
    </span>
  );
}

export default function NetworkStatusDashboard() {
  const { user } = useAuth();
  const [selectedRegion, setSelectedRegion] = useState<string | undefined>(
    undefined
  );
  const [selectedCarrier, setSelectedCarrier] = useState<string | undefined>(
    undefined
  );
  const [timeRange, setTimeRange] = useState(24);

  const overview = trpc.networkStatusDashboard.getOverview.useQuery();
  const regions = trpc.networkStatusDashboard.getRegions.useQuery();
  const timeSeries = trpc.networkStatusDashboard.getTimeSeries.useQuery({
    region: selectedRegion,
    carrier: selectedCarrier,
    hours: timeRange,
  });
  const alerts = trpc.networkStatusDashboard.getAlerts.useQuery({
    unresolved: true,
  });
  const heatmap = trpc.networkStatusDashboard.getCarrierHeatmap.useQuery();
  const carrierSummary =
    trpc.networkStatusDashboard.getCarrierSummary.useQuery();
  const resolveAlert = trpc.networkStatusDashboard.resolveAlert.useMutation({
    onSuccess: () => alerts.refetch(),
  });

  // Aggregate time series for chart
  const chartData = useMemo(() => {
    if (!timeSeries.data) return [];
    const buckets = new Map<
      string,
      {
        ts: number;
        signal: number[];
        latency: number[];
        bw: number[];
        quality: number[];
      }
    >();
    for (const p of timeSeries.data) {
      const hour = new Date(p.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      if (!buckets.has(hour))
        buckets.set(hour, {
          ts: p.timestamp,
          signal: [],
          latency: [],
          bw: [],
          quality: [],
        });
      const b = buckets.get(hour)!;
      b.signal.push(p.signalDbm);
      b.latency.push(p.latencyMs);
      b.bw.push(p.bandwidthKbps);
      b.quality.push(p.qualityScore);
    }
    return Array.from(buckets.entries())
      .sort((a: any, b: any) => a[1].ts - b[1].ts)
      .map(([hour, b]) => ({
        hour,
        signal: Math.round(
          b.signal.reduce((s: any, v: any) => s + v, 0) / b.signal.length
        ),
        latency: Math.round(
          b.latency.reduce((s: any, v: any) => s + v, 0) / b.latency.length
        ),
        bandwidth: Math.round(
          b.bw.reduce((s: any, v: any) => s + v, 0) / b.bw.length
        ),
        quality: Math.round(
          b.quality.reduce((s: any, v: any) => s + v, 0) / b.quality.length
        ),
      }));
  }, [timeSeries.data]);

  // Carrier pie data
  const carrierPieData = useMemo(() => {
    if (!regions.data) return [];
    const counts: Record<string, number> = {};
    for (const r of regions.data) {
      counts[r.dominantCarrier] =
        (counts[r.dominantCarrier] || 0) + r.activeAgents;
    }
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [regions.data]);

  const navItems = [
    { label: "Overview", href: "/network-status" },
    { label: "Insurance Service", href: "/" },
    { label: "Admin", href: "/admin" },
  ];

  return (
    <DashboardLayout>
      <div
        className="p-6 space-y-6"
        style={{ background: COLORS.bg, minHeight: "100vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1
              className="text-2xl font-bold text-white"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Network Status Dashboard
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              Real-time connectivity monitoring across African markets
            </p>
          </div>
          <div className="flex items-center gap-3">
            <select
              value={timeRange}
              onChange={e => setTimeRange(Number(e.target.value))}
              className="px-3 py-2 rounded-lg text-sm text-white"
              style={{
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
              }}
            >
              <option value={6}>6 hours</option>
              <option value={12}>12 hours</option>
              <option value={24}>24 hours</option>
              <option value={48}>48 hours</option>
              <option value={168}>7 days</option>
            </select>
          </div>
        </div>

        {/* KPI Cards */}
        {overview.data && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              {
                label: "Regions",
                value: overview.data.totalRegions,
                color: COLORS.blue,
                icon: "🌍",
              },
              {
                label: "Active Agents",
                value: overview.data.totalAgents.toLocaleString(),
                color: COLORS.green,
                icon: "👤",
              },
              {
                label: "Avg Quality",
                value: overview.data.avgQualityScore,
                color:
                  overview.data.avgQualityScore >= 70
                    ? COLORS.green
                    : COLORS.gold,
                icon: "📊",
              },
              {
                label: "Avg Latency",
                value: `${overview.data.avgLatencyMs}ms`,
                color:
                  overview.data.avgLatencyMs < 150 ? COLORS.green : COLORS.gold,
                icon: "⏱",
              },
              {
                label: "Avg Signal",
                value: `${overview.data.avgSignalDbm} dBm`,
                color:
                  overview.data.avgSignalDbm > -80 ? COLORS.green : COLORS.gold,
                icon: "📶",
              },
              {
                label: "Active Alerts",
                value: overview.data.activeAlerts,
                color:
                  overview.data.activeAlerts > 0 ? COLORS.red : COLORS.green,
                icon: "⚠",
              },
            ].map((kpi, i) => (
              <div
                key={i}
                className="rounded-xl p-4"
                style={{
                  background: COLORS.card,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">{kpi.icon}</span>
                  <span className="text-xs text-gray-500">{kpi.label}</span>
                </div>
                <div
                  className="text-2xl font-bold"
                  style={{
                    color: kpi.color,
                    fontFamily: "'JetBrains Mono', monospace",
                  }}
                >
                  {kpi.value}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Quality Score Over Time */}
          <div
            className="rounded-xl p-4"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">
                Quality Score Over Time
              </h3>
              <div className="flex gap-2">
                <select
                  value={selectedRegion || ""}
                  onChange={e => setSelectedRegion(e.target.value || undefined)}
                  className="px-2 py-1 rounded text-xs text-white"
                  style={{
                    background: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <option value="">All Regions</option>
                  {(regions.data || []).map(r => (
                    <option key={r.region} value={r.region}>
                      {r.region}
                    </option>
                  ))}
                </select>
                <select
                  value={selectedCarrier || ""}
                  onChange={e =>
                    setSelectedCarrier(e.target.value || undefined)
                  }
                  className="px-2 py-1 rounded text-xs text-white"
                  style={{
                    background: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <option value="">All Carriers</option>
                  {(carrierSummary.data || []).map(c => (
                    <option key={c.carrier} value={c.carrier}>
                      {c.carrier}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f293740" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: COLORS.card,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 8,
                      color: "white",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="quality"
                    stroke={COLORS.green}
                    fill={`${COLORS.green}30`}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Latency Over Time */}
          <div
            className="rounded-xl p-4"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <h3 className="text-sm font-bold text-white mb-4">
              Latency & Bandwidth
            </h3>
            <div style={{ height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f293740" />
                  <XAxis
                    dataKey="hour"
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="left"
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fill: "#6b7280", fontSize: 10 }}
                  />
                  <Tooltip
                    contentStyle={{
                      background: COLORS.card,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 8,
                      color: "white",
                    }}
                  />
                  <Legend />
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="latency"
                    stroke={COLORS.gold}
                    strokeWidth={2}
                    dot={false}
                    name="Latency (ms)"
                  />
                  <Line
                    yAxisId="right"
                    type="monotone"
                    dataKey="bandwidth"
                    stroke={COLORS.cyan}
                    strokeWidth={2}
                    dot={false}
                    name="Bandwidth (kbps)"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Region Map + Carrier Distribution */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Regions Table */}
          <div
            className="lg:col-span-2 rounded-xl p-4"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <h3 className="text-sm font-bold text-white mb-4">
              Regional Connectivity
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs">
                    <th className="pb-3 pr-4">Region</th>
                    <th className="pb-3 pr-4">Country</th>
                    <th className="pb-3 pr-4">Quality</th>
                    <th className="pb-3 pr-4">Signal</th>
                    <th className="pb-3 pr-4">Latency</th>
                    <th className="pb-3 pr-4">Bandwidth</th>
                    <th className="pb-3 pr-4">Carrier</th>
                    <th className="pb-3">Agents</th>
                  </tr>
                </thead>
                <tbody>
                  {(regions.data || [])
                    .sort((a: any, b: any) => b.qualityScore - a.qualityScore)
                    .map(r => (
                      <tr
                        key={r.region}
                        className="border-t"
                        style={{ borderColor: COLORS.border }}
                      >
                        <td className="py-3 pr-4 text-white font-medium">
                          {r.region}
                        </td>
                        <td className="py-3 pr-4 text-gray-400">{r.country}</td>
                        <td className="py-3 pr-4">
                          <QualityBadge score={r.qualityScore} />
                        </td>
                        <td
                          className="py-3 pr-4 text-gray-300"
                          style={{ fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          {r.avgSignalDbm.toFixed(0)} dBm
                        </td>
                        <td
                          className="py-3 pr-4 text-gray-300"
                          style={{ fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          {r.avgLatencyMs.toFixed(0)}ms
                        </td>
                        <td
                          className="py-3 pr-4 text-gray-300"
                          style={{ fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          {(r.avgBandwidthKbps / 1000).toFixed(1)} Mbps
                        </td>
                        <td className="py-3 pr-4">
                          <span
                            className="px-2 py-0.5 rounded text-xs font-bold"
                            style={{
                              background: `${CARRIER_COLORS[r.dominantCarrier] || COLORS.gray}20`,
                              color:
                                CARRIER_COLORS[r.dominantCarrier] ||
                                COLORS.gray,
                            }}
                          >
                            {r.dominantCarrier}
                          </span>
                        </td>
                        <td
                          className="py-3 text-gray-300"
                          style={{ fontFamily: "'JetBrains Mono', monospace" }}
                        >
                          {r.activeAgents}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Carrier Distribution Pie */}
          <div
            className="rounded-xl p-4"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <h3 className="text-sm font-bold text-white mb-4">
              Agent Distribution by Carrier
            </h3>
            <div style={{ height: 250 }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={carrierPieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={90}
                    dataKey="value"
                    nameKey="name"
                    paddingAngle={2}
                  >
                    {carrierPieData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={CARRIER_COLORS[entry.name] || COLORS.gray}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: COLORS.card,
                      border: `1px solid ${COLORS.border}`,
                      borderRadius: 8,
                      color: "white",
                    }}
                  />
                  <Legend
                    formatter={value => (
                      <span className="text-gray-400 text-xs">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Carrier Performance Summary */}
        <div
          className="rounded-xl p-4"
          style={{
            background: COLORS.card,
            border: `1px solid ${COLORS.border}`,
          }}
        >
          <h3 className="text-sm font-bold text-white mb-4">
            Carrier Performance Summary
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {(carrierSummary.data || []).slice(0, 5).map(c => (
              <div
                key={c.carrier}
                className="rounded-xl p-4"
                style={{
                  background: COLORS.bg,
                  border: `1px solid ${COLORS.border}`,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{
                      background: CARRIER_COLORS[c.carrier] || COLORS.gray,
                    }}
                  />
                  <span className="text-sm font-bold text-white">
                    {c.carrier}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Quality</span>
                    <span
                      style={{
                        color:
                          c.avgQualityScore >= 70 ? COLORS.green : COLORS.gold,
                        fontFamily: "'JetBrains Mono', monospace",
                      }}
                    >
                      {c.avgQualityScore}
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Latency</span>
                    <span
                      className="text-gray-300"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {c.avgLatencyMs}ms
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Signal</span>
                    <span
                      className="text-gray-300"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {c.avgSignalDbm} dBm
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-500">Bandwidth</span>
                    <span
                      className="text-gray-300"
                      style={{ fontFamily: "'JetBrains Mono', monospace" }}
                    >
                      {(c.avgBandwidthKbps / 1000).toFixed(1)} Mbps
                    </span>
                  </div>
                  {c.dominantRegions.length > 0 && (
                    <div className="text-[10px] text-gray-600 mt-1">
                      Dominant in: {c.dominantRegions.join(", ")}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Active Alerts */}
        {alerts.data && alerts.data.length > 0 && (
          <div
            className="rounded-xl p-4"
            style={{
              background: COLORS.card,
              border: `1px solid ${COLORS.border}`,
            }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-white">Active Alerts</h3>
              <span
                className="text-xs px-2 py-1 rounded-full"
                style={{ background: `${COLORS.red}20`, color: COLORS.red }}
              >
                {alerts.data.length} unresolved
              </span>
            </div>
            <div className="space-y-3">
              {alerts.data.map(alert => (
                <div
                  key={alert.id}
                  className="rounded-lg p-3 flex items-start gap-3"
                  style={{
                    background: COLORS.bg,
                    border: `1px solid ${COLORS.border}`,
                  }}
                >
                  <SeverityBadge severity={alert.severity} />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-white">{alert.message}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      {alert.carrier} · {alert.region} ·{" "}
                      {new Date(alert.timestamp).toLocaleString()}
                    </div>
                  </div>
                  <button
                    onClick={() => resolveAlert.mutate({ alertId: alert.id })}
                    disabled={resolveAlert.isPending}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-50"
                    style={{
                      background: `${COLORS.green}20`,
                      color: COLORS.green,
                    }}
                  >
                    Resolve
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
