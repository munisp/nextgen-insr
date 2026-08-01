/**
 * InfrastructureDashboard — Role-scoped dashboard with real tRPC data and Recharts charts.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { Activity, AlertTriangle, BarChart2, CheckCircle, Clock, Database, Server, Shield, TrendingUp, Zap } from "lucide-react";

const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6","#ec4899"];

export default function InfrastructureDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data, isLoading } = (trpc as any).platformHealthDash?.getHealth?.useQuery?.() ?? { data: null, isLoading: false };
  const { data: metrics } = (trpc as any).platformMetricsExporter?.getMetrics?.useQuery?.() ?? { data: null };
  const { data: network } = (trpc as any).networkTelemetry?.getNetworkStats?.useQuery?.() ?? { data: null };

  const h = data ?? {};
  const m = metrics ?? {};
  const n = network ?? {};

  const cards = [
    { title: "Platform Health", value: h.overallStatus ?? "—", icon: Shield, trend: "flat" as const, trendValue: "all services", status: (h.overallStatus === "healthy" ? "good" : "warning") as const, href: "/system-health-dashboard", accent: "var(--risk-low)" },
    { title: "CPU Usage (%)", value: m.cpuPercent ? Number(m.cpuPercent).toFixed(1) + "%" : "—", icon: Zap, trend: "flat" as const, trendValue: "avg", status: (Number(m.cpuPercent ?? 0) > 80 ? "critical" : "good") as const, href: "/system-health-dashboard", accent: "var(--insurance-primary)" },
    { title: "Memory Usage (%)", value: m.memPercent ? Number(m.memPercent).toFixed(1) + "%" : "—", icon: Database, trend: "flat" as const, trendValue: "used", status: (Number(m.memPercent ?? 0) > 85 ? "critical" : "good") as const, href: "/system-health-dashboard", accent: "var(--insurance-secondary)" },
    { title: "DB Connections", value: m.dbConnections ?? "—", icon: Server, trend: "flat" as const, trendValue: "active", status: "neutral" as const, href: "/system-health-dashboard", accent: "var(--insurance-primary)" },
    { title: "Network Latency (ms)", value: n.avgLatencyMs ?? "—", icon: Activity, trend: "down" as const, trendValue: "↓ 2ms", status: "good" as const, href: "/network-status-dashboard", accent: "var(--risk-low)" },
    { title: "Uptime (%)", value: h.uptime ? Number(h.uptime).toFixed(3) + "%" : "—", icon: TrendingUp, trend: "flat" as const, trendValue: "SLA", status: "good" as const, href: "/system-health-dashboard", accent: "var(--risk-low)" },
    { title: "Services Healthy", value: h.healthyCount ? `${h.healthyCount}/${h.totalServices ?? h.healthyCount}` : "—", icon: CheckCircle, trend: "flat" as const, trendValue: "online", status: "good" as const, href: "/system-health-dashboard", accent: "var(--risk-low)" },
    { title: "Alerts Open", value: h.openAlerts ?? "—", icon: AlertTriangle, trend: "flat" as const, trendValue: "active", status: (Number(h.openAlerts ?? 0) > 0 ? "warning" : "good") as const, href: "/system-health-dashboard", accent: "var(--risk-medium)" },
  ];

  const resourceUsage = [
    { name: "CPU", usage: Number(m.cpuPercent ?? 0), capacity: 100 },
    { name: "Memory", usage: Number(m.memPercent ?? 0), capacity: 100 },
    { name: "Disk", usage: Number(m.diskPercent ?? 0), capacity: 100 },
    { name: "DB Conn", usage: Number(m.dbConnections ?? 0), capacity: Number(m.dbMaxConnections ?? 100) },
  ];

  const serviceHealth = (h.services ?? [
    { name: "PostgreSQL", status: "unknown" },
    { name: "Redis", status: "unknown" },
    { name: "TigerBeetle", status: "unknown" },
    { name: "Temporal", status: "unknown" },
    { name: "Keycloak", status: "unknown" },
    { name: "APISIX", status: "unknown" },
  ]).slice(0, 8);

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--insurance-primary)20", color: "var(--insurance-primary)" }}>
            <Server size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Infrastructure Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Services · Resources · Network · Health</p>
          </div>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-6">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Infrastructure KPIs</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {cards.map((c) => (
              <KpiCard key={c.title} title={c.title} value={c.value} icon={c.icon}
                trend={c.trend} trendValue={c.trendValue} status={c.status}
                accentColor={c.accent} loading={isLoading} onClick={() => navigate(c.href)} />
            ))}
          </div>
        </section>

        <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Resource Utilization (%)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={resourceUsage}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
                <Bar dataKey="usage" radius={[4, 4, 0, 0]}>
                  {resourceUsage.map((d, i) => <Cell key={i} fill={Number(d.usage) > 80 ? "#ef4444" : Number(d.usage) > 60 ? "#f59e0b" : "#22c55e"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Service Health Status</h3>
            <div className="space-y-2">
              {serviceHealth.map((s: any) => (
                <div key={s.name} className="flex items-center justify-between py-1.5 px-2 rounded-lg" style={{ background: "var(--page-bg)" }}>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.status === "healthy" ? "#22c55e" : s.status === "degraded" ? "#f59e0b" : s.status === "offline" ? "#ef4444" : "#6b7280" }} />
                    <span className="text-xs font-medium" style={{ color: "var(--text-primary)" }}>{s.name}</span>
                  </div>
                  <span className="text-xs" style={{ color: s.status === "healthy" ? "#22c55e" : s.status === "degraded" ? "#f59e0b" : "#ef4444" }}>{s.status ?? "unknown"}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {[
              { label: "System Health", icon: Shield, href: "/system-health-dashboard", color: "var(--insurance-primary)" },
              { label: "Network Status", icon: Activity, href: "/network-status-dashboard", color: "var(--insurance-secondary)" },
              { label: "Load Testing", icon: Zap, href: "/load-test-dashboard", color: "var(--risk-medium)" },
              { label: "Security", icon: AlertTriangle, href: "/security-dashboard", color: "var(--risk-critical)" },
            ].map((a) => (
              <button key={a.label} onClick={() => navigate(a.href)}
                className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
                style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
                <a.icon size={22} style={{ color: a.color }} />
                <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>{a.label}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
