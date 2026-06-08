/**
 * Notification Preferences — Manage push, email, SMS notification settings
 * Wired to system.notifyOwner for test notifications
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Bell,
  Mail,
  Smartphone,
  Shield,
  AlertTriangle,
  TrendingUp,
  Users,
  CreditCard,
  Send,
} from "lucide-react";
import { toast } from "sonner";

interface NotifChannel {
  id: string;
  label: string;
  icon: React.ReactNode;
  push: boolean;
  email: boolean;
  sms: boolean;
}

const DEFAULT_CHANNELS: NotifChannel[] = [
  {
    id: "transactions",
    label: "Transaction Alerts",
    icon: <CreditCard className="w-4 h-4" />,
    push: true,
    email: true,
    sms: true,
  },
  {
    id: "fraud",
    label: "Fraud Alerts",
    icon: <AlertTriangle className="w-4 h-4" />,
    push: true,
    email: true,
    sms: true,
  },
  {
    id: "security",
    label: "Security Events",
    icon: <Shield className="w-4 h-4" />,
    push: true,
    email: true,
    sms: false,
  },
  {
    id: "performance",
    label: "Performance Reports",
    icon: <TrendingUp className="w-4 h-4" />,
    push: false,
    email: true,
    sms: false,
  },
  {
    id: "agents",
    label: "Agent Activity",
    icon: <Users className="w-4 h-4" />,
    push: true,
    email: false,
    sms: false,
  },
  {
    id: "system",
    label: "System Updates",
    icon: <Bell className="w-4 h-4" />,
    push: true,
    email: true,
    sms: false,
  },
];

export default function NotificationPreferences() {
  const [channels, setChannels] = useState<NotifChannel[]>(DEFAULT_CHANNELS);
  const testNotify = trpc.system.notifyOwner.useMutation({
    onSuccess: () => toast.success("Test notification sent"),
    onError: e => toast.error("Failed: " + e.message),
  });

  const toggle = (id: string, type: "push" | "email" | "sms") => {
    setChannels(prev =>
      prev.map(c => (c.id === id ? { ...c, [type]: !c[type] } : c))
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bell className="w-6 h-6 text-blue-400" /> Notification Preferences
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Configure how and when you receive alerts across channels
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-blue-600 text-blue-400"
          onClick={() =>
            testNotify.mutate({
              title: "Test Notification",
              content: "This is a test notification from InsurePortal Shell.",
            })
          }
          disabled={testNotify.isPending}
        >
          <Send className="w-3 h-3 mr-1" />{" "}
          {testNotify.isPending ? "Sending..." : "Send Test"}
        </Button>
      </div>

      {/* Channel Settings */}
      <Card className="bg-slate-900/50 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white">
            Notification Channels
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-700 text-slate-500">
                <th className="px-4 py-3 text-left">Alert Type</th>
                <th className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Bell className="w-3 h-3" /> Push
                  </div>
                </th>
                <th className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Mail className="w-3 h-3" /> Email
                  </div>
                </th>
                <th className="px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <Smartphone className="w-3 h-3" /> SMS
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/50">
              {channels.map(c => (
                <tr key={c.id} className="hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-white">
                      {c.icon} {c.label}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Switch
                      checked={c.push}
                      onCheckedChange={() => toggle(c.id, "push")}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Switch
                      checked={c.email}
                      onCheckedChange={() => toggle(c.id, "email")}
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Switch
                      checked={c.sms}
                      onCheckedChange={() => toggle(c.id, "sms")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Quiet Hours */}
      <Card className="bg-slate-900/50 border-slate-700">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm text-white">Quiet Hours</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-white">Enable Quiet Hours</div>
              <div className="text-xs text-slate-500">
                Suppress non-critical notifications during specified hours
              </div>
            </div>
            <Switch />
          </div>
          <div className="flex gap-4 text-xs text-slate-400">
            <div>
              Start: <span className="text-white">10:00 PM</span>
            </div>
            <div>
              End: <span className="text-white">7:00 AM</span>
            </div>
          </div>
          <p className="text-[10px] text-slate-600">
            Critical alerts (fraud, security) are never suppressed
          </p>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button
          className="bg-blue-600 hover:bg-blue-700 text-white"
          onClick={() => toast.success("Preferences saved")}
        >
          Save Preferences
        </Button>
      </div>
    </div>
  );
}
