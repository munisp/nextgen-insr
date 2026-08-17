import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// ═══════════════════════════════════════════════════════════════════════════════
// Mini Sparkline Chart (SVG-based, no external deps)
// ═══════════════════════════════════════════════════════════════════════════════
function Sparkline({
  data,
  color = "#3b82f6",
  height = 40,
  width = 200,
}: {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (data.length < 2)
    return <div style={{ width, height }} className="bg-gray-800 rounded" />;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`
    )
    .join(" ");
  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={width}
        cy={parseFloat(points.split(" ").pop()!.split(",")[1])}
        r="3"
        fill={color}
      />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Bar Chart Component
// ═══════════════════════════════════════════════════════════════════════════════
function BarChart({
  data,
  height = 120,
  barColor = "#3b82f6",
}: {
  data: { label: string; value: number }[];
  height?: number;
  barColor?: string;
}) {
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex flex-col items-center flex-1 min-w-0">
          <div
            className="w-full rounded-t transition-all"
            style={{
              height: `${(d.value / max) * (height - 20)}px`,
              backgroundColor: barColor,
              minHeight: d.value > 0 ? 2 : 0,
            }}
            title={`${d.label}: ${d.value}`}
          />
          <span className="text-[9px] text-gray-500 mt-1 truncate w-full text-center">
            {d.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Gauge Component
// ═══════════════════════════════════════════════════════════════════════════════
function Gauge({
  value,
  max,
  label,
  color,
}: {
  value: number;
  max: number;
  label: string;
  color: string;
}) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="flex flex-col items-center">
      <div className="relative w-20 h-20">
        <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
          <circle
            cx="18"
            cy="18"
            r="15.9"
            fill="none"
            stroke="#1f2937"
            strokeWidth="3"
          />
          <circle
            cx="18"
            cy="18"
            r="15.9"
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeDasharray={`${pct} ${100 - pct}`}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold text-white">
            {Math.round(pct)}%
          </span>
        </div>
      </div>
      <span className="text-xs text-gray-400 mt-1">{label}</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Latency Percentile Chart
// ═══════════════════════════════════════════════════════════════════════════════
function LatencyChart({
  timeline,
}: {
  timeline: { hour: string; p50: number; p95: number; p99: number }[];
}) {
  const height = 120;
  const max = Math.max(...timeline.map(t => t.p99), 1);
  return (
    <div className="relative" style={{ height: height + 30 }}>
      <div className="flex items-end gap-0.5" style={{ height }}>
        {timeline.map((t, i) => (
          <div
            key={i}
            className="flex-1 flex flex-col items-center relative group"
            style={{ height }}
          >
            {/* p99 bar */}
            <div
              className="w-full rounded-t absolute bottom-0"
              style={{
                height: `${(t.p99 / max) * height}px`,
                backgroundColor: "rgba(239,68,68,0.3)",
              }}
            />
            {/* p95 bar */}
            <div
              className="w-full rounded-t absolute bottom-0"
              style={{
                height: `${(t.p95 / max) * height}px`,
                backgroundColor: "rgba(245,158,11,0.4)",
              }}
            />
            {/* p50 bar */}
            <div
              className="w-full rounded-t absolute bottom-0 z-10"
              style={{
                height: `${(t.p50 / max) * height}px`,
                backgroundColor: "#3b82f6",
              }}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs hidden group-hover:block z-20 whitespace-nowrap">
              <div className="text-gray-300">{t.hour}</div>
              <div className="text-blue-400">p50: {t.p50}ms</div>
              <div className="text-amber-400">p95: {t.p95}ms</div>
              <div className="text-red-400">p99: {t.p99}ms</div>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-0.5 mt-1">
        {timeline.map((t, i) => (
          <span
            key={i}
            className="flex-1 text-[8px] text-gray-600 text-center truncate"
          >
            {t.hour}
          </span>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Dashboard
// ═══════════════════════════════════════════════════════════════════════════════
export default function SystemHealthDashboard() {
  const [timeRange, setTimeRange] = useState(24);
  const overviewQ = trpc.healthMonitor.overview.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const txVolumeQ = trpc.healthMonitor.transactionVolume.useQuery(
    { hours: timeRange },
    { refetchInterval: 60_000 }
  );
  const userActivityQ = trpc.healthMonitor.userActivity.useQuery(
    { hours: timeRange },
    { refetchInterval: 60_000 }
  );
  const latencyQ = trpc.healthMonitor.apiLatency.useQuery(
    { hours: timeRange },
    { refetchInterval: 60_000 }
  );
  const errorsQ = trpc.healthMonitor.errorTracking.useQuery(
    { hours: timeRange },
    { refetchInterval: 60_000 }
  );
  const securityQ = trpc.healthMonitor.securityEvents.useQuery(undefined, {
    refetchInterval: 60_000,
  });

  const o = overviewQ.data;

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
  };

  const formatCurrency = (n: number) =>
    `₦${(n / 100).toLocaleString("en-NG", { minimumFractionDigits: 0 })}`;

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              System Health Monitor
              <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse" />
            </h1>
            <p className="text-gray-400 text-sm">
              Real-time platform metrics and performance monitoring
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-gray-800 rounded-lg p-1">
              {[1, 6, 12, 24, 48, 168].map(h => (
                <button
                  key={h}
                  onClick={() => setTimeRange(h)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${timeRange === h ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
                >
                  {h < 24 ? `${h}h` : h === 24 ? "1d" : h === 48 ? "2d" : "7d"}
                </button>
              ))}
            </div>
            <a href="/" className="text-sm text-gray-400 hover:text-white">
              ← Back
            </a>
          </div>
        </div>

        {/* KPI Cards Row */}
        {o && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">
                  Transactions (24h)
                </div>
                <div className="text-2xl font-bold text-white">
                  {o.transactions.last24h.toLocaleString()}
                </div>
                <div className="text-xs text-green-400 mt-1">
                  {o.transactions.successRate}% success
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">Volume (24h)</div>
                <div className="text-2xl font-bold text-white">
                  {formatCurrency(o.transactions.totalVolume24h)}
                </div>
                <div className="text-xs text-red-400 mt-1">
                  {o.transactions.failedCount} failed
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">
                  API Latency (p95)
                </div>
                <div className="text-2xl font-bold text-white">
                  {o.latency.p95}ms
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  p50: {o.latency.p50}ms · p99: {o.latency.p99}ms
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">Active Users</div>
                <div className="text-2xl font-bold text-white">
                  {o.users.activeNow}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  DAU: {o.users.dailyActive}
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">Error Rate</div>
                <div
                  className={`text-2xl font-bold ${o.errors.errorRate > 5 ? "text-red-400" : o.errors.errorRate > 1 ? "text-amber-400" : "text-green-400"}`}
                >
                  {o.errors.errorRate}%
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {o.errors.last1h} errors/hr
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">Uptime</div>
                <div className="text-2xl font-bold text-green-400">
                  {formatUptime(o.system.uptimeSeconds)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {o.system.nodeVersion}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Transaction Volume Chart */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="bg-gray-900 border-gray-800 lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-white text-lg">
                Transaction Volume
              </CardTitle>
            </CardHeader>
            <CardContent>
              {txVolumeQ.data && (
                <>
                  <BarChart
                    data={txVolumeQ.data.buckets.map(b => ({
                      label: b.hour.substring(11, 16),
                      value: b.total,
                    }))}
                    height={140}
                    barColor="#3b82f6"
                  />
                  <div className="flex gap-4 mt-4 text-xs">
                    {Object.entries(txVolumeQ.data.summary.byType).map(
                      ([type, count]) => (
                        <div key={type} className="flex items-center gap-1">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{
                              backgroundColor: {
                                cash_in: "#22c55e",
                                cash_out: "#ef4444",
                                transfer: "#3b82f6",
                                bill_pay: "#f59e0b",
                                airtime: "#8b5cf6",
                              }[type],
                            }}
                          />
                          <span className="text-gray-400 capitalize">
                            {type.replace("_", " ")}: {count}
                          </span>
                        </div>
                      )
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Transaction Status Breakdown */}
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-lg">
                Status Breakdown
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {txVolumeQ.data && (
                <>
                  {Object.entries(txVolumeQ.data.summary.byStatus).map(
                    ([status, count]) => {
                      const total = txVolumeQ.data!.summary.total || 1;
                      const pct = ((count / total) * 100).toFixed(1);
                      const color =
                        status === "completed"
                          ? "#22c55e"
                          : status === "failed"
                            ? "#ef4444"
                            : "#f59e0b";
                      return (
                        <div key={status}>
                          <div className="flex justify-between text-sm mb-1">
                            <span className="text-gray-300 capitalize">
                              {status}
                            </span>
                            <span className="text-gray-400">
                              {count} ({pct}%)
                            </span>
                          </div>
                          <div className="w-full bg-gray-800 rounded-full h-2">
                            <div
                              className="h-2 rounded-full transition-all"
                              style={{
                                width: `${pct}%`,
                                backgroundColor: color,
                              }}
                            />
                          </div>
                        </div>
                      );
                    }
                  )}
                </>
              )}
              {o && (
                <div className="pt-4 border-t border-gray-800 space-y-3">
                  <h4 className="text-sm font-medium text-gray-300">
                    System Resources
                  </h4>
                  <Gauge
                    value={o.system.memoryUsedMb}
                    max={o.system.memoryTotalMb}
                    label="Heap Memory"
                    color="#3b82f6"
                  />
                  <div className="text-xs text-gray-500 text-center">
                    {o.system.memoryUsedMb}MB / {o.system.memoryTotalMb}MB
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* API Latency + User Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-lg">
                  API Latency (ms)
                </CardTitle>
                <div className="flex gap-2 text-xs">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-blue-500" />
                    p50
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                    p95
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                    p99
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {latencyQ.data && (
                <LatencyChart timeline={latencyQ.data.timeline} />
              )}
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-lg">
                User Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              {userActivityQ.data && (
                <>
                  <BarChart
                    data={userActivityQ.data.timeline.map(t => ({
                      label: t.hour,
                      value: t.count,
                    }))}
                    height={100}
                    barColor="#8b5cf6"
                  />
                  <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                    <div>
                      <div className="text-lg font-bold text-white">
                        {userActivityQ.data.uniqueUsers}
                      </div>
                      <div className="text-xs text-gray-400">Unique Users</div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-white">
                        {userActivityQ.data.totalSessions}
                      </div>
                      <div className="text-xs text-gray-400">
                        Total Sessions
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-white">
                        {userActivityQ.data.peakHour}
                      </div>
                      <div className="text-xs text-gray-400">Peak Hour</div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Endpoint Performance Table + Errors */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-lg">
                Endpoint Performance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-gray-400 text-xs border-b border-gray-800">
                      <th className="text-left py-2">Endpoint</th>
                      <th className="text-right py-2">p50</th>
                      <th className="text-right py-2">p95</th>
                      <th className="text-right py-2">p99</th>
                      <th className="text-right py-2">Err%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {latencyQ.data?.endpoints.slice(0, 10).map((ep, i) => (
                      <tr
                        key={i}
                        className="border-b border-gray-800/50 hover:bg-gray-800/30"
                      >
                        <td className="py-2 text-gray-300 font-mono text-xs truncate max-w-[200px]">
                          {ep.endpoint}
                        </td>
                        <td className="py-2 text-right text-gray-400">
                          {ep.p50}ms
                        </td>
                        <td className="py-2 text-right text-amber-400">
                          {ep.p95}ms
                        </td>
                        <td className="py-2 text-right text-red-400">
                          {ep.p99}ms
                        </td>
                        <td className="py-2 text-right">
                          <span
                            className={
                              ep.errorRate > 5
                                ? "text-red-400"
                                : ep.errorRate > 0
                                  ? "text-amber-400"
                                  : "text-green-400"
                            }
                          >
                            {ep.errorRate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-lg">
                  Recent Errors
                </CardTitle>
                {errorsQ.data && (
                  <Badge
                    variant="outline"
                    className="text-red-400 border-red-600"
                  >
                    {errorsQ.data.total} total
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {errorsQ.data?.recentErrors.map((err, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 p-2 bg-gray-800/50 rounded text-xs"
                  >
                    <Badge
                      variant="outline"
                      className={`text-xs shrink-0 ${err.statusCode >= 500 ? "text-red-400 border-red-600" : "text-amber-400 border-amber-600"}`}
                    >
                      {err.statusCode}
                    </Badge>
                    <div className="min-w-0">
                      <div className="text-gray-300 font-mono truncate">
                        {err.endpoint}
                      </div>
                      <div className="text-gray-500">{err.message}</div>
                      <div className="text-gray-600">
                        {new Date(err.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>
                ))}
                {(!errorsQ.data || errorsQ.data.recentErrors.length === 0) && (
                  <div className="text-center text-gray-500 py-8">
                    No recent errors
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Security Events */}
        {securityQ.data && (
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-lg">
                  Security Events (24h)
                </CardTitle>
                <div className="flex gap-2">
                  {securityQ.data.criticalEvents > 0 && (
                    <Badge className="bg-red-600 text-white">
                      {securityQ.data.criticalEvents} Critical
                    </Badge>
                  )}
                  {securityQ.data.warningEvents > 0 && (
                    <Badge className="bg-amber-600 text-white">
                      {securityQ.data.warningEvents} Warning
                    </Badge>
                  )}
                  {securityQ.data.lockedAccounts > 0 && (
                    <Badge className="bg-orange-600 text-white">
                      {securityQ.data.lockedAccounts} Locked
                    </Badge>
                  )}
                  {securityQ.data.blockedIps > 0 && (
                    <Badge className="bg-red-800 text-white">
                      {securityQ.data.blockedIps} Blocked IPs
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {securityQ.data.recentEvents.length > 0 ? (
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {securityQ.data.recentEvents.map((evt, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 p-2 bg-gray-800/30 rounded text-xs"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${evt.severity === "critical" ? "bg-red-500" : evt.severity === "warning" ? "bg-amber-500" : "bg-blue-500"}`}
                      />
                      <span className="text-gray-400 shrink-0 w-16">
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="text-gray-300 font-medium">
                        {evt.event}
                      </span>
                      <span className="text-gray-500 truncate">
                        {JSON.stringify(evt.details).substring(0, 80)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-gray-500 py-6">
                  No security events in the last 24 hours
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
