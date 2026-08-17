import DashboardLayout from "@/components/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Mail,
  Send,
  Clock,
  CheckCircle,
  AlertCircle,
  Calendar,
} from "lucide-react";

export default function ScheduledEmailDelivery() {
  const config = trpc.sprint23.scheduledDelivery.getConfig.useQuery();
  const utils = trpc.useUtils();

  const updateMutation =
    trpc.sprint23.scheduledDelivery.updateConfig.useMutation({
      onSuccess: () => {
        utils.sprint23.scheduledDelivery.getConfig.invalidate();
        toast.success("Configuration updated");
      },
    });

  const triggerMutation =
    trpc.sprint23.scheduledDelivery.triggerNow.useMutation({
      onSuccess: (data: any) => {
        utils.sprint23.scheduledDelivery.getConfig.invalidate();
        toast.success(`Report sent to ${data.recipientCount} recipients`);
      },
    });

  const statusColor = (s: string) => {
    if (s === "success") return "default";
    if (s === "partial") return "secondary";
    return "destructive";
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Mail className="w-6 h-6 text-blue-400" />
              Scheduled Email Delivery
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Automated weekly report email delivery configuration
            </p>
          </div>
          <Button
            onClick={() => triggerMutation.mutate()}
            disabled={triggerMutation.isPending}
          >
            <Send className="w-4 h-4 mr-2" /> Send Now
          </Button>
        </div>

        {config.data && (
          <>
            {/* Config Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        Delivery Status
                      </p>
                      <p className="text-lg font-bold">
                        {config.data.enabled ? "Active" : "Paused"}
                      </p>
                    </div>
                    <Switch
                      checked={config.data.enabled}
                      onCheckedChange={enabled =>
                        updateMutation.mutate({ enabled })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <Clock className="w-6 h-6 mx-auto text-purple-400 mb-1" />
                  <p className="text-sm text-muted-foreground">Schedule</p>
                  <p className="text-lg font-mono">
                    {config.data.cronExpression}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {config.data.timezone}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6 text-center">
                  <Calendar className="w-6 h-6 mx-auto text-green-400 mb-1" />
                  <p className="text-sm text-muted-foreground">Next Delivery</p>
                  <p className="text-sm font-medium">
                    {config.data.nextDelivery
                      ? new Date(config.data.nextDelivery).toLocaleDateString()
                      : "Not scheduled"}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Delivery History */}
            <Card>
              <CardHeader>
                <CardTitle>Delivery History</CardTitle>
              </CardHeader>
              <CardContent>
                {config.data.deliveryHistory.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <Mail className="w-12 h-12 mx-auto mb-2 opacity-30" />
                    <p>No deliveries yet</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border">
                          <th className="text-left py-2 px-3">Sent At</th>
                          <th className="text-center py-2 px-3">Recipients</th>
                          <th className="text-center py-2 px-3">Status</th>
                          <th className="text-left py-2 px-3">Errors</th>
                        </tr>
                      </thead>
                      <tbody>
                        {config.data.deliveryHistory.map((entry: any, idx) => (
                          <tr key={idx} className="border-b border-border/50">
                            <td className="py-2 px-3">
                              {new Date(entry.sentAt).toLocaleString()}
                            </td>
                            <td className="text-center py-2 px-3">
                              {entry.recipientCount}
                            </td>
                            <td className="text-center py-2 px-3">
                              <Badge variant={statusColor(entry.status) as any}>
                                {entry.status}
                              </Badge>
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {entry.errors.length > 0
                                ? entry.errors.join(", ")
                                : "None"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
