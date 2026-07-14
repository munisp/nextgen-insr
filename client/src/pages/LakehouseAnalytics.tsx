/**
 * LakehouseAnalytics.tsx
 *
 * Production-grade Data Lakehouse dashboard for the InsurePortal POS Shell.
 * Covers:
 *  1. Snapshot Browser  — list/download MinIO snapshots per bucket
 *  2. Spatial Heatmap   — transaction density map (Sedona-style grid)
 *  3. Gold-Layer Metrics — daily agent summary + hourly tx metrics
 *  4. DataFusion Console — ad-hoc SQL against Iceberg tables
 *  5. Manual Snapshot Triggers — admin-only on-demand uploads
 */

import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ZAxis,
  Legend,
} from "recharts";
import {
  Database,
  Download,
  RefreshCw,
  MapPin,
  Layers,
  Search,
  TrendingUp,
  AlertTriangle,
  Activity,
  Play,
  FileText,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtNGN(v: number) {
  return `₦${v.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtPct(v: number) {
  return `${(v * 100).toFixed(1)}%`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-NG", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// ── Snapshot Browser ──────────────────────────────────────────────────────────
type BucketKey =
  | "transactions"
  | "settlements"
  | "fraud_events"
  | "agent_metrics";

function SnapshotBrowser() {
  const [bucket, setBucket] = useState<BucketKey>("transactions");
  const [datePrefix, setDatePrefix] = useState(
    new Date().toISOString().slice(0, 7)
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const {
    data: snapshots,
    isLoading,
    refetch,
  } = trpc.lakehouse.listSnapshots.useQuery(
    { bucket, datePrefix },
    { retry: false }
  );

  const { data: downloadUrl, isLoading: urlLoading } =
    trpc.lakehouse.getDownloadUrl.useQuery(
      { bucket, key: selectedKey ?? "", expiresInSeconds: 3600 },
      { enabled: !!selectedKey, retry: false }
    );

  const triggerTx = trpc.lakehouse.triggerTransactionSnapshot.useMutation({
    onSuccess: d => {
      toast.success("Snapshot uploaded", {
        description: `${d.recordCount} records → ${d.key ?? "MinIO"}`,
      });
      refetch();
    },
    onError: e => toast.error("Snapshot failed", { description: e.message }),
  });

  const triggerFraud = trpc.lakehouse.triggerFraudSnapshot.useMutation({
    onSuccess: d => {
      toast.success("Fraud snapshot uploaded", {
        description: `${d.recordCount} records`,
      });
      refetch();
    },
    onError: e => toast.error("Snapshot failed", { description: e.message }),
  });

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Bucket
          </label>
          <Select value={bucket} onValueChange={v => setBucket(v as BucketKey)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="transactions">Transactions</SelectItem>
              <SelectItem value="settlements">Settlements</SelectItem>
              <SelectItem value="fraud_events">Fraud Events</SelectItem>
              <SelectItem value="agent_metrics">Agent Metrics</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Date Prefix (YYYY-MM)
          </label>
          <Input
            className="w-36"
            value={datePrefix}
            onChange={e => setDatePrefix(e.target.value)}
            placeholder="2026-04"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
        >
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerTx.mutate({ date: today })}
            disabled={triggerTx.isPending}
          >
            <Database className="w-4 h-4 mr-1" />
            {triggerTx.isPending ? "Uploading…" : "Snapshot Transactions"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => triggerFraud.mutate({ date: today })}
            disabled={triggerFraud.isPending}
          >
            <AlertTriangle className="w-4 h-4 mr-1" />
            {triggerFraud.isPending ? "Uploading…" : "Snapshot Fraud"}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">
          Loading snapshots…
        </div>
      ) : !snapshots?.keys.length ? (
        <div className="text-center py-8 text-muted-foreground">
          No snapshots found for <strong>{bucket}</strong> /{" "}
          <strong>{datePrefix}</strong>
          <p className="text-xs mt-1">
            MinIO may not be running in dev mode — use the trigger buttons above
            to create snapshots.
          </p>
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead className="w-32">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {snapshots.keys.map((key: any) => (
                <TableRow
                  key={key}
                  className={
                    selectedKey === key
                      ? "bg-accent/40"
                      : "cursor-pointer hover:bg-accent/20"
                  }
                  onClick={() => setSelectedKey(key)}
                >
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell>
                    {selectedKey === key && downloadUrl?.url ? (
                      <a
                        href={downloadUrl.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={urlLoading}
                        >
                          <Download className="w-3 h-3 mr-1" /> Download
                        </Button>
                      </a>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedKey(key)}
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

// ── Spatial Heatmap ───────────────────────────────────────────────────────────
function SpatialHeatmap() {
  const [hours, setHours] = useState(24);
  const [cellDeg, setCellDeg] = useState(0.1);
  const [txType, setTxType] = useState<string>("");

  const {
    data: heatmap,
    isLoading,
    refetch,
  } = trpc.lakehouse.transactionHeatmap.useQuery(
    { hours, cellDeg, txType: txType || undefined },
    { retry: false }
  );

  const { data: agentDensity, isLoading: densityLoading } =
    trpc.lakehouse.agentDensityGrid.useQuery(
      { swLat: 4.0, swLon: 2.7, neLat: 13.9, neLon: 14.7, cellDeg },
      { retry: false }
    );

  // Normalize for scatter chart
  const heatmapData = useMemo(() => {
    if (!heatmap?.cells) return [];
    const maxCount = Math.max(...heatmap.cells.map((c: any) => c.count), 1);
    return heatmap.cells.map((c: any) => ({
      x: c.lon,
      y: c.lat,
      z: Math.round((c.count / maxCount) * 100),
      count: c.count,
      volume: c.volume,
    }));
  }, [heatmap]);

  const densityData = useMemo(() => {
    if (!agentDensity?.cells) return [];
    return agentDensity.cells.map((c: any) => ({
      x: c.lon,
      y: c.lat,
      z: c.count * 5,
      count: c.count,
    }));
  }, [agentDensity]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Time Window
          </label>
          <Select
            value={String(hours)}
            onValueChange={v => setHours(Number(v))}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">Last 6 hours</SelectItem>
              <SelectItem value="24">Last 24 hours</SelectItem>
              <SelectItem value="48">Last 48 hours</SelectItem>
              <SelectItem value="168">Last 7 days</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Grid Cell (°)
          </label>
          <Select
            value={String(cellDeg)}
            onValueChange={v => setCellDeg(Number(v))}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5">0.5° (~55km)</SelectItem>
              <SelectItem value="0.1">0.1° (~11km)</SelectItem>
              <SelectItem value="0.05">0.05° (~5.5km)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            Tx Type
          </label>
          <Select
            value={txType || "all"}
            onValueChange={v => setTxType(v === "all" ? "" : v)}
          >
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="cash_in">Cash In</SelectItem>
              <SelectItem value="cash_out">Cash Out</SelectItem>
              <SelectItem value="transfer">Transfer</SelectItem>
              <SelectItem value="airtime">Airtime</SelectItem>
              <SelectItem value="bill_payment">Bill Payment</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="w-4 h-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-blue-500" />
              Transaction Density Heatmap
              {(heatmap as any)?.source === "postgresql-fallback" && (
                <Badge variant="outline" className="text-xs ml-auto">
                  PostgreSQL fallback
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                Loading…
              </div>
            ) : heatmapData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No transaction data with location for this period
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart
                  margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="x"
                    name="Longitude"
                    type="number"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    dataKey="y"
                    name="Latitude"
                    type="number"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10 }}
                  />
                  <ZAxis dataKey="z" range={[20, 400]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0]?.payload;
                      return (
                        <div className="bg-background border rounded p-2 text-xs shadow">
                          <p>
                            Lat: {d?.y?.toFixed(2)}, Lon: {d?.x?.toFixed(2)}
                          </p>
                          <p>
                            Transactions: <strong>{d?.count}</strong>
                          </p>
                          <p>
                            Volume: <strong>{fmtNGN(d?.volume ?? 0)}</strong>
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    name="Transactions"
                    data={heatmapData}
                    fill="#3b82f6"
                    fillOpacity={0.6}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4 text-green-500" />
              Agent Density Grid (Nigeria)
              {(agentDensity as any)?.source === "postgresql-fallback" && (
                <Badge variant="outline" className="text-xs ml-auto">
                  PostgreSQL fallback
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {densityLoading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground">
                Loading…
              </div>
            ) : densityData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
                No agent location data available
                <p className="text-xs mt-1">
                  Agents need GPS coordinates in device_locations table
                </p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ScatterChart
                  margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis
                    dataKey="x"
                    name="Longitude"
                    type="number"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10 }}
                  />
                  <YAxis
                    dataKey="y"
                    name="Latitude"
                    type="number"
                    domain={["auto", "auto"]}
                    tick={{ fontSize: 10 }}
                  />
                  <ZAxis dataKey="z" range={[20, 300]} />
                  <Tooltip
                    content={({ payload }) => {
                      if (!payload?.length) return null;
                      const d = payload[0]?.payload;
                      return (
                        <div className="bg-background border rounded p-2 text-xs shadow">
                          <p>
                            Lat: {d?.y?.toFixed(2)}, Lon: {d?.x?.toFixed(2)}
                          </p>
                          <p>
                            Active Agents: <strong>{d?.count}</strong>
                          </p>
                        </div>
                      );
                    }}
                  />
                  <Scatter
                    name="Agents"
                    data={densityData}
                    fill="#22c55e"
                    fillOpacity={0.7}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground">
        Spatial queries use Apache Sedona PostGIS when the Python
        lakehouse-service is available, falling back to haversine/PostgreSQL
        aggregation. Grid cells represent ~{Math.round(cellDeg * 111)}km ×{" "}
        {Math.round(cellDeg * 111)}km areas.
      </p>
    </div>
  );
}

// ── Gold-Layer Metrics ────────────────────────────────────────────────────────
function GoldLayerMetrics() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const { data: dailySummary, isLoading: summaryLoading } =
    trpc.lakehouse.goldDailyAgentSummary.useQuery(
      { date, limit: 20 },
      { retry: false }
    );

  const { data: hourlyMetrics, isLoading: hourlyLoading } =
    trpc.lakehouse.goldHourlyMetrics.useQuery({ date }, { retry: false });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium">Date:</label>
        <Input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="w-40"
        />
        {(dailySummary?.source || hourlyMetrics?.source) && (
          <Badge variant="outline" className="text-xs">
            Source: {dailySummary?.source ?? hourlyMetrics?.source}
          </Badge>
        )}
      </div>

      {/* Hourly metrics chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-purple-500" />
            Hourly Transaction Volume — {date}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {hourlyLoading ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground">
              Loading…
            </div>
          ) : !hourlyMetrics?.hours.length ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              No data for {date}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart
                data={hourlyMetrics.hours}
                margin={{ top: 5, right: 10, bottom: 5, left: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="hour"
                  tickFormatter={h => `${h}:00`}
                  tick={{ fontSize: 10 }}
                />
                <YAxis yAxisId="left" tick={{ fontSize: 10 }} />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={v => `${(v * 100).toFixed(0)}%`}
                  tick={{ fontSize: 10 }}
                />
                <Tooltip
                  formatter={(value, name) => {
                    if (name === "txVolume")
                      return [fmtNGN(Number(value)), "Volume"];
                    if (name === "errorRate")
                      return [fmtPct(Number(value)), "Error Rate"];
                    if (name === "fraudRate")
                      return [fmtPct(Number(value)), "Fraud Rate"];
                    return [value, name];
                  }}
                />
                <Legend />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="txVolume"
                  stroke="#8b5cf6"
                  fill="#8b5cf6"
                  fillOpacity={0.2}
                  name="txVolume"
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="errorRate"
                  stroke="#ef4444"
                  fill="#ef4444"
                  fillOpacity={0.1}
                  name="errorRate"
                />
                <Area
                  yAxisId="right"
                  type="monotone"
                  dataKey="fraudRate"
                  stroke="#f97316"
                  fill="#f97316"
                  fillOpacity={0.1}
                  name="fraudRate"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Daily agent summary table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-500" />
            Gold Layer — Daily Agent Summary ({dailySummary?.total ?? 0} agents)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {summaryLoading ? (
            <div className="py-8 text-center text-muted-foreground">
              Loading…
            </div>
          ) : !dailySummary?.rows.length ? (
            <div className="py-8 text-center text-muted-foreground text-sm">
              No agent activity on {date}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Tx Count</TableHead>
                    <TableHead className="text-right">Volume</TableHead>
                    <TableHead className="text-right">Commission</TableHead>
                    <TableHead className="text-right">Success</TableHead>
                    <TableHead className="text-right">Fraud</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailySummary.rows.map((row: any) => (
                    <TableRow key={row.agentId}>
                      <TableCell className="font-mono text-xs">
                        {row.agentId}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {row.agentTier}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.txCount.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {fmtNGN(row.txVolume)}
                      </TableCell>
                      <TableCell className="text-right text-xs">
                        {fmtNGN(row.txCommission)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span
                          className={
                            row.successRate >= 0.95
                              ? "text-green-600"
                              : row.successRate >= 0.8
                                ? "text-amber-600"
                                : "text-red-600"
                          }
                        >
                          {fmtPct(row.successRate)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        {row.fraudCount > 0 ? (
                          <span className="text-red-600 font-medium">
                            {row.fraudCount}
                          </span>
                        ) : (
                          <span className="text-green-600">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── DataFusion SQL Console ────────────────────────────────────────────────────
const EXAMPLE_QUERIES = [
  {
    label: "Top 10 agents by volume (Silver)",
    sql: "SELECT agent_code, agent_tier, count(*) as tx_count, sum(amount) as volume FROM insureportal.silver.transactions WHERE tx_date = current_date GROUP BY agent_code, agent_tier ORDER BY volume DESC LIMIT 10",
  },
  {
    label: "Hourly fraud rate (Gold)",
    sql: "SELECT metric_hour, fraud_rate, error_rate FROM insureportal.gold.hourly_transaction_metrics WHERE days(metric_hour) = current_date ORDER BY metric_hour",
  },
  {
    label: "CBN monthly summary",
    sql: "SELECT * FROM insureportal.gold.cbn_monthly_summary ORDER BY report_month DESC LIMIT 6",
  },
];

function DataFusionConsole() {
  const [sqlQuery, setSqlQuery] = useState(EXAMPLE_QUERIES[0].sql);
  const [limit, setLimit] = useState(100);
  const runQuery = trpc.lakehouse.lakehouseQuery.useMutation({
    onError: e => toast.error("Query failed", { description: e.message }),
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {EXAMPLE_QUERIES.map((q: any) => (
          <Button
            key={q.label}
            variant="outline"
            size="sm"
            onClick={() => setSqlQuery(q.sql)}
            className="text-xs"
          >
            <FileText className="w-3 h-3 mr-1" /> {q.label}
          </Button>
        ))}
      </div>

      <div className="space-y-2">
        <Textarea
          value={sqlQuery}
          onChange={e => setSqlQuery(e.target.value)}
          rows={5}
          className="font-mono text-xs"
          placeholder="SELECT * FROM insureportal.silver.transactions LIMIT 100"
        />
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground">Max rows:</label>
            <Input
              type="number"
              value={limit}
              onChange={e => setLimit(Number(e.target.value))}
              className="w-24 h-8 text-xs"
              min={1}
              max={10000}
            />
          </div>
          <Button
            onClick={() => runQuery.mutate({ sql: sqlQuery, limit })}
            disabled={runQuery.isPending || !sqlQuery.trim()}
            size="sm"
          >
            <Play className="w-4 h-4 mr-1" />
            {runQuery.isPending ? "Running…" : "Run Query"}
          </Button>
          {runQuery.data && (
            <span className="text-xs text-muted-foreground ml-auto">
              {runQuery.data.rowCount} rows · {runQuery.data.durationMs}ms
            </span>
          )}
        </div>
      </div>

      {runQuery.data && (
        <div className="border rounded-lg overflow-auto max-h-96">
          <Table>
            <TableHeader>
              <TableRow>
                {runQuery.data.columns.map((col: any) => (
                  <TableHead key={col} className="text-xs">
                    {col}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {runQuery.data.rows.map((row, i) => (
                <TableRow key={i}>
                  {(row as unknown[]).map((cell, j) => (
                    <TableCell key={j} className="text-xs font-mono">
                      {cell === null ? (
                        <span className="text-muted-foreground">NULL</span>
                      ) : (
                        String(cell)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {!runQuery.data && !runQuery.isPending && (
        <div className="border rounded-lg p-6 text-center text-muted-foreground text-sm">
          <Database className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p>Run a query to see results</p>
          <p className="text-xs mt-1">
            Queries are forwarded to the Python lakehouse-service (DataFusion /
            Iceberg REST). When the service is unavailable, an error is
            returned.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Snapshot Stats ────────────────────────────────────────────────────────────
function SnapshotStats() {
  const { data: stats } = trpc.lakehouse.snapshotStats.useQuery(undefined, {
    retry: false,
  });

  if (!stats) return null;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Total Transactions</div>
        <div className="text-2xl font-bold mt-1">
          {stats.transactions.total.toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground">
          +{stats.transactions.today} today
        </div>
      </Card>
      <Card className="p-4">
        <div className="text-xs text-muted-foreground">Fraud Alerts</div>
        <div className="text-2xl font-bold mt-1 text-red-600">
          {stats.fraudAlerts.total.toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground">in database</div>
      </Card>
      <Card className="p-4 col-span-2">
        <div className="text-xs text-muted-foreground mb-2">
          Medallion Architecture
        </div>
        <div className="space-y-1">
          {Object.entries(stats.layers).map(([layer, desc]) => (
            <div key={layer} className="flex items-start gap-2 text-xs">
              <Badge variant="outline" className="capitalize shrink-0">
                {layer}
              </Badge>
              <span className="text-muted-foreground">{desc}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function LakehouseAnalytics() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-7xl py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Layers className="w-6 h-6 text-purple-500" />
              Data Lakehouse Analytics
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Bronze → Silver → Gold medallion pipeline · Apache Iceberg on
              MinIO · Sedona spatial queries · DataFusion ad-hoc SQL
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              <CheckCircle className="w-3 h-3 mr-1 text-green-500" />
              Iceberg REST
            </Badge>
            <Badge variant="outline" className="text-xs">
              <Activity className="w-3 h-3 mr-1 text-blue-500" />
              Spark Streaming
            </Badge>
          </div>
        </div>

        {/* Stats bar */}
        <SnapshotStats />

        {/* Tabs */}
        <Tabs defaultValue="gold">
          <TabsList className="grid grid-cols-4 w-full max-w-2xl">
            <TabsTrigger value="gold">
              <TrendingUp className="w-4 h-4 mr-1" /> Gold Layer
            </TabsTrigger>
            <TabsTrigger value="spatial">
              <MapPin className="w-4 h-4 mr-1" /> Spatial
            </TabsTrigger>
            <TabsTrigger value="snapshots">
              <Database className="w-4 h-4 mr-1" /> Snapshots
            </TabsTrigger>
            <TabsTrigger value="query" disabled={!isAdmin}>
              <Search className="w-4 h-4 mr-1" /> SQL Console
            </TabsTrigger>
          </TabsList>

          <TabsContent value="gold" className="mt-4">
            <GoldLayerMetrics />
          </TabsContent>

          <TabsContent value="spatial" className="mt-4">
            <SpatialHeatmap />
          </TabsContent>

          <TabsContent value="snapshots" className="mt-4">
            {isAdmin ? (
              <SnapshotBrowser />
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <XCircle className="w-8 h-8 mx-auto mb-2 opacity-40" />
                Admin access required to browse snapshots
              </div>
            )}
          </TabsContent>

          <TabsContent value="query" className="mt-4">
            <DataFusionConsole />
          </TabsContent>
        </Tabs>

        {/* Architecture note */}
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div>
                <div className="font-semibold mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Daily Snapshot Schedule (WAT)
                </div>
                <ul className="space-y-0.5 text-muted-foreground">
                  <li>02:00 — Transaction snapshot</li>
                  <li>02:05 — Fraud events snapshot</li>
                  <li>02:10 — Agent metrics snapshot</li>
                  <li>02:15 — Settlement summary</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold mb-1 flex items-center gap-1">
                  <Layers className="w-3 h-3" /> ETL Pipeline
                </div>
                <ul className="space-y-0.5 text-muted-foreground">
                  <li>Bronze: Kafka → Iceberg (30s micro-batch)</li>
                  <li>Silver: Deduplicated + enriched Parquet</li>
                  <li>Gold: Aggregated daily/hourly metrics</li>
                  <li>Platinum: ML feature store (Ray)</li>
                </ul>
              </div>
              <div>
                <div className="font-semibold mb-1 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Spatial Stack
                </div>
                <ul className="space-y-0.5 text-muted-foreground">
                  <li>Apache Sedona (PostGIS ST_DWithin)</li>
                  <li>H3 hexagonal grid (0.1° cells)</li>
                  <li>Haversine fallback (no PostGIS)</li>
                  <li>Nigeria bounding box: 4°N–14°N</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
