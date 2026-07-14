// @ts-nocheck
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
  const [includeCharts, setIncludeCharts] = useState(true);

  const { data: templates } = trpc.scheduledReports.templates.useQuery();
  const createMutation = trpc.scheduledReports.create.useMutation({
    onSuccess: () => {
      toast.success("Report schedule created");
      setOpen(false);
      setName("");
      onCreated();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const handleCreate = () => {
    createMutation.mutate({
      name,
      type,
      template: template as any,
      recipients: recipients
        .split(",")
        .map((r: any) => r.trim())
        .filter(Boolean),
      config: { includeCharts, format, timezone: "Africa/Lagos", hour, minute },
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
                  {templates?.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
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
          <div className="flex items-center gap-2">
            <Switch
              checked={includeCharts}
              onCheckedChange={setIncludeCharts}
            />
            <Label>Include charts in report</Label>
          </div>
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
  const { data: scheduleData, isLoading } =
    trpc.scheduledReports.list.useQuery();
  const { data: recentRuns } = trpc.scheduledReports.recentRuns.useQuery({
    limit: 20,
  });

  const toggleMutation = trpc.scheduledReports.update.useMutation({
    onSuccess: () => {
      utils.scheduledReports.list.invalidate();
      toast.success("Schedule updated");
    },
  });
  const deleteMutation = trpc.scheduledReports.delete.useMutation({
    onSuccess: () => {
      utils.scheduledReports.list.invalidate();
      toast.success("Schedule deleted");
    },
  });
  const runNowMutation = trpc.scheduledReports.runNow.useMutation({
    onSuccess: () => {
      utils.scheduledReports.list.invalidate();
      utils.scheduledReports.recentRuns.invalidate();
      toast.success("Report generated and sent");
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
                {scheduleData?.enabled ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Recent Runs</p>
              <p className="text-2xl font-bold mt-1">
                {recentRuns?.length ?? 0}
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
                          checked={s.enabled}
                          onCheckedChange={enabled =>
                            toggleMutation.mutate({ id: s.id, enabled })
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
                          variant="outline"
                          onClick={() => runNowMutation.mutate({ id: s.id })}
                          disabled={runNowMutation.isPending}
                        >
                          Run Now
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:text-red-300"
                          onClick={() => deleteMutation.mutate({ id: s.id })}
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
                    {recentRuns?.map((run: any) => (
                      <tr
                        key={run.id}
                        className="border-b last:border-0 hover:bg-muted/30"
                      >
                        <td className="p-3">{run.scheduleName}</td>
                        <td className="p-3">
                          <Badge
                            variant={
                              run.status === "success"
                                ? "default"
                                : "destructive"
                            }
                            className="text-[10px]"
                          >
                            {run.status}
                          </Badge>
                        </td>
                        <td className="p-3 text-muted-foreground">
                          {formatDate(run.startedAt)}
                        </td>
                        <td className="p-3">{run.recipientCount}</td>
                        <td className="p-3 text-red-400 text-xs">
                          {run.error ?? "—"}
                        </td>
                      </tr>
                    ))}
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
