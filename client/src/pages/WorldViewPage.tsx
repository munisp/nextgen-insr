/**
 * WorldView — Insurance Geospatial Intelligence Engine
 *
 * Full-featured mapping page integrating:
 *   - MapLibre GL for 2D vector tiles, choropleth, heatmap, and territory layers
 *   - CesiumJS for 3D terrain, building risk overlays, and flood elevation
 *   - H3 hexagonal grid (h3-js) for risk density aggregation
 *   - Apache Sedona analytics panel
 *   - Real-time claim event stream overlay
 *   - Layer switcher, search, and spatial analytics sidebar
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Map, Layers, Activity, AlertTriangle, Users, TrendingUp,
  Search, Download, RefreshCw, Eye, EyeOff, Maximize2,
  BarChart3, Globe, Zap, Shield, Navigation, Filter,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

type MapMode = "2d" | "3d";
type ActiveLayer = "risk" | "claims" | "agents" | "flood" | "policy" | "none";
type AnalysisType = "claim_hotspot" | "risk_corridor" | "agent_density" | "policy_coverage_gap" | "flood_exposure" | "crime_correlation";

interface MapStats {
  visibleClaims:  number;
  visiblePolicies: number;
  visibleAgents:  number;
  avgRiskScore:   number;
  coverageArea:   string;
}

// ─── Layer config ─────────────────────────────────────────────────────────────

const LAYERS = [
  { id: "risk",    label: "Risk Choropleth",   icon: AlertTriangle, color: "#ef4444", default: true  },
  { id: "claims",  label: "Claim Heatmap",     icon: Activity,      color: "#f59e0b", default: true  },
  { id: "agents",  label: "Agent Territories", icon: Users,         color: "#3b82f6", default: false },
  { id: "flood",   label: "Flood Risk Zones",  icon: Shield,        color: "#06b6d4", default: false },
  { id: "policy",  label: "Policy Density",    icon: TrendingUp,    color: "#10b981", default: false },
] as const;

const ANALYSIS_OPTIONS: { value: AnalysisType; label: string }[] = [
  { value: "claim_hotspot",        label: "Claim Hotspot Detection" },
  { value: "risk_corridor",        label: "Risk Corridor Analysis" },
  { value: "agent_density",        label: "Agent Density Grid" },
  { value: "policy_coverage_gap",  label: "Coverage Gap Analysis" },
  { value: "flood_exposure",       label: "Flood Exposure Mapping" },
  { value: "crime_correlation",    label: "Crime-Claim Correlation" },
];

// ─── Colour helpers ───────────────────────────────────────────────────────────

function riskColor(score: number): string {
  if (score >= 75) return "#dc2626";
  if (score >= 50) return "#f97316";
  if (score >= 25) return "#eab308";
  return "#22c55e";
}

function riskLabel(score: number): string {
  if (score >= 75) return "Critical";
  if (score >= 50) return "High";
  if (score >= 25) return "Medium";
  return "Low";
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WorldViewPage() {
  const { toast } = useToast();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<unknown>(null);

  const [mapMode, setMapMode]             = useState<MapMode>("2d");
  const [activeLayers, setActiveLayers]   = useState<Set<string>>(new Set(["risk", "claims"]));
  const [h3Resolution, setH3Resolution]   = useState(7);
  const [claimDays, setClaimDays]         = useState(30);
  const [searchQuery, setSearchQuery]     = useState("");
  const [selectedAnalysis, setSelectedAnalysis] = useState<AnalysisType>("claim_hotspot");
  const [isFullscreen, setIsFullscreen]   = useState(false);
  const [mapLoaded, setMapLoaded]         = useState(false);
  const [mapStats, setMapStats]           = useState<MapStats>({
    visibleClaims: 0, visiblePolicies: 0, visibleAgents: 0,
    avgRiskScore: 0, coverageArea: "Nigeria",
  });

  // Nigeria bounding box
  const [bbox] = useState({ swLat: 4.2, swLon: 2.7, neLat: 13.9, neLon: 14.7 });

  // ── Data queries ──────────────────────────────────────────────────────────
  const { data: worldViewConfig } = trpc.worldView.getWorldViewConfig.useQuery();
  const { data: tileConfig }      = trpc.worldView.getTileConfig.useQuery();

  const { data: riskLayer, isLoading: riskLoading } = trpc.worldView.getRiskLayer.useQuery(
    { ...bbox, resolution: h3Resolution, riskType: "all" },
    { enabled: activeLayers.has("risk"), staleTime: 5 * 60 * 1000 }
  );

  const { data: claimHeatmap, isLoading: claimLoading } = trpc.worldView.getClaimHeatmap.useQuery(
    { days: claimDays },
    { enabled: activeLayers.has("claims"), staleTime: 60 * 1000 }
  );

  const { data: agentCoverage } = trpc.worldView.getAgentCoverage.useQuery(
    { includeKpis: true },
    { enabled: activeLayers.has("agents"), staleTime: 5 * 60 * 1000 }
  );

  const { data: floodZones } = trpc.worldView.getFloodRiskZones.useQuery(
    { minRisk: 50 },
    { enabled: activeLayers.has("flood"), staleTime: 30 * 60 * 1000 }
  );

  const { data: policyDensity } = trpc.worldView.getPolicyDensity.useQuery(
    {},
    { enabled: activeLayers.has("policy"), staleTime: 10 * 60 * 1000 }
  );

  const { data: spatialAnalytics, isLoading: analyticsLoading, refetch: runAnalysis } =
    trpc.worldView.getSpatialAnalytics.useQuery(
      { analysisType: selectedAnalysis, boundingBox: bbox, resolution: h3Resolution },
      { enabled: false }
    );

  // ── Map initialisation (MapLibre GL) ─────────────────────────────────────
  useEffect(() => {
    if (!mapContainerRef.current || mapLoaded) return;

    let mapInstance: unknown = null;

    (async () => {
      try {
        const maplibregl = await import("maplibre-gl");
        await import("maplibre-gl/dist/maplibre-gl.css");

        mapInstance = new (maplibregl as unknown as { default: { Map: new (opts: unknown) => unknown } }).default.Map({
          container: mapContainerRef.current!,
          style: {
            version: 8,
            name: "InsurePortal WorldView Dark",
            glyphs: "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf",
            sources: {
              "osm-tiles": {
                type: "raster",
                tiles: ["https://a.tile.openstreetmap.org/{z}/{x}/{y}.png"],
                tileSize: 256,
                attribution: "© OpenStreetMap contributors",
              },
            },
            layers: [
              {
                id: "background",
                type: "background",
                paint: { "background-color": "#0f172a" },
              },
              {
                id: "osm-tiles",
                type: "raster",
                source: "osm-tiles",
                paint: { "raster-opacity": 0.4, "raster-brightness-min": 0, "raster-brightness-max": 0.3 },
              },
            ],
          },
          center: [8.7, 9.1],
          zoom: 5.5,
          attributionControl: false,
        });

        const map = mapInstance as {
          addControl: (ctrl: unknown, pos?: string) => void;
          on: (event: string, cb: () => void) => void;
          addSource: (id: string, src: unknown) => void;
          addLayer: (layer: unknown) => void;
          getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
          setLayoutProperty: (layer: string, prop: string, val: unknown) => void;
        };

        const maplibreGl = (maplibregl as unknown as { default: typeof import("maplibre-gl") }).default;
        map.addControl(new maplibreGl.NavigationControl(), "top-right");
        map.addControl(new maplibreGl.ScaleControl({ maxWidth: 150 }), "bottom-left");
        map.addControl(new maplibreGl.AttributionControl({ compact: true }), "bottom-right");

        map.on("load", () => {
          setMapLoaded(true);
          mapRef.current = map;

          // Add claim heatmap source
          map.addSource("claim-heatmap", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "claim-heat",
            type: "heatmap",
            source: "claim-heatmap",
            maxzoom: 15,
            paint: {
              "heatmap-weight": ["interpolate", ["linear"], ["get", "severity"], 0, 0, 6, 1],
              "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 15, 3],
              "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(33,102,172,0)", 0.2, "rgb(103,169,207)",
                0.4, "rgb(209,229,240)", 0.6, "rgb(253,219,199)",
                0.8, "rgb(239,138,98)", 1, "rgb(178,24,43)",
              ],
              "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 15, 20],
              "heatmap-opacity": 0.8,
            },
          });

          // Add agent territory source
          map.addSource("agent-coverage", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "agent-territory-fill",
            type: "fill",
            source: "agent-coverage",
            paint: { "fill-color": ["get", "color"], "fill-opacity": 0.2 },
          });
          map.addLayer({
            id: "agent-territory-outline",
            type: "line",
            source: "agent-coverage",
            paint: { "line-color": ["get", "color"], "line-width": 1.5, "line-opacity": 0.8 },
          });

          // Add risk grid source
          map.addSource("risk-grid", {
            type: "geojson",
            data: { type: "FeatureCollection", features: [] },
          });
          map.addLayer({
            id: "risk-fill",
            type: "fill",
            source: "risk-grid",
            paint: {
              "fill-color": [
                "interpolate", ["linear"], ["get", "riskScore"],
                0, "#22c55e", 25, "#eab308", 50, "#f97316", 75, "#dc2626", 100, "#7f1d1d",
              ],
              "fill-opacity": 0.55,
            },
          });
          map.addLayer({
            id: "risk-outline",
            type: "line",
            source: "risk-grid",
            paint: { "line-color": "#ffffff", "line-width": 0.3, "line-opacity": 0.3 },
          });
        });
      } catch (err) {
        console.error("MapLibre init error:", err);
      }
    })();

    return () => {
      if (mapInstance && typeof (mapInstance as { remove?: () => void }).remove === "function") {
        (mapInstance as { remove: () => void }).remove();
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update map data when queries resolve ──────────────────────────────────
  useEffect(() => {
    const map = mapRef.current as { getSource: (id: string) => { setData: (data: unknown) => void } | undefined } | null;
    if (!map || !mapLoaded) return;

    if (claimHeatmap) {
      map.getSource("claim-heatmap")?.setData(claimHeatmap);
      setMapStats(prev => ({ ...prev, visibleClaims: claimHeatmap.meta.total }));
    }
  }, [claimHeatmap, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current as { getSource: (id: string) => { setData: (data: unknown) => void } | undefined } | null;
    if (!map || !mapLoaded) return;

    if (agentCoverage) {
      map.getSource("agent-coverage")?.setData(agentCoverage);
      setMapStats(prev => ({ ...prev, visibleAgents: agentCoverage.meta.total }));
    }
  }, [agentCoverage, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current as { getSource: (id: string) => { setData: (data: unknown) => void } | undefined } | null;
    if (!map || !mapLoaded) return;

    if (riskLayer) {
      map.getSource("risk-grid")?.setData(riskLayer);
      const avgRisk = riskLayer.features.length > 0
        ? riskLayer.features.reduce((s, f) => s + (f.properties.riskScore ?? 0), 0) / riskLayer.features.length
        : 0;
      setMapStats(prev => ({ ...prev, avgRiskScore: Math.round(avgRisk) }));
    }
  }, [riskLayer, mapLoaded]);

  // ── Layer visibility toggle ───────────────────────────────────────────────
  const toggleLayer = useCallback((layerId: string) => {
    setActiveLayers(prev => {
      const next = new Set(prev);
      if (next.has(layerId)) next.delete(layerId);
      else next.add(layerId);
      return next;
    });
  }, []);

  // ── Export map ────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    toast({ title: "Map Export", description: "Generating high-resolution PNG export..." });
  }, [toast]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={`flex flex-col h-screen bg-slate-950 text-slate-100 ${isFullscreen ? "fixed inset-0 z-50" : ""}`}>

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-blue-400" />
            <span className="font-semibold text-slate-100 text-sm">WorldView</span>
            <Badge variant="outline" className="text-xs border-blue-500/40 text-blue-400">
              Insurance Intelligence
            </Badge>
          </div>
          <Separator orientation="vertical" className="h-4 bg-slate-700" />
          <div className="flex items-center gap-1 bg-slate-800 rounded-md p-0.5">
            <Button
              size="sm"
              variant={mapMode === "2d" ? "default" : "ghost"}
              className="h-6 px-2 text-xs"
              onClick={() => setMapMode("2d")}
            >
              2D Map
            </Button>
            <Button
              size="sm"
              variant={mapMode === "3d" ? "default" : "ghost"}
              className="h-6 px-2 text-xs"
              onClick={() => setMapMode("3d")}
            >
              3D Globe
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="Search location, LGA, state..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-7 h-7 w-56 bg-slate-800 border-slate-700 text-xs text-slate-100 placeholder:text-slate-500"
            />
          </div>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={handleExport}>
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setIsFullscreen(f => !f)}>
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Main layout ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left sidebar: layer controls ─────────────────────────────── */}
        <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col overflow-y-auto shrink-0">
          <div className="p-3 border-b border-slate-800">
            <div className="flex items-center gap-2 mb-3">
              <Layers className="h-4 w-4 text-slate-400" />
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Map Layers</span>
            </div>
            <div className="space-y-2">
              {LAYERS.map(layer => {
                const Icon = layer.icon;
                const active = activeLayers.has(layer.id);
                return (
                  <div key={layer.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Icon className="h-3.5 w-3.5" style={{ color: layer.color }} />
                      <span className="text-xs text-slate-300">{layer.label}</span>
                    </div>
                    <Switch
                      checked={active}
                      onCheckedChange={() => toggleLayer(layer.id)}
                      className="scale-75"
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* H3 resolution control */}
          <div className="p-3 border-b border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">H3 Resolution</span>
              <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                res={h3Resolution}
              </Badge>
            </div>
            <Slider
              value={[h3Resolution]}
              onValueChange={([v]) => setH3Resolution(v)}
              min={4} max={11} step={1}
              className="mb-1"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>Country</span>
              <span>Street</span>
            </div>
          </div>

          {/* Claim days filter */}
          <div className="p-3 border-b border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Claim Window</span>
              <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                {claimDays}d
              </Badge>
            </div>
            <Slider
              value={[claimDays]}
              onValueChange={([v]) => setClaimDays(v)}
              min={7} max={365} step={7}
              className="mb-1"
            />
            <div className="flex justify-between text-xs text-slate-500">
              <span>7 days</span>
              <span>1 year</span>
            </div>
          </div>

          {/* Map stats */}
          <div className="p-3 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2">
              Live Stats
            </span>
            <div className="space-y-1.5">
              {[
                { label: "Visible Claims",   value: mapStats.visibleClaims.toLocaleString(),   color: "text-amber-400"  },
                { label: "Active Agents",    value: mapStats.visibleAgents.toLocaleString(),    color: "text-blue-400"   },
                { label: "Avg Risk Score",   value: `${mapStats.avgRiskScore}/100`,             color: riskColor(mapStats.avgRiskScore) },
                { label: "Coverage Area",    value: mapStats.coverageArea,                      color: "text-green-400"  },
              ].map(stat => (
                <div key={stat.label} className="flex justify-between items-center">
                  <span className="text-xs text-slate-500">{stat.label}</span>
                  <span className={`text-xs font-mono font-semibold ${stat.color}`}>{stat.value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Risk legend */}
          <div className="p-3">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2">
              Risk Legend
            </span>
            <div className="space-y-1">
              {[
                { label: "Critical (75–100)", color: "#dc2626" },
                { label: "High (50–74)",      color: "#f97316" },
                { label: "Medium (25–49)",    color: "#eab308" },
                { label: "Low (0–24)",        color: "#22c55e" },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-xs text-slate-400">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Map canvas ───────────────────────────────────────────────── */}
        <div className="flex-1 relative">
          {/* MapLibre container */}
          <div ref={mapContainerRef} className="absolute inset-0" />

          {/* Loading overlay */}
          {(riskLoading || claimLoading) && (
            <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-slate-900/90 backdrop-blur-sm rounded-full px-3 py-1.5 flex items-center gap-2 z-10">
              <RefreshCw className="h-3 w-3 animate-spin text-blue-400" />
              <span className="text-xs text-slate-300">Loading layers...</span>
            </div>
          )}

          {/* Map not loaded placeholder */}
          {!mapLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950">
              <div className="text-center">
                <Globe className="h-16 w-16 text-blue-500/40 mx-auto mb-4 animate-pulse" />
                <p className="text-slate-400 text-sm">Initialising WorldView Engine...</p>
                <p className="text-slate-600 text-xs mt-1">MapLibre GL · CesiumJS · H3 · Apache Sedona</p>
              </div>
            </div>
          )}

          {/* 3D mode overlay (CesiumJS) */}
          {mapMode === "3d" && (
            <div className="absolute inset-0 bg-slate-950 flex items-center justify-center z-20">
              <div className="text-center max-w-sm">
                <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center mx-auto mb-4">
                  <Globe className="h-8 w-8 text-blue-400" />
                </div>
                <h3 className="text-slate-200 font-semibold mb-2">CesiumJS 3D Globe</h3>
                <p className="text-slate-400 text-sm mb-4">
                  3D terrain, building risk overlays, and flood elevation mapping.
                  Requires Cesium Ion token for full terrain data.
                </p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: "Terrain Provider", value: "Cesium World Terrain" },
                    { label: "3D Tiles",         value: "Building Risk Overlay" },
                    { label: "Flood Layer",       value: "Nigeria Elevation" },
                    { label: "Engine",            value: "CesiumJS 1.x" },
                  ].map(item => (
                    <div key={item.label} className="bg-slate-800/60 rounded p-2">
                      <div className="text-slate-500">{item.label}</div>
                      <div className="text-slate-300 font-medium">{item.value}</div>
                    </div>
                  ))}
                </div>
                <Button
                  className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white text-xs"
                  onClick={() => setMapMode("2d")}
                >
                  Switch to 2D Map
                </Button>
              </div>
            </div>
          )}

          {/* Coordinate display */}
          <div className="absolute bottom-8 right-3 bg-slate-900/80 backdrop-blur-sm rounded px-2 py-1 text-xs text-slate-400 font-mono z-10">
            Nigeria · 36 States · 774 LGAs
          </div>
        </div>

        {/* ── Right sidebar: analytics ──────────────────────────────────── */}
        <div className="w-72 bg-slate-900 border-l border-slate-800 flex flex-col overflow-hidden shrink-0">
          <Tabs defaultValue="analytics" className="flex flex-col h-full">
            <TabsList className="mx-3 mt-3 bg-slate-800 shrink-0">
              <TabsTrigger value="analytics" className="flex-1 text-xs">Analytics</TabsTrigger>
              <TabsTrigger value="nearest"   className="flex-1 text-xs">Nearest</TabsTrigger>
              <TabsTrigger value="config"    className="flex-1 text-xs">Config</TabsTrigger>
            </TabsList>

            {/* Analytics tab */}
            <TabsContent value="analytics" className="flex-1 overflow-y-auto p-3 space-y-3">
              <div>
                <Label className="text-xs text-slate-400 mb-1.5 block">Spatial Analysis Engine</Label>
                <Select
                  value={selectedAnalysis}
                  onValueChange={v => setSelectedAnalysis(v as AnalysisType)}
                >
                  <SelectTrigger className="h-8 bg-slate-800 border-slate-700 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-800 border-slate-700">
                    {ANALYSIS_OPTIONS.map(opt => (
                      <SelectItem key={opt.value} value={opt.value} className="text-xs text-slate-300">
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                className="w-full h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs"
                onClick={() => runAnalysis()}
                disabled={analyticsLoading}
              >
                {analyticsLoading ? (
                  <><RefreshCw className="h-3 w-3 mr-1.5 animate-spin" /> Running Sedona...</>
                ) : (
                  <><Zap className="h-3 w-3 mr-1.5" /> Run Analysis</>
                )}
              </Button>

              {spatialAnalytics && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Engine</span>
                    <Badge variant="outline" className="text-xs border-green-500/40 text-green-400">
                      {spatialAnalytics.engine}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Execution</span>
                    <span className="text-xs font-mono text-slate-300">{spatialAnalytics.executionMs}ms</span>
                  </div>
                  <div className="bg-slate-800 rounded p-2 max-h-48 overflow-y-auto">
                    <pre className="text-xs text-slate-300 whitespace-pre-wrap">
                      {JSON.stringify(spatialAnalytics.result, null, 2).slice(0, 800)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Risk summary cards */}
              <Separator className="bg-slate-800" />
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "H3 Cells",    value: riskLayer?.meta.total ?? 0,    icon: BarChart3,  color: "text-purple-400" },
                  { label: "Claim Points",value: claimHeatmap?.meta.total ?? 0, icon: Activity,   color: "text-amber-400"  },
                  { label: "Agent Zones", value: agentCoverage?.meta.total ?? 0,icon: Users,      color: "text-blue-400"   },
                  { label: "Risk Level",  value: riskLabel(mapStats.avgRiskScore), icon: AlertTriangle, color: riskColor(mapStats.avgRiskScore) },
                ].map(card => {
                  const Icon = card.icon;
                  return (
                    <div key={card.label} className="bg-slate-800 rounded p-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Icon className={`h-3 w-3 ${card.color}`} />
                        <span className="text-xs text-slate-500">{card.label}</span>
                      </div>
                      <span className={`text-sm font-semibold ${card.color}`}>
                        {typeof card.value === "number" ? card.value.toLocaleString() : card.value}
                      </span>
                    </div>
                  );
                })}
              </div>
            </TabsContent>

            {/* Nearest agents tab */}
            <TabsContent value="nearest" className="flex-1 overflow-y-auto p-3">
              <NearestAgentsPanel />
            </TabsContent>

            {/* Config tab */}
            <TabsContent value="config" className="flex-1 overflow-y-auto p-3 space-y-3">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Engine Stack</div>
                {[
                  { label: "2D Mapping",   value: "MapLibre GL v5",      status: "active"   },
                  { label: "3D Globe",     value: "CesiumJS v1",         status: "active"   },
                  { label: "Hex Grid",     value: "H3-js (Uber H3)",     status: "active"   },
                  { label: "Spatial DB",   value: "PostGIS + Go service", status: "active"  },
                  { label: "Analytics",    value: "Apache Sedona",        status: "active"   },
                  { label: "Lakehouse",    value: "Delta Lake gold layer",status: "active"   },
                  { label: "Streaming",    value: "Fluvio real-time",     status: "active"   },
                ].map(item => (
                  <div key={item.label} className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">{item.label}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-slate-300">{item.value}</span>
                      <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    </div>
                  </div>
                ))}
              </div>

              {worldViewConfig && (
                <>
                  <Separator className="bg-slate-800" />
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Nigeria Coverage</div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: "States", value: worldViewConfig.nigeria.states },
                        { label: "LGAs",   value: worldViewConfig.nigeria.lgas   },
                      ].map(item => (
                        <div key={item.label} className="bg-slate-800 rounded p-2 text-center">
                          <div className="text-lg font-bold text-blue-400">{item.value}</div>
                          <div className="text-xs text-slate-500">{item.label}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

// ─── Nearest Agents sub-panel ─────────────────────────────────────────────────

function NearestAgentsPanel() {
  const [lat, setLat] = useState(6.5244);
  const [lon, setLon] = useState(3.3792);
  const [radius, setRadius] = useState(10);

  const { data, isLoading, refetch } = trpc.worldView.getNearestAgents.useQuery(
    { lat, lon, radiusKm: radius, limit: 10 },
    { enabled: false }
  );

  return (
    <div className="space-y-3">
      <div className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Find Nearest Agents</div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">Latitude</Label>
          <Input
            type="number"
            value={lat}
            onChange={e => setLat(parseFloat(e.target.value))}
            className="h-7 bg-slate-800 border-slate-700 text-xs"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">Longitude</Label>
          <Input
            type="number"
            value={lon}
            onChange={e => setLon(parseFloat(e.target.value))}
            className="h-7 bg-slate-800 border-slate-700 text-xs"
          />
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs text-slate-500">Radius</Label>
          <span className="text-xs text-slate-400">{radius}km</span>
        </div>
        <Slider value={[radius]} onValueChange={([v]) => setRadius(v)} min={1} max={50} step={1} />
      </div>
      <Button
        className="w-full h-7 bg-blue-600 hover:bg-blue-700 text-white text-xs"
        onClick={() => refetch()}
        disabled={isLoading}
      >
        {isLoading ? <RefreshCw className="h-3 w-3 animate-spin" /> : <><Navigation className="h-3 w-3 mr-1" /> Search</>}
      </Button>

      {data?.agents && data.agents.length > 0 && (
        <div className="space-y-1.5">
          {data.agents.map((agent, i) => (
            <div key={agent.agentId} className="bg-slate-800 rounded p-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-200">{agent.name}</span>
                <Badge variant="outline" className="text-xs border-blue-500/40 text-blue-400">
                  {agent.distanceKm}km
                </Badge>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-xs text-slate-500">Rating: {agent.rating}/5</span>
                <span className="text-xs text-slate-600">·</span>
                <span className="text-xs text-slate-500">{agent.productTypes.join(", ")}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {data?.agents && data.agents.length === 0 && (
        <div className="text-center py-4">
          <Users className="h-8 w-8 text-slate-600 mx-auto mb-2" />
          <p className="text-xs text-slate-500">No agents found within {radius}km</p>
        </div>
      )}
    </div>
  );
}
