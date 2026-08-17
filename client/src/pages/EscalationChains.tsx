import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export default function EscalationChains() {
  const [tab, setTab] = useState<"chains" | "events">("chains");
  const [search, setSearch] = useState("");

  const chainsQ = trpc.escalationChains.listChains.useQuery();
  const eventsQ = trpc.escalationChains.listEvents.useQuery({});
  const toggleChain = trpc.escalationChains.toggleChain.useMutation({
    onSuccess: () => {
      chainsQ.refetch();
      toast.success("Chain updated");
    },
  });
  const ackEvent = trpc.escalationChains.acknowledgeEvent.useMutation({
    onSuccess: () => {
      eventsQ.refetch();
      toast.success("Event acknowledged");
    },
  });
  const resolveEvent = trpc.escalationChains.resolveEvent.useMutation({
    onSuccess: () => {
      eventsQ.refetch();
      toast.success("Event resolved");
    },
  });
  const runCheck = trpc.escalationChains.runEscalationCheck.useMutation({
    onSuccess: d => {
      eventsQ.refetch();
      toast.success(`Escalation check: ${d.escalated} escalated`);
    },
  });

  const filteredChains = useMemo(() => {
    if (!chainsQ.data?.chains) return [];
    return chainsQ.data.chains.filter(
      c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.triggerSource.includes(search.toLowerCase())
    );
  }, [chainsQ.data, search]);

  const severityColor: Record<string, string> = {
    critical: "bg-red-500",
    high: "bg-orange-500",
    medium: "bg-yellow-500",
    low: "bg-blue-500",
  };
  const statusColor: Record<string, string> = {
    escalating: "bg-red-500 animate-pulse",
    acknowledged: "bg-yellow-500",
    resolved: "bg-green-500",
    expired: "bg-gray-500",
  };

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Escalation Chains</h1>
            <p className="text-gray-400">
              Configure multi-level alert escalation with timeout windows
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => runCheck.mutate()}
              disabled={runCheck.isPending}
            >
              Run Escalation Check
            </Button>
            <a href="/" className="text-sm text-gray-400 hover:text-white">
              ← Back
            </a>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-800 pb-2">
          <button
            onClick={() => setTab("chains")}
            className={`px-4 py-2 rounded-t text-sm font-medium ${tab === "chains" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"}`}
          >
            Chains ({chainsQ.data?.total ?? 0})
          </button>
          <button
            onClick={() => setTab("events")}
            className={`px-4 py-2 rounded-t text-sm font-medium ${tab === "events" ? "bg-gray-800 text-white" : "text-gray-400 hover:text-white"}`}
          >
            Active Events ({eventsQ.data?.total ?? 0})
          </button>
        </div>

        <Input
          placeholder="Search chains..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm bg-gray-900 border-gray-700"
        />

        {tab === "chains" && (
          <div className="grid gap-4">
            {filteredChains.map((chain: any) => (
              <Card key={chain.id} className="bg-gray-900 border-gray-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-lg text-white">
                        {chain.name}
                      </CardTitle>
                      <Badge
                        className={`${severityColor[chain.severity]} text-white text-xs`}
                      >
                        {chain.severity}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="text-gray-300 border-gray-600"
                      >
                        {chain.triggerSource.replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <Button
                      size="sm"
                      variant={chain.enabled ? "default" : "outline"}
                      onClick={() =>
                        toggleChain.mutate({
                          id: chain.id,
                          enabled: !chain.enabled,
                        })
                      }
                    >
                      {chain.enabled ? "Enabled" : "Disabled"}
                    </Button>
                  </div>
                  <CardDescription className="text-gray-400">
                    {chain.description}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    {chain.levels.map((level, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className="bg-gray-800 rounded-lg p-3 min-w-[160px] border border-gray-700">
                          <div className="text-xs text-gray-400 mb-1">
                            Level {level.level}
                          </div>
                          <div className="text-sm font-medium text-white">
                            {level.recipientType.toUpperCase()}
                          </div>
                          <div className="text-xs text-gray-400 truncate">
                            {level.recipient}
                          </div>
                          <div className="text-xs text-yellow-400 mt-1">
                            ⏱ {level.timeoutMinutes}min timeout
                          </div>
                        </div>
                        {i < chain.levels.length - 1 && (
                          <span className="text-gray-600 text-lg">→</span>
                        )}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {tab === "events" && (
          <div className="grid gap-4">
            {eventsQ.data?.events.map((event: any) => (
              <Card key={event.id} className="bg-gray-900 border-gray-800">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-3 h-3 rounded-full ${statusColor[event.status]}`}
                      />
                      <CardTitle className="text-lg text-white">
                        {event.alertTitle}
                      </CardTitle>
                      <Badge
                        variant="outline"
                        className="text-gray-300 border-gray-600"
                      >
                        L{event.currentLevel}/{event.maxLevel}
                      </Badge>
                    </div>
                    <div className="flex gap-2">
                      {event.status === "escalating" && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              ackEvent.mutate({
                                eventId: event.id,
                                acknowledgedBy: "admin",
                              })
                            }
                          >
                            Acknowledge
                          </Button>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() =>
                              resolveEvent.mutate({ eventId: event.id })
                            }
                          >
                            Resolve
                          </Button>
                        </>
                      )}
                      <Badge
                        className={`${statusColor[event.status]} text-white`}
                      >
                        {event.status}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    <div className="text-xs text-gray-400">
                      Started: {new Date(event.startedAt).toLocaleString()}
                    </div>
                    <div className="text-sm font-medium text-gray-300 mb-2">
                      Escalation History
                    </div>
                    <div className="space-y-1">
                      {event.history.map((h, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-3 text-xs text-gray-400 bg-gray-800 rounded p-2"
                        >
                          <Badge
                            variant="outline"
                            className="text-gray-300 border-gray-600"
                          >
                            L{h.level}
                          </Badge>
                          <span>{h.channel.toUpperCase()}</span>
                          <span className="text-gray-500">→</span>
                          <span className="truncate">{h.recipient}</span>
                          <span className="ml-auto">
                            {new Date(h.sentAt).toLocaleTimeString()}
                          </span>
                          <Badge
                            className={
                              h.status === "delivered"
                                ? "bg-green-600"
                                : h.status === "sent"
                                  ? "bg-blue-600"
                                  : "bg-red-600"
                            }
                          >
                            {h.status}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {eventsQ.data?.events.length === 0 && (
              <p className="text-gray-500 text-center py-8">
                No active escalation events
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
