/**
 * SupervisorDashboard — Read-only view for supervisors of their assigned agents
 *
 * Route: /supervisor
 * Access: role === "supervisor" OR role === "admin"
 *
 * Sections:
 *  1. My Profile — assigned agent count, supervisor ID
 *  2. Agent Grid — with search, filter by tier/status, pagination
 *  3. Agent Drill-down — recent transactions for selected agent
 *  4. Active Fraud Alerts — for assigned agents only
 *  5. Pending Float Top-Up Approvals
 *  6. CBN Compliance Metrics
 */
import { useState, useMemo } from "react";
import { trpc } from "../lib/trpc";
import { usePosStore } from "../store/posStore";
import { toast } from "sonner";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG = "#0a0e1a";
const CARD = "oklch(0.14 0.02 240)";
const BORDER = "oklch(0.22 0.02 240)";
const GREEN = "oklch(0.65 0.18 160)";
const RED = "oklch(0.60 0.22 25)";
const GOLD = "oklch(0.78 0.18 80)";
const BLUE = "oklch(0.60 0.22 260)";
const PURPLE = "oklch(0.65 0.22 300)";
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

function tierColor(tier: string) {
  if (tier === "Platinum") return BLUE;
  if (tier === "Gold") return GOLD;
  if (tier === "Silver") return "oklch(0.75 0.02 230)";
  return "oklch(0.55 0.12 60)";
}
function successColor(rate: number | null) {
  if (rate === null) return "oklch(0.55 0.015 230)";
  if (rate >= 98) return GREEN;
  if (rate >= 95) return BLUE;
  if (rate >= 90) return GOLD;
  return RED;
}
function successTier(rate: number | null) {
  if (rate === null) return "No data";
  if (rate >= 98) return "Excellent";
  if (rate >= 95) return "Good";
  if (rate >= 90) return "Fair";
  return "Poor";
}

const AGENTS_PER_PAGE = 12;

export default function SupervisorDashboard() {
  const agent = usePosStore(s => s.agent);
  const [selectedAgentId, setSelectedAgentId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<
    "all" | "Bronze" | "Silver" | "Gold" | "Platinum"
  >("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "suspended"
  >("all");
  const [sortBy, setSortBy] = useState<
    "name" | "premiumReserve" | "volume" | "successRate"
  >("volume");
  const [agentPage, setAgentPage] = useState(1);
  const [txPage, setTxPage] = useState(1);
  const [activeTab, setActiveTab] = useState<
    "agents" | "alerts" | "compliance"
  >("agents");
  const utils = trpc.useUtils();

  const { data: profile } = trpc.supervisor.myProfile.useQuery({});
  const { data: myAgents, isLoading: agentsLoading } =
    trpc.supervisor.myAgents.useQuery({});
  const { data: alerts } = trpc.supervisor.myAlerts.useQuery({});
  const { data: agentTxs, isLoading: txLoading } =
    trpc.supervisor.agentTransactions.useQuery(
      { agentId: selectedAgentId!, limit: 20 },
      { enabled: selectedAgentId !== null }
    );
  const { data: pendingTopUps } =
    trpc.premiumTopUp.supervisorPendingTopUps.useQuery();
  const { data: cbnMetrics } = trpc.analytics.cbnMetrics.useQuery({ days: 30 });

  const approveTopUp = trpc.premiumTopUp.supervisorApproveTopUp.useMutation({
    onSuccess: () => {
      toast.success("Top-up approved — admin can now credit the float");
      utils.premiumTopUp.supervisorPendingTopUps.invalidate();
    },
    onError: (e: any) => toast.error(`Approval failed: ${e.message}`),
  });

  // ── Client-side search/filter/sort ────────────────────────────────────────
  const filteredAgents = useMemo(() => {
    let list = (myAgents ?? []) as any[];
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a: any) =>
          a.name?.toLowerCase().includes(q) ||
          a.agentId?.toLowerCase().includes(q) ||
          a.location?.toLowerCase().includes(q)
      );
    }
    if (tierFilter !== "all")
      list = list.filter((a: any) => a.tier === tierFilter);
    if (statusFilter === "active") list = list.filter((a: any) => a.isActive);
    else if (statusFilter === "suspended")
      list = list.filter((a: any) => !a.isActive);
    list = [...list].sort((a: any, b: any) => {
      if (sortBy === "name") return (a.name ?? "").localeCompare(b.name ?? "");
      if (sortBy === "premiumReserve")
        return Number(b.premiumReserve ?? 0) - Number(a.premiumReserve ?? 0);
      if (sortBy === "volume")
        return (b.totalVolume7d ?? 0) - (a.totalVolume7d ?? 0);
      if (sortBy === "successRate")
        return (b.successRate7d ?? 0) - (a.successRate7d ?? 0);
      return 0;
    });
    return list;
  }, [myAgents, searchQuery, tierFilter, statusFilter, sortBy]);

  const totalAgentPages = Math.ceil(filteredAgents.length / AGENTS_PER_PAGE);
  const pagedAgents = filteredAgents.slice(
    (agentPage - 1) * AGENTS_PER_PAGE,
    agentPage * AGENTS_PER_PAGE
  );
  const activeAlerts = (alerts ?? []).filter(
    (a: any) => a.status === "active" || a.status === "open"
  );

  // ── Access guard ──────────────────────────────────────────────────────────
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
  if (agent.role !== "supervisor" && agent.role !== "admin") {
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
            className="text-sm text-gray-500 mb-6"
            style={{ fontFamily: DISP }}
          >
            Supervisor role required.
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

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: BG, fontFamily: DISP }}
    >
      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div
        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 py-4 border-b"
        style={{ background: CARD, borderColor: BORDER }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-black flex-shrink-0"
            style={{ background: "oklch(0.65 0.18 160 / 0.3)", color: GREEN }}
          >
            👁
          </div>
          <div>
            <div
              className="text-sm font-black text-white"
              style={{ fontFamily: DISP }}
            >
              Supervisor Dashboard
            </div>
            <div className="text-xs text-gray-500" style={{ fontFamily: MONO }}>
              {profile?.assignedAgentIds?.length ?? 0} agents assigned
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          {activeAlerts.length > 0 && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{
                background: "oklch(0.60 0.22 25 / 0.15)",
                border: `1px solid oklch(0.60 0.22 25 / 0.3)`,
              }}
            >
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ background: RED }}
              />
              <span
                className="text-xs font-bold"
                style={{ color: RED, fontFamily: MONO }}
              >
                {activeAlerts.length} Alert
                {activeAlerts.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}
          {(pendingTopUps ?? []).length > 0 && (
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg"
              style={{
                background: "oklch(0.78 0.18 80 / 0.15)",
                border: `1px solid oklch(0.78 0.18 80 / 0.3)`,
              }}
            >
              <span
                className="text-xs font-bold"
                style={{ color: GOLD, fontFamily: MONO }}
              >
                {(pendingTopUps ?? []).length} Top-up
                {(pendingTopUps ?? []).length !== 1 ? "s" : ""} Pending
              </span>
            </div>
          )}
          <div
            className="text-xs text-gray-500 hidden sm:block"
            style={{ fontFamily: DISP }}
          >
            <span className="text-white font-semibold">{agent.name}</span>
            <span
              className="ml-1 px-1.5 py-0.5 rounded text-xs"
              style={{ background: "oklch(0.65 0.18 160 / 0.2)", color: GREEN }}
            >
              {agent.role}
            </span>
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
            ← POS
          </a>
          {agent.role === "admin" && (
            <a
              href="/admin"
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: "oklch(0.78 0.18 80 / 0.2)",
                color: GOLD,
                fontFamily: DISP,
              }}
            >
              Admin →
            </a>
          )}
        </div>
      </div>

      {/* ── Tab navigation ───────────────────────────────────────────────────── */}
      <div className="flex gap-1 px-4 sm:px-6 pt-4 pb-0">
        {(
          [
            {
              key: "agents",
              label: `Agents (${filteredAgents.length})`,
              icon: "👥",
            },
            {
              key: "alerts",
              label: `Alerts (${activeAlerts.length})`,
              icon: "⚠",
            },
            { key: "compliance", label: "CBN Compliance", icon: "🏛" },
          ] as const
        ).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="px-4 py-2 rounded-t-xl text-xs font-semibold transition-all"
            style={{
              background: activeTab === tab.key ? CARD : "transparent",
              color: activeTab === tab.key ? "white" : "oklch(0.55 0.015 230)",
              border:
                activeTab === tab.key
                  ? `1px solid ${BORDER}`
                  : "1px solid transparent",
              borderBottom:
                activeTab === tab.key
                  ? `1px solid ${CARD}`
                  : "1px solid transparent",
              fontFamily: DISP,
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        {/* ── AGENTS TAB ───────────────────────────────────────────────────────── */}
        {activeTab === "agents" && (
          <>
            {/* Pending Top-Up Approvals */}
            {(pendingTopUps ?? []).length > 0 && (
              <div
                className="rounded-2xl p-4"
                style={{
                  background: "oklch(0.78 0.18 80 / 0.06)",
                  border: `1px solid oklch(0.78 0.18 80 / 0.3)`,
                }}
              >
                <div
                  className="text-sm font-bold mb-3"
                  style={{ color: GOLD, fontFamily: DISP }}
                >
                  💰 Pending Float Top-Up Approvals (
                  {(pendingTopUps ?? []).length})
                </div>
                <div
                  className="text-xs text-gray-500 mb-3"
                  style={{ fontFamily: DISP }}
                >
                  These requests exceed the ₦50,000 threshold and require your
                  approval before admin can credit the float.
                </div>
                <div className="flex flex-col gap-2">
                  {(pendingTopUps ?? []).map((req: any) => (
                    <div
                      key={req.id}
                      className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 rounded-xl"
                      style={{
                        background: CARD,
                        border: `1px solid ${BORDER}`,
                      }}
                    >
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-xs font-black text-white"
                            style={{ fontFamily: DISP }}
                          >
                            {req.agentId}
                          </span>
                          <span
                            className="text-xs text-gray-400"
                            style={{ fontFamily: DISP }}
                          >
                            {req.agentName}
                          </span>
                          <span
                            className="text-xs px-1.5 py-0.5 rounded"
                            style={{
                              background: "oklch(0.78 0.18 80 / 0.15)",
                              color: GOLD,
                              fontFamily: DISP,
                            }}
                          >
                            {req.agentTier}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span style={{ color: GOLD, fontFamily: MONO }}>
                            Requested: ₦
                            {Number(req.requestedAmount).toLocaleString(
                              "en-NG",
                              { minimumFractionDigits: 2 }
                            )}
                          </span>
                          <span
                            className="text-gray-500"
                            style={{ fontFamily: DISP }}
                          >
                            Current float: ₦
                            {Number(req.agentFloat).toLocaleString("en-NG", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                          <span
                            className="text-gray-600"
                            style={{ fontFamily: MONO }}
                          >
                            {new Date(req.createdAt).toLocaleString("en-NG")}
                          </span>
                        </div>
                        {req.notes && (
                          <div
                            className="text-xs text-gray-500 mt-0.5"
                            style={{ fontFamily: DISP }}
                          >
                            Note: {req.notes}
                          </div>
                        )}
                      </div>
                      <button
                        onClick={() =>
                          approveTopUp.mutate({ requestId: req.id })
                        }
                        disabled={approveTopUp.isPending}
                        className="px-4 py-2 rounded-xl text-xs font-bold transition-all disabled:opacity-50 flex-shrink-0"
                        style={{
                          background: "oklch(0.78 0.18 80 / 0.2)",
                          color: GOLD,
                          border: `1px solid ${GOLD}`,
                          fontFamily: DISP,
                        }}
                      >
                        {approveTopUp.isPending ? "Approving…" : "Approve"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Search & Filter Bar */}
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                  🔍
                </span>
                <input
                  type="text"
                  placeholder="Search by name, code, or location…"
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value);
                    setAgentPage(1);
                  }}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-white placeholder-gray-600 outline-none"
                  style={{
                    background: CARD,
                    border: `1px solid ${BORDER}`,
                    fontFamily: DISP,
                  }}
                />
              </div>
              <select
                value={tierFilter}
                onChange={e => {
                  setTierFilter(e.target.value as typeof tierFilter);
                  setAgentPage(1);
                }}
                className="px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  fontFamily: DISP,
                }}
              >
                <option value="all">All Tiers</option>
                {["Bronze", "Silver", "Gold", "Platinum"].map(t => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={statusFilter}
                onChange={e => {
                  setStatusFilter(e.target.value as typeof statusFilter);
                  setAgentPage(1);
                }}
                className="px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  fontFamily: DISP,
                }}
              >
                <option value="all">All Status</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value as typeof sortBy)}
                className="px-3 py-2.5 rounded-xl text-sm text-white outline-none"
                style={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  fontFamily: DISP,
                }}
              >
                <option value="volume">Sort: Volume</option>
                <option value="premiumReserve">Sort: Float</option>
                <option value="successRate">Sort: Success Rate</option>
                <option value="name">Sort: Name</option>
              </select>
            </div>

            {/* Agent Grid */}
            <div>
              <div
                className="text-sm font-bold text-gray-300 mb-4"
                style={{ fontFamily: DISP }}
              >
                Showing {pagedAgents.length} of {filteredAgents.length} agents
                {searchQuery && (
                  <span className="ml-2 text-xs text-gray-500">
                    matching "{searchQuery}"
                  </span>
                )}
              </div>

              {agentsLoading ? (
                <div
                  className="text-center py-12 text-gray-500"
                  style={{ fontFamily: DISP }}
                >
                  Loading agents...
                </div>
              ) : pagedAgents.length === 0 ? (
                <div
                  className="text-center py-12 text-gray-600 rounded-2xl"
                  style={{ border: `1px dashed ${BORDER}`, fontFamily: DISP }}
                >
                  {searchQuery || tierFilter !== "all" || statusFilter !== "all"
                    ? "No agents match your filters."
                    : "No agents assigned yet. Ask an admin to assign agents to your supervisor account."}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {pagedAgents.map((a: any) => (
                    <button
                      key={a.id}
                      onClick={() =>
                        setSelectedAgentId(
                          a.id === selectedAgentId ? null : a.id
                        )
                      }
                      className="text-left rounded-2xl p-4 transition-all"
                      style={{
                        background:
                          selectedAgentId === a.id
                            ? "oklch(0.60 0.22 260 / 0.15)"
                            : CARD,
                        border: `1px solid ${selectedAgentId === a.id ? BLUE : BORDER}`,
                      }}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div
                            className="text-sm font-bold text-white"
                            style={{ fontFamily: DISP }}
                          >
                            {a.name}
                          </div>
                          <div
                            className="text-xs"
                            style={{ color: BLUE, fontFamily: MONO }}
                          >
                            {a.agentId}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className="text-xs px-2 py-0.5 rounded-full font-bold"
                            style={{
                              background: `${tierColor(a.tier)}20`,
                              color: tierColor(a.tier),
                              fontFamily: DISP,
                            }}
                          >
                            {a.tier}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded font-semibold ${a.isActive ? "text-emerald-400" : "text-red-400"}`}
                            style={{
                              background: a.isActive
                                ? "oklch(0.65 0.18 160 / 0.15)"
                                : "oklch(0.60 0.22 25 / 0.15)",
                              fontFamily: DISP,
                            }}
                          >
                            {a.isActive ? "Active" : "Suspended"}
                          </span>
                        </div>
                      </div>
                      <div className="mb-3">
                        <div
                          className="text-xs text-gray-500 mb-0.5"
                          style={{ fontFamily: DISP }}
                        >
                          Float Balance
                        </div>
                        <div
                          className="text-lg font-black"
                          style={{ color: GOLD, fontFamily: MONO }}
                        >
                          {fmtShort(Number(a.premiumReserve ?? 0))}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <div
                            className="text-gray-500"
                            style={{ fontFamily: DISP }}
                          >
                            7d Volume
                          </div>
                          <div
                            className="font-bold"
                            style={{ color: GREEN, fontFamily: MONO }}
                          >
                            {fmtShort(a.totalVolume7d ?? 0)}
                          </div>
                        </div>
                        <div>
                          <div
                            className="text-gray-500"
                            style={{ fontFamily: DISP }}
                          >
                            7d Tx Count
                          </div>
                          <div
                            className="font-bold text-white"
                            style={{ fontFamily: MONO }}
                          >
                            {a.txCount7d ?? 0}
                          </div>
                        </div>
                        <div className="col-span-2">
                          <div
                            className="text-gray-500 mb-0.5"
                            style={{ fontFamily: DISP }}
                          >
                            7d Success Rate
                          </div>
                          <div className="flex items-center gap-2">
                            <div
                              className="font-bold"
                              style={{
                                color: successColor(a.successRate7d),
                                fontFamily: MONO,
                              }}
                            >
                              {a.successRate7d !== null
                                ? `${a.successRate7d}%`
                                : "—"}
                            </div>
                            <span
                              className="text-xs"
                              style={{
                                color: successColor(a.successRate7d),
                                fontFamily: DISP,
                              }}
                            >
                              {successTier(a.successRate7d)}
                            </span>
                          </div>
                        </div>
                      </div>
                      {a.location && (
                        <div
                          className="mt-2 text-xs text-gray-600 truncate"
                          style={{ fontFamily: DISP }}
                        >
                          📍 {a.location}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {totalAgentPages > 1 && (
                <div className="flex items-center justify-center gap-2 mt-6">
                  <button
                    onClick={() => setAgentPage(p => Math.max(1, p - 1))}
                    disabled={agentPage === 1}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                    style={{
                      background: CARD,
                      color: "white",
                      border: `1px solid ${BORDER}`,
                      fontFamily: DISP,
                    }}
                  >
                    ← Prev
                  </button>
                  {Array.from(
                    { length: Math.min(7, totalAgentPages) },
                    (_, i) => {
                      const p =
                        Math.max(
                          1,
                          Math.min(agentPage - 3, totalAgentPages - 6)
                        ) + i;
                      return (
                        <button
                          key={p}
                          onClick={() => setAgentPage(p)}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{
                            background: agentPage === p ? BLUE : CARD,
                            color: "white",
                            border: `1px solid ${agentPage === p ? BLUE : BORDER}`,
                            fontFamily: MONO,
                          }}
                        >
                          {p}
                        </button>
                      );
                    }
                  )}
                  <button
                    onClick={() =>
                      setAgentPage(p => Math.min(totalAgentPages, p + 1))
                    }
                    disabled={agentPage === totalAgentPages}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
                    style={{
                      background: CARD,
                      color: "white",
                      border: `1px solid ${BORDER}`,
                      fontFamily: DISP,
                    }}
                  >
                    Next →
                  </button>
                </div>
              )}
            </div>

            {/* Agent Transaction Drill-down */}
            {selectedAgentId && (
              <div>
                <div
                  className="text-sm font-bold text-gray-300 mb-3"
                  style={{ fontFamily: DISP }}
                >
                  Recent Transactions —{" "}
                  {(myAgents ?? []).find((a: any) => a.id === selectedAgentId)
                    ?.name ?? `Agent #${selectedAgentId}`}
                  <button
                    onClick={() => setSelectedAgentId(null)}
                    className="ml-3 text-xs text-gray-500 hover:text-white"
                  >
                    ✕ Close
                  </button>
                </div>
                {txLoading ? (
                  <div
                    className="text-center py-8 text-gray-500"
                    style={{ fontFamily: DISP }}
                  >
                    Loading transactions...
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
                            background: CARD,
                            borderBottom: `1px solid ${BORDER}`,
                          }}
                        >
                          {[
                            "Ref",
                            "Type",
                            "Amount",
                            "Customer",
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
                        {(agentTxs ?? []).length === 0 ? (
                          <tr>
                            <td
                              colSpan={6}
                              className="text-center py-8 text-gray-600"
                              style={{ fontFamily: DISP }}
                            >
                              No transactions found for this agent.
                            </td>
                          </tr>
                        ) : (
                          (agentTxs ?? []).map((tx: any, i: number) => (
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
                                {fmt(Number(tx.amount))}
                              </td>
                              <td
                                className="px-3 py-2 text-gray-400"
                                style={{ fontFamily: DISP }}
                              >
                                {tx.customerName ?? tx.customerPhone ?? "—"}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className="px-2 py-0.5 rounded-full text-xs font-semibold"
                                  style={{
                                    background:
                                      tx.status === "completed"
                                        ? "oklch(0.65 0.18 160 / 0.15)"
                                        : "oklch(0.60 0.22 25 / 0.15)",
                                    color:
                                      tx.status === "completed" ? GREEN : RED,
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
                                {new Date(tx.createdAt).toLocaleString("en-NG")}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* ── ALERTS TAB ───────────────────────────────────────────────────────── */}
        {activeTab === "alerts" && (
          <div>
            <div
              className="text-sm font-bold text-gray-300 mb-4"
              style={{ fontFamily: DISP }}
            >
              Active Fraud Alerts ({activeAlerts.length})
            </div>
            {activeAlerts.length === 0 ? (
              <div
                className="text-center py-12 text-gray-600 rounded-2xl"
                style={{ border: `1px dashed ${BORDER}`, fontFamily: DISP }}
              >
                ✅ No active fraud alerts for your agents.
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {activeAlerts.map((alert: any) => (
                  <div
                    key={alert.id}
                    className="flex items-center justify-between text-xs px-4 py-3 rounded-xl"
                    style={{ background: CARD, border: `1px solid ${BORDER}` }}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ background: RED }}
                      />
                      <span
                        className="font-semibold text-white"
                        style={{ fontFamily: DISP }}
                      >
                        {alert.type}
                      </span>
                    </div>
                    <span
                      className="text-gray-400"
                      style={{ fontFamily: DISP }}
                    >
                      Agent #{alert.agentId}
                    </span>
                    <span style={{ color: GOLD, fontFamily: MONO }}>
                      {fmt(Number(alert.amount ?? 0))}
                    </span>
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{
                        background: "oklch(0.60 0.22 25 / 0.15)",
                        color: RED,
                        fontFamily: DISP,
                      }}
                    >
                      {alert.status}
                    </span>
                    <span
                      className="text-gray-500"
                      style={{ fontFamily: MONO }}
                    >
                      {new Date(alert.createdAt).toLocaleTimeString("en-NG")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── COMPLIANCE TAB ───────────────────────────────────────────────────── */}
        {activeTab === "compliance" && (
          <div>
            <div
              className="text-sm font-bold text-gray-300 mb-4"
              style={{ fontFamily: DISP }}
            >
              CBN Compliance Metrics — Last 30 Days
            </div>
            {!cbnMetrics ? (
              <div
                className="text-center py-12 text-gray-500"
                style={{ fontFamily: DISP }}
              >
                Loading compliance data...
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  {
                    label: "Transaction SLA",
                    value: `${cbnMetrics.transactionSla}%`,
                    color:
                      cbnMetrics.transactionSla >= 99
                        ? GREEN
                        : cbnMetrics.transactionSla >= 95
                          ? GOLD
                          : RED,
                    icon: "⏱",
                  },
                  {
                    label: "Dispute Resolution Rate",
                    value: `${cbnMetrics.disputeResolutionRate}%`,
                    color:
                      cbnMetrics.disputeResolutionRate >= 90
                        ? GREEN
                        : cbnMetrics.disputeResolutionRate >= 75
                          ? GOLD
                          : RED,
                    icon: "⚖",
                  },
                  {
                    label: "KYC Completion Rate",
                    value: `${cbnMetrics.kycCompletionRate}%`,
                    color:
                      cbnMetrics.kycCompletionRate >= 95
                        ? GREEN
                        : cbnMetrics.kycCompletionRate >= 80
                          ? GOLD
                          : RED,
                    icon: "🪪",
                  },
                  {
                    label: "Float Adequacy Rate",
                    value: `${cbnMetrics.floatAdequacyRate}%`,
                    color:
                      cbnMetrics.floatAdequacyRate >= 90
                        ? GREEN
                        : cbnMetrics.floatAdequacyRate >= 75
                          ? GOLD
                          : RED,
                    icon: "💰",
                  },
                  {
                    label: "Fraud Detection Rate",
                    value: `${cbnMetrics.fraudDetectionRate}%`,
                    color: cbnMetrics.fraudDetectionRate >= 99 ? GREEN : GOLD,
                    icon: "🛡",
                  },
                  {
                    label: "Avg Dispute Resolution",
                    value: `${cbnMetrics.avgDisputeResolutionDays?.toFixed(1) ?? "—"} days`,
                    color:
                      (cbnMetrics.avgDisputeResolutionDays ?? 99) <= 3
                        ? GREEN
                        : (cbnMetrics.avgDisputeResolutionDays ?? 99) <= 7
                          ? GOLD
                          : RED,
                    icon: "📅",
                  },
                  {
                    label: "Total Reportable Txns",
                    value: (
                      cbnMetrics.totalReportableTransactions ?? 0
                    ).toLocaleString(),
                    color: BLUE,
                    icon: "📊",
                  },
                  {
                    label: "NFIU SAR Count",
                    value: (cbnMetrics.nfiuSarCount ?? 0).toLocaleString(),
                    color: cbnMetrics.nfiuSarCount > 0 ? RED : GREEN,
                    icon: "🚨",
                  },
                ].map(metric => (
                  <div
                    key={metric.label}
                    className="rounded-2xl p-4"
                    style={{ background: CARD, border: `1px solid ${BORDER}` }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-lg">{metric.icon}</span>
                      <span
                        className="text-xs text-gray-400"
                        style={{ fontFamily: DISP }}
                      >
                        {metric.label}
                      </span>
                    </div>
                    <div
                      className="text-2xl font-black"
                      style={{ color: metric.color, fontFamily: MONO }}
                    >
                      {metric.value}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
