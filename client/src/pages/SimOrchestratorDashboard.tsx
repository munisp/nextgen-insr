import { useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6"];
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function SimOrchestratorDashboard() {
  // No aggregate stats endpoint exists for these charts; render empty state.
  const data: Record<string, number | undefined> = {};
  const isMobile = useIsMobile();
  const [terminalId, setTerminalId] = useState("TERM-001");
  const [agentId, setAgentCode] = useState("AGT-001");

  const configQ = trpc.simOrchestrator.getConfig.useQuery(
    { terminalId, apiKey: import.meta.env.VITE_SIM_API_KEY ?? "" },
    { retry: false, enabled: !!terminalId }
  );
  const carrierQ = trpc.simOrchestrator.getCarrierSummary.useQuery(
    { agentCode: agentId, hours: 24 },
    { retry: false, enabled: !!agentId }
  );

  const simResults = [{ name: 'Passed', value: Number(data?.passed ?? 0) }, { name: 'Failed', value: Number(data?.failed ?? 0) }, { name: 'Pending', value: Number(data?.pending ?? 0) }].filter(d=>d.value>0);
  const simHistory = Array.from({length:7},(_,i)=>{ const d=new Date(Date.now()-(6-i)*86400000); return { day: d.toLocaleDateString('en-NG',{weekday:'short'}), runs: Math.max(0,Number(data?.totalRuns??0)*(0.5+Math.random())) }; });

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">SIM Orchestrator</h1>
            <p className="text-gray-400 text-sm">
              Multi-SIM management, carrier routing, and signal monitoring
            </p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Terminal ID
            </label>
            <Input
              value={terminalId}
              onChange={e => setTerminalId(e.target.value)}
              className="bg-gray-800 border-gray-700 text-white"
            />
          </div>
          <div>
            <label className="text-xs text-gray-400 block mb-1">
              Agent Code
            </label>
            <Input
              value={agentId}
              onChange={e => setAgentCode(e.target.value)}
              className="bg-gray-800 border-gray-700 text-white"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: "Probe Interval",
              value: configQ.data?.probeIntervalMs
                ? `${configQ.data.probeIntervalMs}ms`
                : "—",
              color: "text-white",
            },
            {
              label: "Relay Endpoint",
              value: configQ.data?.relayEndpoint || "—",
              color: "text-white",
            },
            {
              label: "Enabled",
              value: configQ.data?.enabled ? "Yes" : "No",
              color: configQ.data?.enabled ? "text-green-400" : "text-red-400",
            },
          ].map((kpi, i) => (
            <Card key={i} className="bg-gray-900 border-gray-800">
              <CardContent className="pt-4">
                <div className="text-xs text-gray-400">{kpi.label}</div>
                <div className={`text-lg font-bold ${kpi.color}`}>
                  {kpi.value}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">
              Carrier Summary (Last 24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {Array.isArray(carrierQ.data) && carrierQ.data.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-400 text-xs border-b border-gray-800">
                    <th className="text-left py-2">Slot</th>
                    <th className="text-left py-2">Carrier</th>
                    <th className="text-left py-2">Avg Score</th>
                    <th className="text-left py-2">Avg RSSI</th>
                    <th className="text-left py-2">Avg Latency</th>
                    <th className="text-left py-2">Selected</th>
                  </tr>
                </thead>
                <tbody>
                  {carrierQ.data.map((c: any, i: number) => (
                    <tr
                      key={i}
                      className="border-b border-gray-800/50 hover:bg-gray-800/30"
                    >
                      <td className="py-2 text-gray-300 font-mono">{c.slot}</td>
                      <td className="py-2 text-gray-200">{c.carrier}</td>
                      <td className="py-2">
                        <Badge
                          className={
                            c.avgScore > 70 ? "bg-green-600" : "bg-amber-600"
                          }
                        >
                          {c.avgScore?.toFixed(1)}
                        </Badge>
                      </td>
                      <td className="py-2 text-gray-400">
                        {c.avgRssi?.toFixed(0)} dBm
                      </td>
                      <td className="py-2 text-gray-400">
                        {c.avgLatencyMs?.toFixed(0)}ms
                      </td>
                      <td className="py-2 text-gray-400">
                        {c.selectedCount}/{c.totalCount}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-center py-8 text-gray-500">
                No carrier data available for this agent
              </div>
            )}
          </CardContent>
        </Card>

        <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Simulation Results</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={simResults.length>0?simResults:[{name:"No data",value:1}]} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({name,value})=>`${name}: ${value}`}>{(simResults.length>0?simResults:[{name:"No data",value:1}]).map((_,i)=><Cell key={i} fill={["#22c55e","#ef4444","#f59e0b"][i%3]}/>)}</Pie><Tooltip/></PieChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Simulation Run History</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={simHistory}><CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/><XAxis dataKey="day" tick={{fontSize:11,fill:"var(--text-secondary)"}}/><YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}}/><Tooltip/><Bar dataKey="runs" fill="#6366f1" radius={[4,4,0,0]} name="Runs"/></BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
