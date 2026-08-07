/**
 * InsureMarket — API Marketplace & Monetization Dashboard
 *
 * World-class UI for the InsurePortal commercial monetization layer.
 * Showcases all revenue streams, API products, and subscription management.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import {
  Store, Zap, TrendingUp, Users, Globe, Shield, BarChart3,
  ArrowUpRight, CheckCircle2, Code2, Database, Cpu, Lock,
  DollarSign, Package, RefreshCw, ExternalLink, Copy,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ─── Category icons ───────────────────────────────────────────────────────────
const CATEGORY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  underwriting: Shield,
  fraud:        Lock,
  compliance:   CheckCircle2,
  analytics:    BarChart3,
  distribution: Globe,
  reinsurance:  TrendingUp,
};

const CATEGORY_COLORS: Record<string, string> = {
  underwriting: "text-blue-400 bg-blue-400/10",
  fraud:        "text-red-400 bg-red-400/10",
  compliance:   "text-green-400 bg-green-400/10",
  analytics:    "text-purple-400 bg-purple-400/10",
  distribution: "text-amber-400 bg-amber-400/10",
  reinsurance:  "text-cyan-400 bg-cyan-400/10",
};

// ─── Format currency ──────────────────────────────────────────────────────────
function formatNGN(amount: number): string {
  if (amount >= 1_000_000) return `₦${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000)     return `₦${(amount / 1_000).toFixed(0)}K`;
  return `₦${amount.toLocaleString()}`;
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InsureMarketPage() {
  const { toast } = useToast();
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [subscribingApp, setSubscribingApp] = useState<string | null>(null);

  const { data: dashboard, isLoading: dashLoading } = trpc.insureMarket.getMonetizationDashboard.useQuery();
  const { data: apps, isLoading: appsLoading } = trpc.insureMarket.getMarketplaceApps.useQuery(
    { category: selectedCategory as "all" },
  );

  const subscribeMutation = trpc.insureMarket.subscribeToApp.useMutation({
    onSuccess: (data) => {
      toast({
        title: "Subscription Activated",
        description: `API key: ${data.apiKey.slice(0, 20)}...`,
      });
      setSubscribingApp(null);
    },
    onError: (err) => {
      toast({ title: "Subscription Failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 page-enter">

      {/* ── Hero header ──────────────────────────────────────────────────── */}
      <div className="relative overflow-hidden border-b border-slate-800">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-950/50 via-slate-950 to-green-950/30" />
        <div className="relative px-6 py-10">
          <div className="max-w-6xl mx-auto">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                <Store className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-100">
                  <span className="gradient-header">InsureMarket</span>
                </h1>
                <p className="text-sm text-slate-400">API Marketplace & Revenue Intelligence</p>
              </div>
            </div>

            {/* KPI strip */}
            {dashboard && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-6">
                {[
                  { label: "Monthly Revenue",   value: formatNGN(dashboard.kpis.mrr),                icon: DollarSign,  color: "text-green-400"  },
                  { label: "Annual Run Rate",    value: formatNGN(dashboard.kpis.arr),                icon: TrendingUp,  color: "text-blue-400"   },
                  { label: "API Calls (30d)",    value: dashboard.kpis.apiCalls.toLocaleString(),     icon: Zap,         color: "text-amber-400"  },
                  { label: "Subscriptions",      value: dashboard.kpis.activeSubscriptions.toString(),icon: Package,     color: "text-purple-400" },
                  { label: "White-Label Tenants",value: dashboard.kpis.whiteLabelTenants.toString(),  icon: Globe,       color: "text-cyan-400"   },
                ].map(kpi => {
                  const Icon = kpi.icon;
                  return (
                    <div key={kpi.label} className="kpi-card">
                      <div className="flex items-center gap-2 mb-2">
                        <Icon className={`h-4 w-4 ${kpi.color}`} />
                        <span className="text-xs text-slate-500">{kpi.label}</span>
                      </div>
                      <div className={`text-xl font-bold font-mono ${kpi.color}`}>{kpi.value}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-6 py-6">
        <Tabs defaultValue="marketplace">
          <TabsList className="bg-slate-900 border border-slate-800 mb-6">
            <TabsTrigger value="marketplace" className="text-sm">API Marketplace</TabsTrigger>
            <TabsTrigger value="revenue"     className="text-sm">Revenue Streams</TabsTrigger>
            <TabsTrigger value="whitelabel"  className="text-sm">White-Label</TabsTrigger>
            <TabsTrigger value="opportunities" className="text-sm">Opportunities</TabsTrigger>
          </TabsList>

          {/* ── Marketplace tab ─────────────────────────────────────────── */}
          <TabsContent value="marketplace">
            <div className="flex items-center gap-3 mb-5">
              <div className="flex gap-2 flex-wrap">
                {["all", "underwriting", "fraud", "compliance", "analytics", "distribution", "reinsurance"].map(cat => (
                  <Button
                    key={cat}
                    size="sm"
                    variant={selectedCategory === cat ? "default" : "ghost"}
                    className={`h-7 text-xs capitalize ${selectedCategory === cat ? "bg-blue-600 text-white" : "text-slate-400"}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </Button>
                ))}
              </div>
            </div>

            {appsLoading ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="skeleton h-64 rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {apps?.apps.map(app => {
                  const Icon = CATEGORY_ICONS[app.category] ?? Package;
                  const colorClass = CATEGORY_COLORS[app.category] ?? "text-slate-400 bg-slate-400/10";
                  const [textColor] = colorClass.split(" ");
                  return (
                    <div key={app.id} className="glass-card p-5 flex flex-col">
                      {/* Header */}
                      <div className="flex items-start justify-between mb-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorClass}`}>
                          <Icon className="h-4.5 w-4.5" />
                        </div>
                        <Badge variant="outline" className={`text-xs border-current/30 ${textColor} capitalize`}>
                          {app.category}
                        </Badge>
                      </div>

                      <h3 className="font-semibold text-slate-100 text-sm mb-1">{app.name}</h3>
                      <p className="text-xs text-slate-400 leading-relaxed flex-1 mb-4">{app.description}</p>

                      {/* Pricing */}
                      <div className="space-y-1.5 mb-4">
                        <div className="text-xs text-slate-500 uppercase tracking-wider font-semibold">Pricing</div>
                        {app.priceTiers.slice(0, 2).map((tier, i) => (
                          <div key={i} className="flex items-center justify-between bg-slate-800/60 rounded-lg px-3 py-2">
                            <span className="text-xs text-slate-300">{tier.name}</span>
                            <span className={`text-xs font-mono font-semibold ${textColor}`}>
                              {'priceNGN' in tier && tier.priceNGN > 0
                                ? `${formatNGN(tier.priceNGN)}/mo`
                                : 'perCallNGN' in tier
                                  ? `₦${tier.perCallNGN}/call`
                                  : 'commissionPct' in tier
                                    ? `${tier.commissionPct}% commission`
                                    : 'placementFeePct' in tier
                                      ? `${tier.placementFeePct}% placement`
                                      : "Custom"
                              }
                            </span>
                          </div>
                        ))}
                      </div>

                      {/* SLA */}
                      <div className="flex items-center gap-1.5 mb-4">
                        <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                        <span className="text-xs text-slate-500">{app.sla}</span>
                      </div>

                      {/* Actions */}
                      <div className="flex gap-2">
                        <Button
                          className={`flex-1 h-8 text-xs bg-blue-600 hover:bg-blue-700 text-white`}
                          onClick={() => {
                            setSubscribingApp(app.id);
                            subscribeMutation.mutate({
                              appId:        app.id,
                              tierId:       app.priceTiers[0]?.name ?? "starter",
                              tenantId:     "demo-tenant",
                              contactEmail: "admin@insureportal.ng",
                            });
                          }}
                          disabled={subscribeMutation.isPending && subscribingApp === app.id}
                        >
                          {subscribeMutation.isPending && subscribingApp === app.id
                            ? <RefreshCw className="h-3 w-3 animate-spin" />
                            : "Subscribe"
                          }
                        </Button>
                        <Button variant="ghost" className="h-8 w-8 p-0 text-slate-400 hover:text-slate-100">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Revenue streams tab ─────────────────────────────────────── */}
          <TabsContent value="revenue">
            {dashboard && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {dashboard.streams.map(stream => (
                    <div key={stream.name} className="kpi-card kpi-card--info">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-semibold text-slate-200">{stream.name}</span>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs border-green-500/40 text-green-400">
                            {stream.trend}
                          </Badge>
                          <span className="text-xs text-slate-400">{stream.revenuePct}%</span>
                        </div>
                      </div>
                      <div className="text-2xl font-bold font-mono text-blue-400 mb-3">
                        {formatNGN(stream.mrrNGN)}
                        <span className="text-sm text-slate-500 font-normal">/mo</span>
                      </div>
                      <Progress value={stream.revenuePct} className="h-1.5" />
                    </div>
                  ))}
                </div>

                <div className="glass-card p-5">
                  <h3 className="text-sm font-semibold text-slate-200 mb-4">Revenue Summary</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[
                      { label: "MRR",            value: formatNGN(dashboard.kpis.mrr),  color: "text-green-400"  },
                      { label: "ARR",             value: formatNGN(dashboard.kpis.arr),  color: "text-blue-400"   },
                      { label: "API Calls (30d)", value: dashboard.kpis.apiCalls.toLocaleString(), color: "text-amber-400" },
                      { label: "Active Clients",  value: (dashboard.kpis.activeSubscriptions + dashboard.kpis.whiteLabelTenants).toString(), color: "text-purple-400" },
                    ].map(item => (
                      <div key={item.label} className="text-center">
                        <div className={`text-2xl font-bold font-mono ${item.color}`}>{item.value}</div>
                        <div className="text-xs text-slate-500 mt-1">{item.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── White-label tab ─────────────────────────────────────────── */}
          <TabsContent value="whitelabel">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="glass-card p-5">
                <h3 className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
                  <Globe className="h-4 w-4 text-cyan-400" />
                  Provision White-Label Portal
                </h3>
                <div className="space-y-3">
                  {[
                    { label: "Company Name",  placeholder: "Acme Insurance Ltd" },
                    { label: "Subdomain",     placeholder: "acme" },
                    { label: "Contact Email", placeholder: "admin@acme.com" },
                  ].map(field => (
                    <div key={field.label}>
                      <Label className="text-xs text-slate-400 mb-1 block">{field.label}</Label>
                      <Input
                        placeholder={field.placeholder}
                        className="h-8 bg-slate-800 border-slate-700 text-xs text-slate-100"
                      />
                    </div>
                  ))}
                  <div>
                    <Label className="text-xs text-slate-400 mb-1 block">Tier</Label>
                    <Select defaultValue="starter">
                      <SelectTrigger className="h-8 bg-slate-800 border-slate-700 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-slate-800 border-slate-700">
                        <SelectItem value="starter"    className="text-xs">Starter — ₦500K setup + ₦100K/mo</SelectItem>
                        <SelectItem value="growth"     className="text-xs">Growth — ₦1M setup + ₦300K/mo</SelectItem>
                        <SelectItem value="enterprise" className="text-xs">Enterprise — Custom pricing</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button className="w-full h-8 bg-blue-600 hover:bg-blue-700 text-white text-xs mt-2">
                    <Globe className="h-3.5 w-3.5 mr-1.5" />
                    Provision Portal
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-slate-200">White-Label Features</h3>
                {[
                  { title: "Custom Branding",       desc: "Logo, colours, domain, and email templates" },
                  { title: "Module Selection",       desc: "Choose from 20+ insurance modules" },
                  { title: "NAICOM Compliance",      desc: "Pre-configured for Nigerian regulatory requirements" },
                  { title: "API Access",             desc: "Full tRPC API access with tenant isolation" },
                  { title: "Keycloak SSO",           desc: "Custom identity provider integration" },
                  { title: "Dedicated Support",      desc: "SLA-backed technical support" },
                ].map(feature => (
                  <div key={feature.title} className="flex items-start gap-3 p-3 bg-slate-800/40 rounded-lg">
                    <CheckCircle2 className="h-4 w-4 text-green-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-semibold text-slate-200">{feature.title}</div>
                      <div className="text-xs text-slate-500">{feature.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* ── Opportunities tab ────────────────────────────────────────── */}
          <TabsContent value="opportunities">
            {dashboard && (
              <div className="space-y-3">
                <div className="text-sm text-slate-400 mb-4">
                  High-priority monetization opportunities identified by the platform intelligence engine.
                </div>
                {dashboard.opportunities.map((opp, i) => (
                  <div key={i} className="glass-card p-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className="w-8 h-8 rounded-lg bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-xs font-bold text-blue-400">
                        {i + 1}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-slate-200">{opp.title}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Badge variant="outline" className={`text-xs ${
                            opp.priority === "high" ? "border-red-500/40 text-red-400" :
                            opp.priority === "medium" ? "border-amber-500/40 text-amber-400" :
                            "border-slate-500/40 text-slate-400"
                          }`}>
                            {opp.priority} priority
                          </Badge>
                          <Badge variant="outline" className="text-xs border-slate-600 text-slate-400">
                            {opp.effort} effort
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold font-mono text-green-400">
                        {formatNGN(opp.potentialMRR)}/mo
                      </div>
                      <div className="text-xs text-slate-500">potential MRR</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
