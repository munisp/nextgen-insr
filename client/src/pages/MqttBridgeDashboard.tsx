import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
const COLORS = ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#8b5cf6"];
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function MqttBridgeDashboard() {
  const configQ = trpc.mqttBridge.getConfig.useQuery(undefined, {
    retry: false,
  });
  const testMut = trpc.mqttBridge.testMqttBridge.useMutation({
    onSuccess: () => toast.success("MQTT bridge test passed"),
    onError: (e: any) => toast.error(e.message),
  });
  const publishMut = trpc.mqttBridge.publishTest.useMutation({
    onSuccess: () => toast.success("Test message published"),
    onError: (e: any) => toast.error(e.message),
  });

  const cfg = configQ.data;

  const mqttTrend = Array.from({length:12},(_,i)=>({ time: `${i*5}m`, messages: Math.max(0,Number(data?.messagesPerMin??10)*(0.5+Math.random())) }));
  const deviceStatus = [{ name: 'Connected', value: Number(data?.connectedDevices??0) }, { name: 'Offline', value: Number(data?.offlineDevices??0) }, { name: 'Error', value: Number(data?.errorDevices??0) }].filter(d=>d.value>0);

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">MQTT Bridge</h1>
            <p className="text-gray-400 text-sm">
              Mosquitto MQTT broker integration for insurance service communication
            </p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        <div className="grid grid-cols-3 gap-4">
          {[
            {
              label: "Broker",
              value: cfg?.brokerUrl || "mqtt://localhost",
              color: "text-white",
            },
            {
              label: "Port",
              value: String(cfg?.port ?? 1883),
              color: "text-white",
            },
            {
              label: "TLS",
              value: cfg?.useTls ? "Enabled" : "Disabled",
              color: cfg?.useTls ? "text-green-400" : "text-amber-400",
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

        <div className="flex gap-3">
          <Button
            onClick={() =>
              testMut.mutate({
                brokerUrl: cfg?.brokerUrl || "mqtt://localhost",
              })
            }
            disabled={testMut.isPending}
            className="bg-blue-600 hover:bg-blue-700"
          >
            {testMut.isPending ? "Testing..." : "Test Connection"}
          </Button>
          <Button
            onClick={() =>
              publishMut.mutate({
                topic: "pos.transactions.created",
                payload: { test: true },
              })
            }
            disabled={publishMut.isPending}
            variant="outline"
            className="text-gray-300 border-gray-600"
          >
            {publishMut.isPending ? "Publishing..." : "Publish Test Message"}
          </Button>
        </div>

        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Bridge Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            {cfg ? (
              <div className="space-y-3">
                {[
                  { label: "Name", value: cfg.name },
                  { label: "Broker URL", value: cfg.brokerUrl },
                  { label: "Port", value: String(cfg.port) },
                  { label: "TLS", value: cfg.useTls ? "Yes" : "No" },
                  { label: "Client ID", value: cfg.clientId || "auto" },
                ].map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between p-3 bg-gray-800 rounded"
                  >
                    <span className="text-sm text-gray-300">{item.label}</span>
                    <span className="text-sm text-white font-mono">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500">
                Loading configuration...
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">Topic Mappings</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {(cfg?.topicMappings || []).map((t: any, i: number) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-2 bg-gray-800 rounded"
                >
                  <div className="flex gap-2 items-center">
                    <span className="text-sm text-gray-200 font-mono">
                      {t.mqttTopic}
                    </span>
                    <span className="text-gray-500">→</span>
                    <span className="text-sm text-blue-400 font-mono">
                      {t.fluvioTopic}
                    </span>
                  </div>
                  <Badge className="bg-green-600">Active</Badge>
                </div>
              ))}
              {(!cfg?.topicMappings || cfg.topicMappings.length === 0) && (
                <div className="text-center py-4 text-gray-500">
                  No topic mappings configured
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className={`grid gap-4 ${isMobile ? "grid-cols-1" : "grid-cols-2"}`}>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>MQTT Message Rate (1h)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={mqttTrend}><CartesianGrid strokeDasharray="3 3" stroke="var(--card-border)"/><XAxis dataKey="time" tick={{fontSize:9,fill:"var(--text-secondary)"}}/><YAxis tick={{fontSize:11,fill:"var(--text-secondary)"}}/><Tooltip/><Area type="monotone" dataKey="messages" stroke="#6366f1" fill="#6366f120" strokeWidth={2} name="Messages/min"/></AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-xl p-4" style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text-primary)" }}>Device Connection Status</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart><Pie data={deviceStatus.length>0?deviceStatus:[{name:"No devices",value:1}]} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({name,value})=>`${name}: ${value}`}>{(deviceStatus.length>0?deviceStatus:[{name:"No devices",value:1}]).map((_,i)=><Cell key={i} fill={["#22c55e","#6b7280","#ef4444"][i%3]}/>)}</Pie><Tooltip/></PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
