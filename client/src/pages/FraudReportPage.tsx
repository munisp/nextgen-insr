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
      setSelectedReport(data.reportId);
      setTab("view");
      listReports.refetch();
    },
  });

  // F-12 (wave-4b): reports are generated on demand and NOT persisted
  // (getReport fail-loud NOT_FOUND by design) — the view tab renders the
  // real generateReport result {reportId, data:{period,totalAlerts,
  // bySeverity,byStatus,alerts}}.
  const report = generateMut.data;

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
                    onClick={() => {
                      const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
                      const end = new Date(year, month, 0).getDate();
                      const endDate = `${year}-${String(month).padStart(2, "0")}-${end}`;
                      generateMut.mutate({ startDate, endDate });
                    }}
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

            {/* Quick Stats Preview — F-12 (wave-4b): real quickStats fields
                (case-management aggregates); the phantom fraudMetrics nesting
                (transaction volumes/detection rate) has no source → "—" */}
            {quickStats.data && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-2xl font-bold">
                      {quickStats.data.totalCases.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">Total Cases</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-2xl font-bold text-red-500">
                      {quickStats.data.openCases.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">Open Cases</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-2xl font-bold">
                      ₦{(quickStats.data.totalLossPrevented / 1000000).toFixed(1)}M
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Loss Prevented
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4 text-center">
                    <p className="text-2xl font-bold text-green-500">
                      {quickStats.data.resolvedToday.toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Resolved Today
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
                        <Shield className="h-5 w-5" /> Fraud Alert Report —{" "}
                        {report.data.period.startDate} → {report.data.period.endDate}
                      </CardTitle>
                      <Badge variant="outline">
                        {report.data.totalAlerts.toLocaleString()} alerts
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Real aggregates: alerts by severity + status */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {Object.entries(report.data.bySeverity).map(([sev, n]) => (
                        <Card key={sev}>
                          <CardContent className="pt-4 text-center">
                            <p className="text-xl font-bold">{n}</p>
                            <p className="text-xs text-muted-foreground capitalize">
                              {sev} severity
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(report.data.byStatus).map(([st, n]) => (
                        <Badge key={st} variant="secondary" className="capitalize">
                          {st}: {n}
                        </Badge>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Real alert rows */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Alerts in period</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {report.data.alerts.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No fraud alerts in this period
                      </p>
                    ) : (
                      <div className="space-y-1 max-h-[400px] overflow-y-auto">
                        {report.data.alerts.map(a => (
                          <div
                            key={a.id}
                            className="flex items-center justify-between p-2 rounded bg-muted/40 text-sm"
                          >
                            <span className="font-medium">{a.type}</span>
                            <span className="text-xs text-muted-foreground">
                              {a.severity} · {a.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
            {!report && (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  Generate a report to view it here — generated reports are not
                  persisted.
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="history" className="space-y-4">
            {/* F-12 (wave-4b): reports are not persisted — listReports is
                honest-empty by design; rows show the real fields only. */}
            {listReports.data?.reports.map(r => (
              <Card key={r.id}>
                <CardContent className="pt-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium flex items-center gap-2">
                      <Calendar className="h-4 w-4" /> {r.name}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {r.id} · {r.createdAt}
                    </p>
                  </div>
                  <Badge variant="outline">{r.status}</Badge>
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
