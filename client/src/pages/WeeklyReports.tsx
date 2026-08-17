import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar, FileText, Loader2, Mail, Play, Settings } from "lucide-react";


// ─── Trend Delta Display ────────────────────────────────────────────────



// ─── Score Badge ────────────────────────────────────────────────────────


// ─── Metric Card with Trend ─────────────────────────────────────────────


// ─── Main Component ─────────────────────────────────────────────────────

export default function WeeklyReports() {
  const [selectedReportId, setSelectedReportId] = useState<number | null>(null);

  const utils = trpc.useUtils();

  // Queries
  const listQ = trpc.weeklyReports.list.useQuery({ limit: 20, offset: 0 });
  const scheduleQ = trpc.weeklyReports.getSchedule.useQuery();
  const emailConfigQ = trpc.weeklyReports.getEmailConfig.useQuery();
  const recipientsQ = trpc.weeklyReports.listRecipients.useQuery();

  const reportDetailQ = trpc.weeklyReports.getById.useQuery(
    { id: selectedReportId ?? 0 },
    { enabled: !!selectedReportId }
  );
  // getById returns a transaction row, or a {data,total} empty shape when the
  // db is unavailable — narrow to the row only.
  const detailRow =
    reportDetailQ.data && "ref" in reportDetailQ.data
      ? reportDetailQ.data
      : undefined;

  // Mutations
  const generateM = trpc.weeklyReports.generate.useMutation({
    onSuccess: () => {
      toast.success("Weekly report generated successfully");
      utils.weeklyReports.list.invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });






  // F-12 (wave-4b): getPdfHtml is fail-loud NOT_IMPLEMENTED — the export
  // action attempts the real call and surfaces the loud backend error.
  const handlePdfExport = async () => {
    try {
      await utils.weeklyReports.getPdfHtml.fetch();
      toast.success("PDF export opened");
    } catch {
      toast.error("PDF export is not available on this deployment");
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Weekly Health Reports
          </h1>
          <p className="text-muted-foreground mt-1">
            Automated system health summaries with trend analysis, email
            delivery, and PDF export
          </p>
        </div>
        <Button
          onClick={() => generateM.mutate({})}
          disabled={generateM.isPending}
        >
          {generateM.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Generate Now
        </Button>
      </div>

      {/* F-12 (wave-4b): weeklyReports.latest is fail-loud NOT_IMPLEMENTED —
          the report-document model is undelivered; honest unavailable state. */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Latest Report</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            — the weekly report engine is not delivered on this platform
          </div>
        </CardContent>
      </Card>

      {/* Tabs: History | Email Settings | Schedule */}
      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history">
            <Calendar className="h-4 w-4 mr-1" /> Report History
          </TabsTrigger>
          <TabsTrigger value="email">
            <Mail className="h-4 w-4 mr-1" /> Email Delivery
          </TabsTrigger>
          <TabsTrigger value="schedule">
            <Settings className="h-4 w-4 mr-1" /> Schedule
          </TabsTrigger>
        </TabsList>

        {/* ─── History Tab ──────────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          {/* F-12 (wave-4b): weeklyReports.list/getById return REAL
              transaction rows (no report-document model exists) — this is an
              honest plain table of the actual row fields. The report-document
              rendering (scores/trends/alerts/recommendations) is registered
              as undelivered scope. */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-1">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Transaction Records</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 max-h-[500px] overflow-y-auto">
                {listQ.isLoading && (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {(listQ.data?.data ?? []).map(r => (
                  <button
                    key={r.id}
                    onClick={() => setSelectedReportId(r.id)}
                    className={`w-full text-left p-3 rounded-lg transition-colors ${
                      selectedReportId === r.id
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">{r.ref}</span>
                      <Badge variant="outline">{r.status}</Badge>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span>{r.type}</span>
                      <span>{r.amount} {r.currency}</span>
                    </div>
                  </button>
                ))}
                {(listQ.data?.data ?? []).length === 0 && !listQ.isLoading && (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No transaction records
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Record Detail</CardTitle>
              </CardHeader>
              <CardContent>
                {!selectedReportId && (
                  <p className="text-sm text-muted-foreground text-center py-12">
                    Select a record from the list to view details
                  </p>
                )}
                {reportDetailQ.isLoading && (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                )}
                {detailRow && (
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><span className="text-muted-foreground">Ref:</span> {detailRow.ref}</div>
                    <div><span className="text-muted-foreground">Type:</span> {detailRow.type}</div>
                    <div><span className="text-muted-foreground">Amount:</span> {detailRow.amount} {detailRow.currency}</div>
                    <div><span className="text-muted-foreground">Fee:</span> {detailRow.fee}</div>
                    <div><span className="text-muted-foreground">Status:</span> {detailRow.status}</div>
                    <div><span className="text-muted-foreground">Agent:</span> {detailRow.agentId}</div>
                    <div><span className="text-muted-foreground">Customer:</span> {detailRow.customerName ?? "—"}</div>
                    <div><span className="text-muted-foreground">Created:</span> {new Date(detailRow.createdAt).toLocaleString()}</div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ─── Email Tab ─── (F-12: emailConfig/recipients are fail-loud
            NOT_IMPLEMENTED — honest unavailable state) */}
        <TabsContent value="email" className="space-y-4">
          <Card>
            <CardContent className="py-8">
              <div className="text-center text-muted-foreground">
                — weekly-report email delivery is not delivered on this platform
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Schedule Tab ─── (F-12: schedule config is fail-loud
            NOT_IMPLEMENTED — honest unavailable state) */}
        <TabsContent value="schedule" className="space-y-4">
          <Card>
            <CardContent className="py-8">
              <div className="text-center text-muted-foreground">
                — weekly-report scheduling is not delivered on this platform
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
