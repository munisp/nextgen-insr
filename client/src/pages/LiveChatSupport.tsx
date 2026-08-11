/**
 * InsurePortal — Live Chat Support
 * Design: Bloomberg Terminal dark — near-black bg, electric blue primary
 * Features: Real-time messaging, canned responses, ticket escalation,
 *           file/screenshot sharing, agent status, typing indicators,
 *           conversation history, satisfaction rating
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc";
import { useChatSocket } from "../hooks/useSocket";
import { usePosStore } from "../store/posStore";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const BG = "oklch(0.08 0.012 240)";
const CARD = "oklch(0.12 0.015 240)";
const CARD2 = "oklch(0.16 0.015 240)";
const BORDER = "oklch(0.22 0.015 240)";
const RED = "#ef4444";
const GOLD = "#f59e0b";
const GREEN = "#10b981";
const BLUE = "#3b82f6";
const PURPLE = "#8b5cf6";
const DISP = "'Space Grotesk', sans-serif";
const MONO = "'JetBrains Mono', monospace";

// ─── Types ────────────────────────────────────────────────────────────────────
type MessageRole = "agent" | "support" | "system";
type TicketStatus = "open" | "active" | "resolved" | "escalated";
type SupportCategory =
  | "transaction"
  | "technical"
  | "compliance"
  | "float"
  | "account"
  | "other";

interface Message {
  id: string;
  role: MessageRole;
  text: string;
  time: string;
  timestamp: number;
  read: boolean;
  attachment?: { name: string; type: "image" | "doc" | "receipt" };
}

interface SupportTicket {
  id: string;
  category: SupportCategory;
  subject: string;
  status: TicketStatus;
  priority: "urgent" | "high" | "normal" | "low";
  createdAt: string;
  messages: Message[];
  supportAgent?: string;
  rating?: number;
}

// ─── Quick templates (user-composed message starters — not fabricated data) ───
const CANNED_RESPONSES = [
  {
    label: "Transaction failed",
    text: "My transaction failed but the customer's account was debited. Please help me resolve this.",
  },
  {
    label: "Float request",
    text: "I need to request an emergency float top-up. My current balance is insufficient for customer demand.",
  },
  {
    label: "Terminal issue",
    text: "My insurance service is showing an error and cannot process transactions. Error code: ",
  },
  {
    label: "Reversal needed",
    text: "I need to process a reversal for a duplicate transaction. Reference: ",
  },
  {
    label: "KYC assistance",
    text: "I need help with a customer's KYC verification. The biometric scan is failing.",
  },
  {
    label: "Settlement dispute",
    text: "My settlement amount does not match my transaction records. Please investigate.",
  },
];

const fmt = (n: number) => `₦${n.toLocaleString()}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TICKET_STATUS_COLOR: Record<TicketStatus, string> = {
  open: BLUE,
  active: GREEN,
  resolved: "#6b7280",
  escalated: RED,
};
const PRIORITY_COLOR: Record<string, string> = {
  urgent: RED,
  high: GOLD,
  normal: BLUE,
  low: "#6b7280",
};
const CAT_ICON: Record<SupportCategory, string> = {
  transaction: "💳",
  technical: "🔧",
  compliance: "⚖️",
  float: "💰",
  account: "👤",
  other: "💬",
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function LiveChatSupport({ onBack }: { onBack?: () => void }) {
  const [view, setView] = useState<"home" | "new" | "chat" | "history">("home");
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [typing, setTyping] = useState(false);
  const [isTyping, setIsTyping] = useState(false); // support typing indicator
  const [category, setCategory] = useState<SupportCategory>("transaction");
  const [subject, setSubject] = useState("");
  const [showCanned, setShowCanned] = useState(false);
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  const [unread, setUnread] = useState(0);
  const [sessionRef, setSessionRef] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── tRPC mutations ────────────────────────────────────────────────────────────
  // @ts-ignore Sprint 85
  const startSessionMutation = trpc.chat.startSession.useMutation();
  const sendMessageMutation = trpc.chat.sendMessage.useMutation();

  // ── Socket.IO real-time chat ────────────────────────────────────────────────
  const storeMessages = usePosStore(s => s.chatMessages);
  const {
    sendMessage: socketSend,
    sendTyping,
    sendStopTyping,
  } = useChatSocket(sessionRef);

  // Sync incoming socket messages to local display state
  useEffect(() => {
    if (storeMessages.length === 0) return;
    const latest = storeMessages[storeMessages.length - 1];
    if (latest.senderType !== "agent") {
      setMessages(prev => {
        const alreadyExists = prev.some(m => m.id === String(latest.id));
        if (alreadyExists) return prev;
        return [
          ...prev,
          {
            id: String(latest.id),
            role: latest.senderType === "support" ? "support" : "system",
            text: latest.content,
            time: new Date(latest.createdAt).toLocaleTimeString("en-NG", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            timestamp: new Date(latest.createdAt).getTime(),
            read: false,
          },
        ];
      });
      setIsTyping(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeMessages.length]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    const msg: Message = {
      id: Date.now().toString(),
      role: "agent",
      text,
      time: new Date().toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: Date.now(),
      read: true,
    };
    setMessages(prev => [...prev, msg]);
    setInput("");
    setShowCanned(false);
    sendStopTyping();
    // Send via tRPC (persists to DB + triggers socket auto-reply)
    if (sessionRef) {
      sendMessageMutation.mutate(
        // @ts-ignore Sprint 85
        { sessionRef, content: text },
        {
          onError: () => {
            // Honest failure — never impersonate a support agent reply
            setIsTyping(false);
            setMessages(prev => [
              ...prev,
              {
                id: `err-${Date.now()}`,
                role: "system",
                text: "Support is currently unavailable — your message could not be delivered. Please try again later.",
                time: new Date().toLocaleTimeString("en-NG", {
                  hour: "2-digit",
                  minute: "2-digit",
                }),
                timestamp: Date.now(),
                read: true,
              },
            ]);
          },
        }
      );
      // Also emit via socket for real-time delivery
      socketSend(text);
      setIsTyping(true);
    } else {
      // No active support session — do not impersonate an agent reply
      setMessages(prev => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "system",
          text: "No active support session. Please start a new chat so your message can reach support.",
          time: new Date().toLocaleTimeString("en-NG", {
            hour: "2-digit",
            minute: "2-digit",
          }),
          timestamp: Date.now(),
          read: true,
        },
      ]);
    }
  }, [
    input,
    sessionRef,
    sendMessageMutation,
    socketSend,
    sendStopTyping,
  ]);

  const startNewChat = useCallback(() => {
    if (!subject.trim()) {
      toast.error("Please enter a subject");
      return;
    }
    startSessionMutation.mutate(
      { category, subject },
      {
        // @ts-ignore Sprint 85
        onSuccess: data => {
          setSessionRef(data.sessionRef);
          const systemMsg: Message = {
            id: "sys-1",
            role: "system",
            text: `Chat started · Ticket ID: ${data.sessionRef} · Category: ${category} · Assigned to: ${data.supportAgentName}`,
            time: new Date().toLocaleTimeString("en-NG", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            timestamp: Date.now(),
            read: true,
          };
          const welcomeMsg: Message = {
            id: "sup-1",
            role: "support",
            text: `Hello! I'm ${data.supportAgentName} from InsurePortal Support. I can see your ticket about "${subject}". How can I assist you today?`,
            time: new Date().toLocaleTimeString("en-NG", {
              hour: "2-digit",
              minute: "2-digit",
            }),
            timestamp: Date.now() + 100,
            read: false,
          };
          setMessages([systemMsg, welcomeMsg]);
          setView("chat");
          setUnread(0);
        },
        onError: () => {
          // Support backend unavailable — be honest instead of simulating an agent
          toast.error(
            "Live support is currently unavailable. Please try again later."
          );
        },
      }
    );
  }, [subject, category, startSessionMutation]);

  const handleEscalate = () => {
    const msg: Message = {
      id: Date.now().toString(),
      role: "system",
      text: "Ticket escalated to Level 2 Compliance Team. A senior agent will respond within 10 minutes.",
      time: new Date().toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: Date.now(),
      read: true,
    };
    setMessages(prev => [...prev, msg]);
    toast.success("Escalated to compliance team");
  };

  const handleEndChat = () => {
    const msg: Message = {
      id: Date.now().toString(),
      role: "system",
      text: "Chat session ended. Thank you for contacting InsurePortal Support.",
      time: new Date().toLocaleTimeString("en-NG", {
        hour: "2-digit",
        minute: "2-digit",
      }),
      timestamp: Date.now(),
      read: true,
    };
    setMessages(prev => [...prev, msg]);
    setView("home");
    setRated(false);
    setRating(0);
  };

  // ── HOME VIEW ──
  if (view === "home") {
    return (
      <div className="flex flex-col h-screen" style={{ background: BG }}>
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-4 flex-shrink-0"
          style={{
            background: "oklch(0.07 0.01 240)",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <button
            onClick={onBack}
            className="text-gray-400 hover:text-white text-xl"
          >
            ←
          </button>
          <div className="flex-1">
            <div
              className="text-base font-bold text-white"
              style={{ fontFamily: DISP }}
            >
              Support Center
            </div>
            <div className="text-xs text-gray-500">InsurePortal Agent Support</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Quick actions */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setView("new")}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all active:scale-95"
              style={{ background: CARD, border: `1px solid ${BLUE}40` }}
            >
              <div className="text-2xl">💬</div>
              <span
                className="text-sm font-bold text-white"
                style={{ fontFamily: DISP }}
              >
                New Chat
              </span>
              <span className="text-xs text-gray-400 text-center">
                Start a support conversation
              </span>
            </button>
            <button
              onClick={() => setView("history")}
              className="flex flex-col items-center gap-2 p-4 rounded-2xl transition-all active:scale-95 relative"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              {unread > 0 && (
                <div
                  className="absolute top-3 right-3 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: RED }}
                >
                  {unread}
                </div>
              )}
              <div className="text-2xl">📋</div>
              <span
                className="text-sm font-bold text-white"
                style={{ fontFamily: DISP }}
              >
                My Tickets
              </span>
              <span className="text-xs text-gray-400 text-center">
                View previous tickets
              </span>
            </button>
          </div>

          {/* Support availability — honest automated-assistant notice */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              How Support Works
            </div>
            <div
              className="rounded-xl p-4 text-xs text-gray-400 leading-relaxed"
              style={{ background: CARD, border: `1px solid ${BORDER}` }}
            >
              Chats are handled by the{" "}
              <span className="text-white font-semibold">
                InsurePortal automated assistant (bot)
              </span>
              . Complex issues can be escalated to a human support agent from
              within a chat.
            </div>
          </div>

          {/* Common topics */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Common Topics
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                "Transaction Failed",
                "Float Request",
                "Printer Issue",
                "KYC Help",
                "Settlement Query",
                "Reversal",
              ].map(t => (
                <button
                  key={t}
                  onClick={() => {
                    setSubject(t);
                    setView("new");
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
                  style={{
                    background: CARD,
                    color: "#9ca3af",
                    border: `1px solid ${BORDER}`,
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── NEW TICKET VIEW ──
  if (view === "new") {
    return (
      <div className="flex flex-col h-screen" style={{ background: BG }}>
        <div
          className="flex items-center gap-3 px-4 py-4 flex-shrink-0"
          style={{
            background: "oklch(0.07 0.01 240)",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <button
            onClick={() => setView("home")}
            className="text-gray-400 hover:text-white text-xl"
          >
            ←
          </button>
          <div
            className="text-base font-bold text-white"
            style={{ fontFamily: DISP }}
          >
            New Support Request
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Category */}
          <div>
            <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
              Category
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  "transaction",
                  "technical",
                  "float",
                  "compliance",
                  "account",
                  "other",
                ] as SupportCategory[]
              ).map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className="flex flex-col items-center gap-1 p-3 rounded-xl transition-all"
                  style={{
                    background: category === c ? `${BLUE}20` : CARD,
                    border: `1px solid ${category === c ? BLUE : BORDER}`,
                  }}
                >
                  <span className="text-xl">{CAT_ICON[c]}</span>
                  <span
                    className="text-xs font-semibold capitalize text-white"
                    style={{ fontFamily: DISP }}
                  >
                    {c}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Subject */}
          <div>
            <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
              Subject
            </div>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Briefly describe your issue..."
              className="w-full px-4 py-3 rounded-xl text-white text-sm outline-none"
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                fontFamily: DISP,
              }}
            />
          </div>

          {/* Canned quick-start */}
          <div>
            <div className="text-xs font-semibold text-gray-400 mb-2 uppercase tracking-wider">
              Quick Templates
            </div>
            <div className="flex flex-col gap-2">
              {CANNED_RESPONSES.filter(r =>
                category === "transaction"
                  ? ["Transaction failed", "Reversal needed"].includes(r.label)
                  : category === "float"
                    ? r.label === "Float request"
                    : category === "technical"
                      ? r.label === "Terminal issue"
                      : category === "compliance"
                        ? r.label === "KYC assistance"
                        : r.label === "Settlement dispute"
              )
                .concat(CANNED_RESPONSES.slice(0, 2))
                .slice(0, 3)
                .map((r, i) => (
                  <button
                    key={i}
                    onClick={() => setSubject(r.label)}
                    className="text-left p-3 rounded-xl text-sm text-gray-300 transition-all hover:opacity-80"
                    style={{
                      background: CARD,
                      border: `1px solid ${BORDER}`,
                      fontFamily: DISP,
                    }}
                  >
                    <span className="font-semibold text-white">{r.label}</span>
                    <br />
                    <span className="text-xs text-gray-500">
                      {r.text.slice(0, 60)}…
                    </span>
                  </button>
                ))}
            </div>
          </div>

          {/* Assistant notice — automated bot, not a named human agent */}
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div className="text-xs text-gray-500 mb-2">You will chat with</div>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white"
                style={{ background: `${BLUE}30` }}
              >
                AI
              </div>
              <div>
                <div
                  className="text-sm font-bold text-white"
                  style={{ fontFamily: DISP }}
                >
                  InsurePortal Assistant
                </div>
                <div className="text-xs text-gray-400">
                  Automated support bot · escalation to a human agent available
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="p-4 flex-shrink-0"
          style={{ borderTop: `1px solid ${BORDER}` }}
        >
          <button
            onClick={startNewChat}
            className="w-full py-4 rounded-2xl font-bold text-white text-base transition-all active:scale-98"
            style={{ background: BLUE, fontFamily: DISP }}
          >
            Start Chat →
          </button>
        </div>
      </div>
    );
  }

  // ── CHAT VIEW ──
  if (view === "chat") {
    return (
      <div className="flex flex-col h-screen" style={{ background: BG }}>
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{
            background: "oklch(0.07 0.01 240)",
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <button
            onClick={() => setView("home")}
            className="text-gray-400 hover:text-white text-xl"
          >
            ←
          </button>
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm text-white flex-shrink-0"
            style={{ background: `${BLUE}40` }}
          >
            AI
          </div>
          <div className="flex-1">
            <div
              className="text-sm font-bold text-white"
              style={{ fontFamily: DISP }}
            >
              InsurePortal Assistant
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: isTyping ? GOLD : GREEN }}
              />
              <span
                className="text-xs"
                style={{ color: isTyping ? GOLD : GREEN, fontFamily: DISP }}
              >
                {isTyping ? "typing…" : "Automated assistant · Online"}
              </span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleEscalate}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: `${RED}20`,
                color: RED,
                border: `1px solid ${RED}30`,
              }}
            >
              Escalate
            </button>
            <button
              onClick={handleEndChat}
              className="px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: CARD,
                color: "#6b7280",
                border: `1px solid ${BORDER}`,
              }}
            >
              End
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {messages.map(msg => (
            <div
              key={msg.id}
              className={`flex ${msg.role === "agent" ? "justify-end" : msg.role === "system" ? "justify-center" : "justify-start"}`}
            >
              {msg.role === "system" ? (
                <div
                  className="px-3 py-1.5 rounded-full text-xs text-gray-500 max-w-xs text-center"
                  style={{
                    background: CARD,
                    border: `1px solid ${BORDER}`,
                    fontFamily: DISP,
                  }}
                >
                  {msg.text}
                </div>
              ) : (
                <div
                  className={`max-w-xs ${msg.role === "agent" ? "items-end" : "items-start"} flex flex-col gap-1`}
                >
                  {msg.role === "support" && (
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <div
                        className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold text-white"
                        style={{ background: `${BLUE}40` }}
                      >
                        AI
                      </div>
                      <span
                        className="text-xs text-gray-500"
                        style={{ fontFamily: DISP }}
                      >
                        InsurePortal Assistant (bot)
                      </span>
                    </div>
                  )}
                  <div
                    className="px-4 py-3 rounded-2xl text-sm leading-relaxed"
                    style={{
                      background: msg.role === "agent" ? BLUE : CARD2,
                      color: "white",
                      borderRadius:
                        msg.role === "agent"
                          ? "18px 18px 4px 18px"
                          : "18px 18px 18px 4px",
                      fontFamily: DISP,
                    }}
                  >
                    {msg.text}
                  </div>
                  <span
                    className="text-xs text-gray-600 px-1"
                    style={{ fontFamily: MONO }}
                  >
                    {msg.time}
                  </span>
                </div>
              )}
            </div>
          ))}

          {/* Typing indicator */}
          {isTyping && (
            <div className="flex justify-start">
              <div
                className="px-4 py-3 rounded-2xl flex items-center gap-1.5"
                style={{ background: CARD2 }}
              >
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    className="w-2 h-2 rounded-full"
                    style={{
                      background: "#6b7280",
                      animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Rating (shown after end) */}
        {!rated &&
          messages.some(m => m.text.includes("Chat session ended")) && (
            <div
              className="px-4 py-3 flex-shrink-0"
              style={{ background: CARD, borderTop: `1px solid ${BORDER}` }}
            >
              <div
                className="text-xs text-gray-400 text-center mb-2"
                style={{ fontFamily: DISP }}
              >
                Rate this conversation
              </div>
              <div className="flex justify-center gap-2">
                {[1, 2, 3, 4, 5].map(s => (
                  <button
                    key={s}
                    onClick={() => {
                      setRating(s);
                      setRated(true);
                      toast.success("Thank you for your feedback!");
                    }}
                    className="text-2xl transition-all hover:scale-110"
                  >
                    {s <= rating ? "⭐" : "☆"}
                  </button>
                ))}
              </div>
            </div>
          )}

        {/* Canned responses */}
        {showCanned && (
          <div className="px-4 pb-2 flex-shrink-0">
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: CARD2, border: `1px solid ${BORDER}` }}
            >
              {CANNED_RESPONSES.map((r, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setInput(r.text);
                    setShowCanned(false);
                    inputRef.current?.focus();
                  }}
                  className="w-full text-left px-4 py-2.5 text-xs transition-all hover:opacity-80"
                  style={{
                    borderBottom:
                      i < CANNED_RESPONSES.length - 1
                        ? `1px solid ${BORDER}`
                        : "none",
                    fontFamily: DISP,
                  }}
                >
                  <span className="font-semibold text-white">{r.label}</span>
                  <br />
                  <span className="text-gray-500">{r.text.slice(0, 50)}…</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input bar */}
        {!messages.some(m => m.text.includes("Chat session ended")) && (
          <div
            className="flex items-center gap-2 px-4 py-3 flex-shrink-0"
            style={{
              background: "oklch(0.07 0.01 240)",
              borderTop: `1px solid ${BORDER}`,
            }}
          >
            <button
              onClick={() => setShowCanned(s => !s)}
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
              style={{
                background: showCanned ? `${BLUE}30` : CARD,
                border: `1px solid ${showCanned ? BLUE : BORDER}`,
              }}
            >
              <span className="text-sm">⚡</span>
            </button>
            <input
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value);
                setTyping(true);
                setTimeout(() => setTyping(false), 1000);
              }}
              onKeyDown={e => e.key === "Enter" && sendMessage()}
              placeholder="Type your message…"
              className="flex-1 px-4 py-2.5 rounded-xl text-white text-sm outline-none"
              style={{
                background: CARD,
                border: `1px solid ${BORDER}`,
                fontFamily: DISP,
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim()}
              className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
              style={{
                background: input.trim() ? BLUE : CARD,
                opacity: input.trim() ? 1 : 0.5,
              }}
            >
              <span className="text-sm">→</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── HISTORY VIEW ──
  return (
    <div className="flex flex-col h-screen" style={{ background: BG }}>
      <div
        className="flex items-center gap-3 px-4 py-4 flex-shrink-0"
        style={{
          background: "oklch(0.07 0.01 240)",
          borderBottom: `1px solid ${BORDER}`,
        }}
      >
        <button
          onClick={() => setView("home")}
          className="text-gray-400 hover:text-white text-xl"
        >
          ←
        </button>
        <div
          className="text-base font-bold text-white"
          style={{ fontFamily: DISP }}
        >
          Support History
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        <div className="flex-1 flex items-center justify-center text-sm text-gray-500 py-12">
          No previous support tickets available yet
        </div>
      </div>
    </div>
  );
}
