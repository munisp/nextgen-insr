// @ts-nocheck
// SECURITY: SQL template literals in this file are for display/mock purposes only. All actual DB queries use parameterized Drizzle ORM.
/**
 * MDM Device Management Tab — Admin Panel
 *
 * Shows all enrolled insurance services with live status, allows remote commands,
 * config push, and OTA update triggers.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  Monitor,
  Wifi,
  WifiOff,
  RefreshCw,
  Upload,
  Settings,
  Trash2,
  Activity,
  Loader2,
  ChevronRight,
  QrCode,
  Copy,
  CheckCircle,
  PowerOff,
  Power,
  Battery,
  BatteryCharging,
  BatteryLow,
  Camera,
  ShieldAlert,
  MapPin,
  AlertTriangle,
  ShieldCheck,
  ShieldX,
  Signal,
  Key,
  CheckCircle2,
  Plus,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import QRCode from "qrcode";
import { useEffect, useRef } from "react";

type DeviceStatus = string;

// ─── Battery indicator ────────────────────────────────────────────────────────
function BatteryIndicator({
  level,
  charging,
}: {
  level: number | null;
  charging?: boolean | null;
}) {
  if (level === null || level === undefined)
    return <span className="text-slate-500 text-xs">—</span>;
  const Icon = charging ? BatteryCharging : level < 20 ? BatteryLow : Battery;
  const color = charging
    ? "text-emerald-400"
    : level < 20
      ? "text-red-400"
      : level < 50
        ? "text-amber-400"
        : "text-emerald-400";
  return (
    <span className={`flex items-center gap-1 text-xs ${color}`}>
      <Icon className="w-3 h-3" />
      {level}%
    </span>
  );
}

// ─── Network type badge ───────────────────────────────────────────────────────
function NetworkBadge({
  type,
  ssid,
  rssi,
}: {
  type?: string | null;
  ssid?: string | null;
  rssi?: number | null;
}) {
  if (!type) return <span className="text-slate-500 text-xs">—</span>;
  const isWifi = type === "wifi";
  return (
    <span className="flex items-center gap-1 text-xs">
      {isWifi ? (
        <Wifi className="w-3 h-3 text-sky-400" />
      ) : (
        <Signal className="w-3 h-3 text-purple-400" />
      )}
      <span className={isWifi ? "text-sky-300" : "text-purple-300"}>
        {isWifi && ssid ? ssid : type.toUpperCase()}
      </span>
      {isWifi && rssi !== null && rssi !== undefined && (
        <span className="text-slate-500">{rssi}dBm</span>
      )}
    </span>
  );
}

// ─── Compliance status badge ──────────────────────────────────────────────────
function ComplianceBadge({ status }: { status?: string | null }) {
  if (!status || status === "unknown")
    return (
      <Badge
        variant="outline"
        className="text-xs text-slate-400 border-slate-600"
      >
        Unknown
      </Badge>
    );
  if (status === "compliant")
    return (
      <Badge
        variant="outline"
        className="text-xs text-emerald-400 border-emerald-500/30"
      >
        <ShieldCheck className="w-3 h-3 mr-1" />
        Compliant
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-xs text-red-400 border-red-500/30">
      <ShieldX className="w-3 h-3 mr-1" />
      Non-Compliant
    </Badge>
  );
}

function statusBadge(status: string) {
  const map: Record<string, { label: string; className: string }> = {
    online: {
      label: "Online",
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    },
    offline: {
      label: "Offline",
      className: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    },
    updating: {
      label: "Updating",
      className: "bg-amber-500/20 text-amber-400 border-amber-500/30",
    },
    error: {
      label: "Error",
      className: "bg-red-500/20 text-red-400 border-red-500/30",
    },
  };
  const s = map[status] ?? map.offline;
  return (
    <Badge variant="outline" className={s.className}>
      {s.label}
    </Badge>
  );
}

function StatusIcon({ status }: { status: string }) {
  if (status === "online") return <Wifi className="w-4 h-4 text-emerald-400" />;
  if (status === "updating")
    return <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />;
  if (status === "error") return <Activity className="w-4 h-4 text-red-400" />;
  return <WifiOff className="w-4 h-4 text-slate-500" />;
}

// ─── Terminal Events Audit Trail ──────────────────────────────────────────────
function TerminalEventsLog() {
  const [page, setPage] = useState(0);
  const limit = 20;
  const { data, isLoading, refetch } = trpc.auditLog.listByActions.useQuery({
    actions: ["TERMINAL_DISABLED", "TERMINAL_ENABLED"],
    limit,
    offset: page * limit,
  });

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <PowerOff className="w-4 h-4 text-red-400" />
            Terminal Events — Kill-Switch Audit Trail
          </CardTitle>
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading events...
          </div>
        ) : (data ?? []).length === 0 ? (
          <div className="text-center py-8 text-slate-500 text-sm">
            <CheckCircle className="w-6 h-6 mx-auto mb-2 opacity-30" />
            No terminal enable/disable events recorded yet.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-xs">
                <thead className="bg-slate-900/60">
                  <tr className="text-left text-slate-400 uppercase tracking-wide">
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Action</th>
                    <th className="px-3 py-2">Agent</th>
                    <th className="px-3 py-2">Actor</th>
                    <th className="px-3 py-2">Reason</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {(data ?? []).map((evt: any) => {
                    const isDisable = evt.action === "TERMINAL_DISABLED";
                    const meta =
                      (evt.metadata as Record<string, unknown>) ?? {};
                    return (
                      <tr key={evt.id} className="hover:bg-slate-800/40">
                        <td className="px-3 py-2 text-slate-400 font-mono whitespace-nowrap">
                          {new Date(evt.createdAt).toLocaleString("en-NG")}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`px-2 py-0.5 rounded-full font-semibold ${
                              isDisable
                                ? "bg-red-500/20 text-red-400"
                                : "bg-emerald-500/20 text-emerald-400"
                            }`}
                          >
                            {isDisable ? "DISABLED" : "ENABLED"}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-amber-300 font-mono">
                          {evt.agentCode}
                        </td>
                        <td className="px-3 py-2 text-slate-300">
                          {String(meta.actor ?? "—")}
                        </td>
                        <td className="px-3 py-2 text-slate-400 max-w-xs truncate">
                          {String(
                            meta.reason ??
                              (isDisable ? "No reason provided" : "Re-enabled")
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between mt-3">
              <span className="text-xs text-slate-500">
                {(data ?? []).length} events shown
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page === 0}
                  onClick={() => setPage(p => p - 1)}
                >
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={(data ?? []).length < limit}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export function MDMTab() {
  const [statusFilter, setStatusFilter] = useState<
    "all" | "online" | "offline" | "updating" | "error"
  >("all");
  const [selectedDevice, setSelectedDevice] = useState<number | null>(null);
  const [showOtaDialog, setShowOtaDialog] = useState(false);
  const [otaVersion, setOtaVersion] = useState("");
  const [otaUrl, setOtaUrl] = useState("");
  const [showConfigDialog, setShowConfigDialog] = useState(false);
  const [configJson, setConfigJson] = useState("{}");
  const [showEnrollDialog, setShowEnrollDialog] = useState(false);
  const [enrollAgentCode, setEnrollAgentCode] = useState("");
  const [enrollSerial, setEnrollSerial] = useState("");
  const [enrollQrData, setEnrollQrData] = useState<{
    token: string;
    expiresAt: Date;
    qrPayload: string;
  } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);
  const [killSwitchTarget, setKillSwitchTarget] = useState<{
    agentCode: string;
    currentlyEnabled: boolean;
  } | null>(null);
  const [killSwitchReason, setKillSwitchReason] = useState("");

  const { data, isLoading, refetch } = trpc.mdm.listDevices.useQuery({
    status: statusFilter,
  });
  const { data: stats } = trpc.mdm.stats.useQuery({});
  const { data: deviceDetail } = trpc.mdm.getDevice.useQuery(
    { id: selectedDevice! },
    { enabled: selectedDevice !== null }
  );

  const issueCommand = trpc.mdm.issueCommand.useMutation({
    onSuccess: (_, vars) => {
      toast.success(
        `Command ${vars.command} queued — device will execute on next heartbeat.`
      );
      refetch();
    },
    onError: e => toast.error(`Command failed: ${e.message}`),
  });

  const triggerOta = trpc.mdm.triggerOtaUpdate.useMutation({
    onSuccess: res => {
      toast.success(
        `OTA Update triggered — ${res.devicesTargeted} device(s) targeted.`
      );
      setShowOtaDialog(false);
      refetch();
    },
    onError: e => toast.error(`OTA failed: ${e.message}`),
  });

  const generateToken = trpc.mdm.generateEnrollmentToken.useMutation({
    onSuccess: async res => {
      setEnrollQrData(res);
      // Render QR code to data URL
      try {
        const url = await QRCode.toDataURL(res.qrPayload, {
          width: 256,
          margin: 2,
        });
        setQrDataUrl(url);
      } catch (e) {
        console.error("QR generation error", e);
      }
    },
    onError: e => toast.error(`Token generation failed: ${e.message}`),
  });

  const pushConfig = trpc.mdm.pushConfig.useMutation({
    onSuccess: () => {
      toast.success("Config pushed — device will apply on next heartbeat.");
      setShowConfigDialog(false);
    },
    onError: e => toast.error(`Config push failed: ${e.message}`),
  });

  const disableTerminal = trpc.mdm.disableTerminal.useMutation({
    onSuccess: res => {
      toast.success(`Terminal ${res.agentCode} disabled — kill-switch sent.`);
      setKillSwitchTarget(null);
      setKillSwitchReason("");
      refetch();
    },
    onError: e => toast.error(`Disable failed: ${e.message}`),
  });
  const enableTerminal = trpc.mdm.enableTerminal.useMutation({
    onSuccess: res => {
      toast.success(`Terminal ${res.agentCode} re-enabled.`);
      setKillSwitchTarget(null);
      refetch();
    },
    onError: e => toast.error(`Enable failed: ${e.message}`),
  });
  const handleKillSwitch = () => {
    if (!killSwitchTarget) return;
    if (!killSwitchTarget.currentlyEnabled) {
      enableTerminal.mutate({ agentCode: killSwitchTarget.agentCode });
    } else {
      if (!killSwitchReason.trim() || killSwitchReason.trim().length < 5) {
        toast.error("Please provide a reason (at least 5 characters).");
        return;
      }
      disableTerminal.mutate({
        agentCode: killSwitchTarget.agentCode,
        reason: killSwitchReason.trim(),
      });
    }
  };
  const handleCommand = (
    deviceId: number,
    command: "UPDATE" | "RECONFIG" | "RESTART" | "WIPE" | "PING" | "SCREENSHOT"
  ) => {
    if (
      command === "WIPE" &&
      !confirm("This will factory-reset the device. Are you sure?")
    )
      return;
    issueCommand.mutate({ deviceId, command });
  };

  const handleOta = () => {
    if (!otaVersion || !otaUrl) return;
    triggerOta.mutate({
      deviceIds: selectedDevice ? [selectedDevice] : undefined,
      appVersion: otaVersion,
      downloadUrl: otaUrl,
    });
  };

  const handlePushConfig = () => {
    if (!selectedDevice) return;
    try {
      const parsed = JSON.parse(configJson);
      pushConfig.mutate({ deviceId: selectedDevice, config: parsed });
    } catch {
      toast.error("Invalid JSON — please enter valid JSON config.");
    }
  };

  return (
    <div className="space-y-6">
      <Tabs defaultValue="devices" className="w-full">
        <TabsList className="bg-slate-800/50 border border-slate-700 mb-4">
          <TabsTrigger
            value="devices"
            className="text-xs data-[state=active]:bg-slate-700"
          >
            Devices
          </TabsTrigger>
          <TabsTrigger
            value="groups"
            className="text-xs data-[state=active]:bg-slate-700"
          >
            Groups
          </TabsTrigger>
          <TabsTrigger
            value="compliance"
            className="text-xs data-[state=active]:bg-slate-700"
          >
            Compliance
          </TabsTrigger>
          <TabsTrigger
            value="geofence"
            className="text-xs data-[state=active]:bg-slate-700"
          >
            Geofence
          </TabsTrigger>
          <TabsTrigger
            value="ota"
            className="text-xs data-[state=active]:bg-slate-700"
          >
            OTA Firmware
          </TabsTrigger>
          <TabsTrigger
            value="enrollment"
            className="text-xs data-[state=active]:bg-slate-700"
          >
            Enrollment
          </TabsTrigger>
        </TabsList>

        <TabsContent value="devices" className="space-y-6">
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              {
                label: "Total",
                value: stats?.total ?? 0,
                color: "text-slate-300",
              },
              {
                label: "Online",
                value: stats?.online ?? 0,
                color: "text-emerald-400",
              },
              {
                label: "Offline",
                value: stats?.offline ?? 0,
                color: "text-slate-400",
              },
              {
                label: "Updating",
                value: stats?.updating ?? 0,
                color: "text-amber-400",
              },
            ].map(s => (
              <Card key={s.label} className="bg-slate-800/50 border-slate-700">
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-slate-400">{s.label}</p>
                  <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 justify-between">
            <div className="flex gap-2 flex-wrap">
              {(["all", "online", "offline", "updating", "error"] as const).map(
                s => (
                  <Button
                    key={s}
                    size="sm"
                    variant={statusFilter === s ? "default" : "outline"}
                    onClick={() => setStatusFilter(s)}
                    className="capitalize text-xs"
                  >
                    {s}
                  </Button>
                )
              )}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => refetch()}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Refresh
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setEnrollQrData(null);
                  setQrDataUrl("");
                  setEnrollAgentCode("");
                  setEnrollSerial("");
                  setShowEnrollDialog(true);
                }}
              >
                <QrCode className="w-3.5 h-3.5 mr-1" /> Enroll Device
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setSelectedDevice(null);
                  setShowOtaDialog(true);
                }}
              >
                <Upload className="w-3.5 h-3.5 mr-1" /> OTA Update All
              </Button>
            </div>
          </div>

          {/* Device table */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading
              devices...
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-700">
              <table className="w-full text-sm">
                <thead className="bg-slate-800/80">
                  <tr className="text-left text-slate-400 text-xs uppercase tracking-wide">
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Serial</th>
                    <th className="px-4 py-3">Agent</th>
                    <th className="px-4 py-3">Model</th>
                    <th className="px-4 py-3">App Ver</th>
                    <th className="px-4 py-3">Last Seen</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700/50">
                  {(data?.devices ?? []).length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="text-center py-12 text-slate-500"
                      >
                        <Monitor className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        No devices enrolled yet. Devices auto-enroll on first
                        heartbeat.
                      </td>
                    </tr>
                  ) : (
                    (data?.devices ?? []).map(
                      ({ device, agentCode, agentName }) => (
                        <tr
                          key={device.id}
                          className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                          onClick={() => setSelectedDevice(device.id)}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <StatusIcon status={device.status} />
                              {statusBadge(device.status)}
                            </div>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-300">
                            {device.serialNumber}
                          </td>
                          <td className="px-4 py-3">
                            <div className="text-slate-200 text-xs">
                              {agentName ?? "—"}
                            </div>
                            <div className="text-slate-500 text-xs">
                              {agentCode ?? ""}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs">
                            {device.model}
                          </td>
                          <td className="px-4 py-3 text-slate-400 text-xs">
                            {device.appVersion ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            <BatteryIndicator
                              level={(device as any).batteryLevel ?? null}
                              charging={(device as any).batteryCharging}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <NetworkBadge
                              type={(device as any).networkType}
                              ssid={(device as any).wifiSsid}
                              rssi={(device as any).wifiRssi}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <ComplianceBadge
                              status={(device as any).complianceStatus}
                            />
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">
                            {device.lastSeenAt
                              ? new Date(device.lastSeenAt).toLocaleString()
                              : "Never"}
                          </td>
                          <td className="px-4 py-3">
                            <div
                              className="flex gap-1"
                              onClick={e => e.stopPropagation()}
                            >
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => handleCommand(device.id, "PING")}
                              >
                                Ping
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  handleCommand(device.id, "RESTART")
                                }
                              >
                                Restart
                              </Button>
                              {agentCode && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                                  title="Remote Kill-Switch"
                                  onClick={() =>
                                    setKillSwitchTarget({
                                      agentCode,
                                      currentlyEnabled: true,
                                    })
                                  }
                                >
                                  <PowerOff className="w-3 h-3" />
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setSelectedDevice(device.id);
                                  setShowOtaDialog(true);
                                }}
                              >
                                <Upload className="w-3 h-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setSelectedDevice(device.id);
                                  setShowConfigDialog(true);
                                }}
                              >
                                <Settings className="w-3 h-3" />
                              </Button>
                              <ChevronRight className="w-4 h-4 text-slate-600 self-center" />
                            </div>
                          </td>
                        </tr>
                      )
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Device detail side panel */}
          {selectedDevice && deviceDetail && (
            <Card className="bg-slate-800/50 border-slate-700">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm text-slate-200 flex items-center gap-2">
                  <Monitor className="w-4 h-4" />
                  Device Detail — {deviceDetail.device.serialNumber}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  {[
                    { label: "Model", value: deviceDetail.device.model },
                    {
                      label: "OS Version",
                      value: deviceDetail.device.osVersion ?? "—",
                    },
                    {
                      label: "App Version",
                      value: deviceDetail.device.appVersion ?? "—",
                    },
                    {
                      label: "Firmware",
                      value: deviceDetail.device.firmwareVersion ?? "—",
                    },
                    {
                      label: "IP Address",
                      value: deviceDetail.device.ipAddress ?? "—",
                    },
                    {
                      label: "Location",
                      value: (deviceDetail.device as any).location ?? "—",
                    },
                    { label: "Agent", value: deviceDetail.agentName ?? "—" },
                    {
                      label: "Enrolled",
                      value: deviceDetail.device.enrolledAt
                        ? new Date(
                            deviceDetail.device.enrolledAt
                          ).toLocaleDateString()
                        : "—",
                    },
                    {
                      label: "Battery",
                      value:
                        (deviceDetail.device as any).batteryLevel !== null &&
                        (deviceDetail.device as any).batteryLevel !== undefined
                          ? `${(deviceDetail.device as any).batteryLevel}%${(deviceDetail.device as any).batteryCharging ? " ⚡" : ""}`
                          : "—",
                    },
                    {
                      label: "Network",
                      value: (deviceDetail.device as any).networkType ?? "—",
                    },
                    {
                      label: "WiFi SSID",
                      value: (deviceDetail.device as any).wifiSsid ?? "—",
                    },
                    {
                      label: "Compliance",
                      value:
                        (deviceDetail.device as any).complianceStatus ??
                        "unknown",
                    },
                  ].map(f => (
                    <div key={f.label}>
                      <p className="text-slate-500">{f.label}</p>
                      <p className="text-slate-200 font-medium">{f.value}</p>
                    </div>
                  ))}
                </div>

                {deviceDetail.commands.length > 0 && (
                  <div>
                    <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">
                      Recent Commands
                    </p>
                    <div className="space-y-1">
                      {deviceDetail.commands.slice(0, 5).map(cmd => (
                        <div
                          key={cmd.id}
                          className="flex items-center gap-3 text-xs bg-slate-900/50 rounded px-3 py-2"
                        >
                          <Badge variant="outline" className="text-xs">
                            {cmd.command}
                          </Badge>
                          <span
                            className={
                              cmd.status === "completed"
                                ? "text-emerald-400"
                                : cmd.status === "failed"
                                  ? "text-red-400"
                                  : cmd.status === "pending"
                                    ? "text-amber-400"
                                    : "text-slate-400"
                            }
                          >
                            {cmd.status}
                          </span>
                          <span className="text-slate-500 ml-auto">
                            {cmd.issuedAt
                              ? new Date(cmd.issuedAt).toLocaleString()
                              : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 flex-wrap pt-2">
                  {(["PING", "RESTART", "RECONFIG"] as const).map(cmd => (
                    <Button
                      key={cmd}
                      size="sm"
                      variant="outline"
                      className="text-xs"
                      onClick={() => handleCommand(selectedDevice, cmd)}
                      disabled={issueCommand.isPending}
                    >
                      {cmd}
                    </Button>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs text-sky-400 border-sky-500/30"
                    onClick={() => handleCommand(selectedDevice, "SCREENSHOT")}
                    disabled={issueCommand.isPending}
                  >
                    <Camera className="w-3 h-3 mr-1" /> Screenshot
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs text-red-400 border-red-500/30"
                    onClick={() => handleCommand(selectedDevice, "WIPE")}
                    disabled={issueCommand.isPending}
                  >
                    <Trash2 className="w-3 h-3 mr-1" /> Factory Reset
                  </Button>
                </div>

                {/* Screenshot viewer */}
                {(deviceDetail.device as any).screenshotUrl && (
                  <div className="pt-2">
                    <p className="text-xs text-slate-400 mb-2 font-medium uppercase tracking-wide">
                      Last Screenshot
                    </p>
                    <div className="relative rounded overflow-hidden border border-slate-700">
                      <img
                        src={(deviceDetail.device as any).screenshotUrl}
                        alt="Device screenshot"
                        className="w-full max-h-64 object-contain bg-slate-900"
                      />
                      <div className="absolute bottom-0 right-0 bg-slate-900/80 text-xs text-slate-400 px-2 py-1 rounded-tl">
                        {(deviceDetail.device as any).lastScreenshotAt
                          ? new Date(
                              (deviceDetail.device as any).lastScreenshotAt
                            ).toLocaleString()
                          : ""}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* OTA Update Dialog */}
          <Dialog open={showOtaDialog} onOpenChange={setShowOtaDialog}>
            <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
              <DialogHeader>
                <DialogTitle>Trigger OTA Update</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-slate-400">
                  {selectedDevice
                    ? "Update selected device only."
                    : "Update ALL online devices simultaneously."}
                </p>
                <div className="space-y-2">
                  <Label className="text-slate-300">New App Version</Label>
                  <Input
                    value={otaVersion}
                    onChange={e => setOtaVersion(e.target.value)}
                    placeholder="e.g. 2.4.1"
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-slate-300">Download URL</Label>
                  <Input
                    value={otaUrl}
                    onChange={e => setOtaUrl(e.target.value)}
                    placeholder="https://cdn.insureportal.com/releases/v2.4.1.apk"
                    className="bg-slate-800 border-slate-600"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowOtaDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleOta}
                  disabled={triggerOta.isPending || !otaVersion || !otaUrl}
                >
                  {triggerOta.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Upload className="w-4 h-4 mr-2" />
                  )}
                  Push Update
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Device Enrollment QR Dialog */}
          <Dialog open={showEnrollDialog} onOpenChange={setShowEnrollDialog}>
            <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <QrCode className="w-5 h-5 text-emerald-400" /> Enroll New
                  Device
                </DialogTitle>
              </DialogHeader>
              {!enrollQrData ? (
                <div className="space-y-4">
                  <p className="text-sm text-slate-400">
                    Enter the agent code and (optionally) the device serial
                    number. A 15-minute enrollment QR code will be generated.
                    Scan it with the insureportal-installer on the insurance service.
                  </p>
                  <div className="space-y-2">
                    <Label className="text-slate-300">
                      Agent Code <span className="text-red-400">*</span>
                    </Label>
                    <Input
                      value={enrollAgentCode}
                      onChange={e =>
                        setEnrollAgentCode(e.target.value.toUpperCase())
                      }
                      placeholder="e.g. AGT001"
                      className="bg-slate-800 border-slate-600"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-slate-300">
                      Serial Number (optional)
                    </Label>
                    <Input
                      value={enrollSerial}
                      onChange={e => setEnrollSerial(e.target.value)}
                      placeholder="e.g. PAX-SN-20240001"
                      className="bg-slate-800 border-slate-600"
                    />
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setShowEnrollDialog(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() =>
                        generateToken.mutate({
                          agentCode: enrollAgentCode,
                          serialNumber: enrollSerial || undefined,
                        })
                      }
                      disabled={generateToken.isPending || !enrollAgentCode}
                    >
                      {generateToken.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      ) : (
                        <QrCode className="w-4 h-4 mr-2" />
                      )}
                      Generate QR
                    </Button>
                  </DialogFooter>
                </div>
              ) : (
                <div className="space-y-4 text-center">
                  <div className="flex items-center justify-center gap-2 text-emerald-400 text-sm">
                    <CheckCircle className="w-4 h-4" /> Token generated — valid
                    for 15 minutes
                  </div>
                  {qrDataUrl && (
                    <div className="flex justify-center">
                      <img
                        src={qrDataUrl}
                        alt="Enrollment QR Code"
                        className="w-56 h-56 rounded-lg border border-slate-700"
                      />
                    </div>
                  )}
                  <div className="bg-slate-800 rounded-lg p-3 text-left">
                    <p className="text-xs text-slate-400 mb-1">
                      Install command for insurance service:
                    </p>
                    <code className="text-xs text-emerald-300 break-all">
                      sudo ./insureportal-installer --enroll-token{" "}
                      {enrollQrData.token}
                    </code>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="mt-2 w-full text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(
                          `sudo ./insureportal-installer --enroll-token ${enrollQrData.token}`
                        );
                        toast.success("Copied to clipboard");
                      }}
                    >
                      <Copy className="w-3 h-3 mr-1" /> Copy Command
                    </Button>
                  </div>
                  <p className="text-xs text-slate-500">
                    Expires:{" "}
                    {new Date(enrollQrData.expiresAt).toLocaleTimeString()}
                  </p>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEnrollQrData(null);
                        setQrDataUrl("");
                      }}
                    >
                      Generate Another
                    </Button>
                    <Button
                      onClick={() => {
                        setShowEnrollDialog(false);
                        refetch();
                      }}
                    >
                      Done
                    </Button>
                  </DialogFooter>
                </div>
              )}
            </DialogContent>
          </Dialog>

          {/* Config Push Dialog */}
          <Dialog open={showConfigDialog} onOpenChange={setShowConfigDialog}>
            <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
              <DialogHeader>
                <DialogTitle>Push Config to Device</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <p className="text-sm text-slate-400">
                  Enter JSON configuration to push to the device.
                </p>
                <Textarea
                  value={configJson}
                  onChange={e => setConfigJson(e.target.value)}
                  rows={8}
                  className="bg-slate-800 border-slate-600 font-mono text-xs"
                  placeholder='{"maxTransactionAmount": 500000, "requireBiometric": true}'
                />
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setShowConfigDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handlePushConfig}
                  disabled={pushConfig.isPending}
                >
                  {pushConfig.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <Settings className="w-4 h-4 mr-2" />
                  )}
                  Push Config
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Terminal Events Audit Trail */}
          <TerminalEventsLog />

          {/* Remote Kill-Switch Dialog */}
          <Dialog
            open={killSwitchTarget !== null}
            onOpenChange={open => {
              if (!open) {
                setKillSwitchTarget(null);
                setKillSwitchReason("");
              }
            }}
          >
            <DialogContent className="bg-slate-900 border-slate-700 text-slate-100">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {killSwitchTarget?.currentlyEnabled ? (
                    <>
                      <PowerOff className="w-5 h-5 text-red-400" /> Disable
                      Terminal
                    </>
                  ) : (
                    <>
                      <Power className="w-5 h-5 text-emerald-400" /> Re-enable
                      Terminal
                    </>
                  )}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-slate-300">
                  {killSwitchTarget?.currentlyEnabled ? (
                    <>
                      You are about to{" "}
                      <span className="text-red-400 font-semibold">
                        remotely disable
                      </span>{" "}
                      terminal for agent{" "}
                      <span className="font-mono text-amber-300">
                        {killSwitchTarget?.agentCode}
                      </span>
                      . The Insurance Portal will immediately show a kill-switch
                      overlay and all transactions will be blocked.
                    </>
                  ) : (
                    <>
                      You are about to{" "}
                      <span className="text-emerald-400 font-semibold">
                        re-enable
                      </span>{" "}
                      terminal for agent{" "}
                      <span className="font-mono text-amber-300">
                        {killSwitchTarget?.agentCode}
                      </span>
                      . The Insurance Portal overlay will dismiss automatically.
                    </>
                  )}
                </p>
                {killSwitchTarget?.currentlyEnabled && (
                  <div className="space-y-1.5">
                    <Label className="text-slate-300 text-xs">
                      Reason for disabling *
                    </Label>
                    <Input
                      value={killSwitchReason}
                      onChange={e => setKillSwitchReason(e.target.value)}
                      placeholder="e.g. Suspected fraud — under investigation"
                      className="bg-slate-800 border-slate-600 text-slate-100"
                    />
                    <p className="text-xs text-slate-500">
                      This reason will be shown to the agent on their terminal.
                    </p>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setKillSwitchTarget(null);
                    setKillSwitchReason("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant={
                    killSwitchTarget?.currentlyEnabled
                      ? "destructive"
                      : "default"
                  }
                  onClick={handleKillSwitch}
                  disabled={
                    disableTerminal.isPending || enableTerminal.isPending
                  }
                >
                  {disableTerminal.isPending || enableTerminal.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : killSwitchTarget?.currentlyEnabled ? (
                    <PowerOff className="w-4 h-4 mr-2" />
                  ) : (
                    <Power className="w-4 h-4 mr-2" />
                  )}
                  {killSwitchTarget?.currentlyEnabled
                    ? "Disable Terminal"
                    : "Re-enable Terminal"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="groups">
          <DeviceGroupManager />
        </TabsContent>

        <TabsContent value="compliance">
          <ComplianceDashboard />
        </TabsContent>

        <TabsContent value="geofence">
          <GeofenceAlertPanel />
        </TabsContent>

        <TabsContent value="ota">
          <OtaManagementPanel />
        </TabsContent>

        <TabsContent value="enrollment">
          <EnrollmentTokenPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Device Group Manager ─────────────────────────────────────────────────────────
function DeviceGroupManager() {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editGroup, setEditGroup] = useState<any>(null);
  const [groupName, setGroupName] = useState("");
  const [groupDesc, setGroupDesc] = useState("");
  const [bulkCmd, setBulkCmd] = useState<{
    groupId: number;
    groupName: string;
  } | null>(null);
  const utils = trpc.useUtils();

  const { data: groups, isLoading } =
    trpc.management.pos.getTerminalGroups.useQuery();
  const { data: terminals } = trpc.management.pos.listTerminals.useQuery({
    page: 1,
    limit: 500,
  });

  const createGroup = trpc.management.pos.createTerminalGroup.useMutation({
    onSuccess: () => {
      utils.management.pos.getTerminalGroups.invalidate();
      setShowCreateDialog(false);
      setGroupName("");
      setGroupDesc("");
      toast.success("Group created");
    },
    onError: e => toast.error(e.message),
  });
  const updateGroup = trpc.management.pos.updateTerminalGroup.useMutation({
    onSuccess: () => {
      utils.management.pos.getTerminalGroups.invalidate();
      setEditGroup(null);
      toast.success("Group updated");
    },
    onError: e => toast.error(e.message),
  });
  const deleteGroup = trpc.management.pos.deleteTerminalGroup.useMutation({
    onSuccess: () => {
      utils.management.pos.getTerminalGroups.invalidate();
      toast.success("Group deleted");
    },
    onError: e => toast.error(e.message),
  });
  const assignTerminal = trpc.management.pos.assignTerminalToGroup.useMutation({
    onSuccess: () => {
      utils.management.pos.listTerminals.invalidate();
      utils.management.pos.getTerminalGroups.invalidate();
      toast.success("Terminal reassigned");
    },
    onError: e => toast.error(e.message),
  });
  const bulkCommand = trpc.management.pos.bulkGroupCommand.useMutation({
    onSuccess: res => {
      setBulkCmd(null);
      toast.success(
        `${res.command} dispatched to ${res.dispatched} terminal(s)`
      );
    },
    onError: e => toast.error(e.message),
  });

  const terminalsByGroup = (groupId: number) => {
    const items = (terminals as any)?.terminals ?? terminals ?? [];
    return (items as any[]).filter((t: any) => t.groupId === groupId);
  };
  const unassigned = () => {
    const items = (terminals as any)?.terminals ?? terminals ?? [];
    return (items as any[]).filter((t: any) => !t.groupId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200">
          Device Groups ({groups?.length ?? 0})
        </h3>
        <Button
          size="sm"
          variant="outline"
          className="text-xs"
          onClick={() => {
            setGroupName("");
            setGroupDesc("");
            setShowCreateDialog(true);
          }}
        >
          + New Group
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
        </div>
      ) : !groups?.length ? (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardContent className="py-8 text-center">
            <p className="text-slate-500 text-sm">
              No device groups yet. Create one to organize terminals and
              dispatch bulk commands.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g: any) => {
            const members = terminalsByGroup(g.id);
            return (
              <Card key={g.id} className="bg-slate-800/50 border-slate-700">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-semibold text-slate-200">
                        {g.name}
                      </CardTitle>
                      {g.description && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {g.description}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-amber-400"
                        onClick={() => {
                          setEditGroup(g);
                          setGroupName(g.name);
                          setGroupDesc(g.description ?? "");
                        }}
                      >
                        <Settings className="w-3 h-3 mr-1" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-blue-400"
                        onClick={() =>
                          setBulkCmd({ groupId: g.id, groupName: g.name })
                        }
                      >
                        <RefreshCw className="w-3 h-3 mr-1" /> Bulk Cmd
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs text-red-400"
                        onClick={() => {
                          if (
                            confirm(
                              `Delete group "${g.name}"? Terminals will be unassigned.`
                            )
                          )
                            deleteGroup.mutate({ id: g.id });
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-xs text-slate-400 mb-2">
                    {members.length} terminal(s) assigned
                  </div>
                  {members.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {members.map((t: any) => (
                        <Badge
                          key={t.id}
                          variant="outline"
                          className="text-xs text-slate-300 border-slate-600 cursor-pointer hover:border-red-500/50"
                          onClick={() => {
                            if (
                              confirm(
                                `Remove ${t.serialNumber} from this group?`
                              )
                            )
                              assignTerminal.mutate({
                                terminalId: t.id,
                                groupId: null,
                              });
                          }}
                        >
                          {t.serialNumber} ×
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-600">
                      No terminals assigned. Use the dropdown below to add.
                    </p>
                  )}
                  {/* Assign terminal dropdown */}
                  {unassigned().length > 0 && (
                    <div className="mt-3">
                      <Select
                        onValueChange={val =>
                          assignTerminal.mutate({
                            terminalId: Number(val),
                            groupId: g.id,
                          })
                        }
                      >
                        <SelectTrigger className="bg-slate-900 border-slate-600 text-xs h-8 w-64">
                          <SelectValue placeholder="Assign unassigned terminal..." />
                        </SelectTrigger>
                        <SelectContent className="bg-slate-800 border-slate-700">
                          {unassigned().map((t: any) => (
                            <SelectItem
                              key={t.id}
                              value={String(t.id)}
                              className="text-xs"
                            >
                              {t.serialNumber} ({t.model})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Unassigned terminals */}
      {unassigned().length > 0 && (
        <Card className="bg-slate-800/50 border-slate-700">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-400">
              Unassigned Terminals ({unassigned().length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {unassigned().map((t: any) => (
                <Badge
                  key={t.id}
                  variant="outline"
                  className="text-xs text-slate-500 border-slate-700"
                >
                  {t.serialNumber}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Group Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle>Create Device Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Group Name *</Label>
              <Input
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                placeholder="e.g. Lagos-Mainland"
                className="bg-slate-800 border-slate-600 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Description</Label>
              <Input
                value={groupDesc}
                onChange={e => setGroupDesc(e.target.value)}
                placeholder="Optional description"
                className="bg-slate-800 border-slate-600 text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreateDialog(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                createGroup.mutate({
                  name: groupName,
                  description: groupDesc || undefined,
                })
              }
              disabled={!groupName || createGroup.isPending}
            >
              {createGroup.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}{" "}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Group Dialog */}
      <Dialog
        open={editGroup !== null}
        onOpenChange={open => {
          if (!open) setEditGroup(null);
        }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Group Name</Label>
              <Input
                value={groupName}
                onChange={e => setGroupName(e.target.value)}
                className="bg-slate-800 border-slate-600 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Description</Label>
              <Input
                value={groupDesc}
                onChange={e => setGroupDesc(e.target.value)}
                className="bg-slate-800 border-slate-600 text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditGroup(null)}>
              Cancel
            </Button>
            <Button
              onClick={() =>
                updateGroup.mutate({
                  id: editGroup.id,
                  name: groupName,
                  description: groupDesc || undefined,
                })
              }
              disabled={updateGroup.isPending}
            >
              {updateGroup.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}{" "}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Command Dialog */}
      <Dialog
        open={bulkCmd !== null}
        onOpenChange={open => {
          if (!open) setBulkCmd(null);
        }}
      >
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-sm">
          <DialogHeader>
            <DialogTitle>Bulk Command — {bulkCmd?.groupName}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-slate-400">
            Send a command to all terminals in this group.
          </p>
          <div className="grid grid-cols-2 gap-2 mt-3">
            {(["UPDATE", "RECONFIG", "RESTART", "PING"] as const).map(cmd => (
              <Button
                key={cmd}
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={bulkCommand.isPending}
                onClick={() =>
                  bulkCmd &&
                  bulkCommand.mutate({ groupId: bulkCmd.groupId, command: cmd })
                }
              >
                {cmd}
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkCmd(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Compliance Dashboard ─────────────────────────────────────────────────────
export function ComplianceDashboard() {
  const [policyDialog, setPolicyDialog] = useState(false);
  const [editPolicy, setEditPolicy] = useState<any>(null);
  const [policyName, setPolicyName] = useState("");
  const [minBattery, setMinBattery] = useState("");
  const [minAppVersion, setMinAppVersion] = useState("");
  const [allowedNetworks, setAllowedNetworks] = useState<string[]>([
    "wifi",
    "4g",
  ]);
  const [severity, setSeverity] = useState<
    "low" | "medium" | "high" | "critical"
  >("medium");
  const [enforcement, setEnforcement] = useState<
    "notify" | "restrict" | "wipe"
  >("notify");
  const utils = trpc.useUtils();

  const { data: policies, isLoading: loadingPolicies } =
    trpc.mdm.listPolicies.useQuery({});
  const { data: violations, isLoading: loadingViolations } =
    trpc.mdm.listViolations.useQuery({ status: "open" });

  const upsertPolicy = trpc.mdm.upsertPolicy.useMutation({
    onSuccess: () => {
      utils.mdm.listPolicies.invalidate();
      setPolicyDialog(false);
      toast.success("Policy saved");
    },
    onError: e => toast.error(e.message),
  });

  const ackViolation = trpc.mdm.acknowledgeViolation.useMutation({
    onSuccess: () => {
      utils.mdm.listViolations.invalidate();
      toast.success("Violation updated");
    },
    onError: e => toast.error(e.message),
  });

  function openNewPolicy() {
    setEditPolicy(null);
    setPolicyName("");
    setMinBattery("");
    setMinAppVersion("");
    setAllowedNetworks(["wifi", "4g"]);
    setSeverity("medium");
    setEnforcement("notify");
    setPolicyDialog(true);
  }

  function openEditPolicy(p: any) {
    setEditPolicy(p);
    setPolicyName(p.name);
    setMinBattery(p.rules?.minBatteryLevel?.toString() ?? "");
    setMinAppVersion(p.rules?.minAppVersion ?? "");
    setAllowedNetworks(p.rules?.allowedNetworkTypes ?? ["wifi", "4g"]);
    setSeverity(p.severity ?? "medium");
    setEnforcement(p.enforcementAction ?? "notify");
    setPolicyDialog(true);
  }

  function handleSavePolicy() {
    upsertPolicy.mutate({
      id: editPolicy?.id,
      name: policyName,
      rules: {
        ...(minBattery ? { minBatteryLevel: Number(minBattery) } : {}),
        ...(minAppVersion ? { minAppVersion } : {}),
        allowedNetworkTypes: allowedNetworks as any,
      },
      severity,
      enabled: true,
      enforcementAction: enforcement,
    });
  }

  const violationSeverityColor: Record<string, string> = {
    critical: "text-red-400 border-red-500/30",
    high: "text-orange-400 border-orange-500/30",
    medium: "text-amber-400 border-amber-500/30",
    low: "text-slate-400 border-slate-600",
  };

  return (
    <div className="space-y-6">
      {/* Policies */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" /> Compliance
              Policies
            </CardTitle>
            <Button
              size="sm"
              variant="outline"
              className="text-xs"
              onClick={openNewPolicy}
            >
              + New Policy
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingPolicies ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : !policies?.length ? (
            <p className="text-slate-500 text-sm text-center py-4">
              No policies defined. Create one to start monitoring device
              compliance.
            </p>
          ) : (
            <div className="space-y-2">
              {policies.map((p: any) => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 bg-slate-900/50 rounded px-3 py-2 text-xs"
                >
                  <Badge
                    variant="outline"
                    className={
                      violationSeverityColor[p.severity] ??
                      "text-slate-400 border-slate-600"
                    }
                  >
                    {p.severity}
                  </Badge>
                  <span className="text-slate-200 font-medium flex-1">
                    {p.name}
                  </span>
                  <Badge
                    variant="outline"
                    className={
                      p.enabled
                        ? "text-emerald-400 border-emerald-500/30"
                        : "text-slate-500 border-slate-600"
                    }
                  >
                    {p.enabled ? "Active" : "Disabled"}
                  </Badge>
                  <span className="text-slate-500">{p.enforcementAction}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs"
                    onClick={() => openEditPolicy(p)}
                  >
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Open Violations */}
      <Card className="bg-slate-800/50 border-slate-700">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" /> Open Violations (
            {violations?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingViolations ? (
            <div className="flex justify-center py-6">
              <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
            </div>
          ) : !violations?.length ? (
            <p className="text-slate-500 text-sm text-center py-4">
              No open violations. All devices are compliant.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700 text-slate-400">
                    <th className="px-3 py-2 text-left">Device</th>
                    <th className="px-3 py-2 text-left">Type</th>
                    <th className="px-3 py-2 text-left">Severity</th>
                    <th className="px-3 py-2 text-left">Details</th>
                    <th className="px-3 py-2 text-left">Detected</th>
                    <th className="px-3 py-2 text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {violations.map((v: any) => (
                    <tr
                      key={v.id}
                      className="border-b border-slate-800 hover:bg-slate-800/30"
                    >
                      <td className="px-3 py-2 font-mono text-slate-300">
                        {v.serialNumber}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {v.violationType.replace(/_/g, " ")}
                      </td>
                      <td className="px-3 py-2">
                        <Badge
                          variant="outline"
                          className={`text-xs ${violationSeverityColor[v.severity] ?? ""}`}
                        >
                          {v.severity}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-slate-500 max-w-xs truncate">
                        {v.details ? JSON.stringify(v.details) : "—"}
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {v.detectedAt
                          ? new Date(v.detectedAt).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-amber-400"
                            onClick={() =>
                              ackViolation.mutate({
                                violationId: v.id,
                                action: "acknowledge",
                              })
                            }
                          >
                            Ack
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs text-emerald-400"
                            onClick={() =>
                              ackViolation.mutate({
                                violationId: v.id,
                                action: "resolve",
                              })
                            }
                          >
                            Resolve
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Policy Dialog */}
      <Dialog open={policyDialog} onOpenChange={setPolicyDialog}>
        <DialogContent className="bg-slate-900 border-slate-700 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editPolicy ? "Edit Policy" : "New Compliance Policy"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Policy Name *</Label>
              <Input
                value={policyName}
                onChange={e => setPolicyName(e.target.value)}
                placeholder="e.g. Minimum App Version"
                className="bg-slate-800 border-slate-600 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">
                Min Battery Level (%)
              </Label>
              <Input
                type="number"
                value={minBattery}
                onChange={e => setMinBattery(e.target.value)}
                placeholder="e.g. 15"
                className="bg-slate-800 border-slate-600 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Min App Version</Label>
              <Input
                value={minAppVersion}
                onChange={e => setMinAppVersion(e.target.value)}
                placeholder="e.g. 2.4.0"
                className="bg-slate-800 border-slate-600 text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">Severity</Label>
              <Select
                value={severity}
                onValueChange={(v: any) => setSeverity(v)}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {["low", "medium", "high", "critical"].map(s => (
                    <SelectItem key={s} value={s} className="text-xs">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-slate-300 text-xs">
                Enforcement Action
              </Label>
              <Select
                value={enforcement}
                onValueChange={(v: any) => setEnforcement(v)}
              >
                <SelectTrigger className="bg-slate-800 border-slate-600 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-slate-800 border-slate-700">
                  {["notify", "restrict", "wipe"].map(s => (
                    <SelectItem key={s} value={s} className="text-xs">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPolicyDialog(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSavePolicy}
              disabled={upsertPolicy.isPending || !policyName}
            >
              {upsertPolicy.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
              ) : null}
              Save Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Geofence Alert Panel ─────────────────────────────────────────────────────
export function GeofenceAlertPanel() {
  const utils = trpc.useUtils();
  const { data: violations, isLoading } =
    trpc.mdm.listGeofenceViolations.useQuery({ status: "open" });

  return (
    <Card className="bg-slate-800/50 border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <MapPin className="w-4 h-4 text-red-400" /> Geofence Violations
            {violations && violations.length > 0 && (
              <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">
                {violations.length} open
              </Badge>
            )}
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => utils.mdm.listGeofenceViolations.invalidate()}
          >
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
          </div>
        ) : !violations?.length ? (
          <p className="text-slate-500 text-sm text-center py-4">
            No open geofence violations. All devices are within their assigned
            zones.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400">
                  <th className="px-3 py-2 text-left">Device</th>
                  <th className="px-3 py-2 text-left">Agent</th>
                  <th className="px-3 py-2 text-left">Zone</th>
                  <th className="px-3 py-2 text-left">Distance</th>
                  <th className="px-3 py-2 text-left">Detected</th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v: any) => (
                  <tr
                    key={v.id}
                    className="border-b border-slate-800 hover:bg-slate-800/30"
                  >
                    <td className="px-3 py-2 font-mono text-slate-300">
                      {v.serialNumber}
                    </td>
                    <td className="px-3 py-2 text-slate-400">{v.agentCode}</td>
                    <td className="px-3 py-2 text-amber-300">{v.zoneName}</td>
                    <td className="px-3 py-2 text-red-400 font-medium">
                      {v.distanceMeters ? `${v.distanceMeters}m outside` : "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {v.detectedAt
                        ? new Date(v.detectedAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── OTA Firmware Management Panel ──────────────────────────────────────────
function OtaManagementPanel() {
  const [showCreate, setShowCreate] = useState(false);
  const [version, setVersion] = useState("");
  const [downloadUrl, setDownloadUrl] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [minAppVersion, setMinAppVersion] = useState("");
  const utils = trpc.useUtils();

  const releases = trpc.mdm.listOtaReleases.useQuery({ limit: 50, offset: 0 });
  const updateLog = trpc.mdm.listOtaUpdateLog.useQuery({ limit: 50 });
  const createRelease = trpc.mdm.createOtaRelease.useMutation({
    onSuccess: () => {
      utils.mdm.listOtaReleases.invalidate();
      setShowCreate(false);
      setVersion("");
      setDownloadUrl("");
      setReleaseNotes("");
      setMinAppVersion("");
    },
  });
  const publishRelease = trpc.mdm.publishOtaRelease.useMutation({
    onSuccess: () => utils.mdm.listOtaReleases.invalidate(),
  });
  const archiveRelease = trpc.mdm.archiveOtaRelease.useMutation({
    onSuccess: () => utils.mdm.listOtaReleases.invalidate(),
  });

  const statusColor = (s: string) =>
    s === "published"
      ? "oklch(0.65 0.20 145)"
      : s === "draft"
        ? "oklch(0.65 0.22 260)"
        : "oklch(0.50 0.05 240)";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-white">OTA Firmware Releases</h3>
        <Button
          size="sm"
          onClick={() => setShowCreate(true)}
          className="bg-blue-600 hover:bg-blue-700 text-xs"
        >
          <Plus className="w-3 h-3 mr-1" /> New Release
        </Button>
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="bg-slate-900 border-slate-700 text-white">
          <DialogHeader>
            <DialogTitle>Create OTA Release</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs text-slate-400">Version</Label>
              <Input
                value={version}
                onChange={e => setVersion(e.target.value)}
                placeholder="e.g. 2.4.1"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Download URL</Label>
              <Input
                value={downloadUrl}
                onChange={e => setDownloadUrl(e.target.value)}
                placeholder="https://cdn.insureportal.ng/firmware/v2.4.1.apk"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Min App Version</Label>
              <Input
                value={minAppVersion}
                onChange={e => setMinAppVersion(e.target.value)}
                placeholder="e.g. 2.0.0"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <div>
              <Label className="text-xs text-slate-400">Release Notes</Label>
              <Textarea
                value={releaseNotes}
                onChange={e => setReleaseNotes(e.target.value)}
                placeholder="Bug fixes and performance improvements..."
                className="bg-slate-800 border-slate-700 text-white"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowCreate(false)}
              className="border-slate-600 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                createRelease.mutate({
                  version,
                  downloadUrl,
                  releaseNotes,
                  s3Key: `ota/${version}.apk`,
                  checksum: "pending",
                  fileSize: 0,
                  minCurrentVersion: minAppVersion || undefined,
                })
              }
              disabled={!version || !downloadUrl || createRelease.isPending}
              className="bg-blue-600"
            >
              {createRelease.isPending ? (
                <Loader2 className="w-3 h-3 animate-spin mr-1" />
              ) : null}{" "}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Releases Table */}
      <Card className="bg-slate-900/50 border-slate-700">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-slate-500">
                  <th className="px-3 py-2 text-left">Version</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Min Version</th>
                  <th className="px-3 py-2 text-left">Created</th>
                  <th className="px-3 py-2 text-left">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {(releases.data?.items ?? []).map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 font-mono text-slate-200">
                      {r.version}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className="px-2 py-0.5 rounded text-xs font-bold"
                        style={{
                          background: `${statusColor(r.status)}20`,
                          color: statusColor(r.status),
                        }}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {r.minAppVersion ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {r.createdAt
                        ? new Date(r.createdAt).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-3 py-2 flex gap-1">
                      {r.status === "draft" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => publishRelease.mutate({ id: r.id })}
                          className="text-xs h-6 border-green-700 text-green-400 hover:bg-green-900/30"
                        >
                          Publish
                        </Button>
                      )}
                      {r.status === "published" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => archiveRelease.mutate({ id: r.id })}
                          className="text-xs h-6 border-amber-700 text-amber-400 hover:bg-amber-900/30"
                        >
                          Archive
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {(releases.data?.items ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-slate-500">
                      No OTA releases yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Update Log */}
      <Card className="bg-slate-900/50 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white">Update Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-700 text-slate-500">
                  <th className="px-3 py-2 text-left">Device</th>
                  <th className="px-3 py-2 text-left">From</th>
                  <th className="px-3 py-2 text-left">To</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Started</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {(updateLog.data ?? []).map((l: any) => (
                  <tr key={l.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2 font-mono text-slate-300">
                      {l.deviceId}
                    </td>
                    <td className="px-3 py-2 text-slate-400">
                      {l.fromVersion ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-200">{l.toVersion}</td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${l.status === "completed" ? "bg-green-900/30 text-green-400" : l.status === "failed" ? "bg-red-900/30 text-red-400" : "bg-blue-900/30 text-blue-400"}`}
                      >
                        {l.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500">
                      {l.startedAt
                        ? new Date(l.startedAt).toLocaleString()
                        : "—"}
                    </td>
                  </tr>
                ))}
                {(updateLog.data ?? []).length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-slate-500">
                      No update logs yet
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Enrollment Token Panel ─────────────────────────────────────────────────
function EnrollmentTokenPanel() {
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [agentCode, setAgentCode] = useState("");
  const [copied, setCopied] = useState(false);

  const generateToken = trpc.mdm.generateEnrollmentToken.useMutation({
    onSuccess: (data: any) => {
      setGeneratedToken(data.token);
      setCopied(false);
    },
  });

  const handleCopy = () => {
    if (generatedToken) {
      navigator.clipboard.writeText(generatedToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-bold text-white">Device Enrollment</h3>
      <p className="text-xs text-slate-400">
        Generate enrollment tokens for new insurance services. Agents enter this
        token during device setup to bind the terminal to their account.
      </p>

      <Card className="bg-slate-900/50 border-slate-700">
        <CardContent className="p-4 space-y-3">
          <div>
            <Label className="text-xs text-slate-400">
              Agent Code (optional)
            </Label>
            <Input
              value={agentCode}
              onChange={e => setAgentCode(e.target.value)}
              placeholder="e.g. AGT-001 (leave blank for unassigned)"
              className="bg-slate-800 border-slate-700 text-white mt-1"
            />
          </div>
          <Button
            onClick={() =>
              generateToken.mutate({ agentCode: agentCode || "UNASSIGNED" })
            }
            disabled={generateToken.isPending}
            className="bg-blue-600 hover:bg-blue-700 text-xs"
          >
            {generateToken.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin mr-1" />
            ) : (
              <Key className="w-3 h-3 mr-1" />
            )}{" "}
            Generate Token
          </Button>

          {generatedToken && (
            <div className="mt-4 p-3 rounded-lg bg-slate-800 border border-slate-600">
              <div className="text-xs text-slate-400 mb-1">
                Enrollment Token (expires in 24h)
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 font-mono text-sm text-green-400 break-all">
                  {generatedToken}
                </code>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  className="border-slate-600 text-slate-300 text-xs h-7"
                >
                  {copied ? (
                    <CheckCircle2 className="w-3 h-3 text-green-400" />
                  ) : (
                    <Copy className="w-3 h-3" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-slate-500 mt-2">
                Enter this token on the insurance service during first-time setup.
                The device will auto-enroll and appear in the Devices tab.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-slate-900/50 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white">
            Enrollment Instructions
          </CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-slate-400 space-y-2">
          <p>
            <strong className="text-slate-300">Step 1:</strong> Generate an
            enrollment token above (optionally pre-assign to an agent).
          </p>
          <p>
            <strong className="text-slate-300">Step 2:</strong> On the POS
            terminal, open Settings → Device → Enroll and enter the token.
          </p>
          <p>
            <strong className="text-slate-300">Step 3:</strong> The terminal
            sends a heartbeat with the token. The server validates and
            auto-enrolls the device.
          </p>
          <p>
            <strong className="text-slate-300">Step 4:</strong> The device
            appears in the Devices tab with status "active". Compliance policies
            apply immediately.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
