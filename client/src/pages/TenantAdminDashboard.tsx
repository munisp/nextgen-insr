// @ts-nocheck
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  ArrowLeft,
  Building2,
  Eye,
  Globe,
  Palette,
  Plus,
  Settings,
  Shield,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";

// Mock tenant ID for demo — in production, derived from auth context
const DEMO_TENANT_ID = 1;

export default function TenantAdminDashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<
    "tenant_admin" | "tenant_operator" | "tenant_viewer"
  >("tenant_viewer");

  const dashboard = trpc.tenantAdmin.dashboard.useQuery({
    tenantId: DEMO_TENANT_ID,
  });
  const usersList = trpc.tenantAdmin.listUsers.useQuery({
    tenantId: DEMO_TENANT_ID,
  });
  const settings = trpc.tenantAdmin.settings.useQuery({
    tenantId: DEMO_TENANT_ID,
  });
  const branding = trpc.partnerOnboarding.getBranding.useQuery({
    tenantId: DEMO_TENANT_ID,
  });
  const regionsList = trpc.partnerOnboarding.listRegions.useQuery({
    tenantId: DEMO_TENANT_ID,
  });
  const feesList = trpc.partnerOnboarding.listFees.useQuery({
    tenantId: DEMO_TENANT_ID,
  });

  const inviteUser = trpc.tenantAdmin.inviteUser.useMutation({
    onSuccess: () => {
      toast.success("User invited successfully!");
      setInviteEmail("");
      setInviteName("");
      usersList.refetch();
      dashboard.refetch();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const removeUser = trpc.tenantAdmin.removeUser.useMutation({
    onSuccess: () => {
      toast.success("User removed");
      usersList.refetch();
      dashboard.refetch();
    },
  });

  const updateBranding = trpc.partnerOnboarding.updateBranding.useMutation({
    onSuccess: () => {
      toast.success("Branding updated!");
      branding.refetch();
    },
    onError: (err: any) => toast.error(err.message),
  });

  const toggleLive = trpc.tenantAdmin.toggleLive.useMutation({
    onSuccess: (data: any) => toast.success(data.message),
  });

  const d = dashboard.data;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-card/50 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Building2 className="h-5 w-5 text-primary" />
            <span className="font-bold">Tenant Admin Dashboard</span>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                toggleLive.mutate({ tenantId: DEMO_TENANT_ID, isLive: true })
              }
            >
              <Eye className="h-4 w-4 mr-1" /> Go Live
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="users">Sub-Users</TabsTrigger>
            <TabsTrigger value="branding">Branding</TabsTrigger>
            <TabsTrigger value="regions">Regions</TabsTrigger>
            <TabsTrigger value="fees">Fee Overrides</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Total Users
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">{d?.totalUsers ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Active Users
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-green-500">
                    {d?.activeUsers ?? 0}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Pending Invites
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-amber-500">
                    {d?.pendingInvites ?? 0}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">
                    Regions
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">
                    {regionsList.data?.length ?? 0}
                  </p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Shield className="h-4 w-4" /> Admins
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xl font-bold">{d?.admins ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Users className="h-4 w-4" /> Operators
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xl font-bold">{d?.operators ?? 0}</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
                    <Eye className="h-4 w-4" /> Viewers
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-xl font-bold">{d?.viewers ?? 0}</p>
                </CardContent>
              </Card>
            </div>

            {/* Recent Activity */}
            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
              </CardHeader>
              <CardContent>
                {d?.recentActivity && d.recentActivity.length > 0 ? (
                  <div className="space-y-3">
                    {d.recentActivity.map((a: any) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between py-2 border-b last:border-0"
                      >
                        <div>
                          <p className="text-sm font-medium">{a.details}</p>
                          <p className="text-xs text-muted-foreground">
                            {a.actorEmail}
                          </p>
                        </div>
                        <Badge variant="outline" className="text-xs">
                          {a.action}
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No recent activity
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Sub-Users Tab */}
          <TabsContent value="users">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" /> Invite New User
                </CardTitle>
                <CardDescription>
                  Add team members to your tenant
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                  <div>
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={inviteName}
                      onChange={e => setInviteName(e.target.value)}
                      placeholder="John Doe"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Email</Label>
                    <Input
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="john@company.com"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Role</Label>
                    <select
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value as any)}
                      className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                    >
                      <option value="tenant_admin">Admin</option>
                      <option value="tenant_operator">Operator</option>
                      <option value="tenant_viewer">Viewer</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button
                      onClick={() =>
                        inviteUser.mutate({
                          tenantId: DEMO_TENANT_ID,
                          email: inviteEmail,
                          name: inviteName,
                          role: inviteRole,
                        })
                      }
                      disabled={
                        !inviteEmail || !inviteName || inviteUser.isPending
                      }
                      className="w-full"
                    >
                      <Plus className="h-4 w-4 mr-1" /> Invite
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Team Members</CardTitle>
              </CardHeader>
              <CardContent>
                {usersList.data?.items && usersList.data.items.length > 0 ? (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-4 py-2">Name</th>
                          <th className="text-left px-4 py-2">Email</th>
                          <th className="text-left px-4 py-2">Role</th>
                          <th className="text-left px-4 py-2">Status</th>
                          <th className="text-left px-4 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {usersList.data.items.map((u: any) => (
                          <tr key={u.id} className="border-t">
                            <td className="px-4 py-2 font-medium">{u.name}</td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {u.email}
                            </td>
                            <td className="px-4 py-2">
                              <Badge variant="outline">
                                {u.role.replace("tenant_", "")}
                              </Badge>
                            </td>
                            <td className="px-4 py-2">
                              <Badge
                                variant={u.isActive ? "default" : "secondary"}
                              >
                                {u.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </td>
                            <td className="px-4 py-2">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  removeUser.mutate({
                                    id: u.id,
                                    tenantId: DEMO_TENANT_ID,
                                  })
                                }
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No team members yet. Invite your first user above.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Branding Tab */}
          <TabsContent value="branding">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="h-5 w-5" /> Brand Customization
                </CardTitle>
                <CardDescription>
                  Update your white-label branding
                </CardDescription>
              </CardHeader>
              <CardContent>
                {branding.data ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      {[
                        {
                          label: "Primary",
                          key: "primaryColor",
                          value: branding.data.primaryColor,
                        },
                        {
                          label: "Secondary",
                          key: "secondaryColor",
                          value: branding.data.secondaryColor,
                        },
                        {
                          label: "Accent",
                          key: "accentColor",
                          value: branding.data.accentColor,
                        },
                        {
                          label: "Background",
                          key: "backgroundColor",
                          value: branding.data.backgroundColor,
                        },
                        {
                          label: "Text",
                          key: "textColor",
                          value: branding.data.textColor,
                        },
                      ].map(c => (
                        <div key={c.key} className="text-center">
                          <div
                            className="w-full h-10 rounded-lg border"
                            style={{ backgroundColor: c.value }}
                          />
                          <span className="text-xs text-muted-foreground">
                            {c.label}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label>Brand Name</Label>
                        <p className="font-medium">{branding.data.brandName}</p>
                      </div>
                      <div>
                        <Label>Font</Label>
                        <p className="font-medium">
                          {branding.data.fontFamily}
                        </p>
                      </div>
                      <div>
                        <Label>Tagline</Label>
                        <p className="text-sm text-muted-foreground">
                          {branding.data.tagline}
                        </p>
                      </div>
                      <div>
                        <Label>Status</Label>
                        <Badge
                          variant={
                            branding.data.isLive ? "default" : "secondary"
                          }
                        >
                          {branding.data.isLive ? "Live" : "Draft"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No branding configured yet.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Regions Tab */}
          <TabsContent value="regions">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe className="h-5 w-5" /> Remittance Regions
                </CardTitle>
              </CardHeader>
              <CardContent>
                {regionsList.data && regionsList.data.length > 0 ? (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-4 py-2">Route</th>
                          <th className="text-left px-4 py-2">Currencies</th>
                          <th className="text-left px-4 py-2">Limits</th>
                          <th className="text-left px-4 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {regionsList.data.map((c: any) => (
                          <tr key={c.id} className="border-t">
                            <td className="px-4 py-2 font-medium">
                              {c.sourceCountry} → {c.destinationCountry}
                            </td>
                            <td className="px-4 py-2">
                              {c.sourceCurrency} → {c.destinationCurrency}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {c.minAmount} - {c.maxAmount}
                            </td>
                            <td className="px-4 py-2">
                              <Badge
                                variant="outline"
                                className="text-green-500"
                              >
                                {c.status}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No regions configured. Add regions from the onboarding
                    flow.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Fees Tab */}
          <TabsContent value="fees">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Settings className="h-5 w-5" /> Fee Overrides
                </CardTitle>
              </CardHeader>
              <CardContent>
                {feesList.data && feesList.data.length > 0 ? (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-4 py-2">Type</th>
                          <th className="text-left px-4 py-2">Fee</th>
                          <th className="text-left px-4 py-2">Min/Max</th>
                          <th className="text-left px-4 py-2">Active</th>
                        </tr>
                      </thead>
                      <tbody>
                        {feesList.data.map((f: any) => (
                          <tr key={f.id} className="border-t">
                            <td className="px-4 py-2 font-medium">
                              {f.txType} ({f.feeType})
                            </td>
                            <td className="px-4 py-2">
                              {f.feeValue}
                              {f.feeType === "percentage" ? "%" : ""}
                            </td>
                            <td className="px-4 py-2 text-muted-foreground">
                              {f.minFee} - {f.maxFee}
                            </td>
                            <td className="px-4 py-2">
                              <Badge
                                variant={f.isActive ? "default" : "secondary"}
                              >
                                {f.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    No fee overrides configured.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <Card>
              <CardHeader>
                <CardTitle>Tenant Settings</CardTitle>
              </CardHeader>
              <CardContent>
                {settings.data ? (
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <Label>API Rate Limit</Label>
                      <p className="font-medium">
                        {settings.data.apiRateLimit}/min
                      </p>
                    </div>
                    <div>
                      <Label>Max Agents</Label>
                      <p className="font-medium">{settings.data.maxAgents}</p>
                    </div>
                    <div>
                      <Label>Max Daily Transactions</Label>
                      <p className="font-medium">
                        {settings.data.maxTransactionsPerDay.toLocaleString()}
                      </p>
                    </div>
                    <div>
                      <Label>Webhook Endpoints</Label>
                      <p className="font-medium">
                        {settings.data.webhookEndpoints}
                      </p>
                    </div>
                    <div>
                      <Label>Support Tier</Label>
                      <Badge>{settings.data.supportTier}</Badge>
                    </div>
                    <div>
                      <Label>Features</Label>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {settings.data.features.map((f: string) => (
                          <Badge key={f} variant="outline" className="text-xs">
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Loading settings...
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
