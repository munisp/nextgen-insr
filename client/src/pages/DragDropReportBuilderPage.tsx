import { trpc } from "@/lib/trpc";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BarChart3, Plus, Play, Download, Save } from "lucide-react";

export default function DragDropReportBuilderPage() {
  const { data: dashboard, isLoading } =
    trpc.dragDropReportBuilder.dashboard.useQuery();
  const createReport = trpc.dragDropReportBuilder.saveReport.useMutation();
  const [reportName, setReportName] = useState("");

  if (isLoading)
    return <div className="p-8 text-center">Loading report builder...</div>;
  const d = dashboard!;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" /> Drag & Drop Report Builder
          </h1>
          <p className="text-muted-foreground mt-1">
            Advanced BI with visual report composition
          </p>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{d.totalReports}</div>
            <p className="text-sm text-muted-foreground">Total Reports</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-blue-500">
              {d.scheduledReports}
            </div>
            <p className="text-sm text-muted-foreground">Scheduled</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-500">
              {d.templatesAvailable}
            </div>
            <p className="text-sm text-muted-foreground">Data Sources</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-purple-500">
              {d.reportsRunToday}
            </div>
            <p className="text-sm text-muted-foreground">Widget Types</p>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Create New Report</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-3">
          <Input
            placeholder="Report name"
            value={reportName}
            onChange={e => setReportName(e.target.value)}
            className="flex-1"
          />
          <Button
            onClick={() => {
              createReport.mutate({
                name: reportName,
                config: {
                  dataSource: "transactions",
                  dimensions: ["date"],
                  measures: [{ field: "amount", aggregation: "sum" }],
                  filters: [],
                  chartType: "bar",
                  groupBy: "date",
                  sortBy: "date",
                  limit: 100,
                },
              });
              setReportName("");
            }}
          >
            <Plus className="h-4 w-4 mr-2" /> Create
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Available Widgets</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-4 gap-3">
            {d.popularTemplates.map((w: any) => (
              <div
                key={w.type}
                className="p-4 border rounded-lg text-center cursor-move hover:border-primary transition-colors"
              >
                <div className="text-3xl mb-2">{w.icon}</div>
                <p className="font-medium text-sm">{w.label}</p>
                <p className="text-xs text-muted-foreground">{w.description}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Saved Reports</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="text-left p-2">Name</th>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Widgets</th>
                <th className="text-left p-2">Last Run</th>
                <th className="text-left p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {d.recentReports.map((r: any) => (
                <tr key={r.id} className="border-b">
                  <td className="p-2 font-medium">{r.name}</td>
                  <td className="p-2">{r.type}</td>
                  <td className="p-2">{r.widgetCount}</td>
                  <td className="p-2">
                    {new Date(r.lastRun).toLocaleDateString()}
                  </td>
                  <td className="p-2 flex gap-1">
                    <Button size="sm" variant="outline">
                      <Play className="h-3 w-3" />
                    </Button>
                    <Button size="sm" variant="outline">
                      <Download className="h-3 w-3" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
