/**
 * PlatformHub.tsx — Central navigation hub for the InsurePortal Insurance Platform.
 *
 * Displays all available portals with role-based visibility:
 *   - All agents: POS Shell, Agent Banking Portal
 *   - Supervisor / Admin: Management Portal, Supervisor Dashboard
 *   - Admin only: Admin Panel, Super Admin Portal
 *   - All: Customer Portal (for assisted customer onboarding)
 */

import { useLocation } from "wouter";
import { usePosStore } from "@/store/posStore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface PortalCard {
  title: string;
  description: string;
  path: string;
  icon: string;
  badge?: string;
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
  roles: Array<"agent" | "admin" | "supervisor" | "all">;
  color: string;
}

const PORTALS: PortalCard[] = [
  {
    title: "POS Shell",
    description:
      "Core insurance terminal — cash in/out, transfers, airtime, bills, NFC & QR payments.",
    path: "/",
    icon: "🏧",
    badge: "Core",
    badgeVariant: "default",
    roles: ["all"],
    color: "from-blue-600/20 to-blue-800/10 border-blue-500/30",
  },
  {
    title: "Agent Banking Portal",
    description:
      "Finance dashboard, liquidity network, NFC/QR payments, scorecard, and training academy.",
    path: "/agent",
    icon: "💼",
    badge: "Agent",
    badgeVariant: "secondary",
    roles: ["all"],
    color: "from-emerald-600/20 to-emerald-800/10 border-emerald-500/30",
  },
  {
    title: "Customer Portal",
    description:
      "Assisted customer onboarding, account overview, transaction history, and KYC status.",
    path: "/customer",
    icon: "👤",
    badge: "Customer",
    badgeVariant: "secondary",
    roles: ["all"],
    color: "from-violet-600/20 to-violet-800/10 border-violet-500/30",
  },
  {
    title: "Supervisor Dashboard",
    description:
      "Agent oversight, dispute resolution, float approval, and team performance metrics.",
    path: "/supervisor",
    icon: "📊",
    badge: "Supervisor",
    badgeVariant: "outline",
    roles: ["supervisor", "admin"],
    color: "from-amber-600/20 to-amber-800/10 border-amber-500/30",
  },
  {
    title: "Management Portal",
    description:
      "Full platform management — agents, transactions, KYC, commissions, POS terminals, analytics.",
    path: "/management",
    icon: "⚙️",
    badge: "Admin",
    badgeVariant: "destructive",
    roles: ["admin"],
    color: "from-orange-600/20 to-orange-800/10 border-orange-500/30",
  },
  {
    title: "Admin Panel",
    description:
      "Fraud feed, audit log, agent directory, float top-up approvals, settlement controls.",
    path: "/admin",
    icon: "🛡️",
    badge: "Admin",
    badgeVariant: "destructive",
    roles: ["admin"],
    color: "from-red-600/20 to-red-800/10 border-red-500/30",
  },
  {
    title: "Super Admin Portal",
    description:
      "Multi-tenant management, platform-wide analytics, tenant provisioning, and system health.",
    path: "/super-admin",
    icon: "🌐",
    badge: "Super Admin",
    badgeVariant: "destructive",
    roles: ["admin"],
    color: "from-rose-600/20 to-rose-800/10 border-rose-500/30",
  },
  {
    title: "Data Lakehouse",
    description:
      "Bronze→Silver→Gold medallion pipeline. Sedona spatial heatmaps, DataFusion SQL console, daily snapshots on MinIO/Iceberg.",
    path: "/lakehouse",
    icon: "🏔️",
    badge: "Analytics",
    badgeVariant: "secondary",
    roles: ["admin"],
    color: "from-purple-600/20 to-purple-800/10 border-purple-500/30",
  },
  {
    title: "Webhook Manager",
    description:
      "Configure outbound webhooks, view delivery logs, retry failed events, and manage HMAC secrets.",
    path: "/webhooks",
    icon: "🔗",
    badge: "Integrations",
    badgeVariant: "secondary",
    roles: ["admin"],
    color: "from-cyan-600/20 to-cyan-800/10 border-cyan-500/30",
  },
  {
    title: "Commission Payouts",
    description:
      "Review, approve, and process agent commission payout requests with full audit trail.",
    path: "/commission-payouts",
    icon: "💰",
    badge: "Finance",
    badgeVariant: "secondary",
    roles: ["admin"],
    color: "from-green-600/20 to-green-800/10 border-green-500/30",
  },
  {
    title: "Agent Onboarding",
    description:
      "5-step wizard tracking Profile → KYC → Float → Terminal → Training for new agents.",
    path: "/agent-onboarding",
    icon: "📋",
    badge: "Operations",
    badgeVariant: "outline",
    roles: ["admin", "supervisor"],
    color: "from-orange-600/20 to-orange-800/10 border-orange-500/30",
  },
  {
    title: "Settlement Reconciliation",
    description:
      "Run daily reconciliation, identify discrepancies between expected and actual settlement amounts.",
    path: "/settlement-reconciliation",
    icon: "⚖️",
    badge: "Finance",
    badgeVariant: "secondary",
    roles: ["admin"],
    color: "from-indigo-600/20 to-indigo-800/10 border-indigo-500/30",
  },
  {
    title: "Referral Program",
    description:
      "Track agent referrals, activations, and bonus reward disbursements.",
    path: "/referral-program",
    icon: "🎁",
    badge: "Growth",
    badgeVariant: "outline",
    roles: ["admin"],
    color: "from-pink-600/20 to-pink-800/10 border-pink-500/30",
  },
  {
    title: "Audit Log",
    description:
      "Full platform audit trail with search, filter by event type, and CSV export for compliance.",
    path: "/admin/audit",
    icon: "🔍",
    badge: "Compliance",
    badgeVariant: "destructive",
    roles: ["admin"],
    color: "from-red-600/20 to-red-800/10 border-red-500/30",
  },
  {
    title: "Infrastructure",
    description:
      "TigerBeetle ledger, Kafka consumer lag, Temporal workflow management, and HashiCorp Vault secret rotation.",
    path: "/infrastructure",
    icon: "⚙️",
    badge: "DevOps",
    badgeVariant: "secondary",
    roles: ["admin"],
    color: "from-slate-600/20 to-slate-800/10 border-slate-500/30",
  },
];

export default function PlatformHub() {
  const [, navigate] = useLocation();
  const agent = usePosStore(s => s.agent);
  const role = agent?.role ?? "agent";

  const visiblePortals = PORTALS.filter(
    (p: any) =>
      p.roles.includes("all") ||
      p.roles.includes(role as "agent" | "admin" | "supervisor")
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <div className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🏦</span>
            <div>
              <h1 className="text-lg font-bold text-foreground leading-tight">
                InsurePortal POS Shell
              </h1>
              <p className="text-xs text-muted-foreground">
                Insurance Platform
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {agent && (
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-foreground">
                  {agent.agentId}
                </p>
                <p className="text-xs text-muted-foreground capitalize">
                  {role}
                </p>
              </div>
            )}
            <Badge
              variant={
                role === "admin"
                  ? "destructive"
                  : role === "supervisor"
                    ? "outline"
                    : "secondary"
              }
              className="capitalize"
            >
              {role}
            </Badge>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-foreground mb-1">
            Platform Hub
          </h2>
          <p className="text-muted-foreground text-sm">
            Select a portal to navigate to. Access is based on your role
            {agent ? ` (${agent.agentId} · ${role})` : ""}.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visiblePortals.map((portal: any) => (
            <Card
              key={portal.path}
              className={`bg-gradient-to-br ${portal.color} border cursor-pointer hover:scale-[1.02] transition-all duration-200 hover:shadow-lg hover:shadow-black/20`}
              onClick={() => navigate(portal.path)}
            >
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <span className="text-3xl">{portal.icon}</span>
                  {portal.badge && (
                    <Badge variant={portal.badgeVariant} className="text-xs">
                      {portal.badge}
                    </Badge>
                  )}
                </div>
                <CardTitle className="text-base font-semibold text-foreground mt-2">
                  {portal.title}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="text-xs text-muted-foreground leading-relaxed">
                  {portal.description}
                </CardDescription>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-3 w-full text-xs h-7 hover:bg-white/10"
                  onClick={e => {
                    e.stopPropagation();
                    navigate(portal.path);
                  }}
                >
                  Open →
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Quick stats footer */}
        {agent && (
          <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "Float Balance",
                value: `₦${(agent.premiumReserve ?? 0).toLocaleString()}`,
                icon: "💰",
              },
              {
                label: "Commission",
                value: `₦${(agent.commissionBalance ?? 0).toLocaleString()}`,
                icon: "📈",
              },
              {
                label: "Loyalty Points",
                value: (agent.loyaltyPoints ?? 0).toLocaleString(),
                icon: "⭐",
              },
              {
                label: "Agent Tier",
                value: agent.tier ?? "Bronze",
                icon: "🏅",
              },
            ].map((stat: any) => (
              <div
                key={stat.label}
                className="bg-card/60 border border-border rounded-lg p-3 text-center"
              >
                <div className="text-lg mb-1">{stat.icon}</div>
                <div className="text-sm font-semibold text-foreground">
                  {stat.value}
                </div>
                <div className="text-xs text-muted-foreground">
                  {stat.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
