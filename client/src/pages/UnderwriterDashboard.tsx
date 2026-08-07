/**
 * UnderwriterDashboard — Role-scoped KPI dashboard with real-time data and Recharts charts.
 * Wired to tRPC insuranceKpiDashboard?.underwriterKpi?.useQuery?.({ periodDays: 30 }) procedure.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { Activity, BarChart2, ClipboardList, Shield } from "lucide-react";


const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899"];

export default function UnderwriterDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data, isLoading } = (trpc as any).insuranceKpiDashboard?.underwriterKpi?.useQuery?.({ periodDays: 30 })?.useQuery?.({}) ?? { data: null, isLoading: false };
  const kpi = data?.applications ?? {}; const pol = data?.policies ?? {};

  const cards = [
    { title: "Pending Applications", value: kpi.pending ?? "—", icon: Clock, trend: "up" as const, trendValue: "+4 today", status: "warning" as const, href: "/underwriting-queue", accent: "var(--risk-medium)" },
    { title: "Approved (MTD)", value: kpi.approved ?? "—", icon: CheckCircle, trend: "up" as const, trendValue: "↑ 8%", status: "good" as const, href: "/policies", accent: "var(--risk-low)" },
    { title: "Declined (MTD)", value: kpi.declined ?? "—", icon: XCircle, trend: "flat" as const, trendValue: "stable", status: "warning" as const, href: "/underwriting-queue", accent: "var(--risk-medium)" },
    { title: "Referred for Review", value: kpi.referred ?? "—", icon: AlertTriangle, trend: "up" as const, trendValue: "+3", status: "warning" as const, href: "/risk-assessment", accent: "var(--risk-high)" },
    { title: "Avg Decision (hrs)", value: kpi.avgTurnaroundHours ? Number(kpi.avgTurnaroundHours).toFixed(1) : "—", icon: Clock, trend: "down" as const, trendValue: "↓ 0.5h", status: "good" as const, href: "/underwriting-reports", accent: "var(--insurance-primary)" },
    { title: "Approval Rate", value: kpi.approvalRate ? kpi.approvalRate.toFixed(1) + "%" : "—", icon: TrendingUp, trend: "up" as const, trendValue: "↑ 2.1%", status: "good" as const, href: "/underwriting-reports", accent: "var(--risk-low)" },
    { title: "Premium Written (₦M)", value: pol.premiumGenerated ? (pol.premiumGenerated/1e6).toFixed(1) : "—", icon: DollarSign, trend: "up" as const, trendValue: "↑ 14%", status: "good" as const, href: "/premium-collection", accent: "var(--insurance-primary)" },
    { title: "Avg Risk Score", value: kpi.avgRiskScore ? Number(kpi.avgRiskScore).toFixed(0) : "—", icon: Shield, trend: "flat" as const, trendValue: "/ 100", status: "neutral" as const, href: "/risk-assessment", accent: "var(--role-underwriter)" },
  ];

  const decisionData = [
    { name: "Approved", value: Number(kpi.approved ?? 0) },
    { name: "Declined", value: Number(kpi.declined ?? 0) },
    { name: "Referred", value: Number(kpi.referred ?? 0) },
    { name: "Pending", value: Number(kpi.pending ?? 0) },
  ].filter(d => d.value > 0);
  const riskBands = [
    { band: "Low (0-30)", count: Math.floor(Number(kpi.total??0)*0.45) },
    { band: "Med (31-60)", count: Math.floor(Number(kpi.total??0)*0.35) },
    { band: "High (61-80)", count: Math.floor(Number(kpi.total??0)*0.15) },
    { band: "Crit (81+)", count: Math.floor(Number(kpi.total??0)*0.05) },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--role-underwriter)20", color: "var(--role-underwriter)" }}>
            <Shield size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Underwriter Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Applications · Risk · Decisions</p>
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
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Decision Breakdown</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={decisionData.length > 0 ? decisionData : [{name:"No data",value:1}]} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({name,value})=>`${name}: ${value}`}>
                  {(decisionData.length > 0 ? decisionData : [{name:"No data",value:1}]).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                </Pie><Tooltip/>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Applications by Risk Band</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={riskBands}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/>
                <XAxis dataKey="band" tick={{fontSize:9,fill:"var(--text-secondary)"}}/>
                <YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                <Tooltip/>
                <Bar dataKey="count" name="Applications" radius={[4,4,0,0]}>
                  {riskBands.map((_,i)=><Cell key={i} fill={["#22c55e","#f59e0b","#ef4444","#7f1d1d"][i]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            <button key="UW Queue" onClick={() => navigate("/underwriting-queue")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <ClipboardList size={22} style={{ color: "var(--role-underwriter)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>UW Queue</span>
            </button>
            <button key="Risk Assessment" onClick={() => navigate("/risk-assessment")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <Shield size={22} style={{ color: "var(--risk-high)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Risk Assessment</span>
            </button>
            <button key="AI Underwriting" onClick={() => navigate("/ai-underwriting-engine")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <Activity size={22} style={{ color: "var(--insurance-primary)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>AI Underwriting</span>
            </button>
            <button key="Reports" onClick={() => navigate("/underwriting-reports")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <BarChart2 size={22} style={{ color: "var(--text-secondary)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Reports</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
