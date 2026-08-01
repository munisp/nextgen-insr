import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6"];
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";

export default function BusinessRulesDashboard() {
  const [activeTab, setActiveTab] = useState<
    "limits" | "kyc" | "commissions" | "rewards"
  >("limits");

  const limitsQ = trpc.businessRules.cbnLimits.useQuery(undefined, {
    retry: false,
  });
  const kycQ = trpc.businessRules.kycTierLimits.useQuery(undefined, {
    retry: false,
  });
  const commQ = trpc.businessRules.commissionRates.useQuery(undefined, {
    retry: false,
  });
  const rewardsQ = trpc.businessRules.rewardCatalog.useQuery(undefined, {
    retry: false,
  });

  const tabs = [
    { id: "limits" as const, label: "CBN Limits" },
    { id: "kyc" as const, label: "KYC Tiers" },
    { id: "commissions" as const, label: "Commissions" },
    { id: "rewards" as const, label: "Rewards" },
  ];

  const rulesCats = [{ name: 'Premium', value: Number(data?.premiumRules??0) }, { name: 'Claims', value: Number(data?.claimsRules??0) }, { name: 'Underwriting', value: Number(data?.uwRules??0) }, { name: 'Compliance', value: Number(data?.complianceRules??0) }].filter(d=>d.value>0);
  const rulesStatus = [{ name: 'Active', value: Number(data?.activeRules??0) }, { name: 'Inactive', value: Number(data?.inactiveRules??0) }, { name: 'Draft', value: Number(data?.draftRules??0) }].filter(d=>d.value>0);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Business Rules</h1>
            <p className="text-gray-400 text-sm">
              CBN transaction limits, KYC tiers, commission rates, and reward
              catalog
            </p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        <div className="flex gap-2 border-b border-gray-800 pb-2">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 rounded-t text-sm font-medium ${activeTab === t.id ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {activeTab === "limits" && (
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white">
                CBN Transaction Limits
              </CardTitle>
            </CardHeader>
            <CardContent>
              {limitsQ.data ? (
                <div className="space-y-3">
                  {Object.entries(limitsQ.data).map(([k, v], i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 bg-gray-800 rounded"
                    >
                      <span className="text-sm text-gray-300">
                        {k
                          .replace(/([A-Z])/g, " $1")
                          .replace(/_/g, " ")
                          .trim()}
                      </span>
                      <span className="text-sm text-white font-mono">
                        {typeof v === "number"
                          ? `₦${(v as number).toLocaleString()}`
                          : String(v as any)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">Loading...</div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "kyc" && (
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white">KYC Tier Limits</CardTitle>
            </CardHeader>
            <CardContent>
              {kycQ.data ? (
                <div className="space-y-3">
                  {(Array.isArray(kycQ.data)
                    ? kycQ.data
                    : Object.entries(kycQ.data).map(([k, v]) => ({
                        tier: k,
                        ...(typeof v === "object" && v !== null
                          ? v
                          : { limit: v }),
                      }))
                  ).map((tier: any, i: number) => (
                    <div key={i} className="p-3 bg-gray-800 rounded">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-200 font-medium">
                          {tier.tier || tier.name || `Tier ${i + 1}`}
                        </span>
                        <Badge variant="outline">
                          {tier.dailyLimit
                            ? `₦${tier.dailyLimit.toLocaleString()}/day`
                            : String(tier.limit || "—")}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">Loading...</div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "commissions" && (
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white">Commission Rates</CardTitle>
            </CardHeader>
            <CardContent>
              {commQ.data ? (
                <div className="space-y-3">
                  {(Array.isArray(commQ.data)
                    ? commQ.data
                    : Object.entries(commQ.data).map(([k, v]) => ({
                        type: k,
                        ...(typeof v === "object" && v !== null
                          ? v
                          : { rate: v }),
                      }))
                  ).map((r: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between p-3 bg-gray-800 rounded"
                    >
                      <span className="text-sm text-gray-200">
                        {r.type || r.name || `Rate ${i + 1}`}
                      </span>
                      <span className="text-sm text-green-400 font-mono">
                        {r.rate
                          ? `${(r.rate * 100).toFixed(2)}%`
                          : String(r.percentage || r.value || "—")}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">Loading...</div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "rewards" && (
          <Card className="bg-gray-900 border-gray-800">
            <CardHeader>
              <CardTitle className="text-white">Reward Catalog</CardTitle>
            </CardHeader>
            <CardContent>
              {rewardsQ.data ? (
                <div className="space-y-3">
                  {(Array.isArray(rewardsQ.data)
                    ? rewardsQ.data
                    : [rewardsQ.data]
                  ).map((r: any, i: number) => (
                    <div key={i} className="p-3 bg-gray-800 rounded">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-200">
                          {r.name || r.title || `Reward ${i + 1}`}
                        </span>
                        <Badge className="bg-blue-600">
                          {r.points || r.value || "—"} pts
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-gray-500">Loading...</div>
              )}
            </CardContent>
          </Card>
        )}

        <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Rules by Category</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={rulesCats.length>0?rulesCats:[{name:"No data",value:1}]} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({name,value})=>`${name}: ${value}`}>{(rulesCats.length>0?rulesCats:[{name:"No data",value:1}]).map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip/></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Rules by Status</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={rulesStatus}><CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/><XAxis dataKey="name" tick={{fontSize:11,fill:"var(--text-secondary)"}}/><YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}}/><Tooltip/><Bar dataKey="value" radius={[4,4,0,0]}>{rulesStatus.map((_,i)=><Cell key={i} fill={["#22c55e","#6b7280","#f59e0b"][i%3]}/>)}</Bar></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
