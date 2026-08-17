import { useState } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

const SEVERITY_COLORS: Record<string, string> = {
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  warning:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
  critical: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  paused: "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200",
  triggered: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
  resolved: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  expired: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
};

export default function DataThresholdAlerts() {
  const [tab, setTab] = useState("rules");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);

  // Form state
  const [formName, setFormName] = useState("");
  const [formMetric, setFormMetric] = useState("");
  const [formOperator, setFormOperator] = useState("gt");
  const [formThreshold, setFormThreshold] = useState("");
  const [formSeverity, setFormSeverity] = useState("warning");
  const [formChannels, setFormChannels] = useState<string[]>([
    "email",
    "in-app",
  ]);

  const utils = trpc.useUtils();
  const { data: rulesData } = trpc.thresholdAlerts.list.useQuery({
    status: statusFilter as any,
    severity: severityFilter as any,
    search: search || undefined,
  });
  const { data: metricsData } = trpc.thresholdAlerts.metrics.useQuery();
  const { data: operatorsData } = trpc.thresholdAlerts.operators.useQuery();
  const { data: eventsData } = trpc.thresholdAlerts.events.useQuery({});

  const createMut = trpc.thresholdAlerts.create.useMutation({
    onSuccess: () => {
      utils.thresholdAlerts.list.invalidate();
      setShowCreate(false);
      resetForm();
      toast.success("Threshold rule created");
    },
    onError: (err: any) => toast.error(err.message),
  });
  const toggleMut = trpc.thresholdAlerts.toggleStatus.useMutation({
    onSuccess: () => {
      utils.thresholdAlerts.list.invalidate();
      toast.success("Status updated");
    },
    onError: (err: any) => toast.error(err.message),
  });
  const deleteMut = trpc.thresholdAlerts.delete.useMutation({
    onSuccess: () => {
      utils.thresholdAlerts.list.invalidate();
      toast.success("Rule deleted");
    },
    onError: (err: any) => toast.error(err.message),
  });
  const ackMut = trpc.thresholdAlerts.acknowledge.useMutation({
    onSuccess: () => {
      utils.thresholdAlerts.events.invalidate();
      toast.success("Alert acknowledged");
    },
    onError: (err: any) => toast.error(err.message),
  });
  const simulateMut = trpc.thresholdAlerts.simulateCheck.useMutation({
    onSuccess: (data: any) => {
      utils.thresholdAlerts.list.invalidate();
      utils.thresholdAlerts.events.invalidate();
      if (data.breached) toast.warning("Threshold breached! Alert triggered.");
      else toast.success(`Check passed. Current value: ${data.currentValue}`);
    },
    onError: (err: any) => toast.error(err.message),
  });

  const rules = rulesData?.rules ?? [];
  const stats = rulesData?.stats ?? {
    total: 0,
    active: 0,
    triggered: 0,
    paused: 0,
  };
  const metrics = metricsData ?? [];
  const operators = operatorsData ?? [];
  const events = eventsData?.events ?? [];

  function resetForm() {
    setFormName("");
    setFormMetric("");
    setFormOperator("gt");
    setFormThreshold("");
    setFormSeverity("warning");
    setFormChannels(["email", "in-app"]);
  }

  function handleCreate() {
    if (!formName || !formMetric || !formThreshold) {
      toast.error("Fill all required fields");
      return;
    }
    createMut.mutate({
      name: formName,
      metric: formMetric,
      operator: formOperator as any,
      threshold: parseFloat(formThreshold),
      severity: formSeverity as any,
      channels: formChannels as any[],
      ownerId: "u1",
      ownerName: "Admin",
    });
  }

  function toggleChannel(ch: string) {
    setFormChannels(prev =>
      prev.includes(ch) ? prev.filter((c: any) => c !== ch) : [...prev, ch]
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold">{stats.total}</p>
              <p className="text-sm text-muted-foreground">Total Rules</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-green-600">
                {stats.active}
              </p>
              <p className="text-sm text-muted-foreground">Active</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-red-600">
                {stats.triggered}
              </p>
              <p className="text-sm text-muted-foreground">Triggered</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-2xl font-bold text-gray-500">{stats.paused}</p>
              <p className="text-sm text-muted-foreground">Paused</p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={tab} onValueChange={setTab}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <TabsList>
              <TabsTrigger value="rules">Threshold Rules</TabsTrigger>
              <TabsTrigger value="events">
                Alert Events ({events.length})
              </TabsTrigger>
            </TabsList>
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
              <DialogTrigger asChild>
                <Button>+ New Rule</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create Threshold Rule</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label>Name</Label>
                    <Input
                      value={formName}
                      onChange={e => setFormName(e.target.value)}
                      placeholder="e.g., High Fraud Volume"
                    />
                  </div>
                  <div>
                    <Label>Metric</Label>
                    <Select value={formMetric} onValueChange={setFormMetric}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select metric" />
                      </SelectTrigger>
                      <SelectContent>
                        {metrics.map((m: any) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.label} ({m.unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Operator</Label>
                      <Select
                        value={formOperator}
                        onValueChange={setFormOperator}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {operators.map((o: any) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Threshold</Label>
                      <Input
                        type="number"
                        value={formThreshold}
                        onChange={e => setFormThreshold(e.target.value)}
                        placeholder="50"
                      />
                    </div>
                  </div>
                  <div>
                    <Label>Severity</Label>
                    <Select
                      value={formSeverity}
                      onValueChange={setFormSeverity}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="info">Info</SelectItem>
                        <SelectItem value="warning">Warning</SelectItem>
                        <SelectItem value="critical">Critical</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Channels</Label>
                    <div className="flex gap-2 mt-1">
                      {["email", "sms", "push", "webhook", "in-app"].map(
                        (ch: any) => (
                          <Badge
                            key={ch}
                            variant={
                              formChannels.includes(ch) ? "default" : "outline"
                            }
                            className="cursor-pointer"
                            onClick={() => toggleChannel(ch)}
                          >
                            {ch}
                          </Badge>
                        )
                      )}
                    </div>
                  </div>
                  <Button
                    onClick={handleCreate}
                    disabled={createMut.isPending}
                    className="w-full"
                  >
                    {createMut.isPending ? "Creating..." : "Create Rule"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <TabsContent value="rules" className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search rules..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="max-w-xs"
              />
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="triggered">Triggered</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                </SelectContent>
              </Select>
              <Select value={severityFilter} onValueChange={setSeverityFilter}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Severity</SelectItem>
                  <SelectItem value="info">Info</SelectItem>
                  <SelectItem value="warning">Warning</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {rules.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No threshold rules found. Create one to get started.
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {rules.map((rule: any) => (
                  <Card
                    key={rule.id}
                    className={
                      rule.status === "triggered" ? "border-red-500" : ""
                    }
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-start justify-between">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold">{rule.name}</h3>
                            <Badge className={SEVERITY_COLORS[rule.severity]}>
                              {rule.severity}
                            </Badge>
                            <Badge className={STATUS_COLORS[rule.status]}>
                              {rule.status}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {rule.metricLabel} {rule.operator} {rule.threshold}
                            {rule.unit}
                          </p>
                          {rule.currentValue !== null && (
                            <p className="text-sm">
                              Current:{" "}
                              <span className="font-mono font-bold">
                                {rule.currentValue}
                                {rule.unit}
                              </span>
                            </p>
                          )}
                          <div className="flex gap-1 mt-1">
                            {rule.channels.map((ch: string) => (
                              <Badge
                                key={ch}
                                variant="outline"
                                className="text-xs"
                              >
                                {ch}
                              </Badge>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              simulateMut.mutate({
                                ruleId: rule.id,
                                simulatedValue:
                                  rule.threshold +
                                  (rule.operator.startsWith("gt") ||
                                  rule.operator.startsWith("pct")
                                    ? 10
                                    : -10),
                              })
                            }
                          >
                            Test
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              toggleMut.mutate({
                                id: rule.id,
                                action:
                                  rule.status === "paused" ? "resume" : "pause",
                              })
                            }
                          >
                            {rule.status === "paused" ? "Resume" : "Pause"}
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteMut.mutate({ id: rule.id })}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="events" className="space-y-3">
            {events.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-muted-foreground">
                  No alert events yet.
                </CardContent>
              </Card>
            ) : (
              events.map((evt: any) => (
                <Card
                  key={evt.id}
                  className={
                    !evt.acknowledged ? "border-l-4 border-l-red-500" : ""
                  }
                >
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="font-semibold">{evt.ruleName}</h4>
                          <Badge className={SEVERITY_COLORS[evt.severity]}>
                            {evt.severity}
                          </Badge>
                          {evt.resolvedAt && (
                            <Badge className="bg-green-100 text-green-800">
                              Resolved
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm">{evt.message}</p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(evt.createdAt).toLocaleString()}
                          {evt.acknowledgedBy &&
                            ` · Ack by ${evt.acknowledgedBy}`}
                        </p>
                      </div>
                      {!evt.acknowledged && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            ackMut.mutate({
                              eventId: evt.id,
                              userId: "u1",
                              userName: "Admin",
                            })
                          }
                        >
                          Acknowledge
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
