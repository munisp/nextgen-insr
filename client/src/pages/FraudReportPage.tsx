import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/lib/trpc";
import {
  FileText,
  TrendingUp,
  Shield,
  AlertTriangle,
  BarChart3,
  Download,
  Calendar,
  Loader2,
} from "lucide-react";

export default function FraudReportPage() {
  const [year, setYear] = useState(2026);
  const [month, setMonth] = useState(4);
  const [selectedReport, setSelectedReport] = useState<string | null>(null);
  const [tab, setTab] = useState("generate");

  const listReports = trpc.fraudReport.listReports.useQuery();
  const quickStats = trpc.fraudReport.quickStats.useQuery({ year, month });
  const reportDetail = trpc.fraudReport.getReport.useQuery(
    { reportId: selectedReport ?? "" },
    { enabled: !!selectedReport }
  );
  const generateMut = trpc.fraudReport.generateReport.useMutation({
    onSuccess: data => {
      setSelectedReport(data.id);
      setTab("view");
      listReports.refetch();
    },
  });

  const report = reportDetail.data;

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <FileText className="h-7 w-7 text-blue-500" /> Fraud Analysis &
              Risk Reports
            </h1>
            <p className="text-muted-foreground mt-1">
              AI-generated monthly fraud analysis with LLM executive summaries
            </p>
          </div>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="generate">Generate Report</TabsTrigger>
            <TabsTrigger value="view" disabled={!selectedReport}>
              View Report
            </TabsTrigger>
            <TabsTrigger value="history">Report History</TabsTrigger>
          </TabsList>

          <TabsContent value="generate" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Generate Monthly Report
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-4">
                  <div>
                    <label className="text-sm text-muted-foreground">
                      Year
                    </label>
                    <select
                      className="ml-2 p-2 border rounded bg-background"
                      value={year}
                      onChange={e => setYear(Number(e.target.value))}
                    >
                      {[2024, 2025, 2026].map(y => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm text-muted-foreground">
                      Month
                    </label>
                    <select
                      className="ml-2 p-2 border rounded bg-background"
                      value={month}
                      onChange={e => setMonth(Number(e.target.value))}
                    >
                      {Array.from({ length: 12 }, (_, i) => (
                        <option key={i + 1} value={i + 1}>
                          {new Date(2026, i).toLocaleString("default", {
                            month: "long",
                          })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <Button
                    onClick={() => generateMut.mutate({ year, month })}
                    disabled={generateMut.isPending}
                  >
                    {generateMut.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Generating...
                      </>
                    ) : (
                      <>
                        <FileText className="h-4 w-4 mr-2" />
                        Generate Report
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Quick Stats Preview */}
            {quickStats.data && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-2xl font-bold">
                      {quickStats.data.fraudMetrics.totalTransactions.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Total Transactions
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-2xl font-bold text-red-500">
                      {quickStats.data.fraudMetrics.confirmedFraud.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Confirmed Fraud
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-2xl font-bold">
                      ₦
                      {(
                        quickStats.data.fraudMetrics.totalFraudAmount / 1000000
                      ).toFixed(1)}
                      M
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Total Fraud Amount
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-2xl font-bold text-green-500">
                      {quickStats.data.fraudMetrics.detectionRate}%
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Detection Rate
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          <TabsContent value="view" className="space-y-4">
            {report && (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="flex items-center gap-2">
                        <Shield className="h-5 w-5" /> Executive Summary —{" "}
                        {report.period}
                      </CardTitle>
                      <Badge
                        variant={
                          report.riskAssessment.overallRiskLevel === "low"
                            ? "default"
                            : report.riskAssessment.overallRiskLevel ===
                                "medium"
                              ? "secondary"
                              : "destructive"
                        }
                      >
                        Risk: {report.riskAssessment.overallRiskLevel}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm whitespace-pre-wrap">
                      {report.executiveSummary}
                    </p>
                  </CardContent>
                </Card>

                {/* Fraud Metrics */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <p className="text-xl font-bold">
                        {report.fraudMetrics.totalTransactions.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Total Transactions
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <p className="text-xl font-bold text-red-500">
                        {report.fraudMetrics.confirmedFraud.toLocaleString()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Confirmed Fraud
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <p className="text-xl font-bold">
                        ₦
                        {(
                          report.fraudMetrics.totalFraudAmount / 1000000
                        ).toFixed(1)}
                        M
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Fraud Amount
                      </p>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4 text-center">
                      <p className="text-xl font-bold text-green-500">
                        {report.fraudMetrics.detectionRate}%
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Detection Rate
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Top Fraud Categories */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BarChart3 className="h-4 w-4" /> Top Fraud Categories
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="p-2">Category</th>
                          <th className="p-2">Count</th>
                          <th className="p-2">Amount</th>
                          <th className="p-2">Trend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.trendAnalysis.topFraudCategories.map(c => (
                          <tr key={c.category} className="border-b">
                            <td className="p-2 font-medium">{c.category}</td>
                            <td className="p-2">{c.count.toLocaleString()}</td>
                            <td className="p-2">
                              ₦{(c.amount / 1000000).toFixed(1)}M
                            </td>
                            <td className="p-2">
                              <Badge
                                variant={
                                  c.trend === "up"
                                    ? "destructive"
                                    : c.trend === "down"
                                      ? "default"
                                      : "outline"
                                }
                              >
                                {c.trend === "up"
                                  ? "↑"
                                  : c.trend === "down"
                                    ? "↓"
                                    : "→"}{" "}
                                {c.trend}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                {/* Model Performance */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" /> Model Performance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left">
                          <th className="p-2">Model</th>
                          <th className="p-2">Accuracy</th>
                          <th className="p-2">Precision</th>
                          <th className="p-2">Recall</th>
                          <th className="p-2">F1</th>
                          <th className="p-2">AUC</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.modelPerformance.map(m => (
                          <tr key={m.modelName} className="border-b">
                            <td className="p-2 font-medium">{m.modelName}</td>
                            <td className="p-2">
                              {(m.accuracy * 100).toFixed(1)}%
                            </td>
                            <td className="p-2">
                              {(m.precision * 100).toFixed(1)}%
                            </td>
                            <td className="p-2">
                              {(m.recall * 100).toFixed(1)}%
                            </td>
                            <td className="p-2">
                              {(m.f1Score * 100).toFixed(1)}%
                            </td>
                            <td className="p-2 font-bold">
                              {(m.auc * 100).toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>

                {/* Risk Assessment */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4" /> Key Risks &
                      Mitigations
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {report.riskAssessment.keyRisks.map((r, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-3 p-3 rounded border"
                      >
                        <Badge
                          variant={
                            r.severity === "high"
                              ? "destructive"
                              : r.severity === "medium"
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {r.severity}
                        </Badge>
                        <div>
                          <p className="text-sm font-medium">{r.risk}</p>
                          <p className="text-xs text-muted-foreground mt-1">
                            Mitigation: {r.mitigation}
                          </p>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>

                {/* Recommendations */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      AI Recommendations
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {report.recommendations.map((r, i) => (
                        <li key={i} className="text-sm flex items-start gap-2">
                          <span className="text-primary font-bold">
                            {i + 1}.
                          </span>{" "}
                          {r}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            {listReports.data?.reports.map(r => (
              <Card
                key={r.id}
                className="cursor-pointer hover:border-primary/50"
                onClick={() => {
                  setSelectedReport(r.id);
                  setTab("view");
                }}
              >
                <CardContent className="pt-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> {r.period}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {r.totalTransactions.toLocaleString()} txns ·{" "}
                      {r.confirmedFraud.toLocaleString()} fraud · ₦
                      {(r.totalFraudAmount / 1000000).toFixed(1)}M
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        r.overallRiskLevel === "low"
                          ? "default"
                          : r.overallRiskLevel === "medium"
                            ? "secondary"
                            : "destructive"
                      }
                    >
                      {r.overallRiskLevel}
                    </Badge>
                    <Button size="sm" variant="outline">
                      <Download className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(!listReports.data || listReports.data.total === 0) && (
              <p className="text-center text-muted-foreground py-8">
                No reports generated yet. Go to Generate tab to create one.
              </p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
