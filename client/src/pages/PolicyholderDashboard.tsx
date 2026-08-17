import { ClipboardList, CreditCard, FileText, Shield } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

import { useAuth } from "@/_core/hooks/useAuth";
import DashboardLayout from "@/components/DashboardLayout";
import KpiCard from "@/components/KpiCard";
import { trpc } from "@/lib/trpc";
export default function PolicyholderDashboard() {
  const { user } = useAuth();
  const { data: kpiData, isLoading } = trpc.insuranceKpiDashboard.policyholderKpi.useQuery(undefined, { enabled: !!user });
  // F-12 (S87-02): no separate policyholder.premiums router is delivered —
  // premium figures come from the delivered policyholderKpi.premiums sub-object.
  const premData = kpiData?.premiums;

  // F-12 (wave-4b): real policyholderKpi shape is
  // {policies, claims, premiums} — bound below with honest labels.
  const pol = kpiData?.policies;
  const claims = kpiData?.claims;
  const prem = premData ?? {};

  // F-12 (wave-4b): no per-type breakdown or premium-history series is in
  // the delivered shape — sections render honest unavailable states.
  const premHistory: { month: string; amount: number }[] = [];

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--text-primary)" }}>My Insurance</h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Your policies, premiums, and claims at a glance</p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiCard title="Active Policies" value={isLoading ? "…" : String(pol?.active ?? 0)} icon={FileText} />
          <KpiCard title="Premium in Force" value={isLoading ? "…" : `₦${((pol?.totalPremiumInForce ?? 0) / 1e6).toFixed(1)}M`} icon={Shield} />
          <KpiCard title="Open Claims" value={isLoading ? "…" : String(claims?.open ?? 0)} icon={ClipboardList} />
          <KpiCard title="Outstanding Premium" value={isLoading ? "…" : "—"} icon={CreditCard} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Policies by Type</h3>
            {/* F-12 (wave-4b): no per-type breakdown is delivered. */}
            <div className="flex items-center justify-center text-xs" style={{ height: 200, color: "var(--text-secondary)" }}>
              — per-type policy breakdown is not delivered on this platform
            </div>
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
                <Tooltip formatter={(v: unknown)=>`₦${Number(v).toLocaleString()}`}/>
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
