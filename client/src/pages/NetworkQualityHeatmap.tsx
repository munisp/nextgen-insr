/**
 * Network Quality Heatmap — Sprint 93
 *
 * Visualizes connectivity quality across African regions using
 * color-coded cards, sortable tables, and event timeline.
 * Helps prioritize infrastructure investment for 2G/3G areas.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Globe,
  Wifi,
  WifiOff,
  Signal,
  AlertTriangle,
  CheckCircle,
  Clock,
  Users,
  Activity,
  TrendingUp,
  MapPin,
  Zap,
  ArrowUpDown,
} from "lucide-react";

function getHealthColor(failRate: number): string {
  if (failRate <= 0.08) return "text-emerald-500";
  if (failRate <= 0.12) return "text-yellow-500";
  if (failRate <= 0.18) return "text-orange-500";
  return "text-red-500";
}

function getHealthBg(failRate: number): string {
  if (failRate <= 0.08) return "bg-emerald-500/10 border-emerald-500/20";
  if (failRate <= 0.12) return "bg-yellow-500/10 border-yellow-500/20";
  if (failRate <= 0.18) return "bg-orange-500/10 border-orange-500/20";
  return "bg-red-500/10 border-red-500/20";
}

function getHealthLabel(failRate: number): string {
  if (failRate <= 0.08) return "Healthy";
  if (failRate <= 0.12) return "Fair";
  if (failRate <= 0.18) return "Degraded";
  return "Critical";
}

function getLatencyColor(ms: number): string {
  if (ms <= 150) return "text-emerald-500";
  if (ms <= 300) return "text-yellow-500";
  if (ms <= 500) return "text-orange-500";
  return "text-red-500";
}

function getSeverityBadge(severity: string) {
  switch (severity) {
    case "critical":
      return <Badge variant="destructive">Critical</Badge>;
    case "warning":
      return (
        <Badge className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20">
          Warning
        </Badge>
      );
    default:
      return <Badge variant="secondary">Info</Badge>;
  }
}

function formatDuration(ms?: number): string {
  if (!ms) return "—";
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function NetworkQualityHeatmap() {
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<
    "failRate" | "latency" | "queueDepth" | "agentCount"
  >("failRate");
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);

  const { data: regionMetrics, isLoading: metricsLoading } =
    trpc.networkQualityHeatmap.getRegionMetrics.useQuery({
      country: countryFilter === "all" ? undefined : countryFilter,
      sortBy,
    });

  const { data: summary, isLoading: summaryLoading } =
    trpc.networkQualityHeatmap.getSummary.useQuery();

  const { data: events } = trpc.networkQualityHeatmap.getEvents.useQuery({
    limit: 20,
  });

  const { data: regionDetail } =
    trpc.networkQualityHeatmap.getRegionDetail.useQuery(
      { regionId: selectedRegion! },
      { enabled: !!selectedRegion }
    );

  const countries = useMemo(() => {
    if (!regionMetrics) return [];
    return [...new Set(regionMetrics.map((r: any) => r.country))].sort();
  }, [regionMetrics]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Globe className="h-6 w-6 text-primary" />
            Network Quality Heatmap
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Regional connectivity metrics across Africa — prioritize
            infrastructure investment
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={countryFilter} onValueChange={setCountryFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="All Countries" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Countries</SelectItem>
              {countries.map((c: any) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sortBy}
            onValueChange={v => setSortBy(v as typeof sortBy)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="failRate">Worst Fail Rate</SelectItem>
              <SelectItem value="latency">Highest Latency</SelectItem>
              <SelectItem value="queueDepth">Largest Queue</SelectItem>
              <SelectItem value="agentCount">Most Agents</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Summary KPIs */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <MapPin className="h-3.5 w-3.5" /> Regions
              </div>
              <div className="text-2xl font-bold">{summary.totalRegions}</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Users className="h-3.5 w-3.5" /> Total Agents
              </div>
              <div className="text-2xl font-bold">
                {summary.totalAgents.toLocaleString()}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <Activity className="h-3.5 w-3.5" /> Avg Latency
              </div>
              <div
                className={`text-2xl font-bold ${getLatencyColor(summary.avgLatencyMs)}`}
              >
                {summary.avgLatencyMs}ms
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <AlertTriangle className="h-3.5 w-3.5" /> Avg Fail Rate
              </div>
              <div
                className={`text-2xl font-bold ${getHealthColor(summary.avgFailRate)}`}
              >
                {(summary.avgFailRate * 100).toFixed(1)}%
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> Healthy
              </div>
              <div className="text-2xl font-bold text-emerald-500">
                {summary.healthyCount}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 px-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                <AlertTriangle className="h-3.5 w-3.5 text-red-500" /> Critical
              </div>
              <div className="text-2xl font-bold text-red-500">
                {summary.criticalCount}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="heatmap" className="space-y-4">
        <TabsList>
          <TabsTrigger value="heatmap">Region Cards</TabsTrigger>
          <TabsTrigger value="table">Detailed Table</TabsTrigger>
          <TabsTrigger value="events">Event Timeline</TabsTrigger>
          <TabsTrigger value="countries">Country Breakdown</TabsTrigger>
        </TabsList>

        {/* ── Region Cards (Heatmap-style) ── */}
        <TabsContent value="heatmap">
          {metricsLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="animate-pulse">
                  <CardContent className="h-48" />
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {regionMetrics?.map((region: any) => (
                <Card
                  key={region.regionId}
                  className={`cursor-pointer transition-all hover:shadow-md border ${getHealthBg(region.failRate)} ${
                    selectedRegion === region.regionId
                      ? "ring-2 ring-primary"
                      : ""
                  }`}
                  onClick={() =>
                    setSelectedRegion(
                      selectedRegion === region.regionId
                        ? null
                        : region.regionId
                    )
                  }
                >
                  <CardHeader className="pb-2 pt-4 px-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base font-semibold flex items-center gap-2">
                        <MapPin className="h-4 w-4" />
                        {region.regionName}
                      </CardTitle>
                      <Badge
                        variant="outline"
                        className={getHealthBg(region.failRate)}
                      >
                        {getHealthLabel(region.failRate)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {region.country}
                    </p>
                  </CardHeader>
                  <CardContent className="px-4 pb-4 space-y-3">
                    {/* Key Metrics Row */}
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div>
                        <div
                          className={`text-lg font-bold ${getLatencyColor(region.avgLatencyMs)}`}
                        >
                          {region.avgLatencyMs}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          ms latency
                        </div>
                      </div>
                      <div>
                        <div
                          className={`text-lg font-bold ${getHealthColor(region.failRate)}`}
                        >
                          {(region.failRate * 100).toFixed(1)}%
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          fail rate
                        </div>
                      </div>
                      <div>
                        <div className="text-lg font-bold">
                          {region.queueDepth}
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          queued
                        </div>
                      </div>
                    </div>

                    {/* Network Breakdown Bar */}
                    <div>
                      <div className="flex h-2 rounded-full overflow-hidden">
                        {region.networkBreakdown.map((nb: any) => (
                          <div
                            key={nb.type}
                            className={`${
                              nb.type === "4g" || nb.type === "wifi"
                                ? "bg-emerald-500"
                                : nb.type === "3g"
                                  ? "bg-yellow-500"
                                  : nb.type === "2g"
                                    ? "bg-orange-500"
                                    : "bg-red-500"
                            }`}
                            style={{ width: `${nb.percentage}%` }}
                            title={`${nb.type}: ${nb.percentage}%`}
                          />
                        ))}
                      </div>
                      <div className="flex justify-between mt-1 text-[9px] text-muted-foreground">
                        {region.networkBreakdown.map((nb: any) => (
                          <span key={nb.type}>
                            {nb.type.toUpperCase()} {nb.percentage}%
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Footer */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" /> {region.agentCount} agents
                      </span>
                      <span className="flex items-center gap-1">
                        <Signal className="h-3 w-3" />{" "}
                        {region.dominantNetwork.toUpperCase()}
                      </span>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />{" "}
                        {(region.syncSuccessRate * 100).toFixed(0)}% sync
                      </span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Region Detail Panel */}
          {selectedRegion && regionDetail && (
            <Card className="mt-4">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Zap className="h-5 w-5 text-primary" />
                    {regionDetail.regionName} — 24h Trend
                  </CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedRegion(null)}
                  >
                    Close
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-16">Hour</TableHead>
                        <TableHead>Latency</TableHead>
                        <TableHead>Fail Rate</TableHead>
                        <TableHead>Queue</TableHead>
                        <TableHead>Active Agents</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {regionDetail.hourlyTrend.slice(-12).map((h: any) => (
                        <TableRow key={h.hour}>
                          <TableCell className="font-mono text-xs">
                            {String(h.hour).padStart(2, "0")}:00
                          </TableCell>
                          <TableCell>
                            <span className={getLatencyColor(h.latencyMs)}>
                              {h.latencyMs}ms
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={getHealthColor(h.failRate)}>
                              {(h.failRate * 100).toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell>{h.queueDepth}</TableCell>
                          <TableCell>{h.activeAgents}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Detailed Table ── */}
        <TabsContent value="table">
          <Card>
            <CardContent className="pt-4">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Region</TableHead>
                      <TableHead>Country</TableHead>
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 font-medium"
                          onClick={() => setSortBy("agentCount")}
                        >
                          Agents <ArrowUpDown className="h-3 w-3 ml-1" />
                        </Button>
                      </TableHead>
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 font-medium"
                          onClick={() => setSortBy("latency")}
                        >
                          Latency <ArrowUpDown className="h-3 w-3 ml-1" />
                        </Button>
                      </TableHead>
                      <TableHead>Bandwidth</TableHead>
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 font-medium"
                          onClick={() => setSortBy("failRate")}
                        >
                          Fail Rate <ArrowUpDown className="h-3 w-3 ml-1" />
                        </Button>
                      </TableHead>
                      <TableHead>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 font-medium"
                          onClick={() => setSortBy("queueDepth")}
                        >
                          Queue <ArrowUpDown className="h-3 w-3 ml-1" />
                        </Button>
                      </TableHead>
                      <TableHead>Sync Rate</TableHead>
                      <TableHead>Network</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {regionMetrics?.map((r: any) => (
                      <TableRow
                        key={r.regionId}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => setSelectedRegion(r.regionId)}
                      >
                        <TableCell className="font-medium">
                          {r.regionName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {r.country}
                        </TableCell>
                        <TableCell>{r.agentCount}</TableCell>
                        <TableCell>
                          <span className={getLatencyColor(r.avgLatencyMs)}>
                            {r.avgLatencyMs}ms
                          </span>
                        </TableCell>
                        <TableCell>{r.avgBandwidthKbps} kbps</TableCell>
                        <TableCell>
                          <span className={getHealthColor(r.failRate)}>
                            {(r.failRate * 100).toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell>{r.queueDepth}</TableCell>
                        <TableCell>
                          {(r.syncSuccessRate * 100).toFixed(0)}%
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px]">
                            {r.dominantNetwork.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={getHealthBg(r.failRate)}
                          >
                            {getHealthLabel(r.failRate)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Event Timeline ── */}
        <TabsContent value="events">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Clock className="h-4 w-4" />
                Connectivity Events
              </CardTitle>
            </CardHeader>
            <CardContent>
              {events && events.length > 0 ? (
                <div className="space-y-3">
                  {events.map((evt: any) => {
                    const region = regionMetrics?.find(
                      (r: any) => r.regionId === evt.regionId
                    );
                    return (
                      <div
                        key={evt.id}
                        className="flex items-start gap-3 p-3 rounded-lg border bg-card"
                      >
                        <div className="mt-0.5">
                          {evt.eventType === "outage" ? (
                            <WifiOff className="h-4 w-4 text-red-500" />
                          ) : evt.eventType === "recovery" ? (
                            <Wifi className="h-4 w-4 text-emerald-500" />
                          ) : (
                            <AlertTriangle className="h-4 w-4 text-yellow-500" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {getSeverityBadge(evt.severity)}
                            <span className="text-xs font-medium">
                              {region?.regionName || evt.regionId}
                            </span>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {timeAgo(evt.timestamp)}
                            </span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {evt.description}
                          </p>
                          <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                            {evt.affectedAgents > 0 && (
                              <span className="flex items-center gap-1">
                                <Users className="h-3 w-3" />
                                {evt.affectedAgents} affected
                              </span>
                            )}
                            {evt.duration && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDuration(evt.duration)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Wifi className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No connectivity events recorded</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Country Breakdown ── */}
        <TabsContent value="countries">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4" />
                Country-Level Aggregation
              </CardTitle>
            </CardHeader>
            <CardContent>
              {summary?.countryBreakdown && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Country</TableHead>
                      <TableHead>Regions</TableHead>
                      <TableHead>Agents</TableHead>
                      <TableHead>Avg Latency</TableHead>
                      <TableHead>Avg Fail Rate</TableHead>
                      <TableHead>Investment Priority</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {summary.countryBreakdown
                      .sort((a: any, b: any) => b.avgFailRate - a.avgFailRate)
                      .map((c: any) => (
                        <TableRow key={c.country}>
                          <TableCell className="font-medium">
                            {c.country}
                          </TableCell>
                          <TableCell>{c.regionCount}</TableCell>
                          <TableCell>{c.agents.toLocaleString()}</TableCell>
                          <TableCell>
                            <span className={getLatencyColor(c.avgLatency)}>
                              {c.avgLatency}ms
                            </span>
                          </TableCell>
                          <TableCell>
                            <span className={getHealthColor(c.avgFailRate)}>
                              {(c.avgFailRate * 100).toFixed(1)}%
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                c.avgFailRate > 0.15
                                  ? "bg-red-500/10 text-red-500 border-red-500/20"
                                  : c.avgFailRate > 0.1
                                    ? "bg-orange-500/10 text-orange-500 border-orange-500/20"
                                    : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                              }
                            >
                              {c.avgFailRate > 0.15
                                ? "HIGH"
                                : c.avgFailRate > 0.1
                                  ? "MEDIUM"
                                  : "LOW"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
