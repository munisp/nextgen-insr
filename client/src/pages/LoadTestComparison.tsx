import {
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  BarChart3,
  Clock,
  Zap,
  AlertTriangle,
  TrendingUp,
  GitCompareArrows,
  RefreshCw,
  Download,
  FileText,
} from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
// ─── Delta Display Component ────────────────────────────────────────────────

function DeltaCell({
  label,
  valueA,
  valueB,
  diff,
  pctChange,
  improved,
  unit = "",
  higherBetter = false,
}: {
  label: string;
  valueA: number;
  valueB: number;
  diff: number;
  pctChange: number;
  improved: boolean;
  unit?: string;
  higherBetter?: boolean;
}) {
  const isNeutral = Math.abs(pctChange) < 0.5;
  const color = isNeutral
    ? "text-muted-foreground"
    : improved
      ? "text-emerald-400"
      : "text-red-400";
  const Icon = isNeutral ? Minus : improved ? ArrowDownRight : ArrowUpRight;
  const dirIcon = higherBetter
    ? isNeutral
      ? Minus
      : improved
        ? ArrowUpRight
        : ArrowDownRight
    : Icon;

  return (
    <div className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground w-28">{label}</span>
      <span className="text-sm font-mono w-24 text-right">
        {typeof valueA === "number" ? valueA.toLocaleString() : valueA}
        {unit}
      </span>
      <span className="text-sm font-mono w-24 text-right">
        {typeof valueB === "number" ? valueB.toLocaleString() : valueB}
        {unit}
      </span>
      <span
        className={`text-sm font-mono w-28 text-right flex items-center justify-end gap-1 ${color}`}
      >
        {React.createElement(dirIcon, { className: "h-3 w-3" })}
        {diff > 0 ? "+" : ""}
        {diff.toLocaleString()}
        {unit}
        <span className="text-xs">
          ({pctChange > 0 ? "+" : ""}
          {pctChange.toFixed(1)}%)
        </span>
      </span>
    </div>
  );
}

// ─── Overlay Bar Chart ──────────────────────────────────────────────────────

function OverlayBarChart({
  data,
  labelKey,
  valueAKey,
  valueBKey,
  colorA = "bg-blue-500",
  colorB = "bg-amber-500",
}: {
  data: Array<Record<string, any>>;
  labelKey: string;
  valueAKey: string;
  valueBKey: string;
  colorA?: string;
  colorB?: string;
}) {
  const maxVal = Math.max(
    ...data.map(d => Math.max(d[valueAKey] ?? 0, d[valueBKey] ?? 0)),
    1
  );
  return (
    <div className="space-y-2">
      {data.map((item, i) => (
        <div key={i} className="space-y-0.5">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-16 text-right text-muted-foreground truncate">
              {item[labelKey]}
            </span>
            <div className="flex-1 space-y-0.5">
              <div className="h-3 bg-muted/20 rounded overflow-hidden">
                <div
                  className={`h-full ${colorA} rounded opacity-80`}
                  style={{
                    width: `${Math.max(1, (item[valueAKey] / maxVal) * 100)}%`,
                  }}
                />
              </div>
              <div className="h-3 bg-muted/20 rounded overflow-hidden">
                <div
                  className={`h-full ${colorB} rounded opacity-80`}
                  style={{
                    width: `${Math.max(1, (item[valueBKey] / maxVal) * 100)}%`,
                  }}
                />
              </div>
            </div>
            <div className="w-20 text-right">
              <div className="text-xs font-mono text-blue-400">
                {item[valueAKey]?.toLocaleString()}
              </div>
              <div className="text-xs font-mono text-amber-400">
                {item[valueBKey]?.toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Dual Sparkline ─────────────────────────────────────────────────────────

function DualSparkline({
  dataA,
  dataB,
  height = 80,
  colorA = "#3b82f6",
  colorB = "#f59e0b",
}: {
  dataA: number[];
  dataB: number[];
  height?: number;
  colorA?: string;
  colorB?: string;
}) {
  const allData = [...dataA, ...dataB];
  if (allData.length === 0) return null;
  const max = Math.max(...allData, 1);
  const min = Math.min(...allData, 0);
  const range = max - min || 1;
  const w = 100;

  function toPoints(data: number[]) {
    return data
      .map((v, i) => {
        const x = (i / Math.max(data.length - 1, 1)) * w;
        const y = height - ((v - min) / range) * (height - 4) - 2;
        return `${x},${y}`;
      })
      .join(" ");
  }

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }}>
      <polyline
        points={toPoints(dataA)}
        fill="none"
        stroke={colorA}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
      <polyline
        points={toPoints(dataB)}
        fill="none"
        stroke={colorB}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.8"
      />
    </svg>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

import React from "react";

// ─── Export Helpers ─────────────────────────────────────────────────────────

function exportComparisonCsv(data: any) {
  if (!data?.comparison) return;
  const cmp = data.comparison;
  const runA = data.runA;
  const runB = data.runB;

  const rows: string[][] = [
    ["Load Test Comparison Report"],
    ["Generated", new Date().toISOString()],
    [],
    [
      "Run A (Baseline)",
      runA.name,
      `Started: ${runA.startedAt}`,
      `Config: ${runA.config.targetRps} RPS, ${runA.config.duration}s, ${runA.config.concurrency} concurrent`,
    ],
    [
      "Run B (Candidate)",
      runB.name,
      `Started: ${runB.startedAt}`,
      `Config: ${runB.config.targetRps} RPS, ${runB.config.duration}s, ${runB.config.concurrency} concurrent`,
    ],
    [],
    ["Metric", "Category", "Run A", "Run B", "Delta", "% Change", "Improved"],
    [
      "Avg Latency (ms)",
      "Latency",
      String(cmp.latency.avg.valueA),
      String(cmp.latency.avg.valueB),
      String(cmp.latency.avg.diff),
      `${cmp.latency.avg.pctChange}%`,
      String(cmp.latency.avg.improved),
    ],
    [
      "P50 Latency (ms)",
      "Latency",
      String(cmp.latency.p50.valueA),
      String(cmp.latency.p50.valueB),
      String(cmp.latency.p50.diff),
      `${cmp.latency.p50.pctChange}%`,
      String(cmp.latency.p50.improved),
    ],
    [
      "P95 Latency (ms)",
      "Latency",
      String(cmp.latency.p95.valueA),
      String(cmp.latency.p95.valueB),
      String(cmp.latency.p95.diff),
      `${cmp.latency.p95.pctChange}%`,
      String(cmp.latency.p95.improved),
    ],
    [
      "P99 Latency (ms)",
      "Latency",
      String(cmp.latency.p99.valueA),
      String(cmp.latency.p99.valueB),
      String(cmp.latency.p99.diff),
      `${cmp.latency.p99.pctChange}%`,
      String(cmp.latency.p99.improved),
    ],
    [
      "Max Latency (ms)",
      "Latency",
      String(cmp.latency.max.valueA),
      String(cmp.latency.max.valueB),
      String(cmp.latency.max.diff),
      `${cmp.latency.max.pctChange}%`,
      String(cmp.latency.max.improved),
    ],
    [
      "Actual RPS",
      "Throughput",
      String(cmp.throughput.actualRps.valueA),
      String(cmp.throughput.actualRps.valueB),
      String(cmp.throughput.actualRps.diff),
      `${cmp.throughput.actualRps.pctChange}%`,
      String(cmp.throughput.actualRps.improved),
    ],
    [
      "Total Requests",
      "Throughput",
      String(cmp.throughput.totalRequests.valueA),
      String(cmp.throughput.totalRequests.valueB),
      String(cmp.throughput.totalRequests.diff),
      `${cmp.throughput.totalRequests.pctChange}%`,
      String(cmp.throughput.totalRequests.improved),
    ],
    [
      "Throughput (MB/s)",
      "Throughput",
      String(cmp.throughput.throughputMbps.valueA),
      String(cmp.throughput.throughputMbps.valueB),
      String(cmp.throughput.throughputMbps.diff),
      `${cmp.throughput.throughputMbps.pctChange}%`,
      String(cmp.throughput.throughputMbps.improved),
    ],
    [
      "Error Rate (%)",
      "Reliability",
      String(cmp.reliability.errorRate.valueA),
      String(cmp.reliability.errorRate.valueB),
      String(cmp.reliability.errorRate.diff),
      `${cmp.reliability.errorRate.pctChange}%`,
      String(cmp.reliability.errorRate.improved),
    ],
    [
      "Failed Requests",
      "Reliability",
      String(cmp.reliability.failedRequests.valueA),
      String(cmp.reliability.failedRequests.valueB),
      String(cmp.reliability.failedRequests.diff),
      `${cmp.reliability.failedRequests.pctChange}%`,
      String(cmp.reliability.failedRequests.improved),
    ],
    [
      "Success Rate (%)",
      "Reliability",
      String(cmp.reliability.successRate.valueA),
      String(cmp.reliability.successRate.valueB),
      String(cmp.reliability.successRate.diff),
      `${cmp.reliability.successRate.pctChange}%`,
      String(cmp.reliability.successRate.improved),
    ],
    [],
    ["Zipf Distribution (Top 10)"],
    ["Rank", "Requests A", "Requests B", "% A", "% B"],
    ...(cmp.zipfComparison ?? []).map((z: any) => [
      `#${z.rank}`,
      String(z.requestsA),
      String(z.requestsB),
      `${z.pctA}%`,
      `${z.pctB}%`,
    ]),
    [],
    ["Timeline (per second)"],
    ["Second", "RPS A", "RPS B", "Latency A (ms)", "Latency B (ms)"],
    ...(cmp.timelineOverlay ?? []).map((t: any) => [
      String(t.second),
      String(t.rpsA),
      String(t.rpsB),
      String(t.latencyA),
      String(t.latencyB),
    ]),
  ];

  const csvContent = rows
    .map(row =>
      row.map(cell => `"${(cell ?? "").replace(/"/g, '""')}"`).join(",")
    )
    .join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `load-test-comparison-${runA.id}-vs-${runB.id}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportComparisonPdf(data: any) {
  if (!data?.comparison) return;
  const cmp = data.comparison;
  const runA = data.runA;
  const runB = data.runB;

  // Build a printable HTML document and use browser print-to-PDF
  const improvements = [
    cmp.latency.p99.improved,
    cmp.throughput.actualRps.improved,
    cmp.reliability.errorRate.improved,
  ].filter(Boolean).length;
  const verdict =
    improvements >= 2
      ? "IMPROVEMENT"
      : improvements === 1
        ? "MIXED"
        : "REGRESSION";
  const verdictColor =
    improvements >= 2 ? "#10b981" : improvements === 1 ? "#eab308" : "#ef4444";

  function deltaRow(label: string, d: any, unit = "") {
    const color =
      Math.abs(d.pctChange) < 0.5 ? "#888" : d.improved ? "#10b981" : "#ef4444";
    return `<tr>
      <td style="padding:4px 8px">${label}</td>
      <td style="padding:4px 8px;text-align:right;font-family:monospace">${d.valueA.toLocaleString()}${unit}</td>
      <td style="padding:4px 8px;text-align:right;font-family:monospace">${d.valueB.toLocaleString()}${unit}</td>
      <td style="padding:4px 8px;text-align:right;font-family:monospace;color:${color}">${d.diff > 0 ? "+" : ""}${d.diff.toLocaleString()}${unit} (${d.pctChange > 0 ? "+" : ""}${d.pctChange.toFixed(1)}%)</td>
    </tr>`;
  }

  const html = `<!DOCTYPE html>
<html><head><title>Load Test Comparison Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #333; font-size: 12px; }
  h1 { font-size: 18px; margin-bottom: 4px; }
  h2 { font-size: 14px; margin-top: 20px; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  th { background: #f5f5f5; padding: 6px 8px; text-align: left; font-size: 11px; border-bottom: 2px solid #ddd; }
  td { padding: 4px 8px; border-bottom: 1px solid #eee; }
  .verdict { display: inline-block; padding: 4px 12px; border-radius: 4px; font-weight: bold; color: white; background: ${verdictColor}; }
  .meta { color: #666; font-size: 11px; }
</style></head><body>
<h1>Load Test Comparison Report</h1>
<p class="meta">Generated: ${new Date().toLocaleString()}</p>
<p><span class="verdict">${verdict}</span> ${improvements}/3 key metrics improved</p>

<h2>Run Configuration</h2>
<table>
  <tr><th></th><th>Run A (Baseline)</th><th>Run B (Candidate)</th></tr>
  <tr><td>Name</td><td>${runA.name}</td><td>${runB.name}</td></tr>
  <tr><td>Started</td><td>${new Date(runA.startedAt).toLocaleString()}</td><td>${new Date(runB.startedAt).toLocaleString()}</td></tr>
  <tr><td>Target RPS</td><td>${runA.config.targetRps}</td><td>${runB.config.targetRps}</td></tr>
  <tr><td>Duration</td><td>${runA.config.duration}s</td><td>${runB.config.duration}s</td></tr>
  <tr><td>Concurrency</td><td>${runA.config.concurrency}</td><td>${runB.config.concurrency}</td></tr>
  <tr><td>Zipf Exponent</td><td>${runA.config.zipfExponent}</td><td>${runB.config.zipfExponent}</td></tr>
</table>

<h2>Latency Comparison</h2>
<table>
  <tr><th>Metric</th><th style="text-align:right">Run A</th><th style="text-align:right">Run B</th><th style="text-align:right">Delta</th></tr>
  ${deltaRow("Avg Latency", cmp.latency.avg, "ms")}
  ${deltaRow("P50 Latency", cmp.latency.p50, "ms")}
  ${deltaRow("P95 Latency", cmp.latency.p95, "ms")}
  ${deltaRow("P99 Latency", cmp.latency.p99, "ms")}
  ${deltaRow("Max Latency", cmp.latency.max, "ms")}
</table>

<h2>Throughput</h2>
<table>
  <tr><th>Metric</th><th style="text-align:right">Run A</th><th style="text-align:right">Run B</th><th style="text-align:right">Delta</th></tr>
  ${deltaRow("Actual RPS", cmp.throughput.actualRps)}
  ${deltaRow("Total Requests", cmp.throughput.totalRequests)}
  ${deltaRow("Throughput", cmp.throughput.throughputMbps, " MB/s")}
</table>

<h2>Reliability</h2>
<table>
  <tr><th>Metric</th><th style="text-align:right">Run A</th><th style="text-align:right">Run B</th><th style="text-align:right">Delta</th></tr>
  ${deltaRow("Error Rate", cmp.reliability.errorRate, "%")}
  ${deltaRow("Failed Requests", cmp.reliability.failedRequests)}
  ${deltaRow("Success Rate", cmp.reliability.successRate, "%")}
</table>

<h2>Zipf Distribution (Top 10)</h2>
<table>
  <tr><th>Rank</th><th style="text-align:right">Requests A</th><th style="text-align:right">Requests B</th><th style="text-align:right">% A</th><th style="text-align:right">% B</th></tr>
  ${(cmp.zipfComparison ?? []).map((z: any) => `<tr><td>#${z.rank}</td><td style="text-align:right">${z.requestsA.toLocaleString()}</td><td style="text-align:right">${z.requestsB.toLocaleString()}</td><td style="text-align:right">${z.pctA}%</td><td style="text-align:right">${z.pctB}%</td></tr>`).join("")}
</table>
</body></html>`;

  const printWindow = window.open("", "_blank");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 500);
  }
}

export default function LoadTestComparison() {
  const [runIdA, setRunIdA] = useState<string | null>(null);
  const [runIdB, setRunIdB] = useState<string | null>(null);
  const runsQuery = trpc.loadTestMetrics.listRuns.useQuery({ limit: 50 });
  const runs = runsQuery.data ?? [];

  // Auto-select first two runs if available
  // F-12 (wave-4b): compareRuns keys on the runId string, not the row PK;
  // its return shape is flat (no .comparison wrapper).
  const effectiveA = runIdA ?? runs[0]?.runId ?? null;
  const effectiveB = runIdB ?? runs[1]?.runId ?? null;
  const comparisonQuery = trpc.loadTestMetrics.compareRuns.useQuery(
    { runIdA: effectiveA ?? "", runIdB: effectiveB ?? "" },
    { enabled: !!effectiveA && !!effectiveB && effectiveA !== effectiveB }
  );

  const data = comparisonQuery.data;
  const cmp = data;

  const zipfData = useMemo(
    () =>
      (cmp?.zipfComparison ?? []).map(d => ({
        label: `#${d.merchantId}`,
        reqA: d.requestsA,
        reqB: d.requestsB,
      })),
    [cmp]
  );

  const timelineRpsA = useMemo(
    () => (cmp?.timelineOverlay ?? []).map(t => t.rpsA),
    [cmp]
  );
  const timelineRpsB = useMemo(
    () => (cmp?.timelineOverlay ?? []).map(t => t.rpsB),
    [cmp]
  );
  const timelineLatA = useMemo(
    () => (cmp?.timelineOverlay ?? []).map(t => t.latencyA),
    [cmp]
  );
  const timelineLatB = useMemo(
    () => (cmp?.timelineOverlay ?? []).map(t => t.latencyB),
    [cmp]
  );

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <GitCompareArrows className="h-6 w-6" /> Load Test Comparison
            </h1>
            <p className="text-muted-foreground">
              Side-by-side analysis of two load test runs
            </p>
          </div>
          <div className="flex gap-2">
            {cmp && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    exportComparisonCsv(data);
                    toast.success("CSV downloaded");
                  }}
                >
                  <Download className="h-4 w-4 mr-1" /> CSV
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    exportComparisonPdf(data);
                    toast.success("PDF print dialog opened");
                  }}
                >
                  <FileText className="h-4 w-4 mr-1" /> PDF
                </Button>
              </>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                runsQuery.refetch();
                comparisonQuery.refetch();
                toast.success("Refreshed");
              }}
            >
              <RefreshCw className="h-4 w-4 mr-1" /> Refresh
            </Button>
          </div>
        </div>

        {/* Run Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500" /> Run A
                (Baseline)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={effectiveA ?? ""} onValueChange={setRunIdA}>
                <SelectTrigger>
                  <SelectValue placeholder="Select baseline run" />
                </SelectTrigger>
                <SelectContent>
                  {runs.map(r => (
                    <SelectItem key={r.id} value={r.runId}>
                      {r.runId} —{" "}
                      {new Date(r.startedAt).toLocaleDateString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {data?.runA && (
                <div className="mt-2 text-xs text-muted-foreground space-y-1">
                  <div>
                    Config: {data.runA.targetRps} RPS,{" "}
                    {data.runA.durationSeconds}s, {data.runA.concurrency}{" "}
                    concurrent
                  </div>
                  <div>
                    Started: {new Date(data.runA.startedAt).toLocaleString()}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-amber-500" /> Run B
                (Candidate)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={effectiveB ?? ""} onValueChange={setRunIdB}>
                <SelectTrigger>
                  <SelectValue placeholder="Select candidate run" />
                </SelectTrigger>
                <SelectContent>
                  {runs.map(r => (
                    <SelectItem key={r.id} value={r.runId}>
                      {r.runId} —{" "}
                      {new Date(r.startedAt).toLocaleDateString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {data?.runB && (
                <div className="mt-2 text-xs text-muted-foreground space-y-1">
                  <div>
                    Config: {data.runB.targetRps} RPS,{" "}
                    {data.runB.durationSeconds}s, {data.runB.concurrency}{" "}
                    concurrent
                  </div>
                  <div>
                    Started: {new Date(data.runB.startedAt).toLocaleString()}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {effectiveA === effectiveB && effectiveA && (
          <Card className="border-yellow-500/50">
            <CardContent className="py-4">
              <p className="text-sm text-yellow-400 text-center">
                Please select two different runs to compare.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Comparison Results */}
        {cmp && (
          <>
            {/* Latency Comparison */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Latency Comparison
                </CardTitle>
                <CardDescription className="text-xs">
                  Lower is better. Green indicates improvement from Run A to Run
                  B.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="w-28" />
                  <span className="w-24 text-right font-medium text-blue-400">
                    Run A
                  </span>
                  <span className="w-24 text-right font-medium text-amber-400">
                    Run B
                  </span>
                  <span className="w-28 text-right font-medium">Delta</span>
                </div>
                <DeltaCell label="Avg Latency" unit="ms" {...cmp.latency.avg} />
                <DeltaCell label="P50 Latency" unit="ms" {...cmp.latency.p50} />
                <DeltaCell label="P95 Latency" unit="ms" {...cmp.latency.p95} />
                <DeltaCell label="P99 Latency" unit="ms" {...cmp.latency.p99} />
              </CardContent>
            </Card>

            {/* Throughput & Reliability */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Zap className="h-4 w-4" /> Throughput
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Higher is better.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="w-28" />
                    <span className="w-24 text-right font-medium text-blue-400">
                      Run A
                    </span>
                    <span className="w-24 text-right font-medium text-amber-400">
                      Run B
                    </span>
                    <span className="w-28 text-right font-medium">Delta</span>
                  </div>
                  <DeltaCell
                    label="Actual RPS"
                    higherBetter
                    {...cmp.throughput.actualRps}
                  />
                  <DeltaCell
                    label="Total Reqs"
                    higherBetter
                    {...cmp.throughput.totalRequests}
                  />
                  <DeltaCell
                    label="Throughput"
                    unit=" req/s"
                    higherBetter
                    {...cmp.throughput.actualRps}
                  />
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> Reliability
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Lower error rate is better.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="mb-2 flex items-center gap-4 text-xs text-muted-foreground">
                    <span className="w-28" />
                    <span className="w-24 text-right font-medium text-blue-400">
                      Run A
                    </span>
                    <span className="w-24 text-right font-medium text-amber-400">
                      Run B
                    </span>
                    <span className="w-28 text-right font-medium">Delta</span>
                  </div>
                  <DeltaCell
                    label="Error Rate"
                    unit="%"
                    {...cmp.reliability.errorRate}
                  />
                  <DeltaCell
                    label="Failed Reqs"
                    {...cmp.reliability.failedRequests}
                  />
                  <DeltaCell
                    label="Error Rate"
                    unit="%"
                    higherBetter
                    {...cmp.reliability.errorRate}
                  />
                </CardContent>
              </Card>
            </div>

            {/* Zipf Distribution Overlay */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" /> Zipf Distribution Overlay
                  (Top 10)
                </CardTitle>
                <CardDescription className="text-xs">
                  <span className="inline-block w-3 h-2 bg-blue-500 rounded mr-1" />{" "}
                  Run A
                  <span className="inline-block w-3 h-2 bg-amber-500 rounded ml-3 mr-1" />{" "}
                  Run B
                </CardDescription>
              </CardHeader>
              <CardContent>
                <OverlayBarChart
                  data={zipfData}
                  labelKey="label"
                  valueAKey="reqA"
                  valueBKey="reqB"
                  colorA="bg-blue-500"
                  colorB="bg-amber-500"
                />
              </CardContent>
            </Card>

            {/* Timeline Overlays */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" /> RPS Timeline Overlay
                  </CardTitle>
                  <CardDescription className="text-xs">
                    <span className="text-blue-400">Blue</span> = Run A,{" "}
                    <span className="text-amber-400">Amber</span> = Run B
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DualSparkline
                    dataA={timelineRpsA}
                    dataB={timelineRpsB}
                    height={100}
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>0s</span>
                    <span>{cmp.timelineOverlay.length}s</span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Clock className="h-4 w-4" /> Latency Timeline Overlay
                  </CardTitle>
                  <CardDescription className="text-xs">
                    <span className="text-blue-400">Blue</span> = Run A,{" "}
                    <span className="text-amber-400">Amber</span> = Run B
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <DualSparkline
                    dataA={timelineLatA}
                    dataB={timelineLatB}
                    height={100}
                    colorA="#3b82f6"
                    colorB="#f59e0b"
                  />
                  <div className="flex justify-between text-xs text-muted-foreground mt-1">
                    <span>0s</span>
                    <span>{cmp.timelineOverlay.length}s</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Summary Verdict */}
            <Card>
              <CardContent className="py-4">
                <div className="text-center space-y-2">
                  {(() => {
                    const improvements = [
                      cmp.latency.p99.improved,
                      cmp.throughput.actualRps.improved,
                      cmp.reliability.errorRate.improved,
                    ].filter(Boolean).length;
                    if (improvements >= 2) {
                      return (
                        <>
                          <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
                            Run B is an improvement
                          </Badge>
                          <p className="text-sm text-muted-foreground">
                            {improvements}/3 key metrics improved (P99 latency,
                            RPS, error rate)
                          </p>
                        </>
                      );
                    } else if (improvements === 1) {
                      return (
                        <>
                          <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                            Mixed results
                          </Badge>
                          <p className="text-sm text-muted-foreground">
                            Only {improvements}/3 key metrics improved — review
                            tradeoffs carefully
                          </p>
                        </>
                      );
                    } else {
                      return (
                        <>
                          <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
                            Run B is a regression
                          </Badge>
                          <p className="text-sm text-muted-foreground">
                            0/3 key metrics improved — consider reverting
                            changes
                          </p>
                        </>
                      );
                    }
                  })()}
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* No data state */}
        {!cmp && runs.length < 2 && (
          <Card className="border-dashed">
            <CardContent className="py-12">
              <div className="text-center space-y-3">
                <GitCompareArrows className="h-12 w-12 text-muted-foreground mx-auto" />
                <h3 className="text-lg font-medium">Need at Least Two Runs</h3>
                <p className="text-sm text-muted-foreground max-w-md mx-auto">
                  Run at least two load tests to enable comparison. Use the Load
                  Test Dashboard to trigger runs.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
