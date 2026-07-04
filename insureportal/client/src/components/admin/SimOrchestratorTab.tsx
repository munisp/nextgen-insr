// @ts-nocheck
/**
 * SimOrchestratorTab — Admin Panel tab for the intelligent SIM Orchestrator
 *
 * Shows:
 *  1. Per-agent, per-carrier signal history (RSSI sparklines)
 *  2. Active SIM slot selection per agent
 *  3. Probe ingestion rate and last-seen timestamps
 *  4. Orchestrator config management per terminal
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { CoverageMap } from "./CoverageMap";
import { FailoverHistoryTab } from "./FailoverHistoryTab";

// ─── Design tokens ────────────────────────────────────────────────────────────
const BG = "#0a0e1a";
const CARD = "oklch(0.14 0.02 240)";
const BORDER = "oklch(0.22 0.02 240)";
const GREEN = "oklch(0.65 0.18 160)";
const RED = "oklch(0.60 0.22 25)";
const GOLD = "oklch(0.78 0.18 80)";
const BLUE = "oklch(0.60 0.22 260)";
const PURPLE = "oklch(0.60 0.22 300)";
const DISP = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

// Carrier colour map — Nigerian operators
const CARRIER_COLORS: Record<string, string> = {
  MTN: GOLD,
  Airtel: RED,
  Glo: GREEN,
  "9mobile": BLUE,
  Unknown: "oklch(0.55 0.015 230)",
};

function carrierColor(carrier: string) {
  return CARRIER_COLORS[carrier] ?? PURPLE;
}

function signalLabel(rssi: number) {
  if (rssi >= -65) return { label: "Excellent", color: GREEN };
  if (rssi >= -75) return { label: "Good", color: BLUE };
  if (rssi >= -85) return { label: "Fair", color: GOLD };
  return { label: "Poor", color: RED };
}

// Slot display names
const SLOT_LABELS: Record<string, string> = {
  Phys1: "SIM1\nPhysical",
  Phys2: "SIM2\nPhysical",
  ESim1: "eSIM1",
  ESim2: "eSIM2",
};

type ProbeRow = {
  id: number;
  agentId: string;
  terminalId: string;
  slot: string;
  carrier: string;
  mccMnc: number;
  rssi: number;
  regStatus: number;
  latencyMs: number;
  packetLossX10: number;
  score: number;
  selected: boolean;
  latE6: number | null;
  lonE6: number | null;
  fwVersion: string | null;
  probedAt: Date;
  createdAt: Date;
};

// ─── SIM slot badge ───────────────────────────────────────────────────────────
function SimSlotBadge({ slot, isActive }: { slot: string; isActive: boolean }) {
  return (
    <div
      className="flex flex-col items-center px-3 py-2 rounded-xl text-xs font-bold"
      style={{
        background: isActive
          ? "oklch(0.60 0.22 260 / 0.25)"
          : "oklch(0.14 0.02 240)",
        border: `1px solid ${isActive ? BLUE : BORDER}`,
        color: isActive ? BLUE : "oklch(0.55 0.015 230)",
        fontFamily: MONO,
        whiteSpace: "pre-line",
        textAlign: "center",
        minWidth: 56,
      }}
    >
      {SLOT_LABELS[slot] ?? slot}
      {isActive && (
        <span
          className="mt-1 text-[10px] px-1.5 py-0.5 rounded-full"
          style={{ background: "oklch(0.60 0.22 260 / 0.3)", color: BLUE }}
        >
          ACTIVE
        </span>
      )}
    </div>
  );
}

// ─── Agent probe card ─────────────────────────────────────────────────────────
function AgentProbeCard({
  agentId,
  probes,
}: {
  agentId: string;
  probes: ProbeRow[];
}) {
  const latest = probes[0];
  const activeSlot = probes.find(p => p.selected)?.slot ?? "";

  // Group probes by slot
  const bySlot = useMemo(() => {
    const map: Record<string, ProbeRow[]> = {};
    probes.forEach(p => {
      if (!map[p.slot]) map[p.slot] = [];
      map[p.slot].push(p);
    });
    return map;
  }, [probes]);

  // Build chart data: one row per timestamp, columns per slot+carrier
  const chartData = useMemo(() => {
    const times = Array.from(
      new Set(probes.map(p => p.probedAt.toString()))
    ).sort();
    return times.map(ts => {
      const row: Record<string, number | string> = {
        time: new Date(ts).toLocaleTimeString("en-NG", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      probes
        .filter(p => p.probedAt.toString() === ts)
        .forEach(p => {
          row[`${p.slot}_${p.carrier}`] = p.rssi;
        });
      return row;
    });
  }, [probes]);

  const slotCarriers = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ slot: string; carrier: string }> = [];
    probes.forEach(p => {
      const key = `${p.slot}_${p.carrier}`;
      if (!seen.has(key)) {
        seen.add(key);
        result.push({ slot: p.slot, carrier: p.carrier });
      }
    });
    return result;
  }, [probes]);

  const lat = latest?.latE6 != null ? (latest.latE6 / 1e6).toFixed(4) : null;
  const lon = latest?.lonE6 != null ? (latest.lonE6 / 1e6).toFixed(4) : null;

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: CARD, border: `1px solid ${BORDER}` }}
    >
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div
            className="text-sm font-black text-white"
            style={{ fontFamily: DISP }}
          >
            Agent{" "}
            <span style={{ color: BLUE, fontFamily: MONO }}>{agentId}</span>
            {latest?.terminalId && (
              <span
                className="ml-2 text-xs text-gray-500"
                style={{ fontFamily: MONO }}
              >
                ({latest.terminalId})
              </span>
            )}
          </div>
          {latest && (
            <div
              className="text-xs text-gray-500 mt-0.5"
              style={{ fontFamily: MONO }}
            >
              Last probe: {new Date(latest.probedAt).toLocaleString("en-NG")}
              {lat && lon && (
                <span className="ml-2" style={{ color: GOLD }}>
                  📍 {lat}, {lon}
                </span>
              )}
              {latest.fwVersion && (
                <span className="ml-2 text-gray-600">
                  fw {latest.fwVersion}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          {Object.keys(SLOT_LABELS).map(slot => (
            <SimSlotBadge
              key={slot}
              slot={slot}
              isActive={slot === activeSlot}
            />
          ))}
        </div>
      </div>

      {/* Per-slot current readings */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Object.entries(bySlot).map(([slot, slotProbes]) => {
          const p = slotProbes[0];
          const sig = signalLabel(p.rssi);
          const packetLoss = (p.packetLossX10 / 10).toFixed(1);
          return (
            <div
              key={slot}
              className="rounded-xl p-3 flex flex-col gap-1"
              style={{
                background: BG,
                border: `1px solid ${p.selected ? BLUE : BORDER}`,
              }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-bold"
                  style={{ color: carrierColor(p.carrier), fontFamily: DISP }}
                >
                  {p.carrier}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                  style={{
                    background: `${sig.color}22`,
                    color: sig.color,
                    fontFamily: DISP,
                  }}
                >
                  {sig.label}
                </span>
              </div>
              <div
                className="text-xs text-gray-500 mt-0.5"
                style={{ fontFamily: MONO }}
              >
                {SLOT_LABELS[slot] ?? slot}
              </div>
              <div
                className="text-lg font-black"
                style={{ color: sig.color, fontFamily: MONO }}
              >
                {p.rssi} dBm
              </div>
              <div
                className="text-xs text-gray-500 flex gap-2"
                style={{ fontFamily: MONO }}
              >
                <span>{p.latencyMs}ms</span>
                <span>{packetLoss}% loss</span>
              </div>
              <div className="text-xs mt-1" style={{ fontFamily: DISP }}>
                Score:{" "}
                <span className="font-bold" style={{ color: GOLD }}>
                  {p.score}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* RSSI sparkline chart */}
      {chartData.length > 1 && (
        <div>
          <div
            className="text-xs font-semibold text-gray-400 mb-2"
            style={{ fontFamily: DISP }}
          >
            Signal History (RSSI dBm)
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart
              data={chartData}
              margin={{ top: 4, right: 8, left: -20, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} />
              <XAxis
                dataKey="time"
                tick={{
                  fill: "oklch(0.55 0.015 230)",
                  fontSize: 10,
                  fontFamily: MONO,
                }}
              />
              <YAxis
                domain={[-110, -50]}
                tick={{
                  fill: "oklch(0.55 0.015 230)",
                  fontSize: 10,
                  fontFamily: MONO,
                }}
              />
              <Tooltip
                contentStyle={{
                  background: CARD,
                  border: `1px solid ${BORDER}`,
                  borderRadius: 8,
                  fontFamily: MONO,
                  fontSize: 11,
                }}
                labelStyle={{ color: "oklch(0.55 0.015 230)" }}
              />
              <Legend wrapperStyle={{ fontSize: 10, fontFamily: DISP }} />
              {slotCarriers.map(({ slot, carrier }) => (
                <Line
                  key={`${slot}_${carrier}`}
                  type="monotone"
                  dataKey={`${slot}_${carrier}`}
                  stroke={carrierColor(carrier)}
                  strokeWidth={2}
                  dot={false}
                  name={`${SLOT_LABELS[slot] ?? slot} (${carrier})`}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Config editor ────────────────────────────────────────────────────────────
function OrchestratorConfigPanel({
  terminalId,
  onClose,
}: {
  terminalId: string;
  onClose: () => void;
}) {
  const { data: cfg, isLoading } = trpc.simOrchestrator.listConfigs.useQuery(
    undefined,
    {
      select: configs => configs.find(c => c.terminalId === terminalId),
    }
  );
  const upsert = trpc.simOrchestrator.upsertConfig.useMutation({
    onSuccess: () => {
      toast.success("Config saved");
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const [apiKey, setApiKey] = useState("insureportal-sim-orchestrator-default-key");
  const [intervalMs, setIntervalMs] = useState(30000);
  const [relayEndpoint, setRelayEndpoint] = useState(
    "https://api.insureportal.ng/api/trpc/simOrchestrator.ingestProbe"
  );
  const [enabled, setEnabled] = useState(true);
  const [populated, setPopulated] = useState(false);

  useMemo(() => {
    if (cfg && !populated) {
      setApiKey((cfg as any).apiKey ?? "insureportal-sim-orchestrator-default-key");
      setIntervalMs(cfg.probeIntervalMs ?? 30000);
      setRelayEndpoint(
        cfg.relayEndpoint ??
          "https://api.insureportal.ng/api/trpc/simOrchestrator.ingestProbe"
      );
      setEnabled(cfg.enabled ?? true);
      setPopulated(true);
    }
  }, [cfg, populated]);

  if (isLoading)
    return (
      <div
        className="text-center py-8 text-gray-500"
        style={{ fontFamily: DISP }}
      >
        Loading config...
      </div>
    );

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-4"
      style={{ background: CARD, border: `1px solid ${BLUE}` }}
    >
      <div className="flex items-center justify-between">
        <div
          className="text-sm font-black text-white"
          style={{ fontFamily: DISP }}
        >
          Config —{" "}
          <span style={{ color: BLUE, fontFamily: MONO }}>{terminalId}</span>
        </div>
        <button
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-white px-2 py-1 rounded"
          style={{ fontFamily: DISP }}
        >
          ✕ Close
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400" style={{ fontFamily: DISP }}>
            API Key
          </label>
          <input
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            className="px-3 py-2 rounded-lg text-xs text-white outline-none"
            style={{
              background: BG,
              border: `1px solid ${BORDER}`,
              fontFamily: MONO,
            }}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400" style={{ fontFamily: DISP }}>
            Probe Interval (ms)
          </label>
          <input
            type="number"
            min={5000}
            max={300000}
            step={1000}
            value={intervalMs}
            onChange={e => setIntervalMs(Number(e.target.value))}
            className="px-3 py-2 rounded-lg text-xs text-white outline-none"
            style={{
              background: BG,
              border: `1px solid ${BORDER}`,
              fontFamily: MONO,
            }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-400" style={{ fontFamily: DISP }}>
          Relay Endpoint
        </label>
        <input
          value={relayEndpoint}
          onChange={e => setRelayEndpoint(e.target.value)}
          className="px-3 py-2 rounded-lg text-xs text-white outline-none"
          style={{
            background: BG,
            border: `1px solid ${BORDER}`,
            fontFamily: MONO,
          }}
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => setEnabled(e => !e)}
          className="px-4 py-2 rounded-xl text-xs font-bold transition-all"
          style={{
            background: enabled
              ? "oklch(0.65 0.18 160 / 0.2)"
              : "oklch(0.60 0.22 25 / 0.2)",
            color: enabled ? GREEN : RED,
            border: `1px solid ${enabled ? GREEN : RED}`,
            fontFamily: DISP,
          }}
        >
          {enabled ? "✓ Enabled" : "✗ Disabled"}
        </button>
        <button
          onClick={() =>
            upsert.mutate({
              terminalId,
              apiKey,
              probeIntervalMs: intervalMs,
              relayEndpoint,
              enabled,
            })
          }
          disabled={upsert.isPending}
          className="flex-1 py-2 rounded-xl text-xs font-bold transition-all"
          style={{
            background: BLUE,
            color: "white",
            fontFamily: DISP,
            opacity: upsert.isPending ? 0.6 : 1,
          }}
        >
          {upsert.isPending ? "Saving..." : "Save Config"}
        </button>
      </div>
    </div>
  );
}

// ─── Main tab ─────────────────────────────────────────────────────────────────
export function SimOrchestratorTab() {
  const [activeTab, setActiveTab] = useState<"probes" | "map" | "failovers">(
    "probes"
  );
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [configTerminal, setConfigTerminal] = useState<string | null>(null);
  const [hours, setHours] = useState(6);

  // Get all configs to know which terminals exist
  const { data: configs } = trpc.simOrchestrator.listConfigs.useQuery(
    undefined,
    {
      refetchInterval: 60_000,
    }
  );

  // Get history for the selected agent or all agents (use a known agent ID)
  // We query per-agent; if no agent selected we show the first config's terminal
  const agentId = selectedAgent ?? configs?.[0]?.terminalId ?? "DEMO-001";

  const { data: history, isLoading } = trpc.simOrchestrator.getHistory.useQuery(
    { agentId, hours },
    { refetchInterval: 30_000, enabled: !!agentId }
  );

  // Group probes by agentId
  const byAgent = useMemo(() => {
    const map: Record<string, ProbeRow[]> = {};
    (history ?? []).forEach((p: any) => {
      const key = p.agentId as string;
      if (!map[key]) map[key] = [];
      map[key].push(p as ProbeRow);
    });
    return map;
  }, [history]);

  const agentIds = Object.keys(byAgent).sort();
  const terminalIds = configs?.map(c => c.terminalId) ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* Header with tab switcher */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div
            className="text-sm font-black text-white"
            style={{ fontFamily: DISP }}
          >
            SIM Orchestrator
          </div>
          <div
            className="text-xs text-gray-500 mt-0.5"
            style={{ fontFamily: DISP }}
          >
            Intelligent multi-SIM network selection — {terminalIds.length}{" "}
            terminal{terminalIds.length !== 1 ? "s" : ""} configured
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div
            className="flex items-center gap-1 rounded-xl p-1 mr-2"
            style={{ background: BG, border: `1px solid ${BORDER}` }}
          >
            {(["probes", "map", "failovers"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background:
                    activeTab === tab
                      ? "oklch(0.60 0.22 260 / 0.3)"
                      : "transparent",
                  color: activeTab === tab ? "white" : "oklch(0.55 0.015 230)",
                  fontFamily: DISP,
                }}
              >
                {tab === "probes"
                  ? "📶 Probes"
                  : tab === "map"
                    ? "🗺️ Coverage Map"
                    : "⚠️ Failovers"}
              </button>
            ))}
          </div>
          {activeTab === "probes" && (
            <label
              className="text-xs text-gray-400"
              style={{ fontFamily: DISP }}
            >
              History:
            </label>
          )}
          {activeTab === "probes" &&
            ([1, 6, 24, 72] as const).map(h => (
              <button
                key={h}
                onClick={() => setHours(h)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{
                  background: hours === h ? "oklch(0.60 0.22 260 / 0.25)" : BG,
                  color: hours === h ? BLUE : "oklch(0.55 0.015 230)",
                  border: `1px solid ${hours === h ? BLUE : BORDER}`,
                  fontFamily: DISP,
                }}
              >
                {h}h
              </button>
            ))}
        </div>
      </div>

      {/* Coverage Map tab */}
      {activeTab === "map" && <CoverageMap />}

      {/* Failover History tab */}
      {activeTab === "failovers" && <FailoverHistoryTab />}

      {/* Probes tab content */}
      {activeTab === "probes" && (
        <>
          {/* Terminal config list */}
          {terminalIds.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="text-xs text-gray-500"
                style={{ fontFamily: DISP }}
              >
                Terminals:
              </span>
              {terminalIds.map(tid => (
                <button
                  key={tid}
                  onClick={() =>
                    setConfigTerminal(configTerminal === tid ? null : tid)
                  }
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background:
                      configTerminal === tid ? "oklch(0.78 0.18 80 / 0.2)" : BG,
                    color:
                      configTerminal === tid ? GOLD : "oklch(0.55 0.015 230)",
                    border: `1px solid ${configTerminal === tid ? GOLD : BORDER}`,
                    fontFamily: MONO,
                  }}
                >
                  ⚙ {tid}
                </button>
              ))}
            </div>
          )}

          {/* Config panel */}
          {configTerminal && (
            <OrchestratorConfigPanel
              terminalId={configTerminal}
              onClose={() => setConfigTerminal(null)}
            />
          )}

          {/* Loading */}
          {isLoading && (
            <div
              className="text-center py-12 text-gray-500"
              style={{ fontFamily: DISP }}
            >
              Loading probe data...
            </div>
          )}

          {/* Empty state */}
          {!isLoading && agentIds.length === 0 && (
            <div
              className="rounded-2xl p-10 text-center flex flex-col items-center gap-3"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div className="text-4xl">📶</div>
              <div
                className="text-sm font-bold text-white"
                style={{ fontFamily: DISP }}
              >
                No probe data yet
              </div>
              <div
                className="text-xs text-gray-500 max-w-sm"
                style={{ fontFamily: DISP }}
              >
                Deploy the Rust SIM Orchestrator daemon on your POS terminals.
                It will POST probe data to:
              </div>
              <div
                className="mt-1 px-4 py-2 rounded-xl text-xs font-semibold"
                style={{
                  background: "oklch(0.60 0.22 260 / 0.15)",
                  color: BLUE,
                  border: `1px solid ${BLUE}`,
                  fontFamily: MONO,
                }}
              >
                POST /api/trpc/simOrchestrator.ingestProbe
              </div>
              <div
                className="text-xs text-gray-600 mt-1"
                style={{ fontFamily: MONO }}
              >
                Default API key: insureportal-sim-orchestrator-default-key
              </div>
            </div>
          )}

          {/* Agent probe cards */}
          {agentIds.map(aid => (
            <AgentProbeCard key={aid} agentId={aid} probes={byAgent[aid]} />
          ))}
        </>
      )}
    </div>
  );
}
