// SECURITY: SQL template literals in this file are for display/mock purposes only. All actual DB queries use parameterized Drizzle ORM.
/**
 * InsurePortal — Real-Time Fraud Detection Admin Dashboard
 * Design: Bloomberg Terminal dark — near-black bg, electric-red alerts, emerald safe
 * Features: Live feed, risk heatmap, SHAP explanations, agent network graph, case management
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { useFraudSocket } from "../hooks/useSocket";
import { usePosStore } from "../store/posStore";
import { trpc } from "../lib/trpc";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Cell,
  LineChart,
  Line,
} from "recharts";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const BG = "oklch(0.08 0.012 240)";
const CARD = "oklch(0.12 0.015 240)";
const CARD2 = "oklch(0.15 0.015 240)";
const BORDER = "oklch(0.22 0.015 240)";
const RED = "#ef4444";
const ORANGE = "#f97316";
const GOLD = "#f59e0b";
const GREEN = "#10b981";
const BLUE = "#3b82f6";
const CYAN = "#06b6d4";
const PURPLE = "#8b5cf6";
const DISP = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

// ─── Types ────────────────────────────────────────────────────────────────────
type Severity = "critical" | "high" | "medium" | "low";
type CaseStatus = "open" | "investigating" | "resolved" | "escalated";

interface FraudEvent {
  id: string;
  agentId: string;
  agentName: string;
  location: string;
  txType: string;
  amount: number;
  customer: string;
  riskScore: number;
  severity: Severity;
  reason: string;
  time: string;
  timestamp: number;
  status: CaseStatus;
  channel: string;
  shapFeatures: { name: string; value: number; direction: "risk" | "safe" }[];
}

interface AgentRisk {
  agentId: string;
  agentName: string;
  location: string;
  riskScore: number;
  txCount: number;
  flaggedCount: number;
  tier: string;
}

// ─── Mock Data Generators ─────────────────────────────────────────────────────
const AGENTS = [
  {
    code: "AG-LOS-004821",
    name: "Adaeze Okonkwo",
    location: "Ikeja, Lagos",
    tier: "Gold",
  },
  {
    code: "AG-ABJ-002341",
    name: "Emeka Eze",
    location: "Wuse, Abuja",
    tier: "Silver",
  },
  {
    code: "AG-KAN-007812",
    name: "Aminu Garba",
    location: "Kano City",
    tier: "Platinum",
  },
  {
    code: "AG-PHC-003219",
    name: "Chioma Obi",
    location: "Port Harcourt",
    tier: "Gold",
  },
  {
    code: "AG-IBD-005543",
    name: "Tunde Bakare",
    location: "Ibadan, Oyo",
    tier: "Bronze",
  },
  {
    code: "AG-ENU-001187",
    name: "Ngozi Adeyemi",
    location: "Enugu",
    tier: "Silver",
  },
  {
    code: "AG-KAD-009934",
    name: "Musa Aliyu",
    location: "Kaduna",
    tier: "Bronze",
  },
  {
    code: "AG-LOS-008876",
    name: "Biodun Olatunji",
    location: "Victoria Island",
    tier: "Platinum",
  },
];

const TX_TYPES = [
  "Premium Payment",
  "Claim Payout",
  "Transfer",
  "Card Payment",
  "Airtime",
  "Bill Payment",
];
const REASONS = [
  "Transaction velocity exceeded 3× normal rate",
  "Amount 4.2σ above agent 30-day mean",
  "Structuring pattern detected across 3 accounts",
  "Customer account opened < 24 hours ago",
  "Unusual time-of-day pattern (2:14 AM)",
  "Multiple failed PIN attempts before success",
  "Geographic anomaly — 400km from usual location",
  "Round-amount clustering (₦50K × 4 in 1 hour)",
];

const SHAP_TEMPLATES = [
  [
    {
      name: "Transaction velocity (1h)",
      value: 0.34,
      direction: "risk" as const,
    },
    { name: "Amount deviation", value: 0.28, direction: "risk" as const },
    { name: "Time of day anomaly", value: 0.18, direction: "risk" as const },
    { name: "Account age", value: 0.12, direction: "safe" as const },
    { name: "Agent trust score", value: 0.08, direction: "safe" as const },
  ],
  [
    {
      name: "Round-amount clustering",
      value: 0.41,
      direction: "risk" as const,
    },
    { name: "Beneficiary age", value: 0.22, direction: "risk" as const },
    { name: "Geographic anomaly", value: 0.19, direction: "risk" as const },
    { name: "Historical behaviour", value: 0.15, direction: "safe" as const },
    { name: "KYC tier", value: 0.03, direction: "safe" as const },
  ],
];

let _eventCounter = 0;
function generateEvent(): FraudEvent {
  _eventCounter++;
  const agent = AGENTS[Math.floor(Math.random() * AGENTS.length)];
  const risk = Math.floor(Math.random() * 60) + 40;
  const severity: Severity =
    risk >= 85
      ? "critical"
      : risk >= 70
        ? "high"
        : risk >= 55
          ? "medium"
          : "low";
  const now = new Date();
  return {
    id: `EVT-${Date.now()}-${_eventCounter}`,
    agentId: agent.code,
    agentName: agent.name,
    location: agent.location,
    txType: TX_TYPES[Math.floor(Math.random() * TX_TYPES.length)],
    amount: Math.floor(Math.random() * 490_000) + 10_000,
    customer: [
      "Emeka Eze",
      "Fatima Bello",
      "Chidi Obi",
      "Ngozi Adeyemi",
      "Tunde Bakare",
    ][Math.floor(Math.random() * 5)],
    riskScore: risk,
    severity,
    reason: REASONS[Math.floor(Math.random() * REASONS.length)],
    time: now.toLocaleTimeString("en-NG", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }),
    timestamp: now.getTime(),
    status: "open",
    channel: ["POS", "USSD", "Mobile", "Web"][Math.floor(Math.random() * 4)],
    shapFeatures:
      SHAP_TEMPLATES[Math.floor(Math.random() * SHAP_TEMPLATES.length)],
  };
}

const INITIAL_EVENTS: FraudEvent[] = Array.from(
  { length: 12 },
  generateEvent
).map((e, i) => ({
  ...e,
  status:
    i < 3 ? "open" : i < 6 ? "investigating" : i < 9 ? "resolved" : "escalated",
  time: `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${String((i * 5) % 60).padStart(2, "0")}`,
}));

const AGENT_RISKS: AgentRisk[] = AGENTS.map((a, i) => ({
  agentId: a.code,
  agentName: a.name,
  location: a.location,
  riskScore: [72, 45, 88, 31, 65, 52, 91, 28][i],
  txCount: [142, 98, 203, 67, 55, 89, 44, 178][i],
  flaggedCount: [8, 2, 14, 1, 5, 3, 11, 0][i],
  tier: a.tier,
}));

// HOURLY_DATA is now fetched live via trpc.fraud.hourlyStats in the component

const RISK_CATEGORIES = [
  { name: "Velocity Abuse", value: 34, color: RED },
  { name: "Amount Anomaly", value: 28, color: ORANGE },
  { name: "Structuring", value: 19, color: GOLD },
  { name: "Account Takeover", value: 12, color: PURPLE },
  { name: "Geographic", value: 7, color: CYAN },
];

// ─── Severity helpers ─────────────────────────────────────────────────────────
const SEV_COLOR: Record<Severity, string> = {
  critical: RED,
  high: ORANGE,
  medium: GOLD,
  low: "#6b7280",
};
const SEV_BG: Record<Severity, string> = {
  critical: `${RED}18`,
  high: `${ORANGE}18`,
  medium: `${GOLD}18`,
  low: "oklch(0.22 0.01 240 / 0.5)",
};
const STATUS_COLOR: Record<CaseStatus, string> = {
  open: RED,
  investigating: GOLD,
  resolved: GREEN,
  escalated: PURPLE,
};

const fmt = (n: number) =>
  n >= 1_000_000
    ? `₦${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `₦${(n / 1_000).toFixed(0)}K`
      : `₦${n}`;

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  color,
  pulse,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-1"
      style={{ background: CARD, border: `1px solid ${BORDER}` }}
    >
      <div className="flex items-center gap-2">
        {pulse && (
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{ background: color }}
          />
        )}
        <span
          className="text-xs text-gray-500 uppercase tracking-wider"
          style={{ fontFamily: DISP }}
        >
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold" style={{ color, fontFamily: MONO }}>
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

function SHAPBar({
  feature,
}: {
  feature: { name: string; value: number; direction: "risk" | "safe" };
}) {
  const color = feature.direction === "risk" ? RED : GREEN;
  return (
    <div className="mb-2">
      <div className="flex justify-between items-center mb-0.5">
        <span className="text-xs text-gray-300" style={{ fontFamily: DISP }}>
          {feature.name}
        </span>
        <span className="text-xs font-bold" style={{ color, fontFamily: MONO }}>
          {feature.direction === "risk" ? "+" : "−"}
          {(feature.value * 100).toFixed(0)}%
        </span>
      </div>
      <div
        className="h-1.5 rounded-full overflow-hidden"
        style={{ background: BORDER }}
      >
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${feature.value * 100}%`, background: color }}
        />
      </div>
    </div>
  );
}

function EventRow({
  event,
  onSelect,
  selected,
}: {
  event: FraudEvent;
  onSelect: (e: FraudEvent) => void;
  selected: boolean;
}) {
  return (
    <button
      onClick={() => onSelect(event)}
      className="w-full flex items-center gap-3 px-4 py-3 text-left transition-all hover:opacity-90"
      style={{
        background: selected ? `${SEV_COLOR[event.severity]}12` : "transparent",
        borderLeft: selected
          ? `3px solid ${SEV_COLOR[event.severity]}`
          : "3px solid transparent",
        borderBottom: `1px solid ${BORDER}`,
      }}
    >
      {/* Severity dot */}
      <div
        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
        style={{ background: SEV_COLOR[event.severity] }}
      />
      {/* Main info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="text-xs font-bold text-white truncate"
            style={{ fontFamily: DISP }}
          >
            {event.agentName}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded font-bold uppercase flex-shrink-0"
            style={{
              background: SEV_BG[event.severity],
              color: SEV_COLOR[event.severity],
              fontFamily: DISP,
              fontSize: 9,
            }}
          >
            {event.severity}
          </span>
        </div>
        <div
          className="text-xs text-gray-400 truncate"
          style={{ fontFamily: DISP }}
        >
          {event.reason}
        </div>
      </div>
      {/* Amount + time */}
      <div className="text-right flex-shrink-0">
        <div
          className="text-xs font-bold"
          style={{ color: GOLD, fontFamily: MONO }}
        >
          {fmt(event.amount)}
        </div>
        <div className="text-xs text-gray-600" style={{ fontFamily: MONO }}>
          {event.time}
        </div>
      </div>
    </button>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function FraudDashboard() {
  const [events, setEvents] = useState<FraudEvent[]>(INITIAL_EVENTS);
  const [selected, setSelected] = useState<FraudEvent | null>(
    INITIAL_EVENTS[0]
  );
  const [tab, setTab] = useState<"feed" | "agents" | "analytics">("feed");
  const [filterSev, setFilterSev] = useState<Severity | "all">("all");
  const [filterStatus, setFilterStatus] = useState<CaseStatus | "all">("all");
  const [paused, setPaused] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const feedRef = useRef<HTMLDivElement>(null);

  // ── Live fraud alerts from DB ───────────────────────────────────────────────
  const { data: dbAlerts } = trpc.fraud.list.useQuery(
    { page: 1, limit: 50 },
    { refetchInterval: 30_000, retry: false }
  );
  // Seed initial events from DB when available
  useEffect(() => {
    if (!dbAlerts?.items?.length) return;
    const mapped: FraudEvent[] = dbAlerts.items.map((a: any) => {
      const score = parseFloat(a.fraudScore ?? "0");
      return {
        id: String(a.id),
        agentId: a.agentId ?? "UNKNOWN",
        agentName: a.agentId ?? "Unknown Agent",
        location: "Nigeria",
        txType: a.txType ?? "Transaction",
        amount: Number(a.amount ?? 0),
        customer: a.customerName ?? "-",
        riskScore: Math.round(score * 100),
        severity: (a.severity as Severity) ?? "medium",
        reason: a.reason ?? "Flagged by system",
        time: new Date(a.createdAt ?? Date.now()).toLocaleTimeString("en-NG", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        timestamp: new Date(a.createdAt ?? Date.now()).getTime(),
        status: (a.status as CaseStatus) ?? "open",
        channel: "POS",
        shapFeatures: [
          {
            name: "Amount deviation",
            value: score * 0.4,
            direction: "risk" as const,
          },
          { name: "Velocity", value: score * 0.3, direction: "risk" as const },
          { name: "Time of day", value: 0.15, direction: "safe" as const },
          { name: "Agent history", value: 0.1, direction: "safe" as const },
        ],
      };
    });
    setEvents(prev => {
      const ids = new Set(prev.map(e => e.id));
      const newOnes = mapped.filter(m => !ids.has(m.id));
      return [...newOnes, ...prev].slice(0, 100);
    });
  }, [dbAlerts]);

  // ── Real-time Socket.IO fraud feed ──────────────────────────────────────────
  const storeEvents = usePosStore(s => s.fraudEvents);
  useFraudSocket(); // connects to /fraud namespace and pushes events into store

  // Merge store (socket) events into local display state
  useEffect(() => {
    if (storeEvents.length === 0) return;
    const latest = storeEvents[0];
    const mapped: FraudEvent = {
      id: latest.id,
      agentId: latest.agentId,
      agentName: latest.customerName,
      location: "Lagos, Nigeria",
      txType: latest.type,
      amount: latest.amount,
      customer: latest.customerName,
      riskScore: parseFloat(latest.fraudScore) * 100,
      severity: latest.severity,
      reason: latest.reason,
      time: new Date(latest.timestamp).toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: new Date(latest.timestamp).getTime(),
      status: "open",
      channel: "Cash",
      shapFeatures: [
        {
          name: "Amount deviation",
          value: parseFloat(latest.fraudScore) * 0.4,
          direction: "risk",
        },
        {
          name: "Velocity",
          value: parseFloat(latest.fraudScore) * 0.3,
          direction: "risk",
        },
        { name: "Time of day", value: 0.15, direction: "safe" },
        { name: "Agent history", value: 0.1, direction: "safe" },
      ],
    };
    if (!paused) {
      setEvents(prev => [mapped, ...prev].slice(0, 50));
      setNewCount(c => c + 1);
      if (latest.severity === "critical") {
        toast.error(
          `🚨 CRITICAL: ${latest.customerName} — ${fmt(latest.amount)} ${latest.type}`,
          { duration: 5000 }
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeEvents.length]);

  // Fallback: also keep local simulation when socket not yet connected
  useEffect(() => {
    if (paused || storeEvents.length > 0) return;
    const iv = setInterval(
      () => {
        const evt = generateEvent();
        setEvents(prev => [evt, ...prev].slice(0, 50));
        setNewCount(c => c + 1);
        if (evt.severity === "critical") {
          toast.error(
            `🚨 CRITICAL: ${evt.agentName} — ${fmt(evt.amount)} ${evt.txType}`,
            { duration: 5000 }
          );
        }
      },
      4500 + Math.random() * 3000
    );
    return () => clearInterval(iv);
  }, [paused, storeEvents.length]);

  // ── Live hourly stats from DB ───────────────────────────────────────────────
  const { data: liveHourlyData } = trpc.fraud.hourlyStats.useQuery(undefined, {
    refetchInterval: 60_000,
    retry: false,
  });
  // Stable fallback — 24 zero-filled hours — avoids re-render flicker
  const [fallbackHourly] = useState(() =>
    Array.from({ length: 24 }, (_, h) => ({
      h: `${String(h).padStart(2, "0")}:00`,
      alerts: 0,
      blocked: 0,
      volume: 0,
    }))
  );
  const hourlyData =
    liveHourlyData && liveHourlyData.length > 0
      ? liveHourlyData
      : fallbackHourly;

  // ── tRPC status update ──────────────────────────────────────────────────────
  const updateStatusMutation = trpc.fraud.updateStatus.useMutation();

  const updateStatus = useCallback(
    (id: string, status: CaseStatus) => {
      setEvents(prev => prev.map(e => (e.id === id ? { ...e, status } : e)));
      if (selected?.id === id)
        setSelected(prev => (prev ? { ...prev, status } : null));
      // Persist to DB if numeric ID
      const numId = parseInt(id, 10);
      if (!isNaN(numId)) {
        updateStatusMutation.mutate({ id: numId, status });
      }
      toast.success(
        `Case ${status === "resolved" ? "resolved" : status === "escalated" ? "escalated to compliance" : "status updated"}`
      );
    },
    [selected, updateStatusMutation]
  );

  const filtered = events.filter(
    e =>
      (filterSev === "all" || e.severity === filterSev) &&
      (filterStatus === "all" || e.status === filterStatus)
  );

  const stats = {
    total: events.length,
    critical: events.filter(e => e.severity === "critical").length,
    open: events.filter(e => e.status === "open").length,
    blocked: events.filter(e => e.status === "resolved").length,
    totalRisk: events.reduce((s: any, e: any) => s + e.amount, 0),
  };

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: BG, fontFamily: DISP }}
    >
      {/* ── Top Bar ── */}
      <div
        className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{
          background: "oklch(0.07 0.01 240)",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className="w-2.5 h-2.5 rounded-full animate-pulse"
              style={{ background: paused ? GOLD : RED }}
            />
            <span
              className="text-sm font-bold text-white"
              style={{ fontFamily: DISP }}
            >
              Fraud Detection Center
            </span>
          </div>
          <div
            className="px-2 py-0.5 rounded text-xs font-bold"
            style={{ background: `${RED}20`, color: RED }}
          >
            LIVE
          </div>
          {newCount > 0 && (
            <div
              className="px-2 py-0.5 rounded-full text-xs font-bold text-white"
              style={{ background: RED }}
            >
              +{newCount} new
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              setPaused(p => !p);
              setNewCount(0);
            }}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: paused ? `${GREEN}20` : `${GOLD}20`,
              color: paused ? GREEN : GOLD,
              border: `1px solid ${paused ? GREEN : GOLD}40`,
            }}
          >
            {paused ? "▶ Resume" : "⏸ Pause"}
          </button>
          <span className="text-xs text-gray-500" style={{ fontFamily: MONO }}>
            {new Date().toLocaleTimeString("en-NG", {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            })}
          </span>
        </div>
      </div>

      {/* ── KPI Strip ── */}
      <div className="grid grid-cols-5 gap-3 px-5 py-3 flex-shrink-0">
        <StatCard
          label="Total Events"
          value={String(stats.total)}
          sub="Last 24h"
          color={BLUE}
        />
        <StatCard
          label="Critical"
          value={String(stats.critical)}
          sub="Immediate action"
          color={RED}
          pulse
        />
        <StatCard
          label="Open Cases"
          value={String(stats.open)}
          sub="Pending review"
          color={ORANGE}
        />
        <StatCard
          label="Resolved"
          value={String(stats.blocked)}
          sub="Cases closed"
          color={GREEN}
        />
        <StatCard
          label="At-Risk Volume"
          value={fmt(stats.totalRisk)}
          sub="Flagged transactions"
          color={GOLD}
        />
      </div>

      {/* ── Tab Nav ── */}
      <div className="flex gap-1 px-5 pb-3 flex-shrink-0">
        {(["feed", "agents", "analytics"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-2 rounded-xl text-xs font-semibold capitalize transition-all"
            style={{
              background: tab === t ? RED : CARD,
              color: tab === t ? "white" : "#6b7280",
              border: `1px solid ${tab === t ? RED : BORDER}`,
            }}
          >
            {t === "feed"
              ? "🔴 Live Feed"
              : t === "agents"
                ? "👤 Agent Risk"
                : "📊 Analytics"}
          </button>
        ))}
      </div>

      {/* ── Main Content ── */}
      <div className="flex-1 overflow-hidden px-5 pb-5">
        {/* ── LIVE FEED TAB ── */}
        {tab === "feed" && (
          <div className="flex gap-4 h-full">
            {/* Left: Event list */}
            <div
              className="w-96 flex flex-col rounded-2xl overflow-hidden flex-shrink-0"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              {/* Filters */}
              <div
                className="px-4 py-3 flex gap-2 flex-wrap"
                style={{ borderBottom: `1px solid ${BORDER}` }}
              >
                {(["all", "critical", "high", "medium", "low"] as const).map(
                  s => (
                    <button
                      key={s}
                      onClick={() => setFilterSev(s)}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-all"
                      style={{
                        background:
                          filterSev === s
                            ? (s === "all"
                                ? BLUE
                                : SEV_COLOR[s as Severity] || BLUE) + "30"
                            : "transparent",
                        color:
                          filterSev === s
                            ? s === "all"
                              ? BLUE
                              : SEV_COLOR[s as Severity] || BLUE
                            : "#6b7280",
                        border: `1px solid ${filterSev === s ? (s === "all" ? BLUE : SEV_COLOR[s as Severity] || BLUE) : BORDER}`,
                      }}
                    >
                      {s}
                    </button>
                  )
                )}
              </div>
              {/* Event rows */}
              <div ref={feedRef} className="flex-1 overflow-y-auto">
                {filtered.length === 0 && (
                  <div className="text-center text-gray-500 py-12 text-sm">
                    No events match filter
                  </div>
                )}
                {filtered.map(e => (
                  <EventRow
                    key={e.id}
                    event={e}
                    onSelect={setSelected}
                    selected={selected?.id === e.id}
                  />
                ))}
              </div>
            </div>

            {/* Right: Case detail */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-4">
              {selected ? (
                <>
                  {/* Header */}
                  <div
                    className="rounded-2xl p-5"
                    style={{
                      background: CARD,
                      border: `2px solid ${SEV_COLOR[selected.severity]}40`,
                    }}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-lg font-bold text-white"
                            style={{ fontFamily: DISP }}
                          >
                            {selected.agentName}
                          </span>
                          <span
                            className="px-2 py-0.5 rounded text-xs font-bold uppercase"
                            style={{
                              background: SEV_BG[selected.severity],
                              color: SEV_COLOR[selected.severity],
                            }}
                          >
                            {selected.severity}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400">
                          {selected.agentId} · {selected.location}
                        </div>
                      </div>
                      <div className="text-right">
                        <div
                          className="text-2xl font-bold"
                          style={{ color: GOLD, fontFamily: MONO }}
                        >
                          {fmt(selected.amount)}
                        </div>
                        <div className="text-xs text-gray-400">
                          {selected.txType} · {selected.channel}
                        </div>
                      </div>
                    </div>

                    {/* Risk gauge */}
                    <div className="mb-4">
                      <div className="flex justify-between mb-1">
                        <span className="text-xs text-gray-400">
                          Risk Score
                        </span>
                        <span
                          className="text-xl font-bold"
                          style={{
                            color: SEV_COLOR[selected.severity],
                            fontFamily: MONO,
                          }}
                        >
                          {selected.riskScore}%
                        </span>
                      </div>
                      <div
                        className="h-3 rounded-full overflow-hidden"
                        style={{ background: BORDER }}
                      >
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${selected.riskScore}%`,
                            background: `linear-gradient(90deg, ${GOLD}, ${SEV_COLOR[selected.severity]})`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Reason */}
                    <div
                      className="rounded-xl p-3 mb-4"
                      style={{ background: BG, border: `1px solid ${BORDER}` }}
                    >
                      <div className="text-xs text-gray-500 mb-1">
                        Detection Reason
                      </div>
                      <div className="text-sm text-gray-200">
                        {selected.reason}
                      </div>
                    </div>

                    {/* Status + Actions */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ background: STATUS_COLOR[selected.status] }}
                        />
                        <span
                          className="text-xs font-semibold capitalize"
                          style={{ color: STATUS_COLOR[selected.status] }}
                        >
                          {selected.status}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() =>
                            updateStatus(selected.id, "investigating")
                          }
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                          style={{
                            background: `${GOLD}20`,
                            color: GOLD,
                            border: `1px solid ${GOLD}40`,
                          }}
                        >
                          🔍 Investigate
                        </button>
                        <button
                          onClick={() => updateStatus(selected.id, "escalated")}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                          style={{
                            background: `${PURPLE}20`,
                            color: PURPLE,
                            border: `1px solid ${PURPLE}40`,
                          }}
                        >
                          📋 Escalate
                        </button>
                        <button
                          onClick={() => updateStatus(selected.id, "resolved")}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                          style={{
                            background: `${GREEN}20`,
                            color: GREEN,
                            border: `1px solid ${GREEN}40`,
                          }}
                        >
                          ✓ Resolve
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* SHAP Explanation */}
                  <div
                    className="rounded-2xl p-5"
                    style={{ background: CARD, border: `1px solid ${BORDER}` }}
                  >
                    <div className="flex items-center gap-2 mb-4">
                      <span
                        className="text-sm font-bold text-white"
                        style={{ fontFamily: DISP }}
                      >
                        🤖 AI Feature Explanation (SHAP)
                      </span>
                      <span
                        className="text-xs px-2 py-0.5 rounded"
                        style={{ background: `${BLUE}20`, color: BLUE }}
                      >
                        FraudNet v2.1
                      </span>
                    </div>
                    {selected.shapFeatures.map((f, i) => (
                      <SHAPBar key={i} feature={f} />
                    ))}
                    <div
                      className="mt-3 p-3 rounded-xl"
                      style={{
                        background: `${GOLD}10`,
                        border: `1px solid ${GOLD}20`,
                      }}
                    >
                      <div className="text-xs font-semibold text-yellow-400 mb-1">
                        AI Recommendation
                      </div>
                      <div className="text-xs text-gray-300">
                        {selected.riskScore >= 80
                          ? "Block transaction immediately and escalate to compliance. Request biometric re-verification."
                          : selected.riskScore >= 65
                            ? "Place transaction on hold. Request additional customer verification (OTP)."
                            : "Monitor agent activity for next 2 hours. No immediate action required."}
                      </div>
                    </div>
                  </div>

                  {/* Transaction metadata */}
                  <div
                    className="rounded-2xl p-5"
                    style={{ background: CARD, border: `1px solid ${BORDER}` }}
                  >
                    <div
                      className="text-sm font-bold text-white mb-3"
                      style={{ fontFamily: DISP }}
                    >
                      Transaction Metadata
                    </div>
                    {[
                      ["Event ID", selected.id],
                      ["Customer", selected.customer],
                      ["Channel", selected.channel],
                      ["Time", selected.time],
                      [
                        "Agent Tier",
                        AGENTS.find(a => a.code === selected.agentId)?.tier ||
                          "—",
                      ],
                    ].map(([k, v]) => (
                      <div
                        key={k}
                        className="flex justify-between py-2"
                        style={{ borderBottom: `1px solid ${BORDER}` }}
                      >
                        <span className="text-xs text-gray-500">{k}</span>
                        <span
                          className="text-xs text-white font-semibold"
                          style={{ fontFamily: MONO }}
                        >
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-gray-500">
                  Select an event to view details
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── AGENT RISK TAB ── */}
        {tab === "agents" && (
          <div className="flex gap-4 h-full overflow-hidden">
            {/* Agent risk table */}
            <div
              className="flex-1 overflow-y-auto rounded-2xl"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="sticky top-0 grid grid-cols-6 gap-3 px-5 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider"
                style={{
                  background: CARD,
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                <span className="col-span-2">Agent</span>
                <span>Risk Score</span>
                <span>Transactions</span>
                <span>Flagged</span>
                <span>Flag Rate</span>
              </div>
              {[...AGENT_RISKS]
                .sort((a: any, b: any) => b.riskScore - a.riskScore)
                .map((agent, i) => {
                  const flagRate = (
                    (agent.flaggedCount / agent.txCount) *
                    100
                  ).toFixed(1);
                  const riskColor =
                    agent.riskScore >= 80
                      ? RED
                      : agent.riskScore >= 60
                        ? ORANGE
                        : agent.riskScore >= 40
                          ? GOLD
                          : GREEN;
                  return (
                    <div
                      key={agent.agentId}
                      className="grid grid-cols-6 gap-3 px-5 py-4 items-center transition-all hover:opacity-80"
                      style={{
                        borderBottom: `1px solid ${BORDER}`,
                        background: i === 0 ? `${RED}08` : "transparent",
                      }}
                    >
                      <div className="col-span-2">
                        <div
                          className="text-sm font-bold text-white"
                          style={{ fontFamily: DISP }}
                        >
                          {agent.agentName}
                        </div>
                        <div className="text-xs text-gray-500">
                          {agent.agentId} · {agent.location}
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="text-sm font-bold"
                            style={{ color: riskColor, fontFamily: MONO }}
                          >
                            {agent.riskScore}
                          </span>
                        </div>
                        <div
                          className="h-1.5 w-20 rounded-full overflow-hidden"
                          style={{ background: BORDER }}
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${agent.riskScore}%`,
                              background: riskColor,
                            }}
                          />
                        </div>
                      </div>
                      <span
                        className="text-sm text-white"
                        style={{ fontFamily: MONO }}
                      >
                        {agent.txCount}
                      </span>
                      <span
                        className="text-sm font-bold"
                        style={{
                          color: agent.flaggedCount > 5 ? RED : GOLD,
                          fontFamily: MONO,
                        }}
                      >
                        {agent.flaggedCount}
                      </span>
                      <span
                        className="text-sm"
                        style={{
                          color: parseFloat(flagRate) > 5 ? RED : GREEN,
                          fontFamily: MONO,
                        }}
                      >
                        {flagRate}%
                      </span>
                    </div>
                  );
                })}
            </div>

            {/* Scatter: risk vs volume */}
            <div className="w-72 flex flex-col gap-4">
              <div
                className="rounded-2xl p-4 flex-1"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <div className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                  Risk vs Volume
                </div>
                <ResponsiveContainer width="100%" height={200}>
                  <ScatterChart>
                    <XAxis
                      dataKey="txCount"
                      name="Transactions"
                      tick={{ fill: "#6b7280", fontSize: 10 }}
                    />
                    <YAxis
                      dataKey="riskScore"
                      name="Risk Score"
                      tick={{ fill: "#6b7280", fontSize: 10 }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: CARD2,
                        border: `1px solid ${BORDER}`,
                        borderRadius: 8,
                      }}
                      labelStyle={{ color: "white" }}
                      itemStyle={{ color: GOLD }}
                    />
                    <Scatter
                      data={AGENT_RISKS.map(a => ({
                        txCount: a.txCount,
                        riskScore: a.riskScore,
                        name: a.agentName,
                      }))}
                    >
                      {AGENT_RISKS.map((a, i) => (
                        <Cell
                          key={i}
                          fill={
                            a.riskScore >= 80
                              ? RED
                              : a.riskScore >= 60
                                ? ORANGE
                                : a.riskScore >= 40
                                  ? GOLD
                                  : GREEN
                          }
                        />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div
                className="rounded-2xl p-4"
                style={{ background: CARD, border: `1px solid ${BORDER}` }}
              >
                <div className="text-xs font-semibold text-gray-400 mb-3 uppercase tracking-wider">
                  Risk Categories
                </div>
                {RISK_CATEGORIES.map((rc, i) => (
                  <div key={i} className="mb-2">
                    <div className="flex justify-between mb-0.5">
                      <span className="text-xs text-gray-300">{rc.name}</span>
                      <span
                        className="text-xs font-bold"
                        style={{ color: rc.color, fontFamily: MONO }}
                      >
                        {rc.value}%
                      </span>
                    </div>
                    <div
                      className="h-1.5 rounded-full overflow-hidden"
                      style={{ background: BORDER }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{ width: `${rc.value}%`, background: rc.color }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── ANALYTICS TAB ── */}
        {tab === "analytics" && (
          <div className="grid grid-cols-2 gap-4 h-full overflow-y-auto">
            {/* Hourly alert volume */}
            <div
              className="rounded-2xl p-5"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-sm font-bold text-white mb-4"
                style={{ fontFamily: DISP }}
              >
                Hourly Alert Volume (24h)
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <AreaChart data={hourlyData}>
                  <defs>
                    <linearGradient id="alertGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={RED} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={RED} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="h"
                    tick={{ fill: "#6b7280", fontSize: 9 }}
                    interval={3}
                  />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} />
                  <Tooltip
                    contentStyle={{
                      background: CARD2,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 8,
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="alerts"
                    stroke={RED}
                    fill="url(#alertGrad)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Blocked vs Allowed */}
            <div
              className="rounded-2xl p-5"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-sm font-bold text-white mb-4"
                style={{ fontFamily: DISP }}
              >
                Blocked vs Allowed (24h)
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={hourlyData.filter(
                    (_: (typeof hourlyData)[0], i: number) => i % 3 === 0
                  )}
                >
                  <XAxis dataKey="h" tick={{ fill: "#6b7280", fontSize: 9 }} />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} />
                  <Tooltip
                    contentStyle={{
                      background: CARD2,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 8,
                    }}
                  />
                  <Bar
                    dataKey="blocked"
                    fill={RED}
                    radius={[3, 3, 0, 0]}
                    name="Blocked"
                  />
                  <Bar
                    dataKey="volume"
                    fill={GREEN}
                    radius={[3, 3, 0, 0]}
                    name="Allowed"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Risk score distribution */}
            <div
              className="rounded-2xl p-5"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-sm font-bold text-white mb-4"
                style={{ fontFamily: DISP }}
              >
                Risk Score Distribution
              </div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart
                  data={[
                    { range: "40-50", count: 3, color: "#6b7280" },
                    { range: "50-60", count: 5, color: GOLD },
                    { range: "60-70", count: 8, color: ORANGE },
                    { range: "70-80", count: 6, color: ORANGE },
                    { range: "80-90", count: 4, color: RED },
                    { range: "90-100", count: 2, color: RED },
                  ]}
                >
                  <XAxis
                    dataKey="range"
                    tick={{ fill: "#6b7280", fontSize: 9 }}
                  />
                  <YAxis tick={{ fill: "#6b7280", fontSize: 9 }} />
                  <Tooltip
                    contentStyle={{
                      background: CARD2,
                      border: `1px solid ${BORDER}`,
                      borderRadius: 8,
                    }}
                  />
                  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                    {[
                      { range: "40-50", count: 3, color: "#6b7280" },
                      { range: "50-60", count: 5, color: GOLD },
                      { range: "60-70", count: 8, color: ORANGE },
                      { range: "70-80", count: 6, color: ORANGE },
                      { range: "80-90", count: 4, color: RED },
                      { range: "90-100", count: 2, color: RED },
                    ].map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Model performance */}
            <div
              className="rounded-2xl p-5"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-sm font-bold text-white mb-4"
                style={{ fontFamily: DISP }}
              >
                Model Performance (FraudNet v2.1)
              </div>
              {[
                { label: "Precision", value: 94.7, color: GREEN },
                { label: "Recall", value: 91.2, color: BLUE },
                { label: "F1 Score", value: 92.9, color: CYAN },
                { label: "False Positive Rate", value: 5.3, color: ORANGE },
                { label: "AUC-ROC", value: 97.4, color: PURPLE },
              ].map((m, i) => (
                <div key={i} className="mb-3">
                  <div className="flex justify-between mb-0.5">
                    <span className="text-xs text-gray-400">{m.label}</span>
                    <span
                      className="text-xs font-bold"
                      style={{ color: m.color, fontFamily: MONO }}
                    >
                      {m.value}%
                    </span>
                  </div>
                  <div
                    className="h-1.5 rounded-full overflow-hidden"
                    style={{ background: BORDER }}
                  >
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${m.value}%`, background: m.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
