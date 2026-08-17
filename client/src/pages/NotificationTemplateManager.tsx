import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

export default function NotificationTemplateManager() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewVars, setPreviewVars] = useState<Record<string, string>>({});
  const [channelFilter, setChannelFilter] = useState<string>("");

  const templatesQ = trpc.notifTemplates.list.useQuery(
    channelFilter ? { channel: channelFilter } : {}
  );
  const previewMut = trpc.notifTemplates.preview.useMutation();
  const deleteMut = trpc.notifTemplates.delete.useMutation({
    onSuccess: () => {
      templatesQ.refetch();
      toast.success("Template deleted");
      setSelectedId(null);
    },
  });

  const selected = useMemo(() => {
    if (!selectedId || !templatesQ.data) return null;
    return templatesQ.data.templates.find(t => t.id === selectedId) || null;
  }, [selectedId, templatesQ.data]);

  const channelIcon: Record<string, string> = {
    email: "📧",
    sms: "💬",
    push: "🔔",
  };

  const handlePreview = () => {
    if (!selectedId) return;
    previewMut.mutate({ id: selectedId, variables: previewVars });
  };

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

        <div className="grid grid-cols-3 gap-6">
          {/* Template list */}
          <div className="col-span-1 space-y-3">
            {templatesQ.data?.templates.map(tpl => (
              <Card
                key={tpl.id}
                onClick={() => {
                  setSelectedId(tpl.id);
                  setPreviewVars({});
                }}
                className={`cursor-pointer transition-colors ${selectedId === tpl.id ? "bg-gray-800 border-blue-500" : "bg-gray-900 border-gray-800 hover:border-gray-600"}`}
              >
                <CardContent className="pt-4">
                  <div className="flex items-center gap-2 mb-1">
                    <span>{channelIcon[tpl.channel]}</span>
                    <span className="font-medium text-white text-sm">
                      {tpl.name}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <Badge
                      variant="outline"
                      className="text-gray-400 border-gray-600 text-xs"
                    >
                      {tpl.channel}
                    </Badge>
                    {tpl.isDefault && (
                      <Badge className="bg-gray-700 text-gray-300 text-xs">
                        Default
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {tpl.variables.length} variables
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Template detail + preview */}
          <div className="col-span-2">
            {selected ? (
              <Card className="bg-gray-900 border-gray-800">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-white">
                      {selected.name}
                    </CardTitle>
                    <div className="flex gap-2">
                      {!selected.isDefault && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteMut.mutate({ id: selected.id })}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {selected.subject && (
                    <div>
                      <label className="text-xs text-gray-400 block mb-1">
                        Subject
                      </label>
                      <div className="bg-gray-800 rounded p-2 text-sm text-gray-300 font-mono">
                        {selected.subject}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">
                      Body Template
                    </label>
                    <div className="bg-gray-800 rounded p-3 text-sm text-gray-300 font-mono whitespace-pre-wrap max-h-48 overflow-y-auto">
                      {selected.body}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-400 block mb-1">
                      Variables
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {selected.variables.map(v => (
                        <Badge
                          key={v}
                          variant="outline"
                          className="text-blue-400 border-blue-600"
                        >{`{{${v}}}`}</Badge>
                      ))}
                    </div>
                  </div>

                  {/* Preview section */}
                  <div className="border-t border-gray-800 pt-4">
                    <h3 className="text-sm font-medium text-gray-300 mb-3">
                      Preview
                    </h3>
                    <div className="grid grid-cols-2 gap-2 mb-3">
                      {selected.variables.map(v => (
                        <Input
                          key={v}
                          placeholder={v}
                          value={previewVars[v] || ""}
                          onChange={e =>
                            setPreviewVars(prev => ({
                              ...prev,
                              [v]: e.target.value,
                            }))
                          }
                          className="bg-gray-800 border-gray-700 text-white text-sm"
                        />
                      ))}
                    </div>
                    <Button
                      size="sm"
                      onClick={handlePreview}
                      disabled={previewMut.isPending}
                    >
                      {previewMut.isPending ? "Rendering..." : "Render Preview"}
                    </Button>
                    {previewMut.data && (
                      <div className="mt-3 bg-gray-800 rounded-lg p-4 border border-gray-700">
                        {previewMut.data.subject && (
                          <div className="text-sm font-medium text-white mb-2">
                            Subject: {previewMut.data.subject}
                          </div>
                        )}
                        <div className="text-sm text-gray-300 whitespace-pre-wrap">
                          {previewMut.data.body}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ) : (
              <div className="flex items-center justify-center h-64 text-gray-500">
                Select a template to view details and preview
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
