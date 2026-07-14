// @ts-nocheck
/**
 * FailoverHistoryTab — Admin Panel sub-tab
 *
 * Shows the history of emergency SIM switches triggered by the Rust watchdog.
 * Each row shows: terminal, agent, from/to slot, reason, latency, loss%, timestamp.
 * Filterable by terminal ID. Auto-refreshes every 30s.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG = "#0a0e1a";
const CARD = "oklch(0.14 0.02 240)";
const BORDER = "oklch(0.22 0.03 240)";
const DISP = "'JetBrains Mono', monospace";
const MONO = "'JetBrains Mono', monospace";
const BLUE = "oklch(0.65 0.22 260)";
const GOLD = "oklch(0.78 0.18 80)";
const RED = "oklch(0.60 0.25 25)";
const GREEN = "oklch(0.65 0.20 145)";

const SLOT_COLORS: Record<string, string> = {
  Phys1: BLUE,
  Phys2: "oklch(0.65 0.22 200)",
  ESim1: GOLD,
  ESim2: "oklch(0.65 0.18 300)",
};

function SlotBadge({ name }: { name: string }) {
  return (
    <span
      className="px-2 py-0.5 rounded-lg text-xs font-bold"
      style={{
        background: `${SLOT_COLORS[name] ?? BLUE}22`,
        color: SLOT_COLORS[name] ?? BLUE,
        border: `1px solid ${SLOT_COLORS[name] ?? BLUE}44`,
        fontFamily: MONO,
      }}
    >
      {name}
    </span>
  );
}

function ReasonBadge({ reason }: { reason: string }) {
  const isLatency = reason === "high_latency";
  return (
    <span
      className="px-2 py-0.5 rounded-lg text-xs font-semibold"
      style={{
        background: isLatency ? `${GOLD}22` : `${RED}22`,
        color: isLatency ? GOLD : RED,
        border: `1px solid ${isLatency ? GOLD : RED}44`,
        fontFamily: MONO,
      }}
    >
      {isLatency ? "⏱ High Latency" : "📉 High Loss"}
    </span>
  );
}

export function FailoverHistoryTab() {
  const [terminalFilter, setTerminalFilter] = useState("");

  const { data, isLoading, refetch } =
    trpc.simOrchestrator.getFailoverHistory.useQuery(
      {
        terminalId: terminalFilter.trim() || undefined,
        limit: 200,
      },
      { refetchInterval: 30_000 }
    );

  const rows = data ?? [];

  // Derive unique terminal IDs for filter pills
  const allTerminals = Array.from(new Set(rows.map(r => r.terminalId))).sort();

  // Stats
  const totalSwitches = rows.length;
  const latencyCount = rows.filter(r => r.reason === "high_latency").length;
  const lossCount = rows.filter(r => r.reason === "high_packet_loss").length;
  const avgLatency =
    rows.length > 0
      ? Math.round(rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length)
      : 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div
            className="text-sm font-black text-white"
            style={{ fontFamily: DISP }}
          >
            SIM Failover History
          </div>
          <div
            className="text-xs text-gray-500 mt-0.5"
            style={{ fontFamily: DISP }}
          >
            Emergency SIM switches triggered by the watchdog daemon
          </div>
        </div>
        <button
          onClick={() => refetch()}
          className="px-3 py-1.5 rounded-xl text-xs font-semibold transition-all hover:opacity-80"
          style={{
            background: "oklch(0.60 0.22 260 / 0.15)",
            color: BLUE,
            border: `1px solid ${BLUE}44`,
            fontFamily: DISP,
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Switches", value: totalSwitches, color: BLUE },
          { label: "High Latency", value: latencyCount, color: GOLD },
          { label: "High Loss", value: lossCount, color: RED },
          {
            label: "Avg Latency",
            value: avgLatency > 0 ? `${avgLatency}ms` : "—",
            color: GREEN,
          },
        ].map(({ label, value, color }) => (
          <div
            key={label}
            className="rounded-2xl p-4 flex flex-col gap-1"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
              {label}
            </div>
            <div
              className="text-xl font-black"
              style={{ color, fontFamily: DISP }}
            >
              {value}
            </div>
          </div>
        ))}
      </div>

      {/* Terminal filter pills */}
      {allTerminals.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-gray-500" style={{ fontFamily: DISP }}>
            Filter:
          </span>
          <button
            onClick={() => setTerminalFilter("")}
            className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
            style={{
              background: !terminalFilter ? "oklch(0.60 0.22 260 / 0.25)" : BG,
              color: !terminalFilter ? "white" : "oklch(0.55 0.015 230)",
              border: `1px solid ${!terminalFilter ? BLUE : BORDER}`,
              fontFamily: MONO,
            }}
          >
            All
          </button>
          {allTerminals.map(tid => (
            <button
              key={tid}
              onClick={() =>
                setTerminalFilter(terminalFilter === tid ? "" : tid)
              }
              className="px-3 py-1 rounded-lg text-xs font-semibold transition-all"
              style={{
                background:
                  terminalFilter === tid ? "oklch(0.60 0.22 260 / 0.25)" : BG,
                color:
                  terminalFilter === tid ? "white" : "oklch(0.55 0.015 230)",
                border: `1px solid ${terminalFilter === tid ? BLUE : BORDER}`,
                fontFamily: MONO,
              }}
            >
              {tid}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div
          className="text-center py-12 text-gray-500"
          style={{ fontFamily: DISP }}
        >
          Loading failover history...
        </div>
      )}

      {/* Empty state */}
      {!isLoading && rows.length === 0 && (
        <div
          className="rounded-2xl p-10 text-center flex flex-col items-center gap-3"
          style={{ background: CARD, border: `1px solid ${BORDER}` }}
        >
          <div className="text-4xl">✅</div>
          <div
            className="text-sm font-bold text-white"
            style={{ fontFamily: DISP }}
          >
            No failovers recorded
          </div>
          <div
            className="text-xs text-gray-500 max-w-sm"
            style={{ fontFamily: DISP }}
          >
            The watchdog daemon will POST here when it performs an emergency SIM
            switch. All terminals are currently operating within thresholds.
          </div>
        </div>
      )}

      {/* Failover table */}
      {rows.length > 0 && (
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: `1px solid ${BORDER}` }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs" style={{ fontFamily: MONO }}>
              <thead>
                <tr
                  style={{
                    background: "oklch(0.12 0.02 240)",
                    borderBottom: `1px solid ${BORDER}`,
                  }}
                >
                  {[
                    "Terminal",
                    "Agent",
                    "From",
                    "→ To",
                    "Reason",
                    "Latency",
                    "Loss",
                    "TX Ref",
                    "Switched At",
                  ].map(h => (
                    <th
                      key={h}
                      className="px-3 py-2 text-left font-semibold"
                      style={{ color: "oklch(0.55 0.015 230)" }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.id}
                    style={{
                      background: i % 2 === 0 ? CARD : "oklch(0.13 0.02 240)",
                      borderBottom: `1px solid ${BORDER}`,
                    }}
                  >
                    <td className="px-3 py-2 font-bold" style={{ color: BLUE }}>
                      {row.terminalId}
                    </td>
                    <td
                      className="px-3 py-2"
                      style={{ color: "oklch(0.75 0.015 230)" }}
                    >
                      {row.agentId}
                    </td>
                    <td className="px-3 py-2">
                      <SlotBadge name={row.fromSlotName} />
                    </td>
                    <td className="px-3 py-2">
                      <SlotBadge name={row.toSlotName} />
                    </td>
                    <td className="px-3 py-2">
                      <ReasonBadge reason={row.reason} />
                    </td>
                    <td className="px-3 py-2">
                      <span
                        style={{ color: row.latencyMs > 3000 ? RED : GREEN }}
                      >
                        {row.latencyMs.toLocaleString()}ms
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <span
                        style={{ color: row.lossPercent > 20 ? RED : GREEN }}
                      >
                        {row.lossPercent.toFixed(1)}%
                      </span>
                    </td>
                    <td
                      className="px-3 py-2"
                      style={{ color: "oklch(0.50 0.015 230)" }}
                    >
                      {row.txRef ?? "—"}
                    </td>
                    <td
                      className="px-3 py-2"
                      style={{ color: "oklch(0.50 0.015 230)" }}
                    >
                      {new Date(row.switchedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
