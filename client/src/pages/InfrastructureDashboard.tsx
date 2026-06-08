// @ts-nocheck
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import DashboardLayout from "@/components/DashboardLayout";
import {
  Database,
  Activity,
  Zap,
  Shield,
  RefreshCw,
  Play,
  StopCircle,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Server,
  Key,
  Trash2,
  RotateCcw,
} from "lucide-react";

function StatusBadge({ healthy, label }: { healthy: boolean; label?: string }) {
  return (
    <Badge variant={healthy ? "default" : "destructive"} className="gap-1">
      {healthy ? (
        <CheckCircle className="w-3 h-3" />
      ) : (
        <XCircle className="w-3 h-3" />
      )}
      {label ?? (healthy ? "Online" : "Offline")}
    </Badge>
  );
}

function MetricCard({
  title,
  value,
  sub,
  icon: Icon,
  color = "text-blue-500",
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <Icon className={`w-8 h-8 ${color}`} />
        </div>
      </CardContent>
    </Card>
  );
}

// ── TigerBeetle Tab ──────────────────────────────────────────────────────────
function TigerBeetleTab() {
  const [agentCode, setAgentCode] = useState("");
  const summary = trpc.ledger.summary.useQuery();
  const accounts = trpc.ledger.listAccounts.useQuery({ limit: 20 });
  const syncStatus = trpc.ledger.syncStatus.useQuery();
  const triggerSync = trpc.ledger.triggerSync.useMutation({
    onSuccess: d => {
      toast.success(
        d.triggered ? "Sync triggered" : "Sidecar offline — sync queued"
      );
      syncStatus.refetch();
    },
  });
  const retryFailed = trpc.ledger.retryFailed.useMutation({
    onSuccess: d =>
      toast.success(
        `Retried ${d.retried} transfers (${d.succeeded} succeeded)`
      ),
  });
  const agentBal = trpc.ledger.agentBalance.useQuery(
    { agentCode },
    { enabled: agentCode.length > 3 }
  );

  const s = summary.data;
  const sync = syncStatus.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Ledger Status"
          value={s?.healthy ? "Online" : "Offline"}
          icon={Database}
          color={s?.healthy ? "text-green-500" : "text-red-500"}
        />
        <MetricCard
          title="Pending Syncs"
          value={sync?.pending ?? 0}
          sub="Awaiting TigerBeetle"
          icon={Clock}
          color="text-yellow-500"
        />
        <MetricCard
          title="Synced Transfers"
          value={sync?.synced ?? 0}
          icon={CheckCircle}
          color="text-green-500"
        />
        <MetricCard
          title="Failed Transfers"
          value={sync?.failed ?? 0}
          icon={AlertTriangle}
          color="text-red-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard
          title="Total Transactions (PG)"
          value={(s?.postgres.totalTxns ?? 0).toLocaleString()}
          sub="PostgreSQL source"
          icon={Activity}
        />
        <MetricCard
          title="Total Volume (NGN)"
          value={`₦${((s?.postgres.totalVolumeNGN ?? 0) / 100).toLocaleString()}`}
          sub="PostgreSQL source"
          icon={Zap}
          color="text-purple-500"
        />
      </div>

      <div className="flex gap-2">
        <Button
          onClick={() => triggerSync.mutate({})}
          disabled={triggerSync.isPending}
          size="sm"
        >
          <RefreshCw className="w-4 h-4 mr-2" />
          Trigger Sync
        </Button>
        <Button
          onClick={() => retryFailed.mutate({ limit: 20 })}
          disabled={retryFailed.isPending}
          variant="outline"
          size="sm"
        >
          <RotateCcw className="w-4 h-4 mr-2" />
          Retry Failed (20)
        </Button>
        <Button onClick={() => summary.refetch()} variant="ghost" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Agent Float Balance Lookup
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 items-center">
            <Input
              placeholder="Agent code (e.g. AGT001)"
              value={agentCode}
              onChange={e => setAgentCode(e.target.value)}
              className="max-w-xs"
            />
            {agentBal.data && (
              <div className="text-sm">
                <span className="font-semibold">
                  ₦{agentBal.data.balanceNGN.toLocaleString()}
                </span>
                <Badge variant="outline" className="ml-2">
                  {agentBal.data.source}
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ledger Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          {"offline" in (accounts.data ?? {}) &&
            (accounts.data as any)?.offline && (
              <p className="text-sm text-muted-foreground mb-2">
                TigerBeetle sidecar offline — showing PostgreSQL fallback
              </p>
            )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account ID</TableHead>
                <TableHead>Agent Code</TableHead>
                <TableHead>Ledger</TableHead>
                <TableHead>Balance (NGN)</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.data?.accounts.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    No accounts found
                  </TableCell>
                </TableRow>
              )}
              {accounts.data?.accounts.map(acc => (
                <TableRow key={acc.id}>
                  <TableCell className="font-mono text-xs">
                    {acc.id.slice(0, 16)}…
                  </TableCell>
                  <TableCell>{acc.agentCode ?? "—"}</TableCell>
                  <TableCell>{acc.ledger}</TableCell>
                  <TableCell>₦{acc.balanceNGN.toLocaleString()}</TableCell>
                  <TableCell className="text-xs">
                    {new Date(acc.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Kafka Tab ────────────────────────────────────────────────────────────────
function KafkaTab() {
  const [dlqTopic, setDlqTopic] = useState<string>("all");
  const summary = trpc.kafka.summary.useQuery();
  const groups = trpc.kafka.consumerGroups.useQuery();
  const topics = trpc.kafka.topics.useQuery();
  const dlq = trpc.kafka.dlqMessages.useQuery({
    topic: dlqTopic === "all" ? undefined : dlqTopic,
    limit: 20,
  });
  const drainDlq = trpc.kafka.drainDlq.useMutation({
    onSuccess: d => {
      toast.success(`Requeued ${d.requeued} messages`);
      dlq.refetch();
    },
  });
  const purgeDlq = trpc.kafka.purgeDlq.useMutation({
    onSuccess: d => {
      toast.success(`Purged ${d.purged} resolved messages`);
      dlq.refetch();
    },
  });

  const s = summary.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Broker"
          value={s?.brokerOnline ? "Online" : "Offline"}
          icon={Server}
          color={s?.brokerOnline ? "text-green-500" : "text-red-500"}
        />
        <MetricCard
          title="Total Lag"
          value={s?.totalLag ?? 0}
          sub="Messages behind"
          icon={Clock}
          color="text-yellow-500"
        />
        <MetricCard
          title="Active Consumers"
          value={s?.activeConsumers ?? 0}
          icon={Activity}
          color="text-green-500"
        />
        <MetricCard
          title="DLQ Pending"
          value={s?.dlqPending ?? 0}
          sub="Dead-letter queue"
          icon={AlertTriangle}
          color="text-red-500"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricCard
          title="Topics"
          value={s?.totalTopics ?? 0}
          icon={Database}
        />
        <MetricCard
          title="Consumer Groups"
          value={s?.totalConsumerGroups ?? 0}
          icon={Zap}
          color="text-purple-500"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Consumer Groups</CardTitle>
        </CardHeader>
        <CardContent>
          {groups.data?.source === "static" && (
            <p className="text-sm text-muted-foreground mb-2">
              Kafka/Fluvio offline — showing static group definitions
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Group ID</TableHead>
                <TableHead>Topic</TableHead>
                <TableHead>Lag</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.data?.groups.map((g, i) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs">
                    {g.groupId}
                  </TableCell>
                  <TableCell className="text-xs">{g.topic}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        g.lag > 100
                          ? "destructive"
                          : g.lag > 10
                            ? "secondary"
                            : "default"
                      }
                    >
                      {g.lag}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={g.status === "active" ? "default" : "outline"}
                    >
                      {g.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Dead-Letter Queue</CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  drainDlq.mutate({
                    topic: dlqTopic === "all" ? undefined : dlqTopic,
                  })
                }
                disabled={drainDlq.isPending}
              >
                <Play className="w-3 h-3 mr-1" />
                Drain
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => purgeDlq.mutate({ olderThanDays: 30 })}
                disabled={purgeDlq.isPending}
              >
                <Trash2 className="w-3 h-3 mr-1" />
                Purge (30d)
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Select value={dlqTopic} onValueChange={setDlqTopic}>
            <SelectTrigger className="w-64 mb-4">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Topics</SelectItem>
              {topics.data?.topics.map(t => (
                <SelectItem key={t.name} value={t.name}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Topic</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Error</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dlq.data?.messages.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-center text-muted-foreground"
                  >
                    No DLQ messages
                  </TableCell>
                </TableRow>
              )}
              {dlq.data?.messages.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs font-mono">{m.topic}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        m.status === "failed" ? "destructive" : "secondary"
                      }
                    >
                      {m.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground max-w-xs truncate">
                    {m.errorMessage ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(m.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Temporal Tab ─────────────────────────────────────────────────────────────
function TemporalTab() {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [startInput, setStartInput] = useState({ type: "", id: "" });

  const summary = trpc.temporal.summary.useQuery();
  const types = trpc.temporal.workflowTypes.useQuery();
  const workflows = trpc.temporal.list.useQuery({
    status: statusFilter !== "all" ? (statusFilter as any) : undefined,
    workflowType: typeFilter !== "all" ? typeFilter : undefined,
    limit: 20,
  });
  const startWf = trpc.temporal.start.useMutation({
    onSuccess: d => {
      toast.success(
        d.started ? `Started ${startInput.type}` : "Temporal unavailable"
      );
      workflows.refetch();
    },
  });
  const terminateWf = trpc.temporal.terminate.useMutation({
    onSuccess: d => {
      toast.success(
        d.terminated ? "Workflow terminated" : "Temporal unavailable"
      );
      workflows.refetch();
    },
  });

  const s = summary.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricCard
          title="Temporal"
          value={s?.healthy ? "Online" : "Offline"}
          icon={Activity}
          color={s?.healthy ? "text-green-500" : "text-red-500"}
        />
        <MetricCard
          title="Running"
          value={s?.running ?? 0}
          icon={Play}
          color="text-blue-500"
        />
        <MetricCard
          title="Failed"
          value={s?.failed ?? 0}
          icon={AlertTriangle}
          color="text-red-500"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Start Workflow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2 flex-wrap">
            <Select
              value={startInput.type}
              onValueChange={v => setStartInput(p => ({ ...p, type: v }))}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select workflow type" />
              </SelectTrigger>
              <SelectContent>
                {types.data?.types.map(t => (
                  <SelectItem key={t.type} value={t.type}>
                    {t.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="Workflow ID (optional)"
              value={startInput.id}
              onChange={e => setStartInput(p => ({ ...p, id: e.target.value }))}
              className="w-64"
            />
            <Button
              onClick={() =>
                startWf.mutate({
                  workflowType: startInput.type,
                  workflowId: startInput.id || undefined,
                })
              }
              disabled={!startInput.type || startWf.isPending}
            >
              <Play className="w-4 h-4 mr-2" />
              Start
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-base">Workflows</CardTitle>
            <div className="flex gap-2">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {[
                    "RUNNING",
                    "COMPLETED",
                    "FAILED",
                    "CANCELED",
                    "TERMINATED",
                  ].map(s => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {types.data?.types.map(t => (
                    <SelectItem key={t.type} value={t.type}>
                      {t.type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {workflows.data?.source === "offline" && (
            <p className="text-sm text-muted-foreground mb-2">
              Temporal server offline — no live data available
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workflow ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.data?.workflows.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-muted-foreground"
                  >
                    No workflows found
                  </TableCell>
                </TableRow>
              )}
              {workflows.data?.workflows.map(w => (
                <TableRow key={w.execution.runId}>
                  <TableCell className="font-mono text-xs max-w-xs truncate">
                    {w.execution.workflowId}
                  </TableCell>
                  <TableCell className="text-xs">{w.type.name}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        w.status === "RUNNING"
                          ? "default"
                          : w.status === "FAILED"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {w.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {new Date(w.startTime).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    {w.status === "RUNNING" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() =>
                          terminateWf.mutate({
                            workflowId: w.execution.workflowId,
                          })
                        }
                      >
                        <StopCircle className="w-3 h-3" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Vault Tab ────────────────────────────────────────────────────────────────
function VaultTab() {
  const health = trpc.vault.health.useQuery();
  const paths = trpc.vault.listPaths.useQuery();
  const summary = trpc.vault.summary.useQuery();
  const rotate = trpc.vault.rotateSecret.useMutation({
    onSuccess: d => {
      toast.success(
        d.rotated ? `Rotated: ${d.path}` : `Rotation failed: ${d.error}`
      );
      paths.refetch();
    },
  });

  const h = health.data;
  const s = summary.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MetricCard
          title="Vault"
          value={h?.healthy ? "Unsealed" : h?.sealed ? "Sealed" : "Offline"}
          icon={Shield}
          color={h?.healthy ? "text-green-500" : "text-red-500"}
        />
        <MetricCard title="Version" value={h?.version ?? "—"} icon={Server} />
        <MetricCard title="Total Paths" value={s?.totalPaths ?? 0} icon={Key} />
        <MetricCard
          title="Rotatable"
          value={s?.rotatablePaths ?? 0}
          sub="Can be rotated via API"
          icon={RotateCcw}
          color="text-blue-500"
        />
      </div>

      {h?.sealed && (
        <div className="bg-destructive/10 border border-destructive rounded-lg p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-destructive" />
          <div>
            <p className="font-semibold text-destructive">Vault is sealed</p>
            <p className="text-sm text-muted-foreground">
              Run `vault operator unseal` to restore secret access.
            </p>
          </div>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Secret Paths</CardTitle>
        </CardHeader>
        <CardContent>
          {!paths.data?.vaultOnline && (
            <p className="text-sm text-muted-foreground mb-2">
              Vault offline — showing static path definitions
            </p>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Path</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paths.data?.paths.map(p => (
                <TableRow key={p.path}>
                  <TableCell className="font-mono text-xs">
                    {p.path.replace("secret/data/insureportal/", "")}
                  </TableCell>
                  <TableCell className="text-sm">{p.description}</TableCell>
                  <TableCell>
                    <Badge variant="outline">v{p.currentVersion}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">
                    {p.lastUpdated
                      ? new Date(p.lastUpdated).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell>
                    {p.rotatable && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          rotate.mutate({
                            path: p.path,
                            reason: "Manual rotation via UI",
                          })
                        }
                        disabled={rotate.isPending}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Rotate
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function InfrastructureDashboard() {
  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Infrastructure Dashboard</h1>
          <p className="text-muted-foreground">
            TigerBeetle ledger, Kafka consumers, Temporal workflows, and Vault
            secrets
          </p>
        </div>

        <Tabs defaultValue="tigerbeetle">
          <TabsList className="grid grid-cols-4 w-full max-w-2xl">
            <TabsTrigger value="tigerbeetle" className="gap-1">
              <Database className="w-4 h-4" />
              Ledger
            </TabsTrigger>
            <TabsTrigger value="kafka" className="gap-1">
              <Activity className="w-4 h-4" />
              Kafka
            </TabsTrigger>
            <TabsTrigger value="temporal" className="gap-1">
              <Zap className="w-4 h-4" />
              Temporal
            </TabsTrigger>
            <TabsTrigger value="vault" className="gap-1">
              <Shield className="w-4 h-4" />
              Vault
            </TabsTrigger>
          </TabsList>

          <TabsContent value="tigerbeetle" className="mt-6">
            <TigerBeetleTab />
          </TabsContent>
          <TabsContent value="kafka" className="mt-6">
            <KafkaTab />
          </TabsContent>
          <TabsContent value="temporal" className="mt-6">
            <TemporalTab />
          </TabsContent>
          <TabsContent value="vault" className="mt-6">
            <VaultTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
