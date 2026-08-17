/**
 * ReinsurerDashboard — Role-scoped KPI dashboard with real-time data and Recharts charts.
 * Wired to tRPC insuranceKpiDashboard?.reinsurerKpi?.useQuery?.({ periodDays: 90 }) procedure.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { FileText, Scale, Shield, TrendingUp, DollarSign, CheckCircle, Clock, Activity } from "lucide-react";


const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899"];

export default function ReinsurerDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data, isLoading } = trpc.insuranceKpiDashboard.reinsurerKpi.useQuery({ periodDays: 90 });
  const kpi = data?.treaties ?? {}; const cess = data?.cessions ?? {}; const nr = data?.netRetentionRate ?? 0;

  const cards = [
    { title: "Active Treaties", value: kpi.active ?? "—", icon: Scale, trend: "flat" as const, trendValue: "stable", status: "neutral" as const, href: "/reinsurance-management", accent: "var(--role-reinsurer)" },
    { title: "Total Capacity (₦M)", value: kpi.totalCapacity ? (kpi.totalCapacity/1e6).toFixed(1) : "—", icon: Shield, trend: "up" as const, trendValue: "↑ 5%", status: "neutral" as const, href: "/reinsurance-management", accent: "var(--insurance-primary)" },
    { title: "Ceded Premium (₦M)", value: kpi.totalPremiumCeded ? (kpi.totalPremiumCeded/1e6).toFixed(1) : "—", icon: DollarSign, trend: "up" as const, trendValue: "↑ 7%", status: "neutral" as const, href: "/reinsurance-management", accent: "var(--insurance-secondary)" },
    { title: "Cession Count", value: cess.count ?? "—", icon: FileText, trend: "up" as const, trendValue: "MTD", status: "neutral" as const, href: "/reinsurance-management", accent: "var(--role-reinsurer)" },
    { title: "Total Ceded (₦M)", value: cess.totalCeded ? (cess.totalCeded/1e6).toFixed(1) : "—", icon: TrendingUp, trend: "up" as const, trendValue: "↑ 4%", status: "good" as const, href: "/reinsurance-management", accent: "var(--risk-low)" },
    { title: "Recovered (₦M)", value: cess.totalRecovered ? (cess.totalRecovered/1e6).toFixed(1) : "—", icon: CheckCircle, trend: "up" as const, trendValue: "↑ 3%", status: "good" as const, href: "/reinsurance-management", accent: "var(--risk-low)" },
    { title: "Pending Recovery (₦M)", value: cess.pendingRecovery ? (cess.pendingRecovery/1e6).toFixed(1) : "—", icon: Clock, trend: "flat" as const, trendValue: "stable", status: "warning" as const, href: "/reinsurance-management", accent: "var(--risk-medium)" },
    { title: "Net Retention Rate", value: nr ? nr.toFixed(1)+"%" : "—", icon: Activity, trend: "flat" as const, trendValue: "stable", status: "neutral" as const, href: "/reinsurance-management", accent: "var(--insurance-primary)" },
  ];

  const cessionChart = [
    { name: "Total Ceded", value: (cess.totalCeded??0)/1e6 },
    { name: "Recovered", value: (cess.totalRecovered??0)/1e6 },
    { name: "Pending", value: (cess.pendingRecovery??0)/1e6 },
  ];
  const treatyUtil = [
    { name: "Capacity", value: (kpi.totalCapacity??0)/1e6 },
    { name: "Ceded", value: (kpi.totalPremiumCeded??0)/1e6 },
    { name: "Retained", value: ((kpi.totalCapacity??0)-(kpi.totalPremiumCeded??0))/1e6 },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--role-reinsurer)20", color: "var(--role-reinsurer)" }}>
            <Scale size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Reinsurer Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Treaties · Cessions · Recoveries</p>
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
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Ceded vs Recovered (₦M)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={cessionChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                <YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                <Tooltip formatter={(v:any)=>`₦${Number(v).toFixed(2)}M`}/>
                <Bar dataKey="value" radius={[4,4,0,0]}>
                  {cessionChart.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Treaty Capacity Utilization</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={treatyUtil}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                <YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                <Tooltip formatter={(v:any)=>`₦${Number(v).toFixed(2)}M`}/>
                <Bar dataKey="value" fill="#6366f1" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            <button key="Treaties" onClick={() => navigate("/reinsurance-management")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <Scale size={22} style={{ color: "var(--role-reinsurer)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Treaties</span>
            </button>
            <button key="Cessions" onClick={() => navigate("/reinsurance-management")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <FileText size={22} style={{ color: "var(--insurance-primary)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Cessions</span>
            </button>
            <button key="NAICOM Report" onClick={() => navigate("/naicom-reporting")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <Shield size={22} style={{ color: "var(--risk-medium)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>NAICOM Report</span>
            </button>
            <button key="Analytics" onClick={() => navigate("/analytics-dashboard")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <TrendingUp size={22} style={{ color: "var(--risk-low)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Analytics</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
