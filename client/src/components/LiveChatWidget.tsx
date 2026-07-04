/**
 * LiveChatWidget — Floating chat support widget (bottom-right corner)
 *
 * Features:
 * - Expandable chat bubble with AI assistant
 * - Real-time message exchange via tRPC
 * - Escalation to human agent
 * - Session persistence across page navigation
 * - Contextual help based on current page
 * - Satisfaction rating on close
 * - Minimized state with unread indicator
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  MessageCircle,
  X,
  Send,
  Loader2,
  Minimize2,
  Maximize2,
  AlertTriangle,
  Star,
  Bot,
  User,
  ChevronDown,
  Sparkles,
  ArrowUpRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { toast } from "sonner";

interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

// ─── Page Context Map ────────────────────────────────────────────────────────
const pageContextMap: Record<string, string> = {
  "/": "POS Terminal",
  "/hub": "Platform Hub",
  "/agent": "Agent Portal",
  "/customer": "Customer Portal",
  "/merchant": "Merchant Portal",
  "/developer": "Developer Portal",
  "/admin": "Admin Panel",
  "/admin/fraud": "Fraud Dashboard",
  "/admin/analytics": "Analytics Dashboard",
  "/system-health": "System Health",
  "/commission-payouts": "Commission Payouts",
  "/kyc-verification": "KYC Verification",
  "/settlement-reconciliation": "Settlement Reconciliation",
  "/notification-inbox": "Notification Inbox",
  "/weekly-reports": "Weekly Reports",
  "/live-chat": "Live Chat Support",
};

// ─── Quick Actions ───────────────────────────────────────────────────────────
const quickActions = [
  { label: "Transaction failed", icon: "💳" },
  { label: "KYC verification help", icon: "📋" },
  { label: "Commission inquiry", icon: "💰" },
  { label: "Float balance issue", icon: "🏦" },
  { label: "How to process a transfer", icon: "📤" },
  { label: "Report suspicious activity", icon: "🚨" },
];

// ═══════════════════════════════════════════════════════════════════════════════
// LiveChatWidget Component
// ═══════════════════════════════════════════════════════════════════════════════
export function LiveChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [rating, setRating] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [location] = useLocation();

  // @ts-ignore
  const createSession = trpc.aiChat.createSession.useMutation();
  const sendMessage = trpc.aiChat.sendMessage.useMutation();
  // @ts-ignore
  const escalate = trpc.aiChat.escalate.useMutation();
  // @ts-ignore
  const closeSession = trpc.aiChat.closeSession.useMutation();

  // Get current page context
  const currentContext =
    pageContextMap[location] || location.replace("/", "").replace(/-/g, " ");

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Start session when widget opens
  const handleOpen = useCallback(async () => {
    setIsOpen(true);
    setIsMinimized(false);
    setUnreadCount(0);

    if (!sessionId) {
      try {
        const result = await createSession.mutateAsync({
          context: currentContext,
        });
        setSessionId(result.session.id);
        setMessages([result.welcomeMessage]);
      } catch {
        toast.error("Failed to start chat session");
      }
    }
  }, [sessionId, currentContext, createSession]);

  // Send message
  const handleSend = useCallback(
    async (content?: string) => {
      const text = content || input.trim();
      if (!text || !sessionId || isLoading) return;

      setInput("");
      setIsLoading(true);

      // Optimistic add user message
      const tempUserMsg: ChatMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: text,
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, tempUserMsg]);

      try {
        const result = await sendMessage.mutateAsync({
          // @ts-ignore
          sessionId,
          content: text,
          context: currentContext,
        });

        // @ts-ignore
        if (result.error) {
          // @ts-ignore
          toast.error(result.error);
          return;
        }

        // Replace temp message and add AI response
        setMessages(prev => {
          const filtered = prev.filter(m => m.id !== tempUserMsg.id);
          const updated = [...filtered];
          // @ts-ignore
          if (result.userMessage) updated.push(result.userMessage);
          // @ts-ignore
          if (result.aiMessage) updated.push(result.aiMessage);
          return updated;
        });

        // If widget is minimized, increment unread
        if (isMinimized) {
          setUnreadCount(prev => prev + 1);
        }
      } catch {
        toast.error("Failed to send message");
      } finally {
        setIsLoading(false);
      }
    },
    [input, sessionId, isLoading, currentContext, sendMessage, isMinimized]
  );

  // ─── ProactiveHelp Integration ──────────────────────────────────────────────
  // Listen for proactive-help-chat events dispatched by ProactiveHelp component
  useEffect(() => {
    const handleProactiveChat = async (e: Event) => {
      const detail = (e as CustomEvent).detail as {
        page: string;
        issue: string;
        suggestions: string[];
      };
      if (!detail) return;

      // Auto-open the chat widget
      setIsOpen(true);
      setIsMinimized(false);
      setUnreadCount(0);

      // Create session if needed
      if (!sessionId) {
        try {
          const result = await createSession.mutateAsync({
            context: `${currentContext} (Proactive Help)`,
          });
          setSessionId(result.session.id);
          setMessages([result.welcomeMessage]);

          // Auto-send the contextual message after a brief delay
          setTimeout(() => {
            const contextMsg =
              detail.issue || `I need help on the ${detail.page} page`;
            handleSend(contextMsg);
          }, 500);
        } catch {
          toast.error("Failed to start chat session");
        }
      } else {
        // Session exists, just send the contextual message
        const contextMsg =
          detail.issue || `I need help on the ${detail.page} page`;
        handleSend(contextMsg);
      }
    };

    window.addEventListener("proactive-help-chat", handleProactiveChat);
    return () =>
      window.removeEventListener("proactive-help-chat", handleProactiveChat);
  }, [sessionId, currentContext, createSession, handleSend]);

  // Escalate to human
  const handleEscalate = useCallback(async () => {
    if (!sessionId) return;
    try {
      const result = await escalate.mutateAsync({
        sessionId,
        reason: "User requested human agent",
      });
      if (result.message) {
        setMessages(prev => [...prev, result.message!]);
      }
      toast.info("Chat escalated to human support");
    } catch {
      toast.error("Failed to escalate");
    }
  }, [sessionId, escalate]);

  // Close session
  const handleClose = useCallback(async () => {
    if (sessionId && rating > 0) {
      await closeSession.mutateAsync({ sessionId, satisfaction: rating });
    }
    setSessionId(null);
    setMessages([]);
    setIsOpen(false);
    setShowRating(false);
    setRating(0);
  }, [sessionId, rating, closeSession]);

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ─── Closed State (Floating Button) ──────────────────────────────────────
  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:scale-105 transition-transform group"
        title="Chat with AI Support"
        data-chat-toggle="true"
      >
        <MessageCircle className="h-6 w-6 group-hover:scale-110 transition-transform" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount}
          </span>
        )}
      </button>
    );
  }

  // ─── Minimized State ─────────────────────────────────────────────────────
  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2">
        <button
          onClick={() => {
            setIsMinimized(false);
            setUnreadCount(0);
          }}
          className="h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center gap-2 px-4 hover:scale-105 transition-transform"
        >
          <MessageCircle className="h-5 w-5" />
          <span className="text-sm font-medium">Chat</span>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="h-5 text-[10px]">
              {unreadCount}
            </Badge>
          )}
        </button>
      </div>
    );
  }

  // ─── Rating Modal ────────────────────────────────────────────────────────
  if (showRating) {
    return (
      <div className="fixed bottom-6 right-6 z-50 w-[380px] rounded-2xl border border-border bg-background shadow-2xl overflow-hidden">
        <div className="p-6 text-center">
          <Sparkles className="h-10 w-10 text-amber-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold mb-2">
            How was your experience?
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            Rate your chat support experience
          </p>
          <div className="flex items-center justify-center gap-2 mb-6">
            {[1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                onClick={() => setRating(star)}
                className="transition-transform hover:scale-125"
              >
                <Star
                  className={cn(
                    "h-8 w-8",
                    star <= rating
                      ? "fill-amber-400 text-amber-400"
                      : "text-muted-foreground"
                  )}
                />
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => {
                setShowRating(false);
                handleClose();
              }}
            >
              Skip
            </Button>
            <Button
              className="flex-1"
              onClick={handleClose}
              disabled={rating === 0}
            >
              Submit & Close
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Open Chat Panel ─────────────────────────────────────────────────────
  return (
    <div className="fixed bottom-6 right-6 z-50 w-[380px] h-[560px] rounded-2xl border border-border bg-background shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-primary text-primary-foreground">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-primary-foreground/20 flex items-center justify-center">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <p className="text-sm font-semibold">InsurePortal AI Support</p>
            <p className="text-[10px] opacity-80">Always here to help</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsMinimized(true)}
            className="h-7 w-7 rounded-md hover:bg-primary-foreground/20 flex items-center justify-center"
            title="Minimize"
          >
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setShowRating(true)}
            className="h-7 w-7 rounded-md hover:bg-primary-foreground/20 flex items-center justify-center"
            title="Close chat"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center py-8">
            <Bot className="h-12 w-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Starting chat...</p>
          </div>
        ) : (
          <>
            {messages.map(msg => (
              <div
                key={msg.id}
                className={cn(
                  "flex gap-2",
                  msg.role === "user" ? "justify-end" : "justify-start"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                    <Bot className="h-3 w-3 text-primary" />
                  </div>
                )}
                <div
                  className={cn(
                    "max-w-[280px] rounded-2xl px-3.5 py-2.5 text-sm",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-muted text-foreground rounded-bl-md",
                    msg.metadata?.type === "escalation" &&
                      "border border-amber-500/30 bg-amber-500/5"
                  )}
                >
                  <p className="whitespace-pre-wrap break-words leading-relaxed">
                    {msg.content}
                  </p>
                  <p
                    className={cn(
                      "text-[10px] mt-1",
                      msg.role === "user"
                        ? "text-primary-foreground/60"
                        : "text-muted-foreground"
                    )}
                  >
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                {msg.role === "user" && (
                  <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center flex-shrink-0 mt-1">
                    <User className="h-3 w-3 text-primary-foreground" />
                  </div>
                )}
              </div>
            ))}

            {/* Loading indicator */}
            {isLoading && (
              <div className="flex gap-2 justify-start">
                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="h-3 w-3 text-primary" />
                </div>
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-1">
                    <span
                      className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                      style={{ animationDelay: "0ms" }}
                    />
                    <span
                      className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                      style={{ animationDelay: "150ms" }}
                    />
                    <span
                      className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-bounce"
                      style={{ animationDelay: "300ms" }}
                    />
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* Quick Actions (show only when few messages) */}
        {messages.length <= 2 && !isLoading && (
          <div className="pt-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
              Quick Actions
            </p>
            <div className="flex flex-wrap gap-1.5">
              {quickActions.map(action => (
                <button
                  key={action.label}
                  onClick={() => handleSend(action.label)}
                  className="text-xs bg-muted hover:bg-accent px-2.5 py-1.5 rounded-full transition-colors flex items-center gap-1"
                >
                  <span>{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Escalation bar */}
      <div className="flex items-center justify-between px-4 py-1.5 border-t border-border bg-muted/30">
        <span className="text-[10px] text-muted-foreground">
          {currentContext && `Context: ${currentContext}`}
        </span>
        <button
          onClick={handleEscalate}
          className="text-[10px] text-amber-500 hover:text-amber-400 flex items-center gap-1 transition-colors"
        >
          <ArrowUpRight className="h-3 w-3" />
          Escalate to human
        </button>
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border bg-background">
        <div className="flex items-end gap-2">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your message..."
            className="min-h-[40px] max-h-[100px] resize-none text-sm rounded-xl"
            rows={1}
            disabled={isLoading}
          />
          <Button
            size="icon"
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            className="h-10 w-10 rounded-xl flex-shrink-0"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default LiveChatWidget;
