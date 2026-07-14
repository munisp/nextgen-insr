// @ts-nocheck
/**
 * CoverageMap — Signal Heatmap Coverage Map for the SIM Orchestrator Admin Panel
 *
 * Renders probe GPS coordinates from sim_probe_log on a Leaflet map with
 * color-coded circle markers per carrier and RSSI signal strength:
 *   • Green  (RSSI > -70 dBm) — Excellent / Good signal
 *   • Amber  (RSSI -70 to -90 dBm) — Fair signal
 *   • Red    (RSSI < -90 dBm or unknown) — Poor / No signal
 *
 * Uses OpenStreetMap tiles — no API key required.
 */
import { useEffect, useRef, useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import "leaflet/dist/leaflet.css";

// ─── Design tokens (matching SimOrchestratorTab) ──────────────────────────────
const BG = "#0a0e1a";
const CARD = "oklch(0.14 0.02 240)";
const BORDER = "oklch(0.22 0.02 240)";
const GREEN = "#22c55e";
const AMBER = "#f59e0b";
const RED = "#ef4444";
const BLUE = "oklch(0.60 0.22 260)";
const DISP = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

// Carrier colour map
const CARRIER_COLORS: Record<string, string> = {
  MTN: "#f59e0b",
  Airtel: "#ef4444",
  Glo: "#22c55e",
  "9mobile": "#3b82f6",
  Unknown: "#6b7280",
};

function rssiColor(rssiDbm: number | null): string {
  if (rssiDbm === null) return RED;
  if (rssiDbm > -70) return GREEN;
  if (rssiDbm >= -90) return AMBER;
  return RED;
}

function rssiLabel(rssiDbm: number | null): string {
  if (rssiDbm === null) return "Unknown";
  if (rssiDbm > -70) return "Excellent";
  if (rssiDbm > -80) return "Good";
  if (rssiDbm >= -90) return "Fair";
  return "Poor";
}

type GeoPoint = {
  id: number;
  agentId: string;
  terminalId: string;
  slot: string;
  carrier: string;
  rssi: number;
  latencyMs: number;
  score: number;
  selected: boolean;
  lat: number;
  lon: number;
  rssiDbm: number | null;
  probedAt: Date;
};

// ─── Carrier filter pill ──────────────────────────────────────────────────────
function FilterPill({
  label,
  color,
  active,
  count,
  onClick,
}: {
  label: string;
  color: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all"
      style={{
        background: active ? `${color}22` : BG,
        color: active ? color : "oklch(0.55 0.015 230)",
        border: `1px solid ${active ? color : BORDER}`,
        fontFamily: DISP,
      }}
    >
      <span
        className="w-2 h-2 rounded-full inline-block"
        style={{ background: color }}
      />
      {label}
      <span
        className="px-1.5 py-0.5 rounded-full text-[10px]"
        style={{ background: `${color}33`, color }}
      >
        {count}
      </span>
    </button>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function MapLegend() {
  return (
    <div
      className="absolute bottom-4 left-4 z-[1000] rounded-xl p-3 flex flex-col gap-2"
      style={{
        background: "rgba(10,14,26,0.92)",
        border: `1px solid ${BORDER}`,
      }}
    >
      <div
        className="text-xs font-bold text-white"
        style={{ fontFamily: DISP }}
      >
        Signal Strength
      </div>
      {[
        { color: GREEN, label: "Excellent / Good (> -70 dBm)" },
        { color: AMBER, label: "Fair (-70 to -90 dBm)" },
        { color: RED, label: "Poor (< -90 dBm)" },
      ].map(({ color, label }) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full inline-block border-2"
            style={{ background: `${color}55`, borderColor: color }}
          />
          <span
            className="text-[11px] text-gray-400"
            style={{ fontFamily: DISP }}
          >
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main map component ───────────────────────────────────────────────────────
function LeafletMap({
  points,
  colorMode,
}: {
  points: GeoPoint[];
  colorMode: "rssi" | "carrier";
}) {
  const mapRef = useRef<any>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<any[]>([]);

  useEffect(() => {
    // Dynamically import leaflet to avoid SSR issues
    import("leaflet").then(L => {
      if (!mapContainerRef.current) return;

      // Fix default icon paths for bundlers
      delete (L.Icon.Default.prototype as any)._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        shadowUrl:
          "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
      });

      // Initialize map only once
      if (!mapRef.current) {
        mapRef.current = L.map(mapContainerRef.current, {
          center: [9.082, 8.6753], // Nigeria centroid
          zoom: 6,
          zoomControl: true,
        });

        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          attribution:
            '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 19,
        }).addTo(mapRef.current);
      }

      // Clear old markers
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      if (points.length === 0) return;

      // Add new markers
      points.forEach(pt => {
        const fillColor =
          colorMode === "carrier"
            ? (CARRIER_COLORS[pt.carrier] ?? "#6b7280")
            : rssiColor(pt.rssiDbm);

        const circle = L.circleMarker([pt.lat, pt.lon], {
          radius: 8,
          fillColor,
          color: fillColor,
          weight: 2,
          opacity: 0.9,
          fillOpacity: 0.55,
        });

        const probedAtStr = new Date(pt.probedAt).toLocaleString("en-NG");
        circle.bindPopup(
          `<div style="font-family: monospace; font-size: 12px; line-height: 1.6;">
            <strong style="color: ${fillColor}">${pt.carrier}</strong> — ${pt.slot}<br/>
            <strong>Agent:</strong> ${pt.agentId}<br/>
            <strong>Terminal:</strong> ${pt.terminalId}<br/>
            <strong>RSSI:</strong> ${pt.rssiDbm !== null ? `${pt.rssiDbm} dBm` : "Unknown"} (${rssiLabel(pt.rssiDbm)})<br/>
            <strong>Latency:</strong> ${pt.latencyMs} ms<br/>
            <strong>Score:</strong> ${pt.score}/1000<br/>
            <strong>GPS:</strong> ${pt.lat.toFixed(5)}, ${pt.lon.toFixed(5)}<br/>
            <strong>Probed:</strong> ${probedAtStr}
          </div>`
        );

        circle.addTo(mapRef.current);
        markersRef.current.push(circle);
      });

      // Fit bounds to markers
      if (points.length > 0) {
        const bounds = L.latLngBounds(points.map(p => [p.lat, p.lon]));
        mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    });
  }, [points, colorMode]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  return (
    <div className="relative w-full" style={{ height: 480 }}>
      <div
        ref={mapContainerRef}
        style={{ width: "100%", height: "100%", borderRadius: 12 }}
      />
      <MapLegend />
    </div>
  );
}

// ─── Coverage Map Tab ─────────────────────────────────────────────────────────
export function CoverageMap() {
  const [hours, setHours] = useState(168); // 7 days default
  const [colorMode, setColorMode] = useState<"rssi" | "carrier">("rssi");
  const [carrierFilter, setCarrierFilter] = useState<Set<string>>(new Set());

  const {
    data: rawPoints,
    isLoading,
    error,
  } = trpc.simOrchestrator.getProbeGeoData.useQuery(
    { hours },
    { refetchInterval: 60_000 }
  );

  const allCarriers = useMemo(() => {
    const carriers = new Set<string>();
    (rawPoints ?? []).forEach(p => carriers.add(p.carrier || "Unknown"));
    return Array.from(carriers).sort();
  }, [rawPoints]);

  const carrierCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    (rawPoints ?? []).forEach(p => {
      const c = p.carrier || "Unknown";
      counts[c] = (counts[c] ?? 0) + 1;
    });
    return counts;
  }, [rawPoints]);

  const filteredPoints = useMemo((): GeoPoint[] => {
    return (rawPoints ?? [])
      .filter(
        p =>
          carrierFilter.size === 0 || carrierFilter.has(p.carrier || "Unknown")
      )
      .map(p => ({
        ...p,
        carrier: p.carrier || "Unknown",
        probedAt: new Date(p.probedAt),
      })) as GeoPoint[];
  }, [rawPoints, carrierFilter]);

  function toggleCarrier(carrier: string) {
    setCarrierFilter(prev => {
      const next = new Set(prev);
      if (next.has(carrier)) next.delete(carrier);
      else next.add(carrier);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div
            className="text-sm font-black text-white"
            style={{ fontFamily: DISP }}
          >
            Signal Coverage Map
          </div>
          <div
            className="text-xs text-gray-500 mt-0.5"
            style={{ fontFamily: DISP }}
          >
            GPS-tagged probe readings — {filteredPoints.length.toLocaleString()}{" "}
            points
            {rawPoints && rawPoints.length !== filteredPoints.length
              ? ` (${rawPoints.length.toLocaleString()} total)`
              : ""}
          </div>
        </div>

        {/* Time range selector */}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-400" style={{ fontFamily: DISP }}>
            Range:
          </label>
          {[
            { label: "24h", value: 24 },
            { label: "7d", value: 168 },
            { label: "30d", value: 720 },
          ].map(({ label, value }) => (
            <button
              key={value}
              onClick={() => setHours(value)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background:
                  hours === value ? "oklch(0.60 0.22 260 / 0.25)" : BG,
                color: hours === value ? BLUE : "oklch(0.55 0.015 230)",
                border: `1px solid ${hours === value ? BORDER : BORDER}`,
                fontFamily: DISP,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Controls row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Color mode toggle */}
        <div
          className="flex items-center gap-1 rounded-xl p-1"
          style={{ background: BG, border: `1px solid ${BORDER}` }}
        >
          {(["rssi", "carrier"] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setColorMode(mode)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
              style={{
                background:
                  colorMode === mode
                    ? "oklch(0.60 0.22 260 / 0.3)"
                    : "transparent",
                color: colorMode === mode ? "white" : "oklch(0.55 0.015 230)",
                fontFamily: DISP,
              }}
            >
              {mode === "rssi" ? "📶 Signal Strength" : "📡 By Carrier"}
            </button>
          ))}
        </div>

        {/* Carrier filters */}
        {allCarriers.map(carrier => (
          <FilterPill
            key={carrier}
            label={carrier}
            color={CARRIER_COLORS[carrier] ?? "#6b7280"}
            active={carrierFilter.has(carrier)}
            count={carrierCounts[carrier] ?? 0}
            onClick={() => toggleCarrier(carrier)}
          />
        ))}
        {carrierFilter.size > 0 && (
          <button
            onClick={() => setCarrierFilter(new Set())}
            className="text-xs text-gray-500 hover:text-white px-2 py-1 rounded"
            style={{ fontFamily: DISP }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Map */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: CARD, border: `1px solid ${BORDER}` }}
      >
        {isLoading && (
          <div
            className="flex items-center justify-center"
            style={{
              height: 480,
              color: "oklch(0.55 0.015 230)",
              fontFamily: DISP,
            }}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="text-2xl animate-pulse">🗺️</div>
              <div className="text-sm">Loading geo data...</div>
            </div>
          </div>
        )}

        {error && (
          <div
            className="flex items-center justify-center"
            style={{ height: 480, color: RED, fontFamily: DISP }}
          >
            <div className="flex flex-col items-center gap-2">
              <div className="text-2xl">⚠️</div>
              <div className="text-sm">Failed to load coverage data</div>
              <div className="text-xs text-gray-500">{error.message}</div>
            </div>
          </div>
        )}

        {!isLoading && !error && filteredPoints.length === 0 && (
          <div
            className="flex items-center justify-center"
            style={{ height: 480, fontFamily: DISP }}
          >
            <div className="flex flex-col items-center gap-3 text-center">
              <div className="text-4xl">📍</div>
              <div className="text-sm font-bold text-white">
                No GPS data available
              </div>
              <div className="text-xs text-gray-500 max-w-sm">
                Probe data with GPS coordinates will appear here once POS
                terminals report location data (latE6/lonE6 fields in probe
                payloads).
              </div>
            </div>
          </div>
        )}

        {!isLoading && !error && filteredPoints.length > 0 && (
          <LeafletMap points={filteredPoints} colorMode={colorMode} />
        )}
      </div>

      {/* Stats summary */}
      {!isLoading && filteredPoints.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "Total Points",
              value: filteredPoints.length.toLocaleString(),
              color: "oklch(0.60 0.22 260)",
            },
            {
              label: "Excellent Signal",
              value: filteredPoints
                .filter(p => (p.rssiDbm ?? -999) > -70)
                .length.toLocaleString(),
              color: GREEN,
            },
            {
              label: "Fair Signal",
              value: filteredPoints
                .filter(
                  p => (p.rssiDbm ?? -999) <= -70 && (p.rssiDbm ?? -999) >= -90
                )
                .length.toLocaleString(),
              color: AMBER,
            },
            {
              label: "Poor Signal",
              value: filteredPoints
                .filter(p => (p.rssiDbm ?? -999) < -90)
                .length.toLocaleString(),
              color: RED,
            },
          ].map(({ label, value, color }) => (
            <div
              key={label}
              className="rounded-xl p-4 flex flex-col gap-1"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              <div
                className="text-xs text-gray-500"
                style={{ fontFamily: DISP }}
              >
                {label}
              </div>
              <div
                className="text-xl font-black"
                style={{ color, fontFamily: MONO }}
              >
                {value}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
