import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function SimOrchestratorDashboard() {
  const [terminalId, setTerminalId] = useState("TERM-001");
  const [agentId, setAgentCode] = useState("AGT-001");

  const configQ = trpc.simOrchestrator.getConfig.useQuery(
    { terminalId, apiKey: import.meta.env.VITE_SIM_API_KEY ?? "" },
    { retry: false, enabled: !!terminalId }
  );
  const carrierQ = trpc.simOrchestrator.getCarrierSummary.useQuery(
    { agentId, hours: 24 },
    { retry: false, enabled: !!agentId }
  );

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
      </div>
    </div>
  );
}
