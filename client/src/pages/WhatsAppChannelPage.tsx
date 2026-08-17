import { useState } from "react";
import DashboardLayout from "@/components/DashboardLayout";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MessageCircle, Send, Users, BarChart3 } from "lucide-react";

export default function WhatsAppChannelPage() {
  const [tab, setTab] = useState<"messages" | "templates" | "contacts">(
    "messages"
  );
  const messages = trpc.whatsappChannel.messages.useQuery({ limit: 20 });
  const templates = trpc.whatsappChannel.templates.useQuery();
  const contacts = trpc.whatsappChannel.messages.useQuery({ limit: 20 });
  const analytics = trpc.whatsappChannel.analytics.useQuery();

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">WhatsApp Channel</h1>
          <p className="text-muted-foreground">
            WhatsApp Business API integration for agent notifications and
            customer support
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Messages Sent
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {(analytics.data?.totalSent ?? 0).toLocaleString()}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Delivery Rate
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.deliveryRate ?? 0}%
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Templates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {analytics.data?.templateCount ?? 0}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground">
                Templates
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">
                {templates.data?.templates?.length ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        <div className="flex gap-2">
          <Button
            variant={tab === "messages" ? "default" : "outline"}
            onClick={() => setTab("messages")}
          >
            <MessageCircle className="h-4 w-4 mr-1" />
            Messages
          </Button>
          <Button
            variant={tab === "templates" ? "default" : "outline"}
            onClick={() => setTab("templates")}
          >
            <Send className="h-4 w-4 mr-1" />
            Templates
          </Button>
          <Button
            variant={tab === "contacts" ? "default" : "outline"}
            onClick={() => setTab("contacts")}
          >
            <Users className="h-4 w-4 mr-1" />
            Contacts
          </Button>
        </div>

        {tab === "messages" && (
          <Card>
            <CardHeader>
              <CardTitle>Recent Messages</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Recipient</th>
                      <th className="text-left p-2">Template</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Sent At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages.data?.messages?.map((m: any) => (
                      <tr key={m.id} className="border-b">
                        <td className="p-2">{m.recipientPhone}</td>
                        <td className="p-2">{m.templateName}</td>
                        <td className="p-2">
                          <Badge
                            variant={
                              m.status === "delivered"
                                ? "default"
                                : m.status === "sent"
                                  ? "secondary"
                                  : "destructive"
                            }
                          >
                            {m.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-xs">
                          {new Date(m.sentAt).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "templates" && (
          <Card>
            <CardHeader>
              <CardTitle>Message Templates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {templates.data?.templates?.map((t: any) => (
                  <div key={t.id} className="border rounded p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold">{t.name}</span>
                      <Badge
                        variant={
                          t.status === "approved" ? "default" : "secondary"
                        }
                      >
                        {t.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {t.category} &bull; {t.language}
                    </p>
                    <p className="text-xs mt-1 bg-muted p-2 rounded">
                      {t.body}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {tab === "contacts" && (
          <Card>
            <CardHeader>
              <CardTitle>WhatsApp Contacts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2">Name</th>
                      <th className="text-left p-2">Phone</th>
                      <th className="text-left p-2">Type</th>
                      <th className="text-left p-2">Opted In</th>
                      <th className="text-left p-2">Last Message</th>
                    </tr>
                  </thead>
                  <tbody>
                    {contacts.data?.messages?.map((c: any) => (
                      <tr key={c.id} className="border-b">
                        <td className="p-2">{c.name}</td>
                        <td className="p-2 font-mono text-xs">{c.phone}</td>
                        <td className="p-2">
                          <Badge>{c.type}</Badge>
                        </td>
                        <td className="p-2">{c.optedIn ? "Yes" : "No"}</td>
                        <td className="p-2 text-xs">
                          {c.lastMessageAt
                            ? new Date(c.lastMessageAt).toLocaleString()
                            : "Never"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </DashboardLayout>
  );
}
