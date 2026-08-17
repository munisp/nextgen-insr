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

  // F-12 (wave-4b): overview is REAL host/process metrics (node:os). 24h
  // transaction totals derive from the real transactionVolume buckets; the
  // latency/users/errors procedures are fail-loud NOT_IMPLEMENTED and their
  // sections render honest unavailable states below.
  const o = overviewQ.data;
  const tx24hCount = txVolumeQ.data?.hourly.reduce((a, h) => a + h.count, 0);
  const tx24hVolume = txVolumeQ.data?.hourly.reduce((a, h) => a + h.amount, 0);

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
        {(
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">
                  Transactions (24h)
                </div>
                <div className="text-2xl font-bold text-white">
                  {tx24hCount != null ? tx24hCount.toLocaleString() : "—"}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  success rate: —
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">Volume (24h)</div>
                <div className="text-2xl font-bold text-white">
                  {tx24hVolume != null ? formatCurrency(tx24hVolume) : "—"}
                </div>
                <div className="text-xs text-gray-500 mt-1">failed: —</div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">
                  API Latency (p95)
                </div>
                <div className="text-2xl font-bold text-gray-500">—</div>
                <div className="text-xs text-gray-500 mt-1">
                  APM telemetry not delivered
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">Active Users</div>
                <div className="text-2xl font-bold text-gray-500">—</div>
                <div className="text-xs text-gray-500 mt-1">
                  session telemetry not delivered
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">Error Rate</div>
                <div className="text-2xl font-bold text-gray-500">—</div>
                <div className="text-xs text-gray-500 mt-1">
                  error aggregation not delivered
                </div>
              </CardContent>
            </Card>
            <Card className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400 mb-1">Uptime</div>
                <div className="text-2xl font-bold text-green-400">
                  {o ? formatUptime(o.processUptimeSeconds) : "—"}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {o?.nodeVersion ?? "—"}
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
                    data={txVolumeQ.data.hourly.map(h => ({
                      label: h.hour.substring(11, 16),
                      value: h.count,
                    }))}
                    height={140}
                    barColor="#3b82f6"
                  />
                  <div className="flex gap-4 mt-4 text-xs">
                    {txVolumeQ.data.byType.map(({ type, count }) => (
                      <div key={type} className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                        <span className="text-gray-400 capitalize">
                          {type}: {count}
                        </span>
                      </div>
                    ))}
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
                  {txVolumeQ.data.byStatus.map(({ status, count }) => {
                      const total =
                        txVolumeQ.data!.byStatus.reduce((a, x) => a + x.count, 0) || 1;
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
                    Host Resources (node process host)
                  </h4>
                  <Gauge
                    value={o.hostCpuLoadPercent}
                    max={100}
                    label="Host CPU load %"
                    color="#22c55e"
                  />
                  <Gauge
                    value={o.hostMemoryUsedPercent}
                    max={100}
                    label="Host memory %"
                    color="#3b82f6"
                  />
                  <Gauge
                    value={o.hostDiskUsedPercent}
                    max={100}
                    label="Host disk %"
                    color="#f59e0b"
                  />
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
              <div className="text-center text-gray-500 py-8">
                — API latency telemetry is not delivered on this platform
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white text-lg">
                User Activity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center text-gray-500 py-8">
                — User-session telemetry is not delivered on this platform
              </div>
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
              <div className="text-center text-gray-500 py-8">
                — Endpoint performance telemetry is not delivered on this platform
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white text-lg">
                  Recent Errors
                </CardTitle>

              </div>
            </CardHeader>
            <CardContent>
              <div className="text-center text-gray-500 py-8">
                — Application error aggregation is not delivered on this platform
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
                <Badge variant="outline" className="text-gray-300 border-gray-600">
                  {securityQ.data.total} audit events
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {securityQ.data.events.length > 0 ? (
                <div className="space-y-1 max-h-[200px] overflow-y-auto">
                  {securityQ.data.events.map(evt => (
                    <div
                      key={evt.id}
                      className="flex items-center gap-3 p-2 bg-gray-800/30 rounded text-xs"
                    >
                      <span
                        className={`w-2 h-2 rounded-full shrink-0 ${evt.status === "failed" ? "bg-red-500" : "bg-blue-500"}`}
                      />
                      <span className="text-gray-400 shrink-0 w-16">
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="text-gray-300 font-medium">
                        {evt.type}
                      </span>
                      <span className="text-gray-500 truncate">
                        {evt.resource ?? ""}
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
