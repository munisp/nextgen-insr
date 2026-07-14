// @ts-nocheck
/**
 * AgentManagementTab — Admin Panel tab for viewing and managing all agents.
 * Supports: role promotion, suspend/activate, premium reserve view.
 */
import { useState } from "react";
import { trpc } from "../../lib/trpc";
import { toast } from "sonner";

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

const TIER_COLORS: Record<string, string> = {
  Bronze: "oklch(0.65 0.12 50)",
  Silver: "oklch(0.75 0.02 240)",
  Gold: GOLD,
  Platinum: "oklch(0.80 0.15 280)",
  Diamond: "oklch(0.85 0.18 200)",
};

const ROLE_COLORS: Record<string, string> = {
  admin: RED,
  supervisor: GOLD,
  agent: BLUE,
};

export default function AgentManagementTab() {
  const [search, setSearch] = useState("");
  const [assignModal, setAssignModal] = useState<{
    agentId: number;
    agentId: string;
  } | null>(null);
  const [supervisorCode, setSupervisorCode] = useState("");

  const assignMut = trpc.supervisor.assignAgent.useMutation({
    onSuccess: () => {
      toast.success("Agent assigned to supervisor");
      setAssignModal(null);
      setSupervisorCode("");
    },
    onError: e => toast.error(`Assignment failed: ${e.message}`),
  });

  const [confirmModal, setConfirmModal] = useState<{
    type: "role" | "suspend" | "activate";
    agentId: number;
    agentId: string;
    newRole?: string;
  } | null>(null);

  const {
    data: agents,
    refetch,
    isLoading,
  } = trpc.agentMgmt.listAll.useQuery();

  // Per-agent 7-day success rates from Python analytics service
  const { data: ratesData } = trpc.resilience.agentSuccessRates.useQuery(
    { days: 7 },
    {
      refetchInterval: 60_000,
      retry: false,
    }
  );
  const ratesMap = new Map<
    string,
    { rate: number | null; tier: string | null }
  >(
    (ratesData?.agents ?? []).map(a => [
      a.agent_code,
      { rate: a.success_rate_pct, tier: a.tier },
    ])
  );

  const RATE_COLOR = (tier: string | null) => {
    if (tier === "Excellent") return GREEN;
    if (tier === "Good") return BLUE;
    if (tier === "Fair") return GOLD;
    if (tier === "Poor") return RED;
    return "oklch(0.50 0.01 240)";
  };

  const setRoleMut = trpc.agentMgmt.setRole.useMutation({
    onSuccess: () => {
      toast.success("Agent role updated successfully");
      refetch();
      setConfirmModal(null);
    },
    onError: e => toast.error(`Failed to update role: ${e.message}`),
  });

  const setActiveMut = trpc.agentMgmt.setActive.useMutation({
    onSuccess: (_, vars) => {
      toast.success(vars.isActive ? "Agent activated" : "Agent suspended");
      refetch();
      setConfirmModal(null);
    },
    onError: e => toast.error(`Failed: ${e.message}`),
  });

  const filtered = (agents ?? []).filter(
    a =>
      a.agentId.toLowerCase().includes(search.toLowerCase()) ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      (a.location ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div
          className="text-lg font-black text-white"
          style={{ fontFamily: DISP }}
        >
          Agent Directory
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({agents?.length ?? 0} agents)
          </span>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by code, name, location…"
          className="px-3 py-2 rounded-xl text-sm text-white bg-transparent border outline-none w-64"
          style={{ borderColor: BORDER, fontFamily: DISP, background: CARD }}
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Agents", value: agents?.length ?? 0, color: BLUE },
          {
            label: "Active",
            value: agents?.filter(a => a.isActive).length ?? 0,
            color: GREEN,
          },
          {
            label: "Suspended",
            value: agents?.filter(a => !a.isActive).length ?? 0,
            color: RED,
          },
          {
            label: "Admins",
            value: agents?.filter(a => a.role === "admin").length ?? 0,
            color: GOLD,
          },
        ].map(c => (
          <div
            key={c.label}
            className="rounded-2xl p-4 flex flex-col gap-1"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-xs text-gray-500 uppercase tracking-widest"
              style={{ fontFamily: DISP }}
            >
              {c.label}
            </div>
            <div
              className="text-2xl font-black"
              style={{ color: c.color, fontFamily: MONO }}
            >
              {c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Agent table */}
      <div
        className="overflow-x-auto rounded-xl"
        style={{ border: `1px solid ${BORDER}` }}
      >
        {isLoading ? (
          <div
            className="flex items-center justify-center h-32 text-gray-500"
            style={{ fontFamily: DISP }}
          >
            Loading agents…
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr
                style={{
                  background: CARD,
                  borderBottom: `1px solid ${BORDER}`,
                }}
              >
                {[
                  "Code",
                  "Name",
                  "Tier",
                  "Role",
                  "Float Balance",
                  "Commission",
                  "Points",
                  "Location",
                  "7d Success",
                  "Status",
                  "Actions",
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
              {filtered.map((agent, i) => (
                <tr
                  key={agent.id}
                  style={{
                    background: i % 2 === 0 ? BG : CARD,
                    borderBottom: `1px solid ${BORDER}`,
                  }}
                >
                  <td
                    className="px-3 py-3 font-bold"
                    style={{ color: BLUE, fontFamily: MONO }}
                  >
                    {agent.agentId}
                  </td>
                  <td
                    className="px-3 py-3 text-white font-semibold"
                    style={{ fontFamily: DISP }}
                  >
                    {agent.name}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-bold"
                      style={{
                        background: `${TIER_COLORS[agent.tier] ?? BLUE}22`,
                        color: TIER_COLORS[agent.tier] ?? BLUE,
                        fontFamily: DISP,
                      }}
                    >
                      {agent.tier}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-bold uppercase"
                      style={{
                        background: `${ROLE_COLORS[agent.role] ?? BLUE}22`,
                        color: ROLE_COLORS[agent.role] ?? BLUE,
                        fontFamily: DISP,
                      }}
                    >
                      {agent.role}
                    </span>
                  </td>
                  <td
                    className="px-3 py-3 font-bold"
                    style={{ color: GREEN, fontFamily: MONO }}
                  >
                    {fmt(agent.premiumReserve)}
                  </td>
                  <td
                    className="px-3 py-3 font-bold"
                    style={{ color: GOLD, fontFamily: MONO }}
                  >
                    {fmt(agent.commissionBalance)}
                  </td>
                  <td
                    className="px-3 py-3 text-gray-400"
                    style={{ fontFamily: MONO }}
                  >
                    {agent.loyaltyPoints.toLocaleString()}
                  </td>
                  <td
                    className="px-3 py-3 text-gray-400 text-xs"
                    style={{ fontFamily: DISP }}
                  >
                    {agent.location ?? "—"}
                  </td>
                  {/* 7-day success rate from Python analytics */}
                  <td className="px-3 py-3">
                    {(() => {
                      const r = ratesMap.get(agent.agentId);
                      if (!r || r.rate === null) {
                        return (
                          <span
                            className="text-gray-600 text-xs"
                            style={{ fontFamily: MONO }}
                          >
                            —
                          </span>
                        );
                      }
                      return (
                        <div className="flex flex-col gap-0.5">
                          <span
                            className="text-xs font-bold"
                            style={{
                              color: RATE_COLOR(r.tier),
                              fontFamily: MONO,
                            }}
                          >
                            {r.rate.toFixed(1)}%
                          </span>
                          <span
                            className="text-xs"
                            style={{
                              color: RATE_COLOR(r.tier),
                              fontFamily: DISP,
                              opacity: 0.8,
                            }}
                          >
                            {r.tier}
                          </span>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className="px-2 py-0.5 rounded-full text-xs font-semibold"
                      style={{
                        background: agent.isActive
                          ? "oklch(0.65 0.18 160 / 0.15)"
                          : "oklch(0.60 0.22 25 / 0.15)",
                        color: agent.isActive ? GREEN : RED,
                        fontFamily: DISP,
                      }}
                    >
                      {agent.isActive ? "Active" : "Suspended"}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {/* Role promotion */}
                      <select
                        value={agent.role}
                        onChange={e =>
                          setConfirmModal({
                            type: "role",
                            agentId: agent.id,
                            agentId: agent.agentId,
                            newRole: e.target.value,
                          })
                        }
                        className="text-xs px-2 py-1 rounded-lg border outline-none cursor-pointer"
                        style={{
                          background: CARD,
                          borderColor: BORDER,
                          color: ROLE_COLORS[agent.role] ?? BLUE,
                          fontFamily: DISP,
                        }}
                      >
                        <option value="agent">Agent</option>
                        <option value="supervisor">Supervisor</option>
                        <option value="admin">Admin</option>
                      </select>

                      {/* Assign to Supervisor */}
                      <button
                        onClick={() =>
                          setAssignModal({
                            agentId: agent.id,
                            agentId: agent.agentId,
                          })
                        }
                        className="text-xs px-2 py-1 rounded-lg font-semibold transition-all"
                        style={{
                          background: "oklch(0.55 0.22 300 / 0.15)",
                          color: "#a855f7",
                          fontFamily: DISP,
                        }}
                      >
                        Assign
                      </button>

                      {/* Suspend / Activate */}
                      <button
                        onClick={() =>
                          setConfirmModal({
                            type: agent.isActive ? "suspend" : "activate",
                            agentId: agent.id,
                            agentId: agent.agentId,
                          })
                        }
                        className="text-xs px-2 py-1 rounded-lg font-semibold transition-all"
                        style={{
                          background: agent.isActive
                            ? "oklch(0.60 0.22 25 / 0.15)"
                            : "oklch(0.65 0.18 160 / 0.15)",
                          color: agent.isActive ? RED : GREEN,
                          fontFamily: DISP,
                        }}
                      >
                        {agent.isActive ? "Suspend" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Supervisor Assignment Modal */}
      {assignModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
        >
          <div
            className="rounded-2xl p-6 w-80 flex flex-col gap-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-base font-black text-white"
              style={{ fontFamily: DISP }}
            >
              Assign {assignModal.agentId} to Supervisor
            </div>
            <div className="text-sm text-gray-400" style={{ fontFamily: DISP }}>
              Enter the agent ID of the supervisor to assign this agent to.
            </div>
            <input
              value={supervisorCode}
              onChange={e => setSupervisorCode(e.target.value.toUpperCase())}
              placeholder="Supervisor agent ID (e.g. AGT-001)"
              className="px-3 py-2 rounded-xl text-sm text-white bg-transparent border outline-none"
              style={{
                borderColor: BORDER,
                fontFamily: DISP,
                background: "oklch(0.10 0.015 240)",
              }}
            />
            <div className="flex gap-3">
              <button
                onClick={() => {
                  setAssignModal(null);
                  setSupervisorCode("");
                }}
                className="flex-1 py-2 rounded-xl text-sm font-semibold"
                style={{
                  background: "oklch(0.22 0.02 240)",
                  color: "oklch(0.55 0.015 230)",
                  fontFamily: DISP,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (supervisorCode.trim().length < 3) {
                    toast.error("Enter a valid supervisor code");
                    return;
                  }
                  assignMut.mutate({
                    agentId: assignModal.agentId,
                    supervisorCode: supervisorCode.trim(),
                  });
                }}
                disabled={assignMut.isPending}
                className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
                style={{
                  background: "oklch(0.55 0.22 300)",
                  fontFamily: DISP,
                  opacity: assignMut.isPending ? 0.5 : 1,
                }}
              >
                {assignMut.isPending ? "Assigning…" : "Assign"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation modal */}
      {confirmModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: "rgba(0,0,0,0.7)" }}
        >
          <div
            className="rounded-2xl p-6 w-80 flex flex-col gap-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div
              className="text-base font-black text-white"
              style={{ fontFamily: DISP }}
            >
              {confirmModal.type === "role" &&
                `Change role for ${confirmModal.agentId}?`}
              {confirmModal.type === "suspend" &&
                `Suspend ${confirmModal.agentId}?`}
              {confirmModal.type === "activate" &&
                `Activate ${confirmModal.agentId}?`}
            </div>
            <div className="text-sm text-gray-400" style={{ fontFamily: DISP }}>
              {confirmModal.type === "role" &&
                `New role: ${confirmModal.newRole}`}
              {confirmModal.type === "suspend" &&
                "The agent will not be able to log in until reactivated."}
              {confirmModal.type === "activate" &&
                "The agent will regain full access to the insurance service."}
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmModal(null)}
                className="flex-1 py-2 rounded-xl text-sm font-semibold"
                style={{
                  background: "oklch(0.22 0.02 240)",
                  color: "oklch(0.55 0.015 230)",
                  fontFamily: DISP,
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmModal.type === "role" && confirmModal.newRole) {
                    setRoleMut.mutate({
                      agentId: confirmModal.agentId,
                      role: confirmModal.newRole as any,
                    });
                  } else if (confirmModal.type === "suspend") {
                    setActiveMut.mutate({
                      agentId: confirmModal.agentId,
                      isActive: false,
                    });
                  } else if (confirmModal.type === "activate") {
                    setActiveMut.mutate({
                      agentId: confirmModal.agentId,
                      isActive: true,
                    });
                  }
                }}
                disabled={setRoleMut.isPending || setActiveMut.isPending}
                className="flex-1 py-2 rounded-xl text-sm font-bold text-white"
                style={{
                  background: confirmModal.type === "suspend" ? RED : BLUE,
                  fontFamily: DISP,
                  opacity:
                    setRoleMut.isPending || setActiveMut.isPending ? 0.5 : 1,
                }}
              >
                {setRoleMut.isPending || setActiveMut.isPending
                  ? "Processing…"
                  : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
