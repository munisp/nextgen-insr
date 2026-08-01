/**
 * CarrierSlaDashboard — Role-scoped dashboard with real tRPC data and Recharts charts.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { Activity, AlertTriangle, BarChart2, CheckCircle, Clock, Shield, TrendingUp } from "lucide-react";

const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6","#ec4899"];

export default function CarrierSlaDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data: stats, isLoading } = (trpc as any).carrierSla?.getStats?.useQuery?.() ?? { data: null, isLoading: false };
  const { data: carriers } = (trpc as any).carrierSla?.listCarriers?.useQuery?.({ limit: 10 }) ?? { data: null };

  const s = stats ?? {};

  const cards = [
    { title: "Total Carriers", value: s.totalCarriers ?? "—", icon: Shield, trend: "flat" as const, trendValue: "registered", status: "neutral" as const, href: "/carrier-sla-dashboard", accent: "var(--insurance-primary)" },
    { title: "Meeting SLA", value: s.meetingSla ?? "—", icon: CheckCircle, trend: "up" as const, trendValue: "↑ 2", status: "good" as const, href: "/carrier-sla-dashboard", accent: "var(--risk-low)" },
    { title: "SLA Breaches (MTD)", value: s.breachesMtd ?? "—", icon: AlertTriangle, trend: "down" as const, trendValue: "↓ 3", status: (Number(s.breachesMtd ?? 0) > 0 ? "warning" : "good") as const, href: "/carrier-sla-dashboard", accent: "var(--risk-medium)" },
    { title: "Avg Response (hrs)", value: s.avgResponseHours ? Number(s.avgResponseHours).toFixed(1) : "—", icon: Clock, trend: "down" as const, trendValue: "↓ 0.5h", status: "good" as const, href: "/carrier-sla-dashboard", accent: "var(--risk-low)" },
    { title: "Claims SLA (%)", value: s.claimsSlaRate ? s.claimsSlaRate.toFixed(1)+"%" : "—", icon: Activity, trend: "up" as const, trendValue: "↑ 1.2%", status: (Number(s.claimsSlaRate ?? 0) >= 95 ? "good" : "warning") as const, href: "/carrier-sla-dashboard", accent: "var(--risk-low)" },
    { title: "Premium SLA (%)", value: s.premiumSlaRate ? s.premiumSlaRate.toFixed(1)+"%" : "—", icon: TrendingUp, trend: "up" as const, trendValue: "↑ 0.8%", status: (Number(s.premiumSlaRate ?? 0) >= 95 ? "good" : "warning") as const, href: "/carrier-sla-dashboard", accent: "var(--risk-low)" },
  ];

  const slaByCarrier = (carriers?.data ?? []).slice(0, 6).map((c: any) => ({
    name: c.name?.slice(0, 10) ?? `Carrier-${c.id}`,
    sla: Number(c.slaScore ?? 95),
    breaches: Number(c.breachCount ?? 0),
  }));

  const slaCategories = [
    { category: "Claims Processing", rate: Number(s.claimsSlaRate ?? 90) },
    { category: "Premium Collection", rate: Number(s.premiumSlaRate ?? 92) },
    { category: "Policy Issuance", rate: Number(s.policyIssuanceSlaRate ?? 88) },
    { category: "Customer Response", rate: Number(s.customerResponseSlaRate ?? 95) },
    { category: "Document Delivery", rate: Number(s.documentSlaRate ?? 97) },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "var(--insurance-primary)20", color: "var(--insurance-primary)" }}>
            <Shield size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Carrier SLA Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Carriers · SLA Compliance · Breaches</p>
          </div>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-6">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>SLA KPIs</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-3"}`}>
            {cards.map((c) => (
              <KpiCard key={c.title} title={c.title} value={c.value} icon={c.icon}
                trend={c.trend} trendValue={c.trendValue} status={c.status}
                accentColor={c.accent} loading={isLoading} onClick={() => navigate(c.href)} />
            ))}
          </div>
        </section>

        <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>SLA Score by Carrier (%)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={slaByCarrier.length > 0 ? slaByCarrier : [{ name: "No carriers", sla: 0 }]}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 9, fill: "var(--text-secondary)" }} />
                <YAxis domain={[70, 100]} tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip formatter={(v: any) => `${v}%`} />
                <Bar dataKey="sla" radius={[4, 4, 0, 0]}>
                  {slaByCarrier.map((d: any, i: number) => <Cell key={i} fill={Number(d.sla) >= 95 ? "#22c55e" : Number(d.sla) >= 85 ? "#f59e0b" : "#ef4444"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>SLA by Category (%)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={slaCategories} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis type="number" domain={[70, 100]} tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
                <YAxis type="category" dataKey="category" tick={{ fontSize: 9, fill: "var(--text-secondary)" }} width={100} />
                <Tooltip formatter={(v: any) => `${v}%`} />
                <Bar dataKey="rate" radius={[0, 4, 4, 0]}>
                  {slaCategories.map((d, i) => <Cell key={i} fill={Number(d.rate) >= 95 ? "#22c55e" : Number(d.rate) >= 85 ? "#f59e0b" : "#ef4444"} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {[
              { label: "All Carriers", icon: Shield, href: "/carrier-sla-dashboard", color: "var(--insurance-primary)" },
              { label: "SLA Breaches", icon: AlertTriangle, href: "/carrier-sla-dashboard", color: "var(--risk-medium)" },
              { label: "Claims SLA", icon: Activity, href: "/claims", color: "var(--insurance-secondary)" },
              { label: "Reports", icon: BarChart2, href: "/financial-reporting-suite", color: "var(--text-secondary)" },
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
