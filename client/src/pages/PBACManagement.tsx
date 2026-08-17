/**
 * Sprint 92 — PBAC Role Management Interface
 *
 * Intuitive interface for managing the 7-role hierarchy, allowing administrators
 * to assign, modify, and review user permissions with visual hierarchy display.
 */
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
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
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Users,
  UserCog,
  Eye,
  Crown,
  Star,
  Briefcase,
  User,
  FileSearch,
  Monitor,
  ChevronDown,
  ChevronRight,
  Lock,
  Unlock,
  Search,
  Plus,
  Minus,
  Clock,
  History,
  ArrowDown,
  AlertTriangle,
} from "lucide-react";

const roleIcons: Record<string, React.ReactNode> = {
  super_admin: <Crown className="h-5 w-5 text-purple-500" />,
  admin: <ShieldCheck className="h-5 w-5 text-red-500" />,
  supervisor: <Star className="h-5 w-5 text-orange-500" />,
  agent_manager: <Briefcase className="h-5 w-5 text-blue-500" />,
  agent: <User className="h-5 w-5 text-green-500" />,
  auditor: <FileSearch className="h-5 w-5 text-indigo-500" />,
  viewer: <Monitor className="h-5 w-5 text-gray-500" />,
};

const roleColors: Record<string, string> = {
  super_admin: "bg-purple-500/10 border-purple-500/30 text-purple-700",
  admin: "bg-red-500/10 border-red-500/30 text-red-700",
  supervisor: "bg-orange-500/10 border-orange-500/30 text-orange-700",
  agent_manager: "bg-blue-500/10 border-blue-500/30 text-blue-700",
  agent: "bg-green-500/10 border-green-500/30 text-green-700",
  auditor: "bg-indigo-500/10 border-indigo-500/30 text-indigo-700",
  viewer: "bg-gray-500/10 border-gray-500/30 text-gray-700",
};


export default function PBACManagement() {
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [assignDialog, setAssignDialog] = useState(false);
  const [assignUserId, setAssignUserId] = useState("");
  const [assignRoleId, setAssignRoleId] = useState("");
  const [permDialog, setPermDialog] = useState<string | null>(null);
  const [permSearch, setPermSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set()
  );

  // Queries
  const rolesQuery = trpc.pbacManagement.listRoles.useQuery();
  const permissionsQuery = trpc.pbacManagement.listPermissions.useQuery();
  const usersQuery = trpc.pbacManagement.listUserAssignments.useQuery();
  const auditQuery = trpc.pbacManagement.getAuditLog.useQuery();
  const roleDetail = trpc.pbacManagement.getRoleDetail.useQuery(
    { roleId: selectedRole ?? "" },
    { enabled: !!selectedRole }
  );

  // F-12 (wave-4b): honest typed bindings to the real {data, total} shapes.
  type RoleRow = {
    id: string;
    name?: string;
    description?: string;
    permissions?: string[];
    inheritsFrom?: string;
  };
  type AssignmentRow = {
    id: string;
    userId?: string;
    role?: string;
    assignedAt?: string;
    // F-12: expiresAt is never stored by assignRole — assignments do not
    // expire on this platform.
    expiresAt?: string;
  };
  const roles: RoleRow[] = rolesQuery.data?.data ?? [];
  const roleDetailRow: RoleRow | undefined = roleDetail.data?.data?.[0];
  const assignmentsAll: AssignmentRow[] = usersQuery.data?.data ?? [];
  const assignments = userSearch
    ? assignmentsAll.filter(
        a =>
          a.id.toLowerCase().includes(userSearch.toLowerCase()) ||
          (a.userName ?? "").toLowerCase().includes(userSearch.toLowerCase()) ||
          (a.role ?? "").toLowerCase().includes(userSearch.toLowerCase())
      )
    : assignmentsAll;
  const auditRows = auditQuery.data?.data ?? [];
  const permStrings: string[] = permissionsQuery.data?.data ?? [];

  // Mutations
  const assignMut = trpc.pbacManagement.assignRole.useMutation({
    onSuccess: () => {
      toast.success("Role assigned: User role has been updated successfully.");
      rolesQuery.refetch();
      usersQuery.refetch();
      auditQuery.refetch();
      setAssignDialog(false);
      setAssignUserId("");
      setAssignRoleId("");
    },
    onError: (err: any) => {
      toast.error(`Assignment failed: ${err.message}`);
    },
  });

  // F-12 (wave-4b): the real modifyPermissions proc operates on stored
  // policies ({policyId, actions}) — the page's per-role add/remove toggle
  // semantics are not delivered; fail loud on interaction.
  const modifyPermsMut = {
    mutate: (_input?: unknown) =>
      toast.error("Per-role permission toggling is not delivered on this deployment"),
    isPending: false,
  };

  const removeMut = trpc.pbacManagement.removeAssignment.useMutation({
    onSuccess: () => {
      toast.success("Role removed: User has been downgraded to Viewer.");
      rolesQuery.refetch();
      usersQuery.refetch();
      auditQuery.refetch();
    },
  });

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const currentRolePerms = useMemo(() => {
    return new Set(roleDetailRow?.permissions ?? []);
  }, [roleDetailRow]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            PBAC Role Management
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage the 7-role hierarchy, assign permissions, and review access
            controls
          </p>
        </div>
        <Button onClick={() => setAssignDialog(true)}>
          <Plus className="h-4 w-4 mr-1" /> Assign Role
        </Button>
      </div>

      {/* Role Hierarchy Visualization */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Role Hierarchy</CardTitle>
          <CardDescription>
            Click a role to view details and manage permissions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-1">
            {roles.map((role, idx: number) => (
              <div
                key={role.id}
                className="flex flex-col items-center w-full max-w-md"
              >
                {idx > 0 && role.inheritsFrom && (
                  <ArrowDown className="h-4 w-4 text-muted-foreground my-0.5" />
                )}
                <button
                  onClick={() =>
                    setSelectedRole(role.id === selectedRole ? null : role.id)
                  }
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all hover:shadow-md ${
                    selectedRole === role.id
                      ? `${roleColors[role.id] ?? ""} border-2 shadow-md`
                      : "border-border hover:border-primary/30"
                  }`}
                >
                  <div className="shrink-0">
                    {roleIcons[role.id] ?? <Shield className="h-5 w-5" />}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">
                        {role.name ?? role.id}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {role.description}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    {/* F-12: no per-role user-count source is delivered */}
                    <span className="text-xs text-muted-foreground">
                      {role.permissions?.length ?? 0} perms
                    </span>
                  </div>
                </button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Role Detail + Users + Permissions Tabs */}
      {selectedRole && (
        <Tabs defaultValue="users" className="space-y-4">
          <TabsList>
            <TabsTrigger value="users">
              Users ({assignments.length})
            </TabsTrigger>
            <TabsTrigger value="permissions">
              Permissions ({roleDetailRow?.permissions?.length ?? 0})
            </TabsTrigger>
            <TabsTrigger value="audit">Audit Log</TabsTrigger>
          </TabsList>

          {/* Users Tab */}
          <TabsContent value="users" className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search users..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">User</th>
                    <th className="text-left p-3 font-medium">Role</th>
                    <th className="text-left p-3 font-medium">Assigned By</th>
                    <th className="text-left p-3 font-medium">Assigned</th>
                    <th className="text-left p-3 font-medium">Expires</th>
                    <th className="text-right p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.map(user => (
                    <tr
                      key={user.id}
                      className="border-t hover:bg-muted/30"
                    >
                      <td className="p-3">
                        <div>
                          <span className="font-medium">{user.userId ?? user.id}</span>

                        </div>
                      </td>
                      <td className="p-3">
                        <Badge variant="outline" className="gap-1">
                          {user.role ?? "—"}
                        </Badge>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {/* F-12: the assignment blob stores no assignedBy */}
                        —
                      </td>
                      <td className="p-3 text-muted-foreground text-xs">
                        {user.assignedAt ? new Date(user.assignedAt).toLocaleDateString() : "—"}
                      </td>
                      <td className="p-3">
                        {user.expiresAt ? (
                          <Badge variant="outline" className="text-xs">
                            <Clock className="h-3 w-3 mr-1" />
                            {new Date(user.expiresAt).toLocaleDateString()}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Never
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setAssignUserId(user.id.toString());
                              setAssignRoleId(user.role ?? "");
                              setAssignDialog(true);
                            }}
                          >
                            <UserCog className="h-3 w-3 mr-1" /> Change
                          </Button>
                          {user.role !== "viewer" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs text-red-600 hover:text-red-700"
                              onClick={() =>
                                removeMut.mutate({ userId: user.id })
                              }
                            >
                              <Minus className="h-3 w-3 mr-1" /> Demote
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {assignments.length === 0 && (
                    <tr>
                      <td
                        colSpan={6}
                        className="p-8 text-center text-muted-foreground"
                      >
                        No users assigned to this role
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>

          {/* Permissions Tab */}
          <TabsContent value="permissions" className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search permissions..."
                  value={permSearch}
                  onChange={e => setPermSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              {roleDetailRow?.permissions?.includes("*") && (
                <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20">
                  <Crown className="h-3 w-3 mr-1" /> Wildcard Access (all
                  permissions)
                </Badge>
              )}
            </div>

            {/* F-12 (wave-4b): real permissions are flat "resource:action"
                strings — grouped client-side by resource; risk/descriptions
                have no delivered source and are omitted. */}
            {Object.entries(
              permStrings
                .filter(p =>
                  permSearch
                    ? p.toLowerCase().includes(permSearch.toLowerCase())
                    : true
                )
                .reduce<Record<string, string[]>>((acc, p) => {
                  const res = p.split(":")[0] ?? "other";
                  (acc[res] ??= []).push(p);
                  return acc;
                }, {})
            ).map(([category, perms]) => {
              if (perms.length === 0) return null;
              const isExpanded = expandedCategories.has(category);
              const grantedCount = perms.filter(
                p => currentRolePerms.has(p) || currentRolePerms.has("*")
              ).length;
              return (
                <Card key={category}>
                  <button
                    className="w-full flex items-center justify-between p-4 hover:bg-muted/30 transition-colors"
                    onClick={() => toggleCategory(category)}
                  >
                    <div className="flex items-center gap-2">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <span className="font-semibold text-sm">{category}</span>
                      <Badge variant="outline" className="text-xs">
                        {grantedCount}/{perms.length} granted
                      </Badge>
                    </div>
                  </button>
                  {isExpanded && (
                    <CardContent className="pt-0 pb-3">
                      <div className="space-y-2">
                        {perms.map(perm => {
                          const hasPermission =
                            currentRolePerms.has(perm) ||
                            currentRolePerms.has("*");
                          return (
                            <div
                              key={perm}
                              className="flex items-center gap-3 p-2 rounded hover:bg-muted/30"
                            >
                              <Checkbox
                                checked={hasPermission}
                                disabled={currentRolePerms.has("*")}
                                onCheckedChange={checked => {
                                  if (currentRolePerms.has("*")) return;
                                  if (!selectedRole) return;
                                  modifyPermsMut.mutate({
                                    roleId: selectedRole,
                                    addPermissions: checked ? [perm] : [],
                                    removePermissions: !checked ? [perm] : [],
                                  });
                                }}
                              />
                              <div className="flex-1 min-w-0">
                                <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">
                                  {perm}
                                </code>
                              </div>
                              {hasPermission ? (
                                <Unlock className="h-4 w-4 text-green-500 shrink-0" />
                              ) : (
                                <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  )}
                </Card>
              );
            })}
          </TabsContent>

          {/* Audit Log Tab */}
          <TabsContent value="audit" className="space-y-4">
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-3 font-medium">Action</th>
                    <th className="text-left p-3 font-medium">Performed By</th>
                    <th className="text-left p-3 font-medium">Target</th>
                    <th className="text-left p-3 font-medium">Details</th>
                    <th className="text-left p-3 font-medium">Time</th>
                  </tr>
                </thead>
                <tbody>
                  {auditRows.map(entry => (
                    <tr key={entry.id} className="border-t hover:bg-muted/30">
                      <td className="p-3">
                        <Badge variant="outline" className="text-xs capitalize">
                          {entry.action.replace(/_/g, " ")}
                        </Badge>
                      </td>
                      <td className="p-3 font-medium">{entry.agentId ?? "—"}</td>
                      <td className="p-3 text-muted-foreground">
                        {entry.resourceId ?? "—"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground max-w-[300px] truncate">
                        {entry.metadata != null ? JSON.stringify(entry.metadata) : "—"}
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {entry.createdAt ? new Date(entry.createdAt).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                  {auditRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={5}
                        className="p-8 text-center text-muted-foreground"
                      >
                        No audit entries yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {!selectedRole && (
        <Card>
          <CardContent className="py-12 text-center">
            <Shield className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-lg font-semibold">Select a role to manage</p>
            <p className="text-sm text-muted-foreground mt-1">
              Click on any role in the hierarchy above to view users,
              permissions, and audit trail
            </p>
          </CardContent>
        </Card>
      )}

      {/* Assign Role Dialog */}
      <Dialog open={assignDialog} onOpenChange={setAssignDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign Role to User</DialogTitle>
            <DialogDescription>
              Select a user and role. Users can only be assigned roles below
              your own level.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">
                User ID
              </label>
              <Input
                placeholder="Enter user ID..."
                value={assignUserId}
                onChange={e => setAssignUserId(e.target.value)}
                type="number"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">Role</label>
              <Select value={assignRoleId} onValueChange={setAssignRoleId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role..." />
                </SelectTrigger>
                <SelectContent>
                  {rolesQuery.data?.data?.map((role: any) => (
                    <SelectItem key={role.id} value={role.id}>
                      <div className="flex items-center gap-2">
                        {roleIcons[role.id]}
                        <span>{role.displayName}</span>
                        <span className="text-xs text-muted-foreground">
                          (Level {role.level})
                        </span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (!assignUserId || !assignRoleId) return;
                assignMut.mutate({
                  userId: parseInt(assignUserId),
                  role: assignRoleId,
                });
              }}
              disabled={!assignUserId || !assignRoleId || assignMut.isPending}
            >
              Assign Role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
