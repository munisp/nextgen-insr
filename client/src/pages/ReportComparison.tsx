import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import {
  ArrowUp,
  ArrowDown,
  Minus,
  GitCompare,
  TrendingUp,
  TrendingDown,
  BarChart3,
} from "lucide-react";

export default function ReportComparison() {
  const [reportAId, setReportAId] = useState("report-week-15");
  const [reportBId, setReportBId] = useState("report-week-16");

  const comparison = trpc.sprint23.reportComparison.compare.useQuery(
    { reportAId, reportBId },
    { enabled: !!reportAId && !!reportBId }
  );

  const availableReports = useMemo(
    () => [
      { id: "report-week-13", label: "Week 13 (Mar 23-29)" },
      { id: "report-week-14", label: "Week 14 (Mar 30 - Apr 5)" },
      { id: "report-week-15", label: "Week 15 (Apr 7-13)" },
      { id: "report-week-16", label: "Week 16 (Apr 14-20)" },
    ],
    []
  );

  const directionIcon = (dir: string) => {
    if (dir === "up") return <ArrowUp className="w-4 h-4 text-green-400" />;
    if (dir === "down") return <ArrowDown className="w-4 h-4 text-red-400" />;
    return <Minus className="w-4 h-4 text-gray-400" />;
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <GitCompare className="w-6 h-6 text-blue-400" />
              Report Comparison
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Side-by-side comparison of weekly system health reports
            </p>
          </div>
        </div>

        {/* Report Selectors */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Report A (Baseline)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={reportAId} onValueChange={setReportAId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select report" />
                </SelectTrigger>
                <SelectContent>
                  {availableReports.map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Report B (Current)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={reportBId} onValueChange={setReportBId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select report" />
                </SelectTrigger>
                <SelectContent>
                  {availableReports.map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>
        </div>

        {/* Score Comparison */}
        {comparison.data && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-blue-500/30">
                <CardContent className="pt-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Report A Score
                  </p>
                  <p className="text-4xl font-bold text-blue-400">
                    {comparison.data.reportA.score}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {comparison.data.reportA.period.start} —{" "}
                    {comparison.data.reportA.period.end}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-purple-500/30">
                <CardContent className="pt-6 text-center">
                  <BarChart3 className="w-8 h-8 mx-auto text-purple-400 mb-2" />
                  <p className="text-sm text-muted-foreground">Delta</p>
                  <p className="text-2xl font-bold">
                    {comparison.data.reportB.score -
                      comparison.data.reportA.score >
                    0
                      ? "+"
                      : ""}
                    {comparison.data.reportB.score -
                      comparison.data.reportA.score}{" "}
                    pts
                  </p>
                </CardContent>
              </Card>
              <Card className="border-green-500/30">
                <CardContent className="pt-6 text-center">
                  <p className="text-sm text-muted-foreground">
                    Report B Score
                  </p>
                  <p className="text-4xl font-bold text-green-400">
                    {comparison.data.reportB.score}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {comparison.data.reportB.period.start} —{" "}
                    {comparison.data.reportB.period.end}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Summary */}
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm">{comparison.data.summary}</p>
              </CardContent>
            </Card>

            {/* Metric Deltas */}
            <Card>
              <CardHeader>
                <CardTitle>Metric-by-Metric Comparison</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-2 px-3">Metric</th>
                        <th className="text-right py-2 px-3">Report A</th>
                        <th className="text-right py-2 px-3">Report B</th>
                        <th className="text-right py-2 px-3">Change</th>
                        <th className="text-center py-2 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(comparison.data.deltas).map(
                        ([key, d]) => (
                          <tr
                            key={key}
                            className="border-b border-border/50 hover:bg-muted/30"
                          >
                            <td className="py-2 px-3 font-medium">
                              {(d as any).label}
                            </td>
                            <td className="text-right py-2 px-3 text-blue-400">
                              {typeof (d as any).valueA === "number"
                                ? d.valueA.toLocaleString()
                                : d.valueA}
                            </td>
                            <td className="text-right py-2 px-3 text-green-400">
                              {typeof (d as any).valueB === "number"
                                ? d.valueB.toLocaleString()
                                : d.valueB}
                            </td>
                            <td className="text-right py-2 px-3 flex items-center justify-end gap-1">
                              {directionIcon((d as any).direction)}
                              <span
                                className={
                                  (d as any).isImprovement
                                    ? "text-green-400"
                                    : d.direction === "flat"
                                      ? "text-gray-400"
                                      : "text-red-400"
                                }
                              >
                                {(d as any).percentChange > 0 ? "+" : ""}
                                {d.percentChange}%
                              </span>
                            </td>
                            <td className="text-center py-2 px-3">
                              <Badge
                                variant={
                                  (d as any).isImprovement
                                    ? "default"
                                    : "destructive"
                                }
                                className="text-xs"
                              >
                                {(d as any).isImprovement
                                  ? "Improved"
                                  : d.direction === "flat"
                                    ? "Stable"
                                    : "Regressed"}
                              </Badge>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {comparison.isLoading && (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              Loading comparison data...
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
