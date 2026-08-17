/**
 * Actuary Dashboard — Role-scoped KPI dashboard with real-time data and charts.
 * Wired to tRPC actuaryKpi procedure.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard, type KpiTrend, type KpiStatus } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { TrendingUp, BarChart2, BookOpen, Activity, Shield, DollarSign } from "lucide-react";


const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6"];

export default function ActuaryDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.insuranceKpiDashboard.actuaryKpi.useQuery({ periodDays: 90 });
  const kpi = data?.kpis ?? data ?? {};

  const cards: Array<{
    title: string; value: string | number; icon: React.ElementType;
    trend?: KpiTrend; trendValue?: string; subtitle?: string;
    status?: KpiStatus; href: string; accent: string;
  }> = [
    { title: "Gross Reserve (₦M)", value: kpi.reserves?.grossReserve ? (kpi.reserves.grossReserve/1e6).toFixed(1) : "—", icon: Shield, trend: "up", trendValue: "IFRS17", status: "neutral" as const, href: "/reserve-calculations", accent: "var(--role-actuary)" },
    { title: "Net Reserve (₦M)", value: kpi.reserves?.netReserve ? (kpi.reserves.netReserve/1e6).toFixed(1) : "—", icon: TrendingUp, trend: "up", trendValue: "BBA/PAA", status: "neutral" as const, href: "/ifrs17-dashboard", accent: "var(--insurance-primary)" },
    { title: "Risk Adjustment (₦M)", value: kpi.reserves?.riskAdjustment ? (kpi.reserves.riskAdjustment/1e6).toFixed(1) : "—", icon: Activity, trend: "flat", trendValue: "stable", status: "neutral" as const, href: "/actuarial-models", accent: "var(--risk-medium)" },
    { title: "Loss Ratio (%)", value: kpi.claims?.lossRatio ? kpi.claims.lossRatio.toFixed(1)+"%" : "—", icon: BarChart2, trend: "down", trendValue: "↓ 2.1%", status: kpi.claims?.lossRatio > 80 ? "critical" : "good" as const, href: "/actuarial-reports", accent: "var(--risk-low)" },
    { title: "Total Incurred (₦M)", value: kpi.claims?.totalIncurred ? (kpi.claims.totalIncurred/1e6).toFixed(1) : "—", icon: DollarSign, trend: "up", trendValue: "MTD", status: "neutral" as const, href: "/claims", accent: "var(--insurance-secondary)" },
    { title: "Total Paid (₦M)", value: kpi.claims?.totalPaid ? (kpi.claims.totalPaid/1e6).toFixed(1) : "—", icon: BookOpen, trend: "up", trendValue: "settled", status: "good" as const, href: "/settlement-engine", accent: "var(--risk-low)" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--role-actuary)20", color: "var(--role-actuary)" }}>
            <TrendingUp size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Actuary Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Real-time KPIs · Charts · Actions</p>
          </div>
        </div>
      </div>
      <div className="px-4 pt-4 space-y-6">
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Key Metrics</h2>
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
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>IFRS17 Reserve Breakdown</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={[
                { name: "GMM", value: kpi.ifrs17?.gmm ?? 0 },
                { name: "PAA", value: kpi.ifrs17?.paa ?? 0 },
                { name: "CSM", value: kpi.ifrs17?.csm ?? 0 },
                { name: "RA", value: kpi.ifrs17?.ra ?? 0 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip formatter={(v: any) => `₦${(v/1e6).toFixed(2)}M`} />
                <Bar dataKey="value" fill="var(--role-actuary)" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Reserve vs Claims</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={[
                { name: "Gross Reserve", value: (kpi.reserves?.grossReserve ?? 0)/1e6 },
                { name: "Net Reserve", value: (kpi.reserves?.netReserve ?? 0)/1e6 },
                { name: "Incurred", value: (kpi.claims?.totalIncurred ?? 0)/1e6 },
                { name: "Paid", value: (kpi.claims?.totalPaid ?? 0)/1e6 },
              ]}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip formatter={(v: any) => `₦${Number(v).toFixed(2)}M`} />
                <Bar dataKey="value" fill="#6366f1" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            {...[
      { label: "Reserve Calcs", icon: TrendingUp, href: "/reserve-calculations", color: "var(--role-actuary)" },
      { label: "IFRS17 Dashboard", icon: BookOpen, href: "/ifrs17-dashboard", color: "var(--insurance-primary)" },
      { label: "Pricing Models", icon: Activity, href: "/actuarial-models", color: "var(--risk-low)" },
      { label: "Reports", icon: BarChart2, href: "/actuarial-reports", color: "var(--text-secondary)" },
    ].map((a) => (
      <button key={a.label} onClick={() => navigate(a.href)}
        className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
        style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", color: a.color }}>
        <a.icon size={22} />
        <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>{a.label}</span>
      </button>
    ))}
          </div>
        </section>
      </div>
    </div>
  );
}
