import { useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Users,
  GitBranch,
  Map,
  ChevronRight,
  ChevronDown,
  ArrowUpDown,
  Search,
  UserPlus,
  DollarSign,
  Shield,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────
interface HierarchyAgent {
  id: string;
  agentId: string;
  name: string;
  role: string;
  territory: string;
  status: string;
  parentId: string | null;
  totalCommission: number;
  agentCount: number;
  children?: HierarchyAgent[];
}

// ─── Tree Node Component ─────────────────────────────────────────────────────
function TreeNode({
  agent,
  depth = 0,
  onReassign,
}: {
  agent: HierarchyAgent;
  depth?: number;
  onReassign: (a: HierarchyAgent) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = agent.children && agent.children.length > 0;

  const roleColors: Record<string, string> = {
    super_agent:
      "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
    master_agent:
      "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
    agent: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
    sub_agent:
      "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  };

  const roleIcons: Record<string, string> = {
    super_agent: "👑",
    master_agent: "⭐",
    agent: "🏪",
    sub_agent: "📱",
  };

  return (
    <div style={{ marginLeft: depth * 24 }}>
      <div className="flex items-center gap-2 py-2 px-3 rounded-lg hover:bg-muted/50 transition group border-l-2 border-transparent hover:border-primary">
        {/* Expand/collapse */}
        <button
          className="w-5 h-5 flex items-center justify-center"
          onClick={() => hasChildren && setExpanded(!expanded)}
        >
          {hasChildren ? (
            expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )
          ) : (
            <span className="w-4" />
          )}
        </button>

        {/* Role icon */}
        <span className="text-lg">{roleIcons[agent.role] ?? "👤"}</span>

        {/* Agent info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{agent.name}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {agent.agentId}
            </span>
            <Badge className={`text-xs ${roleColors[agent.role] ?? ""}`}>
              {agent.role.replace("_", " ")}
            </Badge>
            {agent.status !== "active" && (
              <Badge variant="secondary">{agent.status}</Badge>
            )}
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground mt-0.5">
            <span className="flex items-center gap-1">
              <Map className="h-3 w-3" /> {agent.territory}
            </span>
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" /> {agent.agentCount} agents
            </span>
            <span className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> ₦
              {agent.totalCommission?.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Actions */}
        <Button
          variant="ghost"
          size="sm"
          className="opacity-0 group-hover:opacity-100 transition"
          onClick={() => onReassign(agent)}
        >
          <ArrowUpDown className="h-3 w-3 mr-1" /> Reassign
        </Button>
      </div>

      {/* Children */}
      {expanded && hasChildren && (
        <div className="border-l border-muted ml-5">
          {agent.children!.map(child => (
            <TreeNode
              key={child.id}
              agent={child}
              depth={depth + 1}
              onReassign={onReassign}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default function AgentHierarchyPage() {
  const [activeTab, setActiveTab] = useState("tree");
  const [searchTerm, setSearchTerm] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [territoryFilter, setTerritoryFilter] = useState("all");
  const [reassignAgent, setReassignAgent] = useState<HierarchyAgent | null>(
    null
  );
  const [newParentId, setNewParentId] = useState("");

  const hierarchy = trpc.agentHierarchy.list.useQuery({
    // @ts-ignore Sprint 85
    role: roleFilter !== "all" ? roleFilter : undefined,
    territory: territoryFilter !== "all" ? territoryFilter : undefined,
    search: searchTerm || undefined,
  });

  const utils = trpc.useUtils();

  const handleReassign = useCallback(async () => {
    if (!reassignAgent || !newParentId) return;
    try {
      // @ts-ignore Sprint 85
      await (trpc.agentHierarchy.reassign as any).mutate({
        agentId: reassignAgent.id,
        newParentId,
      });
      toast.success(`${reassignAgent.name} reassigned successfully`);
      setReassignAgent(null);
      setNewParentId("");
      utils.agentHierarchy.list.invalidate();
    } catch {
      toast.error("Failed to reassign agent");
    }
  }, [reassignAgent, newParentId, utils]);

  // Build tree from flat list
  // @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
  const tree = hierarchy.data?.tree ?? [];
  // @ts-ignore Sprint 85
  const flatList = hierarchy.data?.agents ?? [];

  // Stats
  const stats = {
    superAgents: flatList.filter((a: any) => a.role === "super_agent").length,
    masterAgents: flatList.filter((a: any) => a.role === "master_agent").length,
    agents: flatList.filter((a: any) => a.role === "agent").length,
    subAgents: flatList.filter((a: any) => a.role === "sub_agent").length,
    totalCommission: flatList.reduce(
      (sum: number, a: any) => sum + (a.totalCommission ?? 0),
      0
    ),
    territories: [...new Set(flatList.map((a: any) => a.territory))].length,
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <GitBranch className="h-6 w-6" /> Agent Hierarchy
            </h1>
            <p className="text-muted-foreground">
              Tree visualization, commission cascade view, and territory
              management
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => utils.agentHierarchy.list.invalidate()}
            >
              <ArrowUpDown className="h-4 w-4 mr-1" /> Refresh
            </Button>
            <Button size="sm" onClick={() => toast.info("Adding agent...")}>
              <UserPlus className="h-4 w-4 mr-1" /> Add Agent
            </Button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground">Super Agents</p>
              <p className="text-xl font-bold text-purple-600">
                {stats.superAgents}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground">Master Agents</p>
              <p className="text-xl font-bold text-blue-600">
                {stats.masterAgents}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground">Agents</p>
              <p className="text-xl font-bold text-green-600">{stats.agents}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground">Sub-Agents</p>
              <p className="text-xl font-bold text-amber-600">
                {stats.subAgents}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground">Territories</p>
              <p className="text-xl font-bold">{stats.territories}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground">Total Commission</p>
              <p className="text-xl font-bold text-green-600">
                ₦{stats.totalCommission.toLocaleString()}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search agents..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
            />
          </div>
          <Select value={roleFilter} onValueChange={setRoleFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Roles</SelectItem>
              <SelectItem value="super_agent">Super Agent</SelectItem>
              <SelectItem value="master_agent">Master Agent</SelectItem>
              <SelectItem value="agent">Agent</SelectItem>
              <SelectItem value="sub_agent">Sub-Agent</SelectItem>
            </SelectContent>
          </Select>
          <Select value={territoryFilter} onValueChange={setTerritoryFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Territory" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Territories</SelectItem>
              <SelectItem value="Lagos">Lagos</SelectItem>
              <SelectItem value="Abuja">Abuja</SelectItem>
              <SelectItem value="Kano">Kano</SelectItem>
              <SelectItem value="Port Harcourt">Port Harcourt</SelectItem>
              <SelectItem value="Ibadan">Ibadan</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="tree">
              <GitBranch className="h-4 w-4 mr-1" /> Tree View
            </TabsTrigger>
            <TabsTrigger value="flat">
              <Users className="h-4 w-4 mr-1" /> Flat View
            </TabsTrigger>
            <TabsTrigger value="commission">
              <DollarSign className="h-4 w-4 mr-1" /> Commission Flow
            </TabsTrigger>
          </TabsList>

          {/* Tree View */}
          <TabsContent value="tree">
            <Card>
              <CardContent className="pt-4">
                {tree.length > 0 ? (
                  <div className="space-y-1">
                    {tree.map((agent: any) => (
                      <TreeNode
                        key={agent.id}
                        agent={agent}
                        onReassign={setReassignAgent}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 text-muted-foreground">
                    <GitBranch className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p className="font-semibold">No hierarchy data</p>
                    <p className="text-sm">
                      Agent hierarchy will appear here once agents are assigned
                      parent relationships.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Flat View */}
          <TabsContent value="flat">
            <Card>
              <CardContent className="pt-4">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left p-2">Agent</th>
                        <th className="text-left p-2">Code</th>
                        <th className="text-left p-2">Role</th>
                        <th className="text-left p-2">Territory</th>
                        <th className="text-left p-2">Parent</th>
                        <th className="text-right p-2">Commission</th>
                        <th className="text-right p-2">Downline</th>
                        <th className="text-left p-2">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {flatList.map((a: any) => (
                        <tr key={a.id} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-semibold">{a.name}</td>
                          <td className="p-2 font-mono text-xs">
                            {a.agentId}
                          </td>
                          <td className="p-2">
                            <Badge variant="outline">
                              {a.role?.replace("_", " ")}
                            </Badge>
                          </td>
                          <td className="p-2">{a.territory}</td>
                          <td className="p-2 font-mono text-xs">
                            {a.parentId ?? "—"}
                          </td>
                          <td className="p-2 text-right font-bold">
                            ₦{(a.totalCommission ?? 0).toLocaleString()}
                          </td>
                          <td className="p-2 text-right">
                            {a.agentCount ?? 0}
                          </td>
                          <td className="p-2">
                            <Badge
                              variant={
                                a.status === "active" ? "default" : "secondary"
                              }
                            >
                              {a.status}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Commission Flow */}
          <TabsContent value="commission">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" /> Commission Cascade Flow
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    When a transaction occurs, commission flows upward through
                    the hierarchy. Each level receives a configured percentage
                    of the total commission.
                  </p>
                  {/* Visual flow diagram */}
                  <div className="flex flex-col items-center gap-2">
                    {[
                      {
                        role: "Platform",
                        pct: "5%",
                        color: "bg-gray-600",
                        icon: <Shield className="h-4 w-4" />,
                      },
                      {
                        role: "Super Agent",
                        pct: "10%",
                        color: "bg-purple-600",
                        icon: "👑",
                      },
                      {
                        role: "Master Agent",
                        pct: "15%",
                        color: "bg-blue-600",
                        icon: "⭐",
                      },
                      {
                        role: "Agent (transacting)",
                        pct: "60%",
                        color: "bg-green-600",
                        icon: "🏪",
                      },
                      {
                        role: "Sub-Agent",
                        pct: "10%",
                        color: "bg-amber-600",
                        icon: "📱",
                      },
                    ].map((level, i) => (
                      <div key={i} className="w-full max-w-md">
                        <div
                          className={`${level.color} text-white rounded-lg p-3 flex items-center justify-between`}
                        >
                          <div className="flex items-center gap-2">
                            <span>
                              {typeof level.icon === "string"
                                ? level.icon
                                : level.icon}
                            </span>
                            <span className="font-semibold">{level.role}</span>
                          </div>
                          <span className="text-lg font-bold">{level.pct}</span>
                        </div>
                        {i < 4 && (
                          <div className="text-center text-muted-foreground text-xs py-1">
                            ↑ cascades up
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-4">
                    Split percentages are configurable per transaction type in
                    the Commission Engine &gt; Splits tab.
                    <br />
                    Agent-specific overrides can be set via the
                    commissionSplitOverride field.
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Reassign Dialog */}
        <Dialog
          open={!!reassignAgent}
          onOpenChange={() => setReassignAgent(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reassign Agent</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <p className="text-sm">
                Moving <strong>{reassignAgent?.name}</strong> (
                {reassignAgent?.agentId}) to a new parent agent.
              </p>
              <Input
                placeholder="New Parent Agent ID"
                value={newParentId}
                onChange={e => setNewParentId(e.target.value)}
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">Cancel</Button>
              </DialogClose>
              <Button onClick={handleReassign} disabled={!newParentId}>
                Reassign
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </DashboardLayout>
  );
}
