import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function BulkNotifSender() {
  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"email" | "sms" | "push">("email");
  const [recipientCount, setRecipientCount] = useState(100);

  // F-12 (S87-02): bulkNotif delivers only sendBulk — campaign listing and
  // lifecycle mutations (createCampaign/startCampaign/pauseCampaign) are NOT
  // delivered. The campaigns list renders an honest empty state and the
  // lifecycle actions fail loud at runtime instead of calling phantoms.
  const campaignsQ: {
    data?: {
      total?: number;
      campaigns?: Array<{
        id: number; name: string; status: string; channel?: string;
        progress?: number; recipientCount?: number; sentCount?: number;
        failedCount?: number; createdAt?: string | Date;
      }>;
    };
    isLoading: boolean;
    refetch: () => void;
  } = { data: undefined, isLoading: false, refetch: () => {} };
  const templatesQ = trpc.notifTemplates.list.useQuery({ channel });
  const loud = (action: string) => () =>
    toast.error(`Campaign ${action} is not available on this deployment`);
  const createCampaign = { mutate: loud("creation"), isPending: false };
  const startCampaign = { mutate: loud("start"), isPending: false };
  const pauseCampaign = { mutate: loud("pause"), isPending: false };

  const statusColor: Record<string, string> = {
    draft: "bg-gray-500",
    sending: "bg-blue-500 animate-pulse",
    completed: "bg-green-500",
    failed: "bg-red-500",
    paused: "bg-yellow-500",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Bulk Notification Sender</h1>
            <p className="text-gray-400">
              Send mass notifications to agents and customers
            </p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        {/* Create Campaign */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">New Campaign</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-4">
              <Input
                placeholder="Campaign name"
                value={name}
                onChange={e => setName(e.target.value)}
                className="bg-gray-800 border-gray-700 text-white"
              />
              <select
                value={channel}
                onChange={e =>
                  setChannel(e.target.value as "email" | "sms" | "push")
                }
                className="bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white text-sm"
              >
                <option value="email">Email</option>
                <option value="sms">SMS</option>
                <option value="push">Push</option>
              </select>
              <Input
                type="number"
                placeholder="Recipients"
                value={recipientCount}
                onChange={e => setRecipientCount(Number(e.target.value))}
                className="bg-gray-800 border-gray-700 text-white"
              />
              <Button
                onClick={() => {
                  if (name)
                    createCampaign.mutate({
                      name,
                      templateId:
                        templatesQ.data?.templates[0]?.id || "tpl_001",
                      channel,
                      recipientCount,
                    });
                }}
                disabled={!name || createCampaign.isPending}
              >
                Create Campaign
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Campaign List */}
        <Card className="bg-gray-900 border-gray-800">
          <CardHeader>
            <CardTitle className="text-white">
              Campaigns ({campaignsQ.data?.total ?? 0})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {campaignsQ.data?.campaigns?.map(camp => (
                <div key={camp.id} className="bg-gray-800 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <Badge
                        className={`${statusColor[camp.status]} text-white`}
                      >
                        {camp.status}
                      </Badge>
                      <span className="font-medium text-white">
                        {camp.name}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-gray-400 border-gray-600 text-xs"
                      >
                        {camp.channel}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      {camp.status === "draft" && (
                        <Button
                          size="sm"
                          onClick={() => startCampaign.mutate({ id: camp.id })}
                        >
                          Start
                        </Button>
                      )}
                      {camp.status === "sending" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => pauseCampaign.mutate({ id: camp.id })}
                        >
                          Pause
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-400">
                    <span>
                      Recipients: {camp.recipientCount.toLocaleString()}
                    </span>
                    <span>Sent: {camp.sentCount.toLocaleString()}</span>
                    <span>Failed: {camp.failedCount}</span>
                  </div>
                  {/* Progress bar */}
                  <div className="mt-2 bg-gray-700 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all"
                      style={{ width: `${camp.progress}%` }}
                    />
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {camp.progress}% complete
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
