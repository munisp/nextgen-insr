import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Bell,
  Mail,
  MessageSquare,
  Webhook,
  Hash,
  Shield,
  AlertTriangle,
  Clock,
  Send,
  ChevronDown,
  ChevronRight,
  CheckCircle,
  XCircle,
  Settings,
  Zap,
  BarChart2,
  RefreshCw,
  TestTube2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const severityColors: Record<string, string> = {
  critical: "bg-red-500/10 text-red-400 border-red-500/30",
  high: "bg-orange-500/10 text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/10 text-yellow-400 border-yellow-500/30",
  low: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  info: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

const channelIcons: Record<string, any> = {
  push: Bell,
  email: Mail,
  sms: MessageSquare,
  webhook: Webhook,
  slack: Hash,
};

const categoryLabels: Record<string, string> = {
  ransomware: "Ransomware Detection",
  bulk_operation: "Bulk Operation Limits",
  file_integrity: "File Integrity Violations",
  exfiltration: "Data Exfiltration",
  brute_force: "Brute Force Attacks",
  canary_trigger: "Canary File Triggers",
  ddos: "DDoS Attacks",
  deepfake: "Deepfake Detection",
  unauthorized_access: "Unauthorized Access",
};

export default function AlertNotificationPreferences() {
  const [selectedAdmin, setSelectedAdmin] = useState<string | null>(null);
  const [expandedEscalation, setExpandedEscalation] = useState<string | null>(
    null
  );

  const {
    data: preferences,
    isLoading: loadingPrefs,
    refetch: refetchPrefs,
  } = trpc.alertNotifications.listPreferences.useQuery();
  const { data: deliveryStats, isLoading: loadingStats } =
    trpc.alertNotifications.getStats.useQuery();
  const { data: escalationRules } =
    trpc.alertNotifications.listEscalationRules.useQuery();
  const { data: deliveryHistory, refetch: refetchHistory } =
    trpc.alertNotifications.list.useQuery({ limit: 20 });
  const updatePref = trpc.alertNotifications.updatePreference.useMutation({
    onSuccess: () => {
      toast("Preferences updated successfully");
      refetchPrefs();
    },
    onError: err => toast.error(`Failed to update: ${err.message}`),
  });
  const updateRule = trpc.alertNotifications.updateEscalationRule.useMutation({
    onSuccess: () => toast("Escalation rule updated"),
  });

  // F-12 (S87-02): alertNotifications.sendTestAlert is not delivered — the
  // action fails loud at runtime instead of calling a phantom procedure.
  const sendTest = {
    mutate: () => toast.error("Test-alert delivery is not available on this deployment"),
    isPending: false,
  };

  const currentPref =
    preferences?.find((p: any) => p.adminId === selectedAdmin) ??
    preferences?.[0];

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Shield className="w-6 h-6 text-red-400" />
              Security Alert Notifications
            </h1>
            <p className="text-gray-400 mt-1">
              Configure how and when administrators receive critical security
              alerts
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchPrefs()}
            className="border-gray-700 text-gray-300"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Delivery Stats Cards */}
        {deliveryStats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-[#12121a] border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Total Sent
                    </p>
                    <p className="text-2xl font-bold text-white">
                      {deliveryStats.totalSent}
                    </p>
                  </div>
                  <Send className="w-8 h-8 text-blue-400/50" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[#12121a] border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Delivered
                    </p>
                    <p className="text-2xl font-bold text-green-400">
                      {deliveryStats.totalDelivered}
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-green-400/50" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[#12121a] border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Failed
                    </p>
                    <p className="text-2xl font-bold text-red-400">
                      {deliveryStats.totalFailed}
                    </p>
                  </div>
                  <XCircle className="w-8 h-8 text-red-400/50" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[#12121a] border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Last 24h
                    </p>
                    <p className="text-2xl font-bold text-yellow-400">
                      {deliveryStats.last24h.sent}
                    </p>
                  </div>
                  <Clock className="w-8 h-8 text-yellow-400/50" />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        <Tabs defaultValue="preferences" className="space-y-4">
          <TabsList className="bg-[#12121a] border border-gray-800">
            <TabsTrigger value="preferences">
              <Settings className="w-4 h-4 mr-1" /> Preferences
            </TabsTrigger>
            <TabsTrigger value="channels">
              <Zap className="w-4 h-4 mr-1" /> Channel Stats
            </TabsTrigger>
            <TabsTrigger value="escalation">
              <AlertTriangle className="w-4 h-4 mr-1" /> Escalation Rules
            </TabsTrigger>
            <TabsTrigger value="history">
              <BarChart2 className="w-4 h-4 mr-1" /> Delivery History
            </TabsTrigger>
          </TabsList>

          {/* ── Preferences Tab ─────────────────────────────────────────── */}
          <TabsContent value="preferences" className="space-y-4">
            {/* Admin Selector */}
            {preferences && preferences.length > 0 && (
              <div className="flex items-center gap-4">
                <Select
                  value={selectedAdmin || preferences[0]?.adminId}
                  onValueChange={setSelectedAdmin}
                >
                  <SelectTrigger className="w-64 bg-[#12121a] border-gray-700">
                    <SelectValue placeholder="Select administrator" />
                  </SelectTrigger>
                  <SelectContent>
                    {preferences.map((p: any) => (
                      <SelectItem key={p.adminId} value={p.adminId}>
                        {p.adminName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-gray-700"
                  onClick={() => {
                    if (currentPref) {
                      sendTest.mutate({
                        adminId: currentPref.adminId,
                        severity: "info",
                      });
                    }
                  }}
                  disabled={sendTest.isPending}
                >
                  <TestTube2 className="w-4 h-4 mr-1" />
                  Send Test Alert
                </Button>
              </div>
            )}

            {currentPref && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Channel Toggles */}
                <Card className="bg-[#12121a] border-gray-800">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      Delivery Channels
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {(
                      Object.entries(currentPref.channels) as [
                        string,
                        boolean,
                      ][]
                    ).map(([channel, enabled]) => {
                      const Icon = channelIcons[channel] || Bell;
                      return (
                        <div
                          key={channel}
                          className="flex items-center justify-between py-2 border-b border-gray-800 last:border-0"
                        >
                          <div className="flex items-center gap-3">
                            <Icon className="w-5 h-5 text-gray-400" />
                            <div>
                              <p className="text-sm font-medium text-white capitalize">
                                {channel}
                              </p>
                              <p className="text-xs text-gray-500">
                                {channel === "push" &&
                                  "Manus platform notifications"}
                                {channel === "email" && currentPref.adminEmail}
                                {channel === "sms" &&
                                  (currentPref.adminPhone ||
                                    "No phone configured")}
                                {channel === "webhook" &&
                                  (currentPref.webhookUrl ||
                                    "No URL configured")}
                                {channel === "slack" &&
                                  (currentPref.slackWebhookUrl ||
                                    "No URL configured")}
                              </p>
                            </div>
                          </div>
                          <Switch
                            checked={enabled}
                            onCheckedChange={checked => {
                              updatePref.mutate({
                                adminId: currentPref.adminId,
                                channels: { [channel]: checked },
                              });
                            }}
                          />
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>

                {/* Severity Threshold & Quiet Hours */}
                <div className="space-y-4">
                  <Card className="bg-[#12121a] border-gray-800">
                    <CardHeader>
                      <CardTitle className="text-lg text-white">
                        Severity Threshold
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-xs text-gray-500 mb-3">
                        Only receive alerts at or above this severity level
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {["info", "low", "medium", "high", "critical"].map(
                          (sev: any) => (
                            <button
                              key={sev}
                              onClick={() =>
                                updatePref.mutate({
                                  adminId: currentPref.adminId,
                                  severityThreshold: sev as any,
                                })
                              }
                              className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                                currentPref.severityThreshold === sev
                                  ? severityColors[sev] +
                                    " ring-1 ring-offset-1 ring-offset-[#12121a]"
                                  : "bg-gray-800/50 text-gray-500 border-gray-700 hover:border-gray-600"
                              }`}
                            >
                              {sev.toUpperCase()}
                            </button>
                          )
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="bg-[#12121a] border-gray-800">
                    <CardHeader>
                      <CardTitle className="text-lg text-white flex items-center gap-2">
                        <Clock className="w-4 h-4" /> Quiet Hours
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-400">
                          Enable quiet hours
                        </span>
                        <Switch
                          checked={currentPref.quietHours?.enabled ?? false}
                          onCheckedChange={checked =>
                            updatePref.mutate({
                              adminId: currentPref.adminId,
                              quietHours: {
                                enabled: checked,
                                startHour:
                                  currentPref.quietHours?.startHour ?? 23,
                                endHour: currentPref.quietHours?.endHour ?? 6,
                                overrideForCritical:
                                  currentPref.quietHours?.overrideForCritical ??
                                  true,
                              },
                            })
                          }
                        />
                      </div>
                      {currentPref.quietHours?.enabled && (
                        <>
                          <p className="text-xs text-gray-500">
                            {currentPref.quietHours.startHour}:00 UTC →{" "}
                            {currentPref.quietHours.endHour}:00 UTC
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-400">
                              Override for critical alerts
                            </span>
                            <Switch
                              checked={
                                currentPref.quietHours.overrideForCritical
                              }
                              onCheckedChange={checked =>
                                updatePref.mutate({
                                  adminId: currentPref.adminId,
                                  quietHours: {
                                    ...currentPref.quietHours!,
                                    overrideForCritical: checked,
                                  },
                                })
                              }
                            />
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Category Subscriptions */}
                <Card className="bg-[#12121a] border-gray-800 lg:col-span-2">
                  <CardHeader>
                    <CardTitle className="text-lg text-white">
                      Alert Categories
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {Object.entries(categoryLabels).map(([cat, label]) => {
                        const isSubscribed = currentPref.categories.includes(
                          cat as any
                        );
                        return (
                          <button
                            key={cat}
                            onClick={() => {
                              const newCategories = isSubscribed
                                ? currentPref.categories.filter(
                                    (c: any) => c !== cat
                                  )
                                : [...currentPref.categories, cat];
                              updatePref.mutate({
                                adminId: currentPref.adminId,
                                categories: newCategories as any,
                              });
                            }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all ${
                              isSubscribed
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                                : "bg-gray-800/30 border-gray-700 text-gray-500 hover:border-gray-600"
                            }`}
                          >
                            {isSubscribed ? (
                              <CheckCircle className="w-4 h-4 flex-shrink-0" />
                            ) : (
                              <XCircle className="w-4 h-4 flex-shrink-0" />
                            )}
                            <span className="text-sm">{label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </TabsContent>

          {/* ── Channel Stats Tab ───────────────────────────────────────── */}
          <TabsContent value="channels">
            {deliveryStats && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {(
                  Object.entries(deliveryStats.byChannel) as [string, any][]
                ).map(([channel, stats]) => {
                  const Icon = channelIcons[channel] || Bell;
                  const total = stats.sent || 1;
                  const successRate = Math.round(
                    (stats.delivered / total) * 100
                  );
                  return (
                    <Card
                      key={channel}
                      className="bg-[#12121a] border-gray-800"
                    >
                      <CardContent className="pt-4 pb-4">
                        <div className="flex items-center gap-3 mb-3">
                          <Icon className="w-5 h-5 text-gray-400" />
                          <span className="text-sm font-medium text-white capitalize">
                            {channel}
                          </span>
                          <Badge
                            variant="outline"
                            className={
                              successRate >= 90
                                ? "text-green-400 border-green-500/30"
                                : successRate >= 50
                                  ? "text-yellow-400 border-yellow-500/30"
                                  : "text-red-400 border-red-500/30"
                            }
                          >
                            {successRate}% success
                          </Badge>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div>
                            <p className="text-lg font-bold text-white">
                              {stats.sent}
                            </p>
                            <p className="text-xs text-gray-500">Sent</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-green-400">
                              {stats.delivered}
                            </p>
                            <p className="text-xs text-gray-500">Delivered</p>
                          </div>
                          <div>
                            <p className="text-lg font-bold text-red-400">
                              {stats.failed}
                            </p>
                            <p className="text-xs text-gray-500">Failed</p>
                          </div>
                        </div>
                        {/* Progress bar */}
                        <div className="mt-3 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all"
                            style={{ width: `${successRate}%` }}
                          />
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          {/* ── Escalation Rules Tab ────────────────────────────────────── */}
          <TabsContent value="escalation" className="space-y-4">
            {escalationRules?.map((rule: any) => (
              <Card key={rule.id} className="bg-[#12121a] border-gray-800">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between">
                    <div
                      className="flex items-center gap-3 cursor-pointer flex-1"
                      onClick={() =>
                        setExpandedEscalation(
                          expandedEscalation === rule.id ? null : rule.id
                        )
                      }
                    >
                      {expandedEscalation === rule.id ? (
                        <ChevronDown className="w-4 h-4 text-gray-400" />
                      ) : (
                        <ChevronRight className="w-4 h-4 text-gray-400" />
                      )}
                      <AlertTriangle className="w-4 h-4 text-orange-400" />
                      <span className="text-sm font-medium text-white">
                        {rule.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge
                        variant="outline"
                        className="text-gray-400 border-gray-700"
                      >
                        {rule.triggerAfterMinutes}m
                      </Badge>
                      <Switch
                        checked={rule.enabled}
                        onCheckedChange={checked =>
                          updateRule.mutate({
                            ruleId: rule.id,
                            enabled: checked,
                          })
                        }
                      />
                    </div>
                  </div>
                  {expandedEscalation === rule.id && (
                    <div className="mt-3 pl-11 space-y-2 text-sm text-gray-400">
                      <p>
                        Trigger: After{" "}
                        <strong className="text-white">
                          {rule.triggerAfterMinutes} minutes
                        </strong>{" "}
                        unacknowledged
                      </p>
                      <p>
                        From:{" "}
                        <Badge className={severityColors[rule.fromSeverity]}>
                          {rule.fromSeverity}
                        </Badge>{" "}
                        → To:{" "}
                        <Badge
                          className={severityColors[rule.escalateToSeverity]}
                        >
                          {rule.escalateToSeverity}
                        </Badge>
                      </p>
                      <p>
                        Additional recipients:{" "}
                        {rule.notifyAdditionalRecipients.length > 0
                          ? rule.notifyAdditionalRecipients.join(", ")
                          : "None"}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </TabsContent>

          {/* ── Delivery History Tab ────────────────────────────────────── */}
          <TabsContent value="history">
            <Card className="bg-[#12121a] border-gray-800">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-lg text-white">
                  Recent Deliveries
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refetchHistory()}
                  className="border-gray-700 text-gray-300"
                >
                  <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                </Button>
              </CardHeader>
              <CardContent>
                {deliveryHistory?.records &&
                deliveryHistory.records.length > 0 ? (
                  <div className="space-y-2">
                    {deliveryHistory.records.map((record: any) => {
                      const Icon = channelIcons[record.channel] || Bell;
                      return (
                        <div
                          key={record.id}
                          className="flex items-center gap-3 py-2 border-b border-gray-800 last:border-0"
                        >
                          <Icon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate">
                              {record.messagePreview}
                            </p>
                            <p className="text-xs text-gray-500">
                              {record.recipientAddress} •{" "}
                              {new Date(record.sentAt).toLocaleString()}
                            </p>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              record.status === "delivered" ||
                              record.status === "sent"
                                ? "text-green-400 border-green-500/30"
                                : record.status === "pending"
                                  ? "text-yellow-400 border-yellow-500/30"
                                  : "text-red-400 border-red-500/30"
                            }
                          >
                            {record.status}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500 text-center py-8">
                    No delivery records yet. Send a test alert to generate
                    history.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
