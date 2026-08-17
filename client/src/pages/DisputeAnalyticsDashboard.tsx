import {
  BarChart3,
  Clock,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  RefreshCw,
  Shield,
  DollarSign,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import DashboardLayout from "@/components/DashboardLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
export default function DisputeAnalyticsDashboard() {
  const [activeTab, setActiveTab] = useState("resolution");

  // ── Live tRPC queries ──────────────────────────────────────────────
  const summary = trpc.disputeAnalytics.getSummary.useQuery();
  const resolution = trpc.disputeAnalytics.getResolutionMetrics.useQuery();
  const refunds = trpc.disputeAnalytics.getRefundRates.useQuery();
  const sla = trpc.disputeAnalytics.getSlaCompliance.useQuery();
  const trends = trpc.disputeAnalytics.getTrendData.useQuery({});
  const categories = trpc.disputeAnalytics.getTopCategories.useQuery();
  const utils = trpc.useUtils();
  // F-12 (wave-4b): honest client-side derivations from real shapes.
  const breachCount = sla.data
    ? sla.data.totalDisputes - sla.data.withinSla
    : undefined;
  const avgRefundAmount =
    refunds.data && refunds.data.totalRefunds > 0
      ? Math.round(refunds.data.totalRefundAmount / refunds.data.totalRefunds)
      : undefined;
  const resolvedWeeklyAvg = trends.data?.resolvedDaily
    ? Math.round(
        trends.data.resolvedDaily.slice(-7).reduce((x, d) => x + d.count, 0)
      )
    : undefined;

  const isLoading = summary.isLoading;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-primary" />
              Dispute Analytics
            </h1>
            <p className="text-muted-foreground">
              Resolution times, refund rates, SLA compliance, and dispute
              patterns
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              utils.disputeAnalytics.invalidate();
              toast.success("Analytics refreshed");
            }}
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </Button>
        </div>

        {/* KPI Cards — Live from tRPC */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" /> Avg Resolution
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? "—" : `${summary.data?.avgResolutionHours} hrs`}
              </div>
              <p className="text-xs text-green-500 flex items-center gap-1">
                <TrendingDown className="h-3 w-3" /> Improving
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <DollarSign className="h-3 w-3" /> Refund Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? "—" : `${summary.data?.refundRate}%`}
              </div>
              <p className="text-xs text-muted-foreground">
                ₦
                {isLoading
                  ? "—"
                  : (refunds.data?.totalRefundAmount ?? 0).toLocaleString()}{" "}
                total
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <Shield className="h-3 w-3" /> SLA Compliance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">
                {isLoading ? "—" : `${summary.data?.slaCompliance}%`}
              </div>
              <p className="text-xs text-muted-foreground">
                {breachCount ?? "—"} breaches
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Open Disputes
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-amber-600">
                {isLoading ? "—" : summary.data?.openDisputes}
              </div>
              <p className="text-xs text-muted-foreground">
                — escalated tracking not delivered
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="resolution">Resolution</TabsTrigger>
            <TabsTrigger value="refunds">Refunds</TabsTrigger>
            <TabsTrigger value="sla">SLA</TabsTrigger>
            <TabsTrigger value="trends">Trends</TabsTrigger>
            <TabsTrigger value="categories">Categories</TabsTrigger>
          </TabsList>

          {/* Resolution Metrics */}
          <TabsContent value="resolution" className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Average</p>
                  <p className="text-2xl font-bold">
                    {resolution.data?.avgResolutionHours ?? "—"} hrs
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Median</p>
                  <p className="text-2xl font-bold">
                    —
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">P95</p>
                  <p className="text-2xl font-bold">
                    —
                  </p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Resolution by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left p-2">Category</th>
                        <th className="text-right p-2">Count</th>
                        <th className="text-right p-2">Avg Hours</th>
                        <th className="text-right p-2">Resolved %</th>
                        <th className="text-left p-2">Performance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resolution.data?.byCategory ?? []).map(
                        (c: any, i: number) => (
                          <tr key={i} className="border-b hover:bg-muted/50">
                            <td className="p-2 font-medium">{c.category}</td>
                            <td className="p-2 text-right">{c.count}</td>
                            <td className="p-2 text-right">{c.avgHours} hrs</td>
                            <td className="p-2 text-right font-bold">
                              {c.resolvedPct}%
                            </td>
                            <td className="p-2">
                              <div className="w-full bg-muted rounded-full h-2">
                                <div
                                  className="bg-primary h-2 rounded-full"
                                  style={{ width: `${c.resolvedPct}%` }}
                                />
                              </div>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Refund Rates */}
          <TabsContent value="refunds" className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Overall Refund Rate
                  </p>
                  <p className="text-2xl font-bold">
                    {refunds.data?.overallRefundRate ?? "—"}%
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Avg Refund Amount
                  </p>
                  <p className="text-2xl font-bold">
                    ₦{(avgRefundAmount ?? 0).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Total Refunded
                  </p>
                  <p className="text-2xl font-bold text-red-500">
                    ₦{(refunds.data?.totalRefundAmount ?? 0).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Monthly Refund Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left p-2">Month</th>
                        <th className="text-right p-2">Refund Rate</th>
                        <th className="text-right p-2">Count</th>
                        <th className="text-right p-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(refunds.data?.byMonth ?? []).map(
                        (m: any, i: number) => (
                          <tr key={i} className="border-b hover:bg-muted/50">
                            <td className="p-2 font-medium">{m.month}</td>
                            <td className="p-2 text-right">{m.refundRate}%</td>
                            <td className="p-2 text-right">{m.count}</td>
                            <td className="p-2 text-right font-bold">
                              ₦{m.amount.toLocaleString()}
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Refund Rate by Category</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {(refunds.data?.byCategory ?? []).map((c: any, i: number) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-48 text-sm font-medium truncate">
                        {c.category}
                      </div>
                      <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                        <div
                          className="h-full bg-primary/80 rounded-full flex items-center justify-end pr-2 text-[10px] text-white font-bold"
                          style={{ width: `${c.refundRate}%` }}
                        >
                          {c.refundRate}%
                        </div>
                      </div>
                      <div className="w-24 text-right text-sm font-mono">
                        ₦{c.avgAmount.toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* SLA Compliance */}
          <TabsContent value="sla" className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Overall Compliance
                  </p>
                  <p className="text-2xl font-bold text-green-600">
                    {sla.data?.overallCompliance ?? "—"}%
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Total Breaches
                  </p>
                  <p className="text-2xl font-bold text-red-500">
                    {breachCount ?? "—"}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Total Tracked</p>
                  <p className="text-2xl font-bold">
                    {sla.data?.totalDisputes ?? "—"}
                  </p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>SLA by Priority Level</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left p-2">Priority</th>
                        <th className="text-right p-2">Compliance</th>
                        <th className="text-right p-2">Target</th>
                        <th className="text-right p-2">Breaches</th>
                        <th className="text-right p-2">Avg Response</th>
                        <th className="text-left p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(sla.data?.byPriority ?? []).map((p: any, i: number) => (
                        <tr key={i} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-medium">{p.priority}</td>
                          <td className="p-2 text-right font-bold">
                            {p.compliance}%
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {p.target}%
                          </td>
                          <td className="p-2 text-right">{p.breaches}</td>
                          <td className="p-2 text-right">
                            {p.avgResponseHours} hrs
                          </td>
                          <td className="p-2">
                            <Badge
                              variant={
                                p.compliance >= p.target
                                  ? "default"
                                  : "destructive"
                              }
                            >
                              {p.compliance >= p.target
                                ? "Meeting"
                                : "Below Target"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Weekly Compliance Trend</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {(sla.data?.trend ?? []).map((t: any, i: number) => (
                    <div key={i} className="flex items-center gap-3">
                      <div className="w-20 text-sm text-muted-foreground">
                        {t.week}
                      </div>
                      <div className="flex-1 bg-muted rounded-full h-4 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${t.compliance >= 94 ? "bg-green-500" : t.compliance >= 90 ? "bg-amber-500" : "bg-red-500"}`}
                          style={{ width: `${t.compliance}%` }}
                        />
                      </div>
                      <div className="w-16 text-right text-sm font-bold">
                        {t.compliance}%
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Trends */}
          <TabsContent value="trends" className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Weekly Avg Filed
                  </p>
                  <p className="text-2xl font-bold">
                    {trends.data?.weeklyAvg != null ? Math.round(trends.data.weeklyAvg) : "—"}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Weekly Avg Resolved
                  </p>
                  <p className="text-2xl font-bold text-green-600">
                    {resolvedWeeklyAvg ?? "—"}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">Trend</p>
                  <p className="text-2xl font-bold flex items-center justify-center gap-1">
                    {trends.data?.trendDirection === "improving" ? (
                      <>
                        <TrendingDown className="h-5 w-5 text-green-500" />{" "}
                        Improving
                      </>
                    ) : (
                      <>
                        <TrendingUp className="h-5 w-5 text-red-500" />{" "}
                        Worsening
                      </>
                    )}
                  </p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Daily Dispute Activity (Last 7 Days)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left p-2">Date</th>
                        <th className="text-right p-2">Filed</th>
                        <th className="text-right p-2">Resolved</th>
                        <th className="text-right p-2">Escalated</th>
                        <th className="text-left p-2">Net Change</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(trends.data?.daily ?? []).map((d: any, i: number) => {
                        const net = d.resolved - d.filed;
                        return (
                          <tr key={i} className="border-b hover:bg-muted/50">
                            <td className="p-2 font-medium">{d.date}</td>
                            <td className="p-2 text-right text-amber-600">
                              {d.filed}
                            </td>
                            <td className="p-2 text-right text-green-600">
                              {d.resolved}
                            </td>
                            <td className="p-2 text-right text-red-500">
                              {d.escalated}
                            </td>
                            <td className="p-2">
                              <span
                                className={
                                  net >= 0 ? "text-green-600" : "text-red-500"
                                }
                              >
                                {net >= 0 ? `+${net}` : net} net resolved
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Top Categories */}
          <TabsContent value="categories" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Total Disputes
                  </p>
                  <p className="text-2xl font-bold">
                    {categories.data?.totalDisputes ?? "—"}
                  </p>
                </CardContent>
              </Card>
              <Card className="bg-muted/30">
                <CardContent className="pt-4 text-center">
                  <p className="text-xs text-muted-foreground">
                    Total Financial Impact
                  </p>
                  <p className="text-2xl font-bold text-red-500">
                    ₦{(categories.data?.totalImpact ?? 0).toLocaleString()}
                  </p>
                </CardContent>
              </Card>
            </div>
            <Card>
              <CardHeader>
                <CardTitle>Dispute Categories by Impact</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left p-2">Category</th>
                        <th className="text-right p-2">Count</th>
                        <th className="text-right p-2">% of Total</th>
                        <th className="text-right p-2">Avg Amount</th>
                        <th className="text-right p-2">Total Impact</th>
                        <th className="text-left p-2">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(categories.data?.categories ?? []).map(
                        (c: any, i: number) => (
                          <tr key={i} className="border-b hover:bg-muted/50">
                            <td className="p-2 font-medium">{c.category}</td>
                            <td className="p-2 text-right">{c.count}</td>
                            <td className="p-2 text-right">{c.pctOfTotal}%</td>
                            <td className="p-2 text-right">
                              ₦{c.avgAmount.toLocaleString()}
                            </td>
                            <td className="p-2 text-right font-bold">
                              ₦{c.totalImpact.toLocaleString()}
                            </td>
                            <td className="p-2">
                              <Badge
                                variant={
                                  c.trend === "decreasing"
                                    ? "default"
                                    : c.trend === "increasing"
                                      ? "destructive"
                                      : "secondary"
                                }
                              >
                                {c.trend === "decreasing" && (
                                  <TrendingDown className="h-3 w-3 mr-1" />
                                )}
                                {c.trend === "increasing" && (
                                  <TrendingUp className="h-3 w-3 mr-1" />
                                )}
                                {c.trend}
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
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
