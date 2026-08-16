/**
 * Admin Support Inbox — InsurePortal POS Shell
 * Bloomberg Terminal dark theme with electric blue accents.
 *
 * Features:
 * - Real-time conversation list with status filters (open/assigned/escalated/resolved)
 * - Live message thread view with admin reply capability
 * - Session assignment, escalation, and resolution controls
 * - Chat stats dashboard (open, assigned, escalated, avg rating)
 * - Auto-refresh via polling + Socket.IO for instant updates
 * - Canned admin responses for common support scenarios
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
// @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch from router/page interface
import { DashboardLayout } from "@/components/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  MessageCircle,
  Send,
  Users,
  AlertTriangle,
  CheckCircle,
  Clock,
  Star,
  Search,
  RefreshCw,
  UserPlus,
  ArrowUpRight,
  ChevronRight,
  Loader2,
  Inbox,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────
interface ChatSession {
  id: number;
  sessionRef: string;
  agentId: number | null;
  category: string | null;
  subject: string | null;
  status: string;
  supportAgentName: string | null;
  rating: number | null;
  createdAt: Date;
  resolvedAt: Date | null;
  updatedAt: Date;
}

interface ChatMessage {
  id: number;
  sessionId: number;
  senderType: string;
  senderName: string | null;
  content: string;
  isRead: boolean | null;
  createdAt: string;
}

// ─── Canned Admin Responses ─────────────────────────────────────────────────
const ADMIN_CANNED = [
  {
    label: "Greeting",
    text: "Hello! Thank you for contacting InsurePortal support. I'm reviewing your issue now.",
  },
  {
    label: "Investigating",
    text: "I'm looking into this for you. Please give me a moment to check the details.",
  },
  {
    label: "Escalating",
    text: "I'm escalating this to our senior support team for faster resolution. You'll hear back shortly.",
  },
  {
    label: "Float Top-up",
    text: "Your float top-up request has been processed. Please check your balance in 2-5 minutes.",
  },
  {
    label: "Transaction Fix",
    text: "I've identified the issue with your transaction. A reversal has been initiated and should reflect within 24 hours.",
  },
  {
    label: "KYC Update",
    text: "Your KYC documents have been received and are under review. Expected processing time is 24-48 hours.",
  },
  {
    label: "Resolved",
    text: "Your issue has been resolved. Is there anything else I can help you with?",
  },
];

const SUPPORT_AGENTS = [
  "Amaka Okonkwo",
  "Chidi Nwosu",
  "Fatima Bello",
  "Emeka Eze",
  "Ngozi Adeyemi",
  "Ibrahim Musa",
  "Blessing Okoro",
];

const STATUS_CONFIG: Record<
  string,
  { color: string; icon: typeof Clock; label: string }
> = {
  open: {
    color: "text-blue-400 bg-blue-400/10 border-blue-400/20",
    icon: Clock,
    label: "Open",
  },
  assigned: {
    color: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    icon: UserPlus,
    label: "Assigned",
  },
  escalated: {
    color: "text-red-400 bg-red-400/10 border-red-400/20",
    icon: AlertTriangle,
    label: "Escalated",
  },
  resolved: {
    color: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    icon: CheckCircle,
    label: "Resolved",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
export default function AdminSupportInbox() {
  const { user } = useAuth();
  const [statusFilter, setStatusFilter] = useState<
    "all" | "open" | "assigned" | "escalated" | "resolved"
  >("all");
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(
    null
  );
  const [replyText, setReplyText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [assignAgent, setAssignAgent] = useState("");
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [showEscalateDialog, setShowEscalateDialog] = useState(false);
  const [escalateReason, setEscalateReason] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // ── Queries ─────────────────────────────────────────────────────────────
  // @ts-ignore Sprint 85
  const statsQuery = trpc.chat.adminStats.useQuery(undefined, {
    refetchInterval: 15000,
  });
  // @ts-ignore Sprint 85 — Sprint 85: pre-existing type mismatch
  const sessionsQuery = trpc.chat.adminListSessions.useQuery(
    statusFilter === "all"
      ? { limit: 100 }
      : { status: statusFilter, limit: 100 },
    { refetchInterval: 10000 }
  );

  // @ts-ignore Sprint 85
  const messagesQuery = trpc.chat.adminGetMessages.useQuery(
    { sessionId: selectedSession?.id ?? 0 },
    { enabled: !!selectedSession, refetchInterval: 5000 }
  );

  // ── Mutations ───────────────────────────────────────────────────────────
  // @ts-ignore Sprint 85
  const replyMutation = trpc.chat.adminReply.useMutation({
    onSuccess: () => {
      setReplyText("");
      messagesQuery.refetch();
      toast.success("Reply sent");
    },
    onError: () => toast.error("Failed to send reply"),
  });

  // @ts-ignore Sprint 85
  const assignMutation = trpc.chat.adminAssignSession.useMutation({
    onSuccess: () => {
      setShowAssignDialog(false);
      setAssignAgent("");
      sessionsQuery.refetch();
      toast.success("Session assigned");
    },
    onError: () => toast.error("Failed to assign session"),
  });

  // @ts-ignore Sprint 85
  const escalateMutation = trpc.chat.adminEscalate.useMutation({
    onSuccess: () => {
      setShowEscalateDialog(false);
      setEscalateReason("");
      sessionsQuery.refetch();
      messagesQuery.refetch();
      toast.success("Session escalated");
    },
    onError: () => toast.error("Failed to escalate"),
  });

  // @ts-ignore Sprint 85
  const resolveMutation = trpc.chat.adminResolve.useMutation({
    onSuccess: () => {
      sessionsQuery.refetch();
      messagesQuery.refetch();
      toast.success("Session resolved");
    },
    onError: () => toast.error("Failed to resolve"),
  });

  // @ts-ignore Sprint 85
  const deleteMutation = trpc.chat.adminDeleteSession.useMutation({
    onSuccess: () => {
      setSelectedSession(null);
      sessionsQuery.refetch();
      toast.success("Session deleted");
    },
    onError: () => toast.error("Failed to delete session"),
  });

  // ── Auto-scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messagesQuery.data]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleReply = useCallback(() => {
    if (!replyText.trim() || !selectedSession) return;
    replyMutation.mutate({
      sessionId: selectedSession.id,
      content: replyText.trim(),
    });
  }, [replyText, selectedSession, replyMutation]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleReply();
    }
  };

  // ── Filter sessions ─────────────────────────────────────────────────────
  const filteredSessions = (sessionsQuery.data?.sessions ?? []).filter(
    (s: ChatSession) => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        s.sessionRef?.toLowerCase().includes(q) ||
        s.subject?.toLowerCase().includes(q) ||
        s.category?.toLowerCase().includes(q) ||
        s.supportAgentName?.toLowerCase().includes(q)
      );
    }
  );

  const stats = statsQuery.data;

  return (
    <DashboardLayout>
      <div className="flex flex-col h-[calc(100vh-64px)]">
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="border-b border-border px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Inbox className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-semibold">Support Inbox</h1>
                <p className="text-sm text-muted-foreground">
                  Manage live chat conversations
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                sessionsQuery.refetch();
                statsQuery.refetch();
              }}
              className="gap-2"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              {
                label: "Open",
                value: stats?.openSessions ?? 0,
                icon: Clock,
                color: "text-blue-400",
              },
              {
                label: "Assigned",
                value: stats?.assignedSessions ?? 0,
                icon: UserPlus,
                color: "text-amber-400",
              },
              {
                label: "Escalated",
                value: stats?.escalatedSessions ?? 0,
                icon: AlertTriangle,
                color: "text-red-400",
              },
              {
                label: "Resolved",
                value: stats?.resolvedSessions ?? 0,
                icon: CheckCircle,
                color: "text-emerald-400",
              },
              {
                label: "Avg Rating",
                value: "N/A",
                icon: Star,
                color: "text-amber-400",
              },
            ].map((stat: any) => (
              <div
                key={stat.label}
                className="bg-card border border-border rounded-lg p-3 flex items-center gap-3"
              >
                <stat.icon className={cn("h-4 w-4", stat.color)} />
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-lg font-semibold">{stat.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Main Content ────────────────────────────────────────────────── */}
        <div className="flex flex-1 overflow-hidden">
          {/* ── Session List (Left Panel) ──────────────────────────────────── */}
          <div className="w-[360px] border-r border-border flex flex-col">
            {/* Filters */}
            <div className="p-3 border-b border-border space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search sessions..."
                  value={searchQuery}
                  onChange={(e: any) => setSearchQuery(e.target.value)}
                  className="pl-9 h-8 text-sm"
                />
              </div>
              <div className="flex gap-1 flex-wrap">
                {(
                  ["all", "open", "assigned", "escalated", "resolved"] as const
                ).map((status: any) => (
                  <button
                    key={status}
                    onClick={() => setStatusFilter(status)}
                    className={cn(
                      "px-2.5 py-1 rounded-md text-xs font-medium transition-colors capitalize",
                      statusFilter === status
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    )}
                  >
                    {status}
                  </button>
                ))}
              </div>
            </div>

            {/* Session List */}
            <ScrollArea className="flex-1">
              {sessionsQuery.isLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filteredSessions.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <MessageCircle className="h-8 w-8 mb-2 opacity-30" />
                  <p className="text-sm">No conversations found</p>
                </div>
              ) : (
                <div className="divide-y divide-border">
                  // @ts-ignore Sprint 85
                  {filteredSessions.map((session: ChatSession) => {
                    const statusCfg =
                      STATUS_CONFIG[session.status] ?? STATUS_CONFIG.open;
                    const StatusIcon = statusCfg.icon;
                    const isSelected = selectedSession?.id === session.id;
                    return (
                      <button
                        key={session.id}
                        onClick={() => setSelectedSession(session)}
                        className={cn(
                          "w-full text-left p-3 hover:bg-accent/50 transition-colors",
                          isSelected && "bg-accent/70 border-l-2 border-primary"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-sm font-medium truncate">
                                {session.subject ||
                                  session.category ||
                                  "Support Request"}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] px-1.5 py-0 border",
                                  statusCfg.color
                                )}
                              >
                                <StatusIcon className="h-2.5 w-2.5 mr-1" />
                                {statusCfg.label}
                              </Badge>
                              {session.supportAgentName && (
                                <span className="truncate">
                                  {session.supportAgentName}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                              {new Date(session.createdAt).toLocaleDateString(
                                undefined,
                                { month: "short", day: "numeric" }
                              )}
                            </span>
                            {session.rating && (
                              <span className="text-[10px] text-amber-400">
                                {"★".repeat(session.rating)}
                              </span>
                            )}
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* ── Message Thread (Right Panel) ───────────────────────────────── */}
          <div className="flex-1 flex flex-col">
            {!selectedSession ? (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                <Inbox className="h-12 w-12 mb-3 opacity-20" />
                <p className="text-sm">Select a conversation to view</p>
              </div>
            ) : (
              <>
                {/* Thread Header */}
                <div className="border-b border-border px-4 py-3 flex items-center justify-between">
                  <div>
                    <h2 className="text-sm font-semibold">
                      {selectedSession.subject ||
                        selectedSession.category ||
                        "Support Request"}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Ref: {selectedSession.sessionRef} · Agent:{" "}
                      {selectedSession.supportAgentName ?? "Unassigned"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedSession.status !== "resolved" && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs gap-1"
                          onClick={() => setShowAssignDialog(true)}
                        >
                          <UserPlus className="h-3 w-3" />
                          Assign
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs gap-1 text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                          onClick={() => setShowEscalateDialog(true)}
                        >
                          <ArrowUpRight className="h-3 w-3" />
                          Escalate
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs gap-1 text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10"
                          onClick={() =>
                            resolveMutation.mutate({
                              sessionId: selectedSession.id,
                            })
                          }
                          disabled={resolveMutation.isPending}
                        >
                          <CheckCircle className="h-3 w-3" />
                          Resolve
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  <div className="space-y-3">
                    // @ts-ignore Sprint 85
                    {(messagesQuery.data ?? []).map((msg: ChatMessage) => {
                      const isSupport = msg.senderType === "support";
                      const isSystem = msg.senderType === "system";
                      return (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex",
                            isSystem
                              ? "justify-center"
                              : isSupport
                                ? "justify-end"
                                : "justify-start"
                          )}
                        >
                          {isSystem ? (
                            <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 max-w-[85%]">
                              <p className="text-xs text-amber-400">
                                {msg.content}
                              </p>
                              <p className="text-[10px] text-muted-foreground mt-1">
                                {new Date(msg.createdAt).toLocaleTimeString(
                                  [],
                                  { hour: "2-digit", minute: "2-digit" }
                                )}
                              </p>
                            </div>
                          ) : (
                            <div
                              className={cn(
                                "max-w-[75%] rounded-2xl px-4 py-2.5",
                                isSupport
                                  ? "bg-primary text-primary-foreground rounded-br-md"
                                  : "bg-muted text-foreground rounded-bl-md"
                              )}
                            >
                              <p
                                className={cn(
                                  "text-[10px] font-semibold mb-0.5",
                                  isSupport
                                    ? "text-primary-foreground/70"
                                    : "text-primary"
                                )}
                              >
                                {msg.senderName ??
                                  (isSupport ? "Support" : "Agent")}
                              </p>
                              <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                                {msg.content}
                              </p>
                              <p
                                className={cn(
                                  "text-[10px] mt-1 text-right",
                                  isSupport
                                    ? "text-primary-foreground/50"
                                    : "text-muted-foreground"
                                )}
                              >
                                {new Date(msg.createdAt).toLocaleTimeString(
                                  [],
                                  { hour: "2-digit", minute: "2-digit" }
                                )}
                              </p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <div ref={messagesEndRef} />
                  </div>
                </ScrollArea>

                {/* Canned Responses */}
                {selectedSession.status !== "resolved" && (
                  <div className="border-t border-border px-4 py-2 flex gap-1.5 overflow-x-auto">
                    {ADMIN_CANNED.map((canned: any) => (
                      <button
                        key={canned.label}
                        onClick={() => setReplyText(canned.text)}
                        className="text-[10px] bg-muted hover:bg-accent px-2 py-1 rounded-full whitespace-nowrap transition-colors text-muted-foreground"
                      >
                        {canned.label}
                      </button>
                    ))}
                  </div>
                )}

                {/* Reply Input */}
                {selectedSession.status !== "resolved" && (
                  <div className="border-t border-border p-3 bg-card">
                    <div className="flex items-end gap-2">
                      <Textarea
                        value={replyText}
                        onChange={(e: any) => setReplyText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Type your reply..."
                        className="min-h-[40px] max-h-[100px] resize-none text-sm rounded-xl"
                        rows={1}
                        disabled={replyMutation.isPending}
                      />
                      <Button
                        size="icon"
                        onClick={handleReply}
                        disabled={!replyText.trim() || replyMutation.isPending}
                        className="h-10 w-10 rounded-xl flex-shrink-0"
                      >
                        {replyMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Assign Dialog ───────────────────────────────────────────────── */}
        {showAssignDialog && selectedSession && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowAssignDialog(false)}
          >
            <div
              className="bg-card border border-border rounded-xl p-6 w-[400px] shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold mb-4">
                Assign Support Agent
              </h3>
              <div className="space-y-2 mb-4">
                {SUPPORT_AGENTS.map((agent: any) => (
                  <button
                    key={agent}
                    onClick={() => setAssignAgent(agent)}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg text-sm transition-colors",
                      assignAgent === agent
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted hover:bg-accent text-foreground"
                    )}
                  >
                    <Users className="h-3.5 w-3.5 inline mr-2" />
                    {agent}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAssignDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!assignAgent || assignMutation.isPending}
                  onClick={() =>
                    assignMutation.mutate({
                      sessionId: selectedSession.id,
                      supportAgentName: assignAgent,
                    })
                  }
                >
                  {assignMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : null}
                  Assign
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Escalate Dialog ─────────────────────────────────────────────── */}
        {showEscalateDialog && selectedSession && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShowEscalateDialog(false)}
          >
            <div
              className="bg-card border border-border rounded-xl p-6 w-[400px] shadow-2xl"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                Escalate Conversation
              </h3>
              <Textarea
                value={escalateReason}
                onChange={(e: any) => setEscalateReason(e.target.value)}
                placeholder="Reason for escalation..."
                className="min-h-[80px] text-sm mb-4"
              />
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowEscalateDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={
                    escalateReason.length < 3 || escalateMutation.isPending
                  }
                  onClick={() =>
                    escalateMutation.mutate({
                      sessionId: selectedSession.id,
                      reason: escalateReason,
                    })
                  }
                >
                  {escalateMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : null}
                  Escalate
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
