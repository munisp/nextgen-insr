/**
 * MQTTBridgeTab — Fluvio MQTT Source Connector configuration UI
 * Allows admins to configure, test, publish synthetic events, and generate
 * InfinyOn connector YAML for bridging insurance service MQTT events into Fluvio topics.
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Loader2,
  Plus,
  Trash2,
  Download,
  Play,
  Save,
  Wifi,
  WifiOff,
  Copy,
  Zap,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface TopicMapping {
  mqttTopic: string;
  fluvioTopic: string;
  transform?: string;
}

const FLUVIO_TOPICS = [
  "pos.transactions.created",
  "pos.fraud-alerts",
  "pos.float-events",
  "pos.kyc-events",
  "pos.terminal-heartbeat",
];

export function MQTTBridgeTab() {
  const [activeTab, setActiveTab] = useState<"config" | "test" | "spec">(
    "config"
  );

  // ── Server state ─────────────────────────────────────────────────────────────
  const {
    data: config,
    isLoading,
    refetch,
  } = trpc.mqttBridge.getConfig.useQuery();
  const saveMutation = trpc.mqttBridge.saveConfig.useMutation({
    onSuccess: () => {
      toast.success("Configuration saved");
      refetch();
    },
    onError: e => toast.error(`Save failed: ${e.message}`),
  });
  const testMutation = trpc.mqttBridge.testMqttBridge.useMutation({
    onSuccess: r => {
      if (r.success) toast.success(`Connection successful: ${r.message}`);
      else toast.error(`Connection failed: ${r.message}`);
    },
    onError: e => toast.error(`Test failed: ${e.message}`),
  });
  const publishTestMutation = trpc.mqttBridge.publishTest.useMutation({
    onSuccess: r => {
      if (r.success) {
        toast.success(`Published to '${r.topic}' in ${r.latencyMs}ms`);
        setLastPublishResult(r);
      } else {
        toast.error(`Publish failed: ${r.message}`);
        setLastPublishResult(r);
      }
    },
    onError: e => toast.error(`Publish failed: ${e.message}`),
  });

  // ── Local form state ──────────────────────────────────────────────────────────
  const [brokerUrl, setBrokerUrl] = useState("mqtt://broker.insureportal.io:1883");
  const [port, setPort] = useState(1883);
  const [useTls, setUseTls] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [clientId, setClientId] = useState("insureportal-fluvio-bridge");
  const [qos, setQos] = useState<"0" | "1" | "2">("1");
  const [keepAlive, setKeepAlive] = useState(60);
  const [enabled, setEnabled] = useState(false);
  const [topicMappings, setTopicMappings] = useState<TopicMapping[]>([]);
  const [initialized, setInitialized] = useState(false);

  // ── Publish test state ────────────────────────────────────────────────────────
  const [testTopic, setTestTopic] = useState("pos.transactions.created");
  const [testPayloadStr, setTestPayloadStr] = useState(
    JSON.stringify(
      {
        type: "MQTT_BRIDGE_TEST",
        ref: "TEST-001",
        agentCode: "AGT-INSUREPORTAL",
        amount: 5000,
        currency: "NGN",
        channel: "POS",
        source: "mqtt-bridge-test-harness",
      },
      null,
      2
    )
  );
  const [lastPublishResult, setLastPublishResult] = useState<{
    success: boolean;
    latencyMs: number;
    topic: string;
    message: string;
  } | null>(null);

  // Populate form from server data once
  if (config && !initialized) {
    setBrokerUrl(config.brokerUrl ?? "mqtt://broker.insureportal.io:1883");
    setPort(config.port ?? 1883);
    setUseTls(config.useTls ?? false);
    setUsername(config.username ?? "");
    setPassword(config.password ?? "");
    setClientId(config.clientId ?? "insureportal-fluvio-bridge");
    setQos((config.qos as "0" | "1" | "2") ?? "1");
    setKeepAlive(config.keepAliveSeconds ?? 60);
    setEnabled(config.enabled ?? false);
    setTopicMappings((config.topicMappings as TopicMapping[]) ?? []);
    setInitialized(true);
  }

  // ── Connector spec query ──────────────────────────────────────────────────────
  const specQuery = trpc.mqttBridge.generateConnectorSpec.useQuery(
    {
      brokerUrl,
      port,
      username: username || undefined,
      password: password || undefined,
      useTls,
      clientId,
      topicMappings,
      qos,
      keepAliveSeconds: keepAlive,
    },
    { enabled: activeTab === "spec" && topicMappings.length > 0 }
  );

  const handleSave = () => {
    saveMutation.mutate({
      brokerUrl,
      port,
      useTls,
      username,
      password,
      clientId,
      topicMappings,
      qos,
      keepAliveSeconds: keepAlive,
      enabled,
    });
  };

  const handleTest = () => {
    testMutation.mutate({ brokerUrl, port, useTls });
  };

  const handlePublishTest = () => {
    let payload: Record<string, unknown> | undefined;
    try {
      payload = JSON.parse(testPayloadStr);
    } catch {
      toast.error("Invalid JSON payload");
      return;
    }
    publishTestMutation.mutate({ topic: testTopic, payload });
  };

  const addTopicMapping = () => {
    setTopicMappings(prev => [
      ...prev,
      {
        mqttTopic: "pos/+/transactions",
        fluvioTopic: "pos.transactions.created",
        transform: "json",
      },
    ]);
  };

  const removeTopicMapping = (idx: number) => {
    setTopicMappings(prev => prev.filter((_, i) => i !== idx));
  };

  const updateTopicMapping = (
    idx: number,
    field: keyof TopicMapping,
    value: string
  ) => {
    setTopicMappings(prev =>
      prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m))
    );
  };

  const downloadSpec = (name: string, yaml: string) => {
    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Copied to clipboard"));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const lastTestStatus = config?.lastTestStatus ?? "never";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">MQTT Bridge Configuration</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Configure InfinyOn MQTT Source Connector to bridge insurance service
            events into Fluvio topics.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastTestStatus === "success" ? (
            <Badge variant="default" className="gap-1 bg-green-600">
              <Wifi className="w-3 h-3" /> Reachable
            </Badge>
          ) : lastTestStatus === "failed" ? (
            <Badge variant="destructive" className="gap-1">
              <WifiOff className="w-3 h-3" /> Unreachable
            </Badge>
          ) : (
            <Badge variant="secondary" className="gap-1">
              Not tested
            </Badge>
          )}
          <div className="flex items-center gap-2">
            <Label htmlFor="bridge-enabled" className="text-sm">
              Enabled
            </Label>
            <Switch
              id="bridge-enabled"
              checked={enabled}
              onCheckedChange={setEnabled}
            />
          </div>
        </div>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={v => setActiveTab(v as "config" | "test" | "spec")}
      >
        <TabsList>
          <TabsTrigger value="config">⚙️ Broker Config</TabsTrigger>
          <TabsTrigger value="test">⚡ Publish Test</TabsTrigger>
          <TabsTrigger value="spec">📄 Connector YAML</TabsTrigger>
        </TabsList>

        {/* ── Broker Config Tab ─────────────────────────────────────────────── */}
        <TabsContent value="config" className="space-y-6 mt-4">
          {/* Connection */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Broker Connection</CardTitle>
              <CardDescription>
                MQTT broker endpoint and authentication settings.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2 space-y-1">
                <Label>Broker URL</Label>
                <Input
                  value={brokerUrl}
                  onChange={e => setBrokerUrl(e.target.value)}
                  placeholder="mqtt://broker.insureportal.io:1883"
                />
                <p className="text-xs text-muted-foreground">
                  Use <code>mqtt://</code> or <code>mqtts://</code> for TLS.
                  Default: <code>mqtt://broker.insureportal.io:1883</code>
                </p>
              </div>
              <div className="space-y-1">
                <Label>Port</Label>
                <Input
                  type="number"
                  value={port}
                  onChange={e => setPort(Number(e.target.value))}
                  placeholder="1883 (plain) / 8883 (TLS)"
                />
              </div>
              <div className="space-y-1">
                <Label>Client ID</Label>
                <Input
                  value={clientId}
                  onChange={e => setClientId(e.target.value)}
                  placeholder="insureportal-fluvio-bridge"
                />
              </div>
              <div className="space-y-1">
                <Label>Username</Label>
                <Input
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div className="flex items-center gap-3">
                <Switch id="tls" checked={useTls} onCheckedChange={setUseTls} />
                <Label htmlFor="tls">Use TLS / SSL (port 8883)</Label>
              </div>
            </CardContent>
          </Card>

          {/* Reliability */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Reliability Settings</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>QoS Level</Label>
                <Select
                  value={qos}
                  onValueChange={v => setQos(v as "0" | "1" | "2")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">
                      0 — At most once (fire and forget)
                    </SelectItem>
                    <SelectItem value="1">
                      1 — At least once (acknowledged)
                    </SelectItem>
                    <SelectItem value="2">
                      2 — Exactly once (guaranteed)
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Keep-Alive (seconds)</Label>
                <Input
                  type="number"
                  value={keepAlive}
                  onChange={e => setKeepAlive(Number(e.target.value))}
                  min={10}
                  max={3600}
                />
              </div>
            </CardContent>
          </Card>

          {/* Topic Mappings */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Topic Mappings</CardTitle>
                  <CardDescription>
                    Map MQTT topics to Fluvio topics. Wildcards (+, #) are
                    supported.
                  </CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={addTopicMapping}>
                  <Plus className="w-4 h-4 mr-1" /> Add Mapping
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {topicMappings.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No topic mappings. Click "Add Mapping" to start.
                </p>
              )}
              {topicMappings.map((m, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center"
                >
                  <Input
                    value={m.mqttTopic}
                    onChange={e =>
                      updateTopicMapping(i, "mqttTopic", e.target.value)
                    }
                    placeholder="pos/+/transactions"
                    className="font-mono text-sm"
                  />
                  <Input
                    value={m.fluvioTopic}
                    onChange={e =>
                      updateTopicMapping(i, "fluvioTopic", e.target.value)
                    }
                    placeholder="pos.transactions.created"
                    className="font-mono text-sm"
                  />
                  <Select
                    value={m.transform ?? "none"}
                    onValueChange={v =>
                      updateTopicMapping(i, "transform", v === "none" ? "" : v)
                    }
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => removeTopicMapping(i)}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </div>
              ))}
              {topicMappings.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  MQTT topic → Fluvio topic → Transform. Use <code>+</code> for
                  single-level wildcard, <code>#</code> for multi-level.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Actions */}
          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Save className="w-4 h-4 mr-2" />
              )}
              Save Configuration
            </Button>
            <Button
              variant="outline"
              onClick={handleTest}
              disabled={testMutation.isPending || !brokerUrl}
            >
              {testMutation.isPending ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Play className="w-4 h-4 mr-2" />
              )}
              Test TCP Connection
            </Button>
          </div>
        </TabsContent>

        {/* ── Publish Test Tab ──────────────────────────────────────────────── */}
        <TabsContent value="test" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Publish Test Event</CardTitle>
              <CardDescription>
                Send a synthetic event directly to a Fluvio topic to validate
                the full MQTT → Fluvio pipeline. The event is published via the
                server-side Fluvio producer and round-trip latency is measured.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label>Target Fluvio Topic</Label>
                <Select value={testTopic} onValueChange={setTestTopic}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FLUVIO_TOPICS.map(t => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Event Payload (JSON)</Label>
                <Textarea
                  value={testPayloadStr}
                  onChange={e => setTestPayloadStr(e.target.value)}
                  className="font-mono text-xs h-48 bg-muted"
                  placeholder='{"type": "MQTT_BRIDGE_TEST", ...}'
                />
              </div>
              <Button
                onClick={handlePublishTest}
                disabled={publishTestMutation.isPending}
              >
                {publishTestMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Zap className="w-4 h-4 mr-2" />
                )}
                Publish Test Event
              </Button>

              {/* Result */}
              {lastPublishResult && (
                <div
                  className={`rounded-md border p-4 space-y-2 ${lastPublishResult.success ? "border-green-500/40 bg-green-500/5" : "border-destructive/40 bg-destructive/5"}`}
                >
                  <div className="flex items-center gap-2">
                    {lastPublishResult.success ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <XCircle className="w-5 h-5 text-destructive" />
                    )}
                    <span className="font-medium text-sm">
                      {lastPublishResult.success
                        ? "Published successfully"
                        : "Publish failed"}
                    </span>
                    <Badge
                      variant="outline"
                      className="ml-auto font-mono text-xs"
                    >
                      {lastPublishResult.latencyMs}ms
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {lastPublishResult.message}
                  </p>
                  <p className="text-xs text-muted-foreground font-mono">
                    Topic:{" "}
                    <span className="text-foreground">
                      {lastPublishResult.topic}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Check the <strong>Fluvio Stream</strong> tab above to see
                    the event appear in the live feed.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Connector YAML Tab ────────────────────────────────────────────── */}
        <TabsContent value="spec" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                InfinyOn Connector YAML
              </CardTitle>
              <CardDescription>
                Generated YAML specs for each topic mapping. Deploy with{" "}
                <code className="text-xs bg-muted px-1 rounded">
                  fluvio cloud connector create --config &lt;file&gt;.yaml
                </code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {specQuery.isLoading && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Generating
                  connector specs...
                </div>
              )}
              {topicMappings.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  Add topic mappings in the Broker Config tab to generate
                  connector YAML.
                </p>
              )}
              {specQuery.data?.connectors.map(c => (
                <div key={c.name} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <code className="text-sm font-medium">{c.name}.yaml</code>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => copyToClipboard(c.yaml)}
                      >
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadSpec(c.name, c.yaml)}
                      >
                        <Download className="w-3 h-3 mr-1" /> Download
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={c.yaml}
                    readOnly
                    className="font-mono text-xs h-48 bg-muted"
                  />
                </div>
              ))}
              {specQuery.data && specQuery.data.connectors.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <code className="text-sm font-medium">
                      install-mqtt-connectors.sh
                    </code>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          copyToClipboard(specQuery.data!.installScript)
                        }
                      >
                        <Copy className="w-3 h-3 mr-1" /> Copy
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          downloadSpec(
                            "install-mqtt-connectors",
                            specQuery.data!.installScript
                          )
                        }
                      >
                        <Download className="w-3 h-3 mr-1" /> Download
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={specQuery.data.installScript}
                    readOnly
                    className="font-mono text-xs h-32 bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Run this script on any machine with the Fluvio CLI installed
                    and authenticated to InfinyOn Cloud. All{" "}
                    {specQuery.data.topicCount} connector(s) will be deployed in
                    sequence.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
