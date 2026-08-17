import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function NotificationTemplateManager() {
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});
  const [channelFilter, setChannelFilter] = useState<string>("");

  // F-12 (wave-4b): notifTemplates CRUD is fail-loud NOT_IMPLEMENTED (no
  // template store delivered); preview has no procedure at all. The page
  // renders an honest unavailable state and actions fail loud.
  const templatesQ = trpc.notifTemplates.list.useQuery(
    channelFilter ? { channel: channelFilter } : {}
  );


  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Notification Templates</h1>
            <p className="text-gray-400">
              Manage email, SMS, and push notification templates
            </p>
          </div>
          <a href="/" className="text-sm text-gray-400 hover:text-white">
            ← Back
          </a>
        </div>

        {/* Channel filter */}
        <div className="flex gap-2">
          <button
            onClick={() => setChannelFilter("")}
            className={`px-3 py-1 rounded text-sm ${!channelFilter ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}
          >
            All
          </button>
          {["email", "sms", "push"].map(ch => (
            <button
              key={ch}
              onClick={() => setChannelFilter(ch)}
              className={`px-3 py-1 rounded text-sm capitalize ${channelFilter === ch ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-400"}`}
            >
              {channelIcon[ch]} {ch}
            </button>
          ))}
        </div>

        {/* F-12 (wave-4b): template CRUD + preview are fail-loud
            NOT_IMPLEMENTED — honest unavailable state; the list query stays
            wired so a loud backend error surfaces if ever delivered. */}
        <Card>
          <CardContent className="py-10 text-center text-gray-400">
            — notification-template management is not delivered on this
            platform (no template store)
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

