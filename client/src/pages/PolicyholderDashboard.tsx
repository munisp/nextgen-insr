import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6"];
import DashboardLayout from "@/components/DashboardLayout";
import KpiCard from "@/components/KpiCard";

export default function PolicyholderDashboard() {
  const { user } = useAuth();
  const { data: kpiData, isLoading } = trpc.insuranceKpiDashboard.policyholderKpi.useQuery(undefined, { enabled: !!user });
  // F-12 (S87-02): no separate policyholder.premiums router is delivered —
  // premium figures come from the delivered policyholderKpi.premiums sub-object.
  const premData = kpiData?.premiums;

  const kpi = kpiData ?? {};
  const prem = premData ?? {};

  // Real per-type policy counts only — no fabricated fixed split.
  const policyTypes: { name: string; value: number }[] = (
    Array.isArray(kpi.byType) ? kpi.byType : []
  ).filter((d: any) => Number(d.value) > 0);
  // Real per-period premium payments only — no ±10% randomization.
  const premHistory: { month: string; amount: number }[] = Array.isArray(
    prem.history
  )
    ? prem.history
    : [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>My Insurance</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Your policies, premiums, and claims at a glance</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard title="Active Policies" value={isLoading ? "…" : String(kpi.active ?? 0)} icon="📋" />
          <KpiCard title="Total Coverage" value={isLoading ? "…" : `₦${((kpi.coverage ?? 0) / 1e6).toFixed(1)}M`} icon="🛡️" />
          <KpiCard title="Pending Claims" value={isLoading ? "…" : String(kpi.pendingClaims ?? 0)} icon="📝" />
          <KpiCard title="Next Premium" value={isLoading ? "…" : (prem.nextDue ? `₦${Number(prem.nextDue).toLocaleString()}` : "—")} icon="💳" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Policies by Type</h3>
            {policyTypes.length === 0 ? (
              <div className="flex items-center justify-center text-xs" style={{ height: 200, color: "var(--text-secondary)" }}>
                No policy data available yet
              </div>
            ) : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={policyTypes} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({name,percent})=>`${name} ${(percent*100).toFixed(0)}%`}>
                  {policyTypes.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}
                </Pie><Tooltip/>
              </PieChart>
            </ResponsiveContainer>
            )}
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Premium Payment History</h3>
            {premHistory.length === 0 ? (
              <div className="flex items-center justify-center text-xs" style={{ height: 200, color: "var(--text-secondary)" }}>
                No premium payment history available yet
              </div>
            ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={premHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)" />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--text-secondary)" }} />
                <Tooltip formatter={(v:any)=>`₦${Number(v).toLocaleString()}`}/>
                <Bar dataKey="amount" fill="#6366f1" radius={[4,4,0,0]} name="Premium Paid"/>
              </BarChart>
            </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
