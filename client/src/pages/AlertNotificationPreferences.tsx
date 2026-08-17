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
  const [expandedEscalation, setExpandedEscalation] = useState<string | null>(
    null
  );

  const { data: deliveryStats, isLoading: loadingStats } =
    trpc.alertNotifications.getStats.useQuery();
  const { data: deliveryHistory, refetch: refetchHistory } =
    trpc.alertNotifications.list.useQuery({ limit: 20 });

  // F-12 (S87-02): alertNotifications.sendTestAlert is not delivered — the
  // action fails loud at runtime instead of calling a phantom procedure.
  const sendTest = {
    mutate: () => toast.error("Test-alert delivery is not available on this deployment"),
    isPending: false,
  };


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
            onClick={() => refetchHistory()}
            className="border-gray-700 text-gray-300"
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        {/* Delivery Stats Cards — F-12 (wave-4b): real getStats fields
            (alert counts); per-channel delivery metrics have no source. */}
        {deliveryStats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-[#12121a] border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Total Alerts
                    </p>
                    <p className="text-2xl font-bold text-white">
                      {deliveryStats.totalAlerts}
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
                      Unacknowledged
                    </p>
                    <p className="text-2xl font-bold text-amber-400">
                      {deliveryStats.unacknowledged}
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-amber-400/50" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[#12121a] border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Critical
                    </p>
                    <p className="text-2xl font-bold text-red-400">
                      {deliveryStats.critical}
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-red-400/50" />
                </div>
              </CardContent>
            </Card>
            <Card className="bg-[#12121a] border-gray-800">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider">
                      Warning
                    </p>
                    <p className="text-2xl font-bold text-amber-300">
                      {deliveryStats.warning}
                    </p>
                  </div>
                  <CheckCircle className="w-8 h-8 text-amber-300/50" />
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
            {/* F-12 (wave-4b): admin notification preferences have no
                delivered store — the preference procedures are fail-loud
                NOT_IMPLEMENTED; honest unavailable state. */}
            <Card className="bg-[#12121a] border-gray-800">
              <CardContent className="py-10 text-center text-gray-500">
                — notification preference management is not delivered on this
                platform
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Channel Stats Tab ───────────────────────────────────────── */}
          <TabsContent value="channels">
            {/* F-12 (wave-4b): per-channel delivery metrics have no delivered
                source — honest unavailable state. */}
            <Card className="bg-[#12121a] border-gray-800">
              <CardContent className="py-10 text-center text-gray-500">
                — per-channel delivery metrics are not delivered on this platform
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Escalation Rules Tab ────────────────────────────────────── */}
          <TabsContent value="escalation" className="space-y-4">
            {/* F-12 (wave-4b): escalation-rule procedures are not delivered —
                honest unavailable state. */}
            <Card className="bg-[#12121a] border-gray-800">
              <CardContent className="py-10 text-center text-gray-500">
                — escalation-rule management is not delivered on this platform
              </CardContent>
            </Card>
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
                {deliveryHistory?.alerts &&
                deliveryHistory.alerts.length > 0 ? (
                  <div className="space-y-2">
                    {deliveryHistory.alerts.map((record: any) => {
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
