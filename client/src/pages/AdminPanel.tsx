/**
 * AdminPanel — InsurePortal Supervisor / Back-Office Dashboard
 * Route: /admin  (protected — requires agent.role === "admin" OR Manus OAuth admin role)
 *
 * Sections:
 *  1. Overview KPIs  — total volume, active agents, fraud rate, avg commission
 *  2. Live Fraud Feed — real-time Socket.IO events + status management
 *  3. Audit Log       — paginated table of all agent actions
 *  4. Agent Directory — list of all agents with float / tier / status
 *  5. Transaction Log — all transactions across all agents
 */
import { useState, useEffect, useRef } from "react";
import { trpc } from "../lib/trpc";
import { usePosStore } from "../store/posStore";
import { toast } from "sonner";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useFraudSocket } from "../hooks/useSocket";
import AgentManagementTab from "../components/admin/AgentManagementTab";
import FloatTopUpTab from "../components/admin/FloatTopUpTab";
import { MDMTab } from "../components/admin/MDMTab";
import { DisputesAdminTab } from "../components/admin/DisputesAdminTab";
import { SecurityTab } from "../components/admin/SecurityTab";
import { GeofencingTab } from "../components/admin/GeofencingTab";
import { FluvioStreamTab } from "../components/admin/FluvioStreamTab";
import ERPConfigTab from "../components/admin/ERPConfigTab";
import { FraudRulesTab } from "./admin/FraudRulesTab";
import { SystemConfigTab } from "../components/admin/SystemConfigTab";
import { SimOrchestratorTab } from "../components/admin/SimOrchestratorTab";
import { FailoverHistoryTab } from "../components/admin/FailoverHistoryTab";
import { MQTTBridgeTab } from "../components/admin/MQTTBridgeTab";
import { CoverageMap } from "../components/admin/CoverageMap";

// ─── Design tokens (match POS Shell) ─────────────────────────────────────────
const BG = "#0a0e1a";
const CARD = "oklch(0.14 0.02 240)";
const BORDER = "oklch(0.22 0.02 240)";
const GREEN = "oklch(0.65 0.18 160)";
const RED = "oklch(0.60 0.22 25)";
const GOLD = "oklch(0.78 0.18 80)";
const BLUE = "oklch(0.60 0.22 260)";
const DISP = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

const fmt = (n: number) =>
  `₦${n.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtShort = (n: number) =>
  n >= 1_000_000
    ? `₦${(n / 1_000_000).toFixed(2)}M`
    : n >= 1_000
      ? `₦${(n / 1_000).toFixed(1)}K`
      : `₦${n}`;

// ─── Severity badge ───────────────────────────────────────────────────────────
function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    critical: { bg: "oklch(0.60 0.22 25 / 0.2)", color: RED },
    high: { bg: "oklch(0.78 0.18 80 / 0.2)", color: GOLD },
    medium: { bg: "oklch(0.60 0.22 260 / 0.2)", color: BLUE },
    low: { bg: "oklch(0.65 0.18 160 / 0.2)", color: GREEN },
  };
  const s = map[severity] ?? map.low;
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full font-bold uppercase"
      style={{ background: s.bg, color: s.color, fontFamily: DISP }}
    >
      {severity}
    </span>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-1"
      style={{ background: CARD, border: `1px solid ${BORDER}` }}
    >
      <div
        className="text-xs text-gray-500 uppercase tracking-widest"
        style={{ fontFamily: DISP }}
      >
        {label}
      </div>
      <div className="text-2xl font-black" style={{ color, fontFamily: MONO }}>
        {value}
      </div>
      {sub && (
        <div className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
          {sub}
        </div>
      )}
    </div>
  );
}

// ─── Fraud Feed Tab ───────────────────────────────────────────────────────────
function FraudFeedTab() {
  const fraudEvents = usePosStore(s => s.fraudEvents);
  const updateStatus = trpc.fraud.updateStatus.useMutation({
    onSuccess: () => toast.success("Status updated"),
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div
          className="text-sm font-bold text-gray-300"
          style={{ fontFamily: DISP }}
        >
          Live Fraud Events{" "}
          <span className="text-xs text-gray-500 ml-2">
            ({fraudEvents.length} total)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: RED }}
          />
          <span className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
            Live
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
        {fraudEvents.length === 0 ? (
          <div
            className="text-center py-12 text-gray-600"
            style={{ fontFamily: DISP }}
          >
            No fraud events yet — monitoring active
          </div>
        ) : (
          fraudEvents.map((evt: any) => (
            <div
              key={evt.id}
              className="rounded-xl p-4 flex flex-col gap-2"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={evt.severity} />
                  <span
                    className="text-sm font-bold text-white"
                    style={{ fontFamily: DISP }}
                  >
                    {evt.type}
                  </span>
                </div>
                <span
                  className="text-xs text-gray-500"
                  style={{ fontFamily: MONO }}
                >
                  {new Date(evt.timestamp).toLocaleTimeString("en-NG")}
                </span>
              </div>
              <div
                className="flex items-center justify-between text-xs text-gray-400"
                style={{ fontFamily: DISP }}
              >
                <span>
                  Agent:{" "}
                  <span className="text-white font-semibold">
                    {evt.agentId}
                  </span>
                </span>
                <span>
                  Customer:{" "}
                  <span className="text-white font-semibold">
                    {evt.customerName}
                  </span>
                </span>
                <span style={{ color: GOLD, fontFamily: MONO }}>
                  {fmt(evt.amount)}
                </span>
              </div>
              <div
                className="text-xs text-gray-500"
                style={{ fontFamily: DISP }}
              >
                {evt.reason}
              </div>
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() =>
                    updateStatus.mutate({
                      id: Number(evt.id),
                      status: "investigating",
                    })
                  }
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: "oklch(0.60 0.22 260 / 0.2)",
                    color: BLUE,
                    fontFamily: DISP,
                  }}
                >
                  Investigate
                </button>
                <button
                  onClick={() =>
                    updateStatus.mutate({
                      id: Number(evt.id),
                      status: "resolved",
                    })
                  }
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: "oklch(0.65 0.18 160 / 0.2)",
                    color: GREEN,
                    fontFamily: DISP,
                  }}
                >
                  Resolve
                </button>
                <button
                  onClick={() =>
                    updateStatus.mutate({
                      id: Number(evt.id),
                      status: "escalated",
                    })
                  }
                  className="flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: "oklch(0.60 0.22 25 / 0.2)",
                    color: RED,
                    fontFamily: DISP,
                  }}
                >
                  Escalate
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────
function AuditLogTab() {
  const [page, setPage] = useState(0);
  const limit = 20;
  const { data, isLoading } = trpc.auditLog.listAll.useQuery({
    limit,
    offset: page * limit,
  });

  return (
    <div className="flex flex-col gap-3">
      <div
        className="text-sm font-bold text-gray-300"
        style={{ fontFamily: DISP }}
      >
        System Audit Log
      </div>
      {isLoading ? (
        <div
          className="text-center py-8 text-gray-500"
          style={{ fontFamily: DISP }}
        >
          Loading...
        </div>
      ) : (
        <>
          <div
            className="overflow-x-auto rounded-xl"
            style={{ border: `1px solid ${BORDER}` }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr
                  style={{
                    background: CARD,
                    borderBottom: `1px solid ${BORDER}`,
                  }}
                >
                  {["Time", "Agent", "Action", "Resource", "Ref", "Status"].map(
                    h => (
                      <th
                        key={h}
                        className="px-3 py-3 text-left font-semibold text-gray-400 uppercase tracking-wider"
                        style={{ fontFamily: DISP }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((log: any, i: number) => {
                  const isReversal = log.action === "TRANSACTION_REVERSED";
                  const meta = (log.metadata as Record<string, unknown>) ?? {};
                  const actionColor = isReversal ? GOLD : BLUE;
                  const actionBg = isReversal
                    ? "oklch(0.78 0.18 80 / 0.15)"
                    : "oklch(0.60 0.22 260 / 0.15)";
                  return (
                    <tr
                      key={log.id}
                      style={{
                        background: isReversal
                          ? "oklch(0.78 0.18 80 / 0.05)"
                          : i % 2 === 0
                            ? BG
                            : CARD,
                        borderBottom: `1px solid ${BORDER}`,
                        borderLeft: isReversal
                          ? `3px solid ${GOLD}`
                          : "3px solid transparent",
                      }}
                    >
                      <td
                        className="px-3 py-2 text-gray-400"
                        style={{ fontFamily: MONO }}
                      >
                        {new Date(log.createdAt).toLocaleString("en-NG")}
                      </td>
                      <td
                        className="px-3 py-2 font-semibold text-white"
                        style={{ fontFamily: DISP }}
                      >
                        {log.agentId}
                      </td>
                      <td className="px-3 py-2" style={{ fontFamily: DISP }}>
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{ background: actionBg, color: actionColor }}
                        >
                          {log.action}
                        </span>
                        {isReversal && meta.reason != null && (
                          <div
                            className="text-xs mt-0.5"
                            style={{
                              color: "oklch(0.55 0.015 230)",
                              fontFamily: DISP,
                            }}
                          >
                            {String(meta.reason)}
                          </div>
                        )}
                      </td>
                      <td
                        className="px-3 py-2 text-gray-400"
                        style={{ fontFamily: DISP }}
                      >
                        {log.resource}
                      </td>
                      <td className="px-3 py-2" style={{ fontFamily: MONO }}>
                        <span
                          style={{
                            color: isReversal ? GOLD : "oklch(0.55 0.015 230)",
                          }}
                        >
                          {log.resourceId ?? "—"}
                        </span>
                        {isReversal && meta.originalAmount != null && (
                          <div
                            className="text-xs mt-0.5"
                            style={{ color: RED, fontFamily: MONO }}
                          >
                            ₦
                            {Number(
                              meta.originalAmount as number
                            ).toLocaleString("en-NG", {
                              minimumFractionDigits: 2,
                            })}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="px-2 py-0.5 rounded-full text-xs font-semibold"
                          style={{
                            background:
                              log.status === "success"
                                ? "oklch(0.65 0.18 160 / 0.15)"
                                : "oklch(0.60 0.22 25 / 0.15)",
                            color: log.status === "success" ? GREEN : RED,
                            fontFamily: DISP,
                          }}
                        >
                          {log.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div
            className="flex items-center justify-between text-xs text-gray-500"
            style={{ fontFamily: DISP }}
          >
            <span>Page {page + 1}</span>
            <div className="flex gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 rounded-lg disabled:opacity-40"
                style={{ background: CARD, color: "white" }}
              >
                ← Prev
              </button>
              <button
                disabled={(data ?? []).length < limit}
                onClick={() => setPage(p => p + 1)}
                className="px-3 py-1.5 rounded-lg disabled:opacity-40"
                style={{ background: CARD, color: "white" }}
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Analytics Tab ────────────────────────────────────────────────────────────
function AnalyticsTab() {
  const [fromDate, setFromDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split("T")[0];
  });
  const [toDate, setToDate] = useState<string>(
    () => new Date().toISOString().split("T")[0]
  );
  const [exporting, setExporting] = useState(false);

  const { refetch: fetchCsv } = trpc.export.transactionsCsv.useQuery(
    { from: fromDate, to: toDate },
    { enabled: false }
  );

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await fetchCsv();
      const data = result.data;
      if (!data) throw new Error("No data returned");
      const blob = new Blob([data.csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `insureportal-transactions-${fromDate}-to-${toDate}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Exported ${data.rowCount} transactions`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Export failed";
      toast.error(msg);
    } finally {
      setExporting(false);
    }
  };

  // Live chart data from server
  const { data: adminHourlyData } = trpc.transactions.adminHourlyStats.useQuery(
    undefined,
    {
      refetchInterval: 60_000,
      retry: false,
    }
  );
  // Fallback to stable placeholder if not yet loaded (avoids re-render flicker)
  const [fallbackVolume] = useState(() =>
    Array.from({ length: 12 }, (_, i) => ({
      hour: `${(8 + i).toString().padStart(2, "0")}:00`,
      volume: 0,
      count: 0,
    }))
  );
  const hourlyVolume =
    adminHourlyData && adminHourlyData.length > 0
      ? adminHourlyData
      : fallbackVolume;

  const { data: statsByTypeRaw } = trpc.transactions.statsByType.useQuery(
    undefined,
    {
      refetchInterval: 120_000,
      retry: false,
    }
  );
  const [paInput] = useState(() => ({ startDate: fromDate, endDate: toDate }));
  const { data: platformAnalyticsData } =
    trpc.transactions.platformAnalytics.useQuery(paInput, {
      refetchInterval: 300_000,
      retry: false,
    });
  // Map live data to recharts-compatible shape with stable colours
  const TYPE_COLORS: Record<string, string> = {
    "Cash In": GREEN,
    "Cash Out": BLUE,
    Transfer: "#8b5cf6",
    Airtime: GOLD,
    "Bill Payment": "#ec4899",
    "Card Payment": "#06b6d4",
    "QR Payment": "#f97316",
    "NFC Payment": "#84cc16",
    "Nano Loan": "#e11d48",
    Insurance: "#0ea5e9",
    Reversal: "#6b7280",
  };
  const txTypeData =
    statsByTypeRaw && statsByTypeRaw.length > 0
      ? statsByTypeRaw.map((d, i) => ({
          name: d.type,
          value: d.percentage,
          count: d.count,
          volume: d.volume,
          color: TYPE_COLORS[d.type] ?? `hsl(${(i * 47) % 360}, 70%, 55%)`,
        }))
      : [
          { name: "Cash In", value: 35, count: 0, volume: 0, color: GREEN },
          { name: "Cash Out", value: 28, count: 0, volume: 0, color: BLUE },
          {
            name: "Transfer",
            value: 18,
            count: 0,
            volume: 0,
            color: "#8b5cf6",
          },
          { name: "Airtime", value: 10, count: 0, volume: 0, color: GOLD },
          {
            name: "Bill Payment",
            value: 9,
            count: 0,
            volume: 0,
            color: "#ec4899",
          },
        ];

  return (
    <div className="flex flex-col gap-6">
      {/* Platform Analytics Summary */}
      {platformAnalyticsData?.data != null && (
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div className="flex items-center justify-between mb-3">
            <div
              className="text-sm font-bold text-gray-300"
              style={{ fontFamily: DISP }}
            >
              Platform Analytics Summary
            </div>
            <span
              className="text-xs px-2 py-0.5 rounded-full"
              style={{
                background:
                  platformAnalyticsData.source === "platform"
                    ? "#14532d"
                    : "#1c1917",
                color:
                  platformAnalyticsData.source === "platform"
                    ? "#4ade80"
                    : "#a8a29e",
                fontFamily: MONO,
              }}
            >
              {platformAnalyticsData.source === "platform"
                ? "● analytics-service"
                : "● local DB fallback"}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[
              {
                label: "Total Transactions",
                value: (
                  (platformAnalyticsData.data as any).total_transactions ?? 0
                ).toLocaleString(),
              },
              {
                label: "Total Volume",
                value: `₦${((platformAnalyticsData.data as any).total_volume ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
              },
              {
                label: "Success Rate",
                value: `${((platformAnalyticsData.data as any).success_rate ?? 0).toFixed(1)}%`,
              },
            ].map(kpi => (
              <div
                key={kpi.label}
                className="rounded-xl p-3"
                style={{ background: BG }}
              >
                <div
                  className="text-xs text-gray-500 mb-1"
                  style={{ fontFamily: DISP }}
                >
                  {kpi.label}
                </div>
                <div
                  className="text-xl font-bold text-white"
                  style={{ fontFamily: MONO }}
                >
                  {kpi.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* CSV Export Controls */}
      <div
        className="rounded-2xl p-4 flex flex-wrap items-end gap-4"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <div className="flex flex-col gap-1">
          <label
            className="text-xs text-gray-500 uppercase tracking-widest"
            style={{ fontFamily: DISP }}
          >
            From Date
          </label>
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm text-white outline-none"
            style={{
              background: BG,
              border: `1px solid ${BORDER}`,
              fontFamily: MONO,
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label
            className="text-xs text-gray-500 uppercase tracking-widest"
            style={{ fontFamily: DISP }}
          >
            To Date
          </label>
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="rounded-lg px-3 py-2 text-sm text-white outline-none"
            style={{
              background: BG,
              border: `1px solid ${BORDER}`,
              fontFamily: MONO,
            }}
          />
        </div>
        <button
          onClick={handleExport}
          disabled={exporting}
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all"
          style={{
            background: exporting ? "#374151" : GREEN,
            color: exporting ? "#9ca3af" : "#000",
            fontFamily: DISP,
            cursor: exporting ? "not-allowed" : "pointer",
          }}
        >
          {exporting ? "⏳ Exporting..." : "⬇ Download CSV"}
        </button>
        <div
          className="text-xs text-gray-500 ml-auto"
          style={{ fontFamily: DISP }}
        >
          Exports all transactions for the selected date range as a CSV file
        </div>
      </div>
      <div>
        <div
          className="text-sm font-bold text-gray-300 mb-3"
          style={{ fontFamily: DISP }}
        >
          Hourly Transaction Volume
        </div>
        <div
          className="rounded-2xl p-4"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={hourlyVolume}>
              <defs>
                <linearGradient id="adminVol" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={GREEN} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={GREEN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="hour"
                tick={{
                  fill: "#6b7280",
                  fontSize: 10,
                  fontFamily: "JetBrains Mono",
                }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{
                  fill: "#6b7280",
                  fontSize: 10,
                  fontFamily: "JetBrains Mono",
                }}
                axisLine={false}
                tickLine={false}
                tickFormatter={v => fmtShort(v)}
              />
              <Tooltip
                contentStyle={{
                  background: BG,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 12,
                  fontFamily: "Space Grotesk",
                }}
                formatter={(v: any) => [fmtShort(v), "Volume"]}
              />
              <Area
                type="monotone"
                dataKey="volume"
                stroke={GREEN}
                strokeWidth={2}
                fill="url(#adminVol)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <div
            className="text-sm font-bold text-gray-300 mb-3"
            style={{ fontFamily: DISP }}
          >
            Transaction Mix
          </div>
          <div
            className="rounded-2xl p-4 flex flex-col items-center"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={txTypeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={70}
                  dataKey="value"
                  paddingAngle={3}
                >
                  {txTypeData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    fontFamily: "Space Grotesk",
                  }}
                  formatter={(v: any) => [`${v}%`, ""]}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
              {txTypeData.map(d => (
                <div key={d.name} className="flex items-center gap-1">
                  <div
                    className="w-2 h-2 rounded-full"
                    style={{ background: d.color }}
                  />
                  <span
                    className="text-xs text-gray-400"
                    style={{ fontFamily: DISP }}
                  >
                    {d.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div>
          <div
            className="text-sm font-bold text-gray-300 mb-3"
            style={{ fontFamily: DISP }}
          >
            Daily Tx Count
          </div>
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={hourlyVolume.slice(0, 8)}>
                <XAxis
                  dataKey="hour"
                  tick={{
                    fill: "#6b7280",
                    fontSize: 9,
                    fontFamily: "JetBrains Mono",
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fill: "#6b7280", fontSize: 9 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: BG,
                    border: `1px solid ${BORDER}`,
                    borderRadius: 8,
                    fontFamily: "Space Grotesk",
                  }}
                />
                <Bar dataKey="count" fill={BLUE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
      {/* Link to full real-time analytics dashboard */}
      <div
        className="rounded-2xl p-4 flex items-center justify-between"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <div>
          <div
            className="text-sm font-bold text-gray-200"
            style={{ fontFamily: DISP }}
          >
            Real-Time Analytics Dashboard
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            MQTT throughput · ERP sync success rate · Live metrics with 30s
            auto-refresh
          </div>
        </div>
        <a
          href="/admin/analytics"
          className="px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2"
          style={{ background: BLUE, color: "#fff", textDecoration: "none" }}
        >
          📊 Open Dashboard
        </a>
      </div>
    </div>
  );
}

// ─── Settlement Panel ────────────────────────────────────────────────────────
function SettlementPanel() {
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{
    agentCount: number;
    smsSent: number;
    errors: string[];
    runAt: Date;
  } | null>(null);

  const { data: lastRun } = trpc.settlement.getLastRun.useQuery(undefined, {
    refetchInterval: 30_000,
  });

  const runNow = trpc.settlement.runNow.useMutation({
    onMutate: () => setRunning(true),
    onSuccess: data => {
      setRunning(false);
      setLastResult(data);
      toast.success(
        `Settlement complete — ${data.agentCount} agents processed, ${data.smsSent} SMS sent${
          data.errors.length > 0 ? ` (${data.errors.length} errors)` : ""
        }`
      );
    },
    onError: (e: any) => {
      setRunning(false);
      toast.error(`Settlement failed: ${e.message}`);
    },
  });

  // Normalize lastRun shape to include errors array
  const normalizedLastRun = lastRun
    ? {
        agentCount: lastRun.agentCount,
        smsSent: lastRun.smsSent,
        errors: [] as string[],
        runAt: lastRun.runAt,
      }
    : null;
  const result = lastResult ?? normalizedLastRun;

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: CARD, border: `1px solid ${BORDER}` }}
    >
      <div className="flex items-center justify-between">
        <div>
          <div
            className="text-sm font-black text-white"
            style={{ fontFamily: DISP }}
          >
            Daily Settlement
          </div>
          <div
            className="text-xs text-gray-500 mt-0.5"
            style={{ fontFamily: DISP }}
          >
            Cron: 17:00 WAT (16:00 UTC) Mon–Fri · Sends SMS summaries to all
            active agents
          </div>
        </div>
        <button
          onClick={() => runNow.mutate()}
          disabled={running}
          className="px-4 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: running
              ? "oklch(0.65 0.18 160 / 0.2)"
              : "oklch(0.65 0.18 160 / 0.3)",
            color: GREEN,
            border: `1px solid ${GREEN}`,
            fontFamily: DISP,
          }}
        >
          {running ? "⏳ Running…" : "▶ Run Settlement Now"}
        </button>
      </div>

      {result && (
        <div className="grid grid-cols-3 gap-3">
          <div
            className="rounded-xl p-3 text-center"
            style={{ background: BG, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xl font-black"
              style={{ color: GREEN, fontFamily: MONO }}
            >
              {result.agentCount}
            </div>
            <div
              className="text-xs text-gray-500 mt-1"
              style={{ fontFamily: DISP }}
            >
              Agents Processed
            </div>
          </div>
          <div
            className="rounded-xl p-3 text-center"
            style={{ background: BG, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xl font-black"
              style={{ color: BLUE, fontFamily: MONO }}
            >
              {result.smsSent}
            </div>
            <div
              className="text-xs text-gray-500 mt-1"
              style={{ fontFamily: DISP }}
            >
              SMS Sent
            </div>
          </div>
          <div
            className="rounded-xl p-3 text-center"
            style={{ background: BG, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xl font-black"
              style={{
                color: result.errors.length > 0 ? RED : GREEN,
                fontFamily: MONO,
              }}
            >
              {result.errors.length}
            </div>
            <div
              className="text-xs text-gray-500 mt-1"
              style={{ fontFamily: DISP }}
            >
              Errors
            </div>
          </div>
        </div>
      )}

      {result && (
        <div className="text-xs text-gray-600" style={{ fontFamily: MONO }}>
          Last run: {new Date(result.runAt).toLocaleString("en-NG")}
          {result.errors.length > 0 && (
            <div className="mt-1" style={{ color: RED }}>
              Errors: {result.errors.slice(0, 3).join(" · ")}
              {result.errors.length > 3 && ` +${result.errors.length - 3} more`}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Settlement History Tab ─────────────────────────────────────────────────
function SettlementHistoryTab() {
  const [page, setPage] = useState(0);
  const limit = 20;
  const { data: historyData, isLoading: histLoading } =
    trpc.settlement.getHistory.useQuery(
      { limit, offset: page * limit },
      { refetchInterval: 60_000 }
    );
  const { data: outstandingData, isLoading: outLoading } =
    trpc.settlement.getOutstanding.useQuery(undefined, {
      refetchInterval: 60_000,
    });

  const settlements = (historyData?.settlements ?? []) as any[];
  const outstanding = (outstandingData?.outstanding ?? []) as any[];

  return (
    <div className="flex flex-col gap-6">
      <div
        className="text-lg font-black text-white"
        style={{ fontFamily: DISP }}
      >
        Settlement Management
      </div>

      {/* Outstanding settlements for today */}
      <div
        className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <div className="flex items-center justify-between">
          <div>
            <div
              className="text-sm font-black text-white"
              style={{ fontFamily: DISP }}
            >
              Outstanding Today
            </div>
            <div
              className="text-xs text-gray-500 mt-0.5"
              style={{ fontFamily: DISP }}
            >
              Agents with unsettled transactions for{" "}
              {new Date().toLocaleDateString("en-NG")}
            </div>
          </div>
          <span
            className="text-xs px-3 py-1 rounded-full font-bold"
            style={{
              background: "oklch(0.78 0.18 80 / 0.2)",
              color: GOLD,
              fontFamily: MONO,
            }}
          >
            {outstanding.length} agents
          </span>
        </div>
        {outLoading ? (
          <div
            className="text-center py-4 text-gray-500"
            style={{ fontFamily: DISP }}
          >
            Loading...
          </div>
        ) : outstanding.length === 0 ? (
          <div
            className="text-center py-4 text-gray-600"
            style={{ fontFamily: DISP }}
          >
            No outstanding settlements today
          </div>
        ) : (
          <div
            className="overflow-x-auto rounded-xl"
            style={{ border: `1px solid ${BORDER}` }}
          >
            <table className="w-full text-xs">
              <thead>
                <tr
                  style={{
                    background: BG,
                    borderBottom: `1px solid ${BORDER}`,
                  }}
                >
                  {[
                    "Agent",
                    "Name",
                    "Tx Count",
                    "Volume",
                    "Commission",
                    "Date",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-3 text-left font-semibold text-gray-400 uppercase tracking-wider"
                      style={{ fontFamily: DISP }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {outstanding.map((row: any, i: number) => (
                  <tr
                    key={row.agentId}
                    style={{
                      background: i % 2 === 0 ? CARD : BG,
                      borderBottom: `1px solid ${BORDER}`,
                    }}
                  >
                    <td
                      className="px-3 py-2 font-bold"
                      style={{ color: BLUE, fontFamily: MONO }}
                    >
                      {row.agentId}
                    </td>
                    <td
                      className="px-3 py-2 text-gray-300"
                      style={{ fontFamily: DISP }}
                    >
                      {row.agentName}
                    </td>
                    <td
                      className="px-3 py-2 text-gray-400"
                      style={{ fontFamily: MONO }}
                    >
                      {row.txCount}
                    </td>
                    <td
                      className="px-3 py-2 font-bold"
                      style={{ color: GOLD, fontFamily: MONO }}
                    >
                      {fmt(row.totalVolume)}
                    </td>
                    <td
                      className="px-3 py-2 font-bold"
                      style={{ color: GREEN, fontFamily: MONO }}
                    >
                      {fmt(row.totalCommission)}
                    </td>
                    <td
                      className="px-3 py-2 text-gray-500"
                      style={{ fontFamily: MONO }}
                    >
                      {row.date}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Settlement run history */}
      <div
        className="rounded-2xl p-5 flex flex-col gap-4"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        <div
          className="text-sm font-black text-white"
          style={{ fontFamily: DISP }}
        >
          Settlement Run History
        </div>
        {histLoading ? (
          <div
            className="text-center py-4 text-gray-500"
            style={{ fontFamily: DISP }}
          >
            Loading...
          </div>
        ) : settlements.length === 0 ? (
          <div
            className="text-center py-4 text-gray-600"
            style={{ fontFamily: DISP }}
          >
            No settlement runs recorded yet
          </div>
        ) : (
          <>
            <div
              className="overflow-x-auto rounded-xl"
              style={{ border: `1px solid ${BORDER}` }}
            >
              <table className="w-full text-xs">
                <thead>
                  <tr
                    style={{
                      background: BG,
                      borderBottom: `1px solid ${BORDER}`,
                    }}
                  >
                    {["Run At", "Agents", "SMS Sent", "Errors", "Status"].map(
                      h => (
                        <th
                          key={h}
                          className="px-3 py-3 text-left font-semibold text-gray-400 uppercase tracking-wider"
                          style={{ fontFamily: DISP }}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {settlements.map((s: any, i: number) => (
                    <tr
                      key={s.id ?? i}
                      style={{
                        background: i % 2 === 0 ? CARD : BG,
                        borderBottom: `1px solid ${BORDER}`,
                      }}
                    >
                      <td
                        className="px-3 py-2 text-gray-400"
                        style={{ fontFamily: MONO }}
                      >
                        {new Date(s.runAt).toLocaleString("en-NG")}
                      </td>
                      <td
                        className="px-3 py-2 font-bold"
                        style={{ color: GREEN, fontFamily: MONO }}
                      >
                        {s.agentCount}
                      </td>
                      <td
                        className="px-3 py-2 font-bold"
                        style={{ color: BLUE, fontFamily: MONO }}
                      >
                        {s.smsSent}
                      </td>
                      <td className="px-3 py-2">
                        {(s.errors?.length ?? 0) > 0 ? (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-bold"
                            style={{
                              background: "oklch(0.60 0.22 25 / 0.2)",
                              color: RED,
                              fontFamily: MONO,
                            }}
                          >
                            {s.errors.length} error
                            {s.errors.length > 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-bold"
                            style={{
                              background: "oklch(0.65 0.18 160 / 0.2)",
                              color: GREEN,
                              fontFamily: MONO,
                            }}
                          >
                            Clean
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-bold"
                          style={{
                            background:
                              s.status === "success"
                                ? "oklch(0.65 0.18 160 / 0.2)"
                                : "oklch(0.78 0.18 80 / 0.2)",
                            color: s.status === "success" ? GREEN : GOLD,
                            fontFamily: DISP,
                          }}
                        >
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                style={{
                  background: "oklch(0.60 0.22 260 / 0.2)",
                  color: BLUE,
                  fontFamily: DISP,
                }}
              >
                ← Prev
              </button>
              <span
                className="text-xs text-gray-500 self-center"
                style={{ fontFamily: MONO }}
              >
                Page {page + 1}
              </span>
              <button
                onClick={() => setPage(p => p + 1)}
                disabled={settlements.length < limit}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                style={{
                  background: "oklch(0.60 0.22 260 / 0.2)",
                  color: BLUE,
                  fontFamily: DISP,
                }}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Main AdminPanel component ────────────────────────────────────────────────
export default function AdminPanel() {
  // Read ?tab= from URL so notification clicks open the correct tab directly
  const initialTab = (new URLSearchParams(window.location.search).get("tab") ??
    "overview") as
    | "overview"
    | "fraud"
    | "audit"
    | "analytics"
    | "agents"
    | "topup"
    | "devices"
    | "disputes"
    | "security"
    | "geofencing"
    | "settlement"
    | "fluvio"
    | "erp"
    | "fraud-rules"
    | "sysconfig"
    | "sim-orch"
    | "failover"
    | "mqtt"
    | "coverage";
  const [tab, setTab] = useState<
    | "overview"
    | "fraud"
    | "audit"
    | "analytics"
    | "agents"
    | "topup"
    | "devices"
    | "disputes"
    | "security"
    | "geofencing"
    | "settlement"
    | "fluvio"
    | "erp"
    | "fraud-rules"
    | "sysconfig"
    | "sim-orch"
    | "failover"
    | "mqtt"
    | "coverage"
  >(initialTab);
  const agent = usePosStore(s => s.agent);
  const fraudEvents = usePosStore(s => s.fraudEvents);
  const unreadFraud = usePosStore(s => s.unreadFraudCount);
  const clearFraudCount = usePosStore(s => s.clearFraudCount);

  // Connect to Socket.IO for live fraud events
  useFraudSocket();

  // Load recent transactions for KPIs
  const { data: txList } = trpc.transactions.list.useQuery({ limit: 100 });

  // 7-day success rate from Python analytics service
  const { data: successRateData } = trpc.resilience.successRate.useQuery(
    { days: 7 },
    {
      refetchInterval: 60_000,
      retry: false,
    }
  );
  const successRatePct: number | null =
    (successRateData as any)?.success_rate_pct ?? null;
  const successTier: string | null = (successRateData as any)?.tier ?? null;

  // ── Access guard — requires authenticated agent with admin role ─────────────
  if (!agent) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: BG }}
      >
        <div className="text-center">
          <div className="text-4xl mb-4">🔒</div>
          <div
            className="text-xl font-bold text-white mb-2"
            style={{ fontFamily: DISP }}
          >
            Authentication Required
          </div>
          <div
            className="text-sm text-gray-500 mb-6"
            style={{ fontFamily: DISP }}
          >
            Please log in to access the admin panel.
          </div>
          <a
            href="/"
            className="px-6 py-3 rounded-xl font-bold text-white"
            style={{ background: BLUE, fontFamily: DISP }}
          >
            ← Return to POS
          </a>
        </div>
      </div>
    );
  }

  if (agent.role !== "admin") {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: BG }}
      >
        <div className="text-center">
          <div className="text-4xl mb-4">🚫</div>
          <div
            className="text-xl font-bold text-white mb-2"
            style={{ fontFamily: DISP }}
          >
            Access Denied
          </div>
          <div
            className="text-sm text-gray-500 mb-2"
            style={{ fontFamily: DISP }}
          >
            This panel requires supervisor privileges.
          </div>
          <div
            className="text-xs text-gray-600 mb-6"
            style={{ fontFamily: MONO }}
          >
            Your role: <span style={{ color: GOLD }}>{agent.role}</span>
          </div>
          <a
            href="/"
            className="px-6 py-3 rounded-xl font-bold text-white"
            style={{ background: BLUE, fontFamily: DISP }}
          >
            ← Return to POS Terminal
          </a>
        </div>
      </div>
    );
  }

  // ── KPI calculations ──────────────────────────────────────────────────────────
  const totalVolume = (txList ?? []).reduce(
    (s: any, t: any) => s + t.amount,
    0
  );
  const totalCommission = (txList ?? []).reduce(
    (s: any, t: any) => s + t.commission,
    0
  );
  const criticalFraud = fraudEvents.filter(
    e => e.severity === "critical"
  ).length;
  const fraudRate =
    txList && txList.length > 0
      ? ((criticalFraud / txList.length) * 100).toFixed(2)
      : "0.00";

  const { data: topupRequests } = trpc.agentMgmt.listTopUpRequests.useQuery({
    status: "pending",
  });
  const pendingTopUps = topupRequests?.length ?? 0;

  const tabs = [
    { id: "overview" as const, label: "Overview", icon: "⬡" },
    {
      id: "fraud" as const,
      label: "Fraud Feed",
      icon: "⚠",
      badge: unreadFraud,
    },
    { id: "audit" as const, label: "Audit Log", icon: "📋" },
    { id: "analytics" as const, label: "Analytics", icon: "📊" },
    { id: "agents" as const, label: "Agents", icon: "👥" },
    {
      id: "topup" as const,
      label: "Float Req",
      icon: "💰",
      badge: pendingTopUps,
    },
    { id: "devices" as const, label: "Devices", icon: "📱" },
    { id: "disputes" as const, label: "Disputes", icon: "⚖️" },
    { id: "security" as const, label: "Security", icon: "🔐" },
    { id: "geofencing" as const, label: "Geofencing", icon: "📍" },
    { id: "settlement" as const, label: "Settlement", icon: "💳" },
    { id: "fluvio" as const, label: "Fluvio Stream", icon: "📡" },
    { id: "erp" as const, label: "ERP Integration", icon: "🏢" },
    { id: "fraud-rules" as const, label: "Fraud Rules", icon: "🛡" },
    { id: "sysconfig" as const, label: "System Config", icon: "⚙️" },
    { id: "sim-orch" as const, label: "SIM Orchestrator", icon: "📶" },
    { id: "failover" as const, label: "Failover Log", icon: "🔄" },
    { id: "mqtt" as const, label: "MQTT Bridge", icon: "🌐" },
    { id: "coverage" as const, label: "Coverage Map", icon: "🗺️" },
  ];

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: BG, fontFamily: DISP }}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b"
        style={{ background: CARD, borderColor: BORDER }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black"
            style={{ background: "oklch(0.60 0.22 260 / 0.3)", color: BLUE }}
          >
            ⬡
          </div>
          <div>
            <div
              className="text-sm font-black text-white"
              style={{ fontFamily: DISP }}
            >
              InsurePortal Admin
            </div>
            <div className="text-xs text-gray-500" style={{ fontFamily: MONO }}>
              Supervisor Dashboard
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ background: GREEN }}
            />
            <span
              className="text-xs text-gray-400"
              style={{ fontFamily: MONO }}
            >
              Live
            </span>
          </div>
          <div className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
            Logged in as{" "}
            <span className="text-white font-semibold">{agent.agentId}</span>
          </div>
          <a
            href="/"
            className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              background: "oklch(0.60 0.22 260 / 0.2)",
              color: BLUE,
              fontFamily: DISP,
            }}
          >
            ← POS Terminal
          </a>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Sidebar nav ──────────────────────────────────────────────────── */}
        <div
          className="w-48 flex-shrink-0 flex flex-col gap-1 p-3 border-r"
          style={{ background: CARD, borderColor: BORDER }}
        >
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id);
                if (t.id === "fraud") clearFraudCount();
              }}
              className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all text-left relative"
              style={{
                background:
                  tab === t.id ? "oklch(0.60 0.22 260 / 0.2)" : "transparent",
                color: tab === t.id ? BLUE : "oklch(0.55 0.015 230)",
                fontFamily: DISP,
              }}
            >
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {t.badge && t.badge > 0 && (
                <span
                  className="absolute right-2 top-1.5 w-5 h-5 rounded-full text-xs font-black flex items-center justify-center"
                  style={{ background: RED, color: "white", fontFamily: MONO }}
                >
                  {t.badge > 9 ? "9+" : t.badge}
                </span>
              )}
            </button>
          ))}

          <div
            className="mt-auto pt-4 border-t"
            style={{ borderColor: BORDER }}
          >
            <div
              className="text-xs text-gray-600 px-2 mb-2"
              style={{ fontFamily: DISP }}
            >
              Quick Stats
            </div>
            <div className="px-2 flex flex-col gap-2">
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Tx Today</span>
                <span
                  className="font-bold"
                  style={{ color: GREEN, fontFamily: MONO }}
                >
                  {txList?.length ?? 0}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Fraud Alerts</span>
                <span
                  className="font-bold"
                  style={{ color: RED, fontFamily: MONO }}
                >
                  {fraudEvents.length}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-gray-500">Volume</span>
                <span
                  className="font-bold"
                  style={{ color: GOLD, fontFamily: MONO }}
                >
                  {fmtShort(totalVolume)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6">
          {tab === "overview" && (
            <div className="flex flex-col gap-6">
              <div
                className="text-lg font-black text-white"
                style={{ fontFamily: DISP }}
              >
                Platform Overview
              </div>

              {/* KPI grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  label="Total Volume"
                  value={fmtShort(totalVolume)}
                  sub="Today"
                  color={GREEN}
                />
                <KpiCard
                  label="Total Commission"
                  value={fmtShort(totalCommission)}
                  sub="Earned today"
                  color={GOLD}
                />
                <KpiCard
                  label="Fraud Rate"
                  value={`${fraudRate}%`}
                  sub={`${criticalFraud} critical alerts`}
                  color={criticalFraud > 0 ? RED : GREEN}
                />
                <KpiCard
                  label="Transactions"
                  value={String(txList?.length ?? 0)}
                  sub="Processed today"
                  color={BLUE}
                />
              </div>

              {/* 7-day success rate KPI (Python analytics service) */}
              {successRatePct !== null && (
                <div
                  className="flex items-center gap-4 p-4 rounded-xl"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div
                    className="text-3xl font-black"
                    style={{
                      color:
                        successTier === "Excellent"
                          ? GREEN
                          : successTier === "Good"
                            ? BLUE
                            : successTier === "Fair"
                              ? GOLD
                              : RED,
                      fontFamily: MONO,
                    }}
                  >
                    {successRatePct.toFixed(1)}%
                  </div>
                  <div>
                    <div
                      className="text-sm font-bold text-white"
                      style={{ fontFamily: DISP }}
                    >
                      7-Day Transaction Success Rate
                    </div>
                    <div
                      className="text-xs"
                      style={{
                        color:
                          successTier === "Excellent"
                            ? GREEN
                            : successTier === "Good"
                              ? BLUE
                              : successTier === "Fair"
                                ? GOLD
                                : RED,
                        fontFamily: MONO,
                      }}
                    >
                      {successTier} — powered by analytics-service (Python)
                    </div>
                  </div>
                </div>
              )}

              {/* Settlement trigger */}
              <SettlementPanel />

              {/* Recent transactions table */}
              <div>
                <div
                  className="text-sm font-bold text-gray-300 mb-3"
                  style={{ fontFamily: DISP }}
                >
                  Recent Transactions
                </div>
                <div
                  className="overflow-x-auto rounded-xl"
                  style={{ border: `1px solid ${BORDER}` }}
                >
                  <table className="w-full text-xs">
                    <thead>
                      <tr
                        style={{
                          background: CARD,
                          borderBottom: `1px solid ${BORDER}`,
                        }}
                      >
                        {[
                          "Ref",
                          "Type",
                          "Amount",
                          "Customer",
                          "Channel",
                          "Status",
                          "Time",
                        ].map(h => (
                          <th
                            key={h}
                            className="px-3 py-3 text-left font-semibold text-gray-400 uppercase tracking-wider"
                            style={{ fontFamily: DISP }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(txList ?? []).slice(0, 15).map((tx: any, i: number) => (
                        <tr
                          key={tx.id}
                          style={{
                            background: i % 2 === 0 ? BG : CARD,
                            borderBottom: `1px solid ${BORDER}`,
                          }}
                        >
                          <td
                            className="px-3 py-2 text-gray-400"
                            style={{ fontFamily: MONO }}
                          >
                            {tx.ref}
                          </td>
                          <td
                            className="px-3 py-2 font-semibold text-white"
                            style={{ fontFamily: DISP }}
                          >
                            {tx.type}
                          </td>
                          <td
                            className="px-3 py-2 font-bold"
                            style={{ color: GOLD, fontFamily: MONO }}
                          >
                            {fmt(tx.amount)}
                          </td>
                          <td
                            className="px-3 py-2 text-gray-400"
                            style={{ fontFamily: DISP }}
                          >
                            {tx.customerName ?? tx.customerPhone ?? "—"}
                          </td>
                          <td
                            className="px-3 py-2 text-gray-500"
                            style={{ fontFamily: DISP }}
                          >
                            {tx.channel}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className="px-2 py-0.5 rounded-full text-xs font-semibold"
                              style={{
                                background:
                                  tx.status === "success"
                                    ? "oklch(0.65 0.18 160 / 0.15)"
                                    : "oklch(0.60 0.22 25 / 0.15)",
                                color: tx.status === "success" ? GREEN : RED,
                                fontFamily: DISP,
                              }}
                            >
                              {tx.status}
                            </span>
                          </td>
                          <td
                            className="px-3 py-2 text-gray-500"
                            style={{ fontFamily: MONO }}
                          >
                            {new Date(tx.createdAt).toLocaleTimeString("en-NG")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === "fraud" && <FraudFeedTab />}
          {tab === "audit" && <AuditLogTab />}
          {tab === "analytics" && <AnalyticsTab />}
          {tab === "agents" && <AgentManagementTab />}
          {tab === "topup" && <FloatTopUpTab />}
          {tab === "devices" && <MDMTab />}
          {tab === "disputes" && <DisputesAdminTab />}
          {tab === "security" && <SecurityTab />}
          {tab === "geofencing" && <GeofencingTab />}
          {tab === "settlement" && <SettlementHistoryTab />}
          {tab === "fluvio" && <FluvioStreamTab />}
          {tab === "erp" && <ERPConfigTab />}
          {tab === "fraud-rules" && <FraudRulesTab />}
          {tab === "sysconfig" && <SystemConfigTab />}
          {tab === "sim-orch" && <SimOrchestratorTab />}
          {tab === "failover" && <FailoverHistoryTab />}
          {tab === "mqtt" && <MQTTBridgeTab />}
          {tab === "coverage" && <CoverageMap />}
        </div>
      </div>
    </div>
  );
}
