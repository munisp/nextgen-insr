/**
 * Admin User Management — InsurePortal InsurePortal Platform (Sprint 89)
 * Dedicated user management page for admins with search, filter, role management.
 */
import { useState, useMemo } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Shield, Users, Search, UserCog, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function AdminUserManagement() {
  const { user } = useAuth();
  const [roleFilter, setRoleFilter] = useState<"admin" | "user" | undefined>(
    undefined
  );
  const [searchTerm, setSearchTerm] = useState("");

  if (user && user.role !== "admin") {
    return (
      <DashboardLayout>
        <div className="text-center py-20">
          <Shield className="h-16 w-16 text-red-500/30 mx-auto mb-4" />
          <h1 className="text-xl font-bold">Access Denied</h1>
          <p className="text-sm text-muted-foreground mt-2">
            Administrator privileges required.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  const { data, refetch, isLoading } = trpc.adminDashboard.listUsers.useQuery({
    limit: 100,
    offset: 0,
    role: roleFilter,
  });

  const updateRole = trpc.adminDashboard.updateUserRole.useMutation({
    onSuccess: () => {
      toast.success("Role updated");
      refetch();
    },
    onError: err => toast.error(err.message),
  });

  const filteredUsers = useMemo(() => {
    if (!data?.users) return [];
    if (!searchTerm) return data.users;
    const term = searchTerm.toLowerCase();
    return data.users.filter(
      u =>
        (u.name || "").toLowerCase().includes(term) ||
        (u.email || "").toLowerCase().includes(term) ||
        String(u.id).includes(term)
    );
  }, [data?.users, searchTerm]);

  return (
    <DashboardLayout>
      <div className="space-y-6 max-w-7xl mx-auto">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <UserCog className="h-6 w-6 text-primary" />
            User Management
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage platform users, roles, and permissions
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search users..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex gap-1">
            {(["all", "admin", "user"] as const).map(f => (
              <Button
                key={f}
                size="sm"
                variant={
                  (!roleFilter && f === "all") || roleFilter === f
                    ? "default"
                    : "outline"
                }
                onClick={() => setRoleFilter(f === "all" ? undefined : f)}
              >
                {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
              </Button>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  ID
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Name
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Email
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Role
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Plan
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Joined
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Last Active
                </th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filteredUsers.map(u => (
                <tr key={u.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 text-xs font-mono">{u.id}</td>
                  <td className="px-4 py-3 text-xs font-medium">
                    {u.name || "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {u.email || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px]",
                        u.role === "admin"
                          ? "text-amber-400 border-amber-500/30"
                          : "text-blue-400 border-blue-500/30"
                      )}
                    >
                      {u.role}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs">{u.stripePlanId || "—"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {u.createdAt
                      ? new Date(u.createdAt).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {u.lastSignedIn
                      ? new Date(u.lastSignedIn).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {u.id !== user?.id && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-xs h-7"
                        onClick={() =>
                          updateRole.mutate({
                            userId: u.id,
                            role: u.role === "admin" ? "user" : "admin",
                          })
                        }
                        disabled={updateRole.isPending}
                      >
                        {updateRole.isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : u.role === "admin" ? (
                          "Demote"
                        ) : (
                          "Promote"
                        )}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredUsers.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="px-4 py-8 text-center text-xs text-muted-foreground"
                  >
                    {isLoading ? "Loading..." : "No users found"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardLayout>
  );
}
