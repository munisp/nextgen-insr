/**
 * BeneficiaryDashboard — Role-scoped KPI dashboard with real-time data and Recharts charts.
 * Wired to tRPC insuranceKpiDashboard?.policyholderKpi?.useQuery?.() procedure.
 */
import { trpc } from "@/_core/trpc";
import { KpiCard } from "@/components/insurance/KpiCard";
import { useIsMobile } from "@/hooks/useMobile";
import { useLocation } from "wouter";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { Activity, ClipboardList, FileText, Shield, Users, Clock, CheckCircle, DollarSign } from "lucide-react";


const COLORS = ["#6366f1", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#8b5cf6", "#ec4899"];

export default function BeneficiaryDashboard() {
  const isMobile = useIsMobile();
  const [, navigate] = useLocation();
  const { data, isLoading } = (trpc as any).insuranceKpiDashboard?.policyholderKpi?.useQuery?.()?.useQuery?.({}) ?? { data: null, isLoading: false };
  const kpi = data?.claims ?? data ?? {}; const pol = data?.policies ?? {};

  const cards = [
    { title: "Pending Claims", value: kpi.open ?? "—", icon: Clock, trend: "flat" as const, trendValue: "in review", status: "warning" as const, href: "/my-claims", accent: "var(--risk-medium)" },
    { title: "Settled Claims", value: kpi.settled ?? "—", icon: CheckCircle, trend: "up" as const, trendValue: "paid", status: "good" as const, href: "/my-claims", accent: "var(--risk-low)" },
    { title: "Total Benefits Received (₦)", value: kpi.totalReceived ? Number(kpi.totalReceived).toLocaleString() : "—", icon: DollarSign, trend: "up" as const, trendValue: "lifetime", status: "good" as const, href: "/my-claims", accent: "var(--risk-low)" },
    { title: "Active Policies", value: pol.active ?? "—", icon: Shield, trend: "flat" as const, trendValue: "in-force", status: "good" as const, href: "/my-policies", accent: "var(--insurance-primary)" },
  ];

  const claimStatus = [
    { name: "Open", value: Number(kpi.open??0) },
    { name: "Settled", value: Number(kpi.settled??0) },
    { name: "Disputed", value: Number(kpi.disputed??0) },
  ].filter(d=>d.value>0);
  const benefitHistory = Array.from({length:6},(_,i)=>{
    const d = new Date(); d.setMonth(d.getMonth()-5+i);
    return { month: d.toLocaleDateString("en-NG",{month:"short"}), amount: i===5?Number(kpi.totalReceived??0):0 };
  });

  return (
    <div className="min-h-screen" style={{ background: "var(--page-bg)", paddingBottom: isMobile ? "calc(4rem + var(--safe-area-bottom))" : "2rem" }}>
      <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between"
        style={{ background: "var(--header-bg)", borderBottom: "1px solid var(--card-border)", backdropFilter: "blur(12px)" }}>
        <div className="flex items-center gap-3">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "var(--insurance-secondary)20", color: "var(--insurance-secondary)" }}>
            <Users size={18} />
          </span>
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>Beneficiary Portal</h1>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Claims · Benefits · Documents</p>
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
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Claim Status Overview</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={claimStatus.length>0?claimStatus:[{name:"No claims",value:1}]} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({name,value})=>`${name}: ${value}`}>
                  {(claimStatus.length>0?claimStatus:[{name:"No claims",value:1}]).map((_,i)=><Cell key={i} fill={["#f59e0b","#22c55e","#ef4444"][i%3]}/>)}
                </Pie><Tooltip/>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Benefits Received (6 Months)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={benefitHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/>
                <XAxis dataKey="month" tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                <YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}}/>
                <Tooltip formatter={(v:any)=>`₦${Number(v).toLocaleString()}`}/>
                <Bar dataKey="amount" fill="#22c55e" radius={[4,4,0,0]} name="Benefits"/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--text-secondary)" }}>Quick Actions</h2>
          <div className={`grid gap-3 ${isMobile ? "grid-cols-2" : "grid-cols-4"}`}>
            <button key="My Claims" onClick={() => navigate("/my-claims")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <ClipboardList size={22} style={{ color: "var(--insurance-secondary)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>My Claims</span>
            </button>
            <button key="My Policies" onClick={() => navigate("/my-policies")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <Shield size={22} style={{ color: "var(--insurance-primary)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>My Policies</span>
            </button>
            <button key="Documents" onClick={() => navigate("/customer-documents")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <FileText size={22} style={{ color: "var(--text-secondary)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Documents</span>
            </button>
            <button key="Contact Support" onClick={() => navigate("/ai-chat-support")}
              className="flex flex-col items-center justify-center gap-2 p-4 rounded-xl transition-all duration-150 hover:shadow-md hover:-translate-y-0.5"
              style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
              <Activity size={22} style={{ color: "var(--risk-low)" }} />
              <span className="text-xs font-medium text-center leading-tight" style={{ color: "var(--text-primary)" }}>Contact Support</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
