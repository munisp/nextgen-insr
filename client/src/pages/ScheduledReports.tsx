/**
 * ScheduledReports — Manage automated report schedules
 */
import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";

function formatDate(ts: number | null): string {
  if (!ts) return "Never";
  return new Date(ts).toLocaleString();
}

function formatRelative(ts: number): string {
  const diff = ts - Date.now();
  if (diff < 0) return "Overdue";
  const hours = Math.floor(diff / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

const TYPE_COLORS: Record<string, string> = {
  daily: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  weekly: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  monthly: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

function CreateScheduleDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<"daily" | "weekly" | "monthly">("daily");
  const [template, setTemplate] = useState("transaction_summary");
  const [recipients, setRecipients] = useState("admin@insureportal.com");
  const [hour, setHour] = useState(18);
  const [minute, setMinute] = useState(0);
  const [format, setFormat] = useState<"html" | "pdf">("html");

  const { data: templates } = trpc.scheduledReports.templates.useQuery(undefined, { retry: false });
  const createMutation = trpc.scheduledReports.createSchedule.useMutation({
    onSuccess: () => {
      toast.success("Report schedule created");
      setOpen(false);
      setName("");
      onCreated();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleCreate = () => {
    // F-12 (wave-4b): real createSchedule input is
    // {reportType, frequency, recipients, format, time} — the phantom
    // name/type/template/config wrapper is gone.
    createMutation.mutate({
      reportType: name,
      frequency: type,
      recipients: recipients
        .split(",")
        .map(r => r.trim())
        .filter(Boolean),
      format,
      time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">+ New Schedule</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Report Schedule</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Daily Transaction Summary"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Frequency</Label>
              <Select value={type} onValueChange={v => setType(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Template</Label>
              <Select value={template} onValueChange={setTemplate}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* F-12 (wave-4b): no report-template store is delivered. */}
                  <SelectItem value="__none" disabled>
                    — no templates delivered
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Recipients (comma-separated)</Label>
            <Input
              value={recipients}
              onChange={e => setRecipients(e.target.value)}
              placeholder="admin@insureportal.com, finance@insureportal.com"
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <Label>Hour (0-23)</Label>
              <Input
                type="number"
                min={0}
                max={23}
                value={hour}
                onChange={e => setHour(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Minute (0-59)</Label>
              <Input
                type="number"
                min={0}
                max={59}
                value={minute}
                onChange={e => setMinute(Number(e.target.value))}
              />
            </div>
            <div>
              <Label>Format</Label>
              <Select value={format} onValueChange={v => setFormat(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="html">HTML</SelectItem>
                  <SelectItem value="pdf">PDF</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {/* F-12 (wave-4b): "include charts" had no backing field in the
              real createSchedule input — removed rather than fake the
              affordance. */}
          <Button
            onClick={handleCreate}
            disabled={!name || !recipients || createMutation.isPending}
            className="w-full"
          >
            {createMutation.isPending ? "Creating..." : "Create Schedule"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ScheduledReports() {
  const utils = trpc.useUtils();
  // F-12 (wave-4b): list/recentRuns/templates/runNow/update aliases are
  // fail-loud; the REAL procs are listSchedules/getStats/createSchedule/
  // deleteSchedule/pauseSchedule (systemConfig-backed). recentRuns has no
  // run store — the section renders an honest unavailable state.
  const { data: scheduleData, isLoading } =
    trpc.scheduledReports.listSchedules.useQuery({});
  const { data: reportStats } = trpc.scheduledReports.getStats.useQuery();

  const toggleMutation = trpc.scheduledReports.pauseSchedule.useMutation({
    onSuccess: () => {
      utils.scheduledReports.listSchedules.invalidate();
      toast.success("Schedule updated");
    },
  });
  const deleteMutation = trpc.scheduledReports.deleteSchedule.useMutation({
    onSuccess: () => {
      utils.scheduledReports.listSchedules.invalidate();
      toast.success("Schedule deleted");
    },
  });

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6 max-w-[1200px] mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Scheduled Reports</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Automated report delivery via email
            </p>
          </div>
          <CreateScheduleDialog
            onCreated={() => utils.scheduledReports.list.invalidate()}
          />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Schedules</p>
              <p className="text-2xl font-bold mt-1">
                {scheduleData?.total ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Active</p>
              <p className="text-2xl font-bold mt-1 text-emerald-500">
                {reportStats?.activeSchedules ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Recent Runs</p>
              <p className="text-2xl font-bold mt-1">
                "—"
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="schedules">
          <TabsList>
            <TabsTrigger value="schedules">Schedules</TabsTrigger>
            <TabsTrigger value="history">Run History</TabsTrigger>
          </TabsList>

          <TabsContent value="schedules" className="space-y-3 mt-4">
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                Loading schedules...
              </div>
            ) : (
              scheduleData?.schedules.map((s: any) => (
                <Card key={s.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Switch
                          checked={s.status === "active"}
                          onCheckedChange={enabled =>
                            toggleMutation.mutate({ scheduleId: s.id })
                          }
                        />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{s.name}</span>
                            <Badge
                              variant="outline"
                              className={TYPE_COLORS[s.type]}
                            >
                              {s.type}
                            </Badge>
                            <Badge variant="outline" className="text-[10px]">
                              {s.config.format.toUpperCase()}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            Template: {s.templateName} &middot; Recipients:{" "}
                            {s.recipients.join(", ")} &middot; Next:{" "}
                            {formatRelative(s.nextRun)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:text-red-300"
                          onClick={() => deleteMutation.mutate({ scheduleId: s.id })}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            <Card>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="p-3 text-left">Schedule</th>
                      <th className="p-3 text-left">Status</th>
                      <th className="p-3 text-left">Started</th>
                      <th className="p-3 text-left">Recipients</th>
                      <th className="p-3 text-left">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* F-12 (wave-4b): no run-history store is delivered. */}
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-sm text-muted-foreground">
                        — report run history is not delivered on this platform
                      </td>
                    </tr>
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
