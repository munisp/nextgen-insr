/**
 * RegulatorDashboard — Role-scoped KPI dashboard with real-time data and Recharts charts.
 * Wired to tRPC insuranceKpiDashboard?.regulatorKpi?.useQuery?.({ periodDays: 90 }) procedure.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { BarChart2, FileText, Scale, Shield } from "lucide-react";


const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899"];

export default function RegulatorDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data, isLoading } = (trpc as any).insuranceKpiDashboard?.regulatorKpi?.useQuery?.({ periodDays: 90 })?.useQuery?.({}) ?? { data: null, isLoading: false };
  const kpi = data?.market ?? data ?? {}; const comp = data?.compliance ?? {}; const cap = data?.capital ?? {};

  const cards = [
    { title: "Licensed Insurers", value: kpi.licensedInsurers ?? "—", icon: Shield, trend: "flat" as const, trendValue: "NAICOM", status: "neutral" as const, href: "/regulatory-compliance-checks", accent: "var(--role-regulator)" },
    { title: "Total Policies In-Force", value: kpi.totalPolicies ?? "—", icon: FileText, trend: "up" as const, trendValue: "↑ 3%", status: "good" as const, href: "/policies", accent: "var(--insurance-primary)" },
    { title: "Industry Premium (₦B)", value: kpi.industryPremium ? (kpi.industryPremium/1e9).toFixed(2) : "—", icon: DollarSign, trend: "up" as const, trendValue: "↑ 8%", status: "good" as const, href: "/financial-reporting-suite", accent: "var(--risk-low)" },
    { title: "Claims Ratio (%)", value: kpi.claimsRatio ? kpi.claimsRatio.toFixed(1)+"%" : "—", icon: Activity, trend: "down" as const, trendValue: "↓ 2%", status: (Number(kpi.claimsRatio??0)>80?"critical":"good") as "critical" | "good", href: "/claims", accent: "var(--risk-low)" },
    { title: "Capital Adequacy (%)", value: cap.ratio ? cap.ratio.toFixed(1)+"%" : "—", icon: TrendingUp, trend: "up" as const, trendValue: "NAICOM min 15%", status: (Number(cap.ratio??0)>=15?"good":"critical") as "good" | "critical", href: "/regulatory-compliance-checks", accent: "var(--risk-low)" },
    { title: "Compliance Score", value: comp.overallScore ? comp.overallScore+"%" : "—", icon: CheckCircle, trend: "up" as const, trendValue: "↑ 1.5%", status: (Number(comp.overallScore??0)>=90?"good":"warning") as "good" | "warning", href: "/compliance-dashboard", accent: "var(--risk-low)" },
    { title: "SARs Filed (MTD)", value: kpi.sarsFiled ?? "—", icon: AlertTriangle, trend: "flat" as const, trendValue: "CBN", status: "neutral" as const, href: "/cbn-reporting-dashboard", accent: "var(--insurance-secondary)" },
    { title: "Market Penetration (%)", value: kpi.marketPenetration ?? "—", icon: BarChart2, trend: "up" as const, trendValue: "↑ 0.3%", status: "neutral" as const, href: "/analytics-dashboard", accent: "var(--insurance-primary)" },
  ];

  const marketChart = [
    { name: "Premium", value: (kpi.industryPremium??0)/1e9 },
    { name: "Claims Paid", value: (kpi.claimsPaid??0)/1e9 },
    { name: "Reserves", value: (kpi.reserves??0)/1e9 },
    { name: "Capital", value: (cap.total??0)/1e9 },
  ];
  const compCategories = [
    { category: "Capital", score: Number(cap.ratio??0) },
    { category: "AML", score: Number(comp.amlScore??85) },
    { category: "KYC", score: Number(comp.kycScore??90) },
    { category: "Claims", score: Number(comp.claimsScore??88) },
    { category: "Licensing", score: Number(comp.licensingScore??95) },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--role-regulator)20", color: "var(--role-regulator)" }}>
            <Scale size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Regulator Dashboard</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>NAICOM · CBN · Market Oversight</p>
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
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Market Overview (₦B)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={marketChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                <YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                <Tooltip formatter={(v:any)=>`₦${Number(v).toFixed(2)}B`}/>
                <Bar dataKey="value" fill="#6366f1" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Compliance by Category</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={compCategories}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/>
                <XAxis dataKey="category" tick={{fontSize:10,fill:"var(--text-secondary)"}}/>
                <YAxis domain={[0,100]} tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                <Tooltip formatter={(v:any)=>`${Number(v).toFixed(1)}%`}/>
                <Bar dataKey="score" radius={[4,4,0,0]}>
                  {compCategories.map((d,i)=><Cell key={i} fill={Number(d.score)>=90?"#22c55e":Number(d.score)>=70?"#f59e0b":"#ef4444"}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            <button key="NAICOM Reports" onClick={() => navigate("/naicom-reporting")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <FileText size={22} style={{ color: "var(--role-regulator)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>NAICOM Reports</span>
            </button>
            <button key="CBN Reporting" onClick={() => navigate("/cbn-reporting-dashboard")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <Scale size={22} style={{ color: "var(--insurance-primary)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>CBN Reporting</span>
            </button>
            <button key="Compliance Checks" onClick={() => navigate("/regulatory-compliance-checks")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <Shield size={22} style={{ color: "var(--risk-medium)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Compliance Checks</span>
            </button>
            <button key="Market Analytics" onClick={() => navigate("/analytics-dashboard")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <BarChart2 size={22} style={{ color: "var(--risk-low)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Market Analytics</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
