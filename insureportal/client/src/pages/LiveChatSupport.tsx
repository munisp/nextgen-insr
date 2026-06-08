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

interface SupportAgent {
  name: string;
  avatar: string;
  status: "online" | "busy" | "away";
  speciality: string;
  responseTime: string;
}

// ─── Mock Data ────────────────────────────────────────────────────────────────
const SUPPORT_AGENTS: SupportAgent[] = [
  {
    name: "Kemi Adeyemi",
    avatar: "KA",
    status: "online",
    speciality: "Transactions & Float",
    responseTime: "< 2 min",
  },
  {
    name: "Chukwu Obi",
    avatar: "CO",
    status: "online",
    speciality: "Technical Support",
    responseTime: "< 3 min",
  },
  {
    name: "Fatima Musa",
    avatar: "FM",
    status: "busy",
    speciality: "Compliance & KYC",
    responseTime: "< 5 min",
  },
  {
    name: "Tunde Afolabi",
    avatar: "TA",
    status: "online",
    speciality: "Account Management",
    responseTime: "< 2 min",
  },
];

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

const BOT_RESPONSES: Record<string, string[]> = {
  transaction: [
    "I can see your concern about the transaction. Let me pull up the details from our system.",
    "I've located the transaction in our records. Can you confirm the customer's phone number for verification?",
    "I'm escalating this to our transaction team. You'll receive a resolution within 15 minutes.",
  ],
  technical: [
    "I understand you're having a technical issue. Let me run a remote diagnostic on your terminal.",
    "The diagnostic shows your terminal firmware is up to date. Please try restarting the terminal.",
    "I'm connecting you with our Level 2 technical team for further assistance.",
  ],
  float: [
    "I can see your current float balance. Let me check your eligibility for an emergency top-up.",
    "You're eligible for an emergency float of up to ₦200,000 based on your transaction history.",
    "The float top-up has been approved and will reflect in your balance within 2 minutes.",
  ],
  compliance: [
    "I understand your compliance concern. Let me review the flagged transaction details.",
    "I've reviewed the case and I'm connecting you with our compliance officer.",
    "The compliance team has been notified. Please do not process further transactions with this customer until cleared.",
  ],
  default: [
    "Thank you for reaching out to InsurePortal support. I'm reviewing your request now.",
    "I understand your concern. Let me check our system for more details.",
    "I'm looking into this for you. This should only take a moment.",
    "I've found the relevant information. Here's what I can tell you...",
  ],
};

const HISTORY_TICKETS: SupportTicket[] = [
  {
    id: "TKT-2024-0891",
    category: "transaction",
    subject: "Failed Cash-Out — Customer Debited",
    status: "resolved",
    priority: "urgent",
    createdAt: "Yesterday 14:32",
    rating: 5,
    supportAgent: "Kemi Adeyemi",
    messages: [
      {
        id: "1",
        role: "agent",
        text: "My customer's account was debited ₦50,000 but cash was not dispensed.",
        time: "14:32",
        timestamp: 0,
        read: true,
      },
      {
        id: "2",
        role: "support",
        text: "I can see the transaction. Processing reversal now — will complete in 3 minutes.",
        time: "14:34",
        timestamp: 0,
        read: true,
      },
      {
        id: "3",
        role: "system",
        text: "Reversal processed. ₦50,000 returned to customer account.",
        time: "14:37",
        timestamp: 0,
        read: true,
      },
    ],
  },
  {
    id: "TKT-2024-0876",
    category: "technical",
    subject: "Printer Paper Jam — Cannot Print Receipts",
    status: "resolved",
    priority: "normal",
    createdAt: "3 days ago",
    rating: 4,
    supportAgent: "Chukwu Obi",
    messages: [
      {
        id: "1",
        role: "agent",
        text: "My printer is jammed and I cannot print receipts for customers.",
        time: "10:15",
        timestamp: 0,
        read: true,
      },
      {
        id: "2",
        role: "support",
        text: "Please follow these steps: 1. Open the printer cover 2. Remove paper 3. Clean roller 4. Reload paper.",
        time: "10:17",
        timestamp: 0,
        read: true,
      },
    ],
  },
];

const fmt = (n: number) => `₦${n.toLocaleString()}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<SupportAgent["status"], string> = {
  online: GREEN,
  busy: GOLD,
  away: "#6b7280",
};
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
  const [unread, setUnread] = useState(2);
  const [queuePos] = useState(Math.floor(Math.random() * 3) + 1);
  const [sessionRef, setSessionRef] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const assignedAgent = SUPPORT_AGENTS[0];

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

  // Simulate support agent typing + response
  const simulateResponse = useCallback((category: SupportCategory) => {
    setIsTyping(true);
    const delay = 1500 + Math.random() * 2000;
    setTimeout(() => {
      setIsTyping(false);
      const pool = BOT_RESPONSES[category] || BOT_RESPONSES.default;
      const text = pool[Math.floor(Math.random() * pool.length)];
      const msg: Message = {
        id: Date.now().toString(),
        role: "support",
        text,
        time: new Date().toLocaleTimeString("en-NG", {
          hour: "2-digit",
          minute: "2-digit",
        }),
        timestamp: Date.now(),
        read: false,
      };
      setMessages(prev => [...prev, msg]);
    }, delay);
  }, []);

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
            // Fallback to local simulation if API unavailable
            simulateResponse(category);
          },
        }
      );
      // Also emit via socket for real-time delivery
      socketSend(text);
      setIsTyping(true);
    } else {
      simulateResponse(category);
    }
  }, [
    input,
    category,
    simulateResponse,
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
    // Try tRPC first, fall back to local simulation
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
          // Fallback: local simulation
          const systemMsg: Message = {
            id: "sys-1",
            role: "system",
            text: `Chat started · Ticket ID: TKT-${Date.now().toString().slice(-6)} · Category: ${category} · Assigned to: ${assignedAgent.name}`,
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
            text: `Hello! I'm ${assignedAgent.name} from InsurePortal Support. I can see your ticket about "${subject}". How can I assist you today?`,
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
      }
    );
  }, [subject, category, assignedAgent, startSessionMutation]);

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
          <div className="flex items-center gap-1.5">
            <div
              className="w-2 h-2 rounded-full"
              style={{ background: GREEN }}
            />
            <span className="text-xs text-gray-400">
              {SUPPORT_AGENTS.filter(a => a.status === "online").length} agents
              online
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {/* Queue status */}
          <div
            className="rounded-2xl p-4"
            style={{ background: `${BLUE}10`, border: `1px solid ${BLUE}30` }}
          >
            <div className="flex items-center justify-between mb-2">
              <span
                className="text-sm font-bold text-white"
                style={{ fontFamily: DISP }}
              >
                Current Wait Time
              </span>
              <span
                className="text-xs font-bold"
                style={{ color: GREEN, fontFamily: MONO }}
              >
                ~{queuePos * 2} min
              </span>
            </div>
            <div className="text-xs text-gray-400">
              Queue position: #{queuePos} ·{" "}
              {SUPPORT_AGENTS.filter(a => a.status === "online").length} agents
              available
            </div>
          </div>

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
                {HISTORY_TICKETS.length} previous tickets
              </span>
            </button>
          </div>

          {/* Available agents */}
          <div>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Available Support Agents
            </div>
            <div className="flex flex-col gap-2">
              {SUPPORT_AGENTS.map((agent, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 p-3 rounded-xl"
                  style={{ background: CARD, border: `1px solid ${BORDER}` }}
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
                    style={{ background: `${BLUE}30` }}
                  >
                    {agent.avatar}
                  </div>
                  <div className="flex-1">
                    <div
                      className="text-sm font-bold text-white"
                      style={{ fontFamily: DISP }}
                    >
                      {agent.name}
                    </div>
                    <div className="text-xs text-gray-400">
                      {agent.speciality}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1 justify-end mb-0.5">
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: STATUS_COLOR[agent.status] }}
                      />
                      <span
                        className="text-xs capitalize"
                        style={{ color: STATUS_COLOR[agent.status] }}
                      >
                        {agent.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {agent.responseTime}
                    </div>
                  </div>
                </div>
              ))}
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

          {/* Assigned agent preview */}
          <div
            className="rounded-2xl p-4"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div className="text-xs text-gray-500 mb-2">
              Will be assigned to
            </div>
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white"
                style={{ background: `${BLUE}30` }}
              >
                {assignedAgent.avatar}
              </div>
              <div>
                <div
                  className="text-sm font-bold text-white"
                  style={{ fontFamily: DISP }}
                >
                  {assignedAgent.name}
                </div>
                <div className="text-xs text-gray-400">
                  {assignedAgent.speciality} · {assignedAgent.responseTime}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: GREEN }}
                />
                <span className="text-xs" style={{ color: GREEN }}>
                  Online
                </span>
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
            {assignedAgent.avatar}
          </div>
          <div className="flex-1">
            <div
              className="text-sm font-bold text-white"
              style={{ fontFamily: DISP }}
            >
              {assignedAgent.name}
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
                {isTyping ? "typing…" : "Online · Support Agent"}
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
                        {assignedAgent.avatar}
                      </div>
                      <span
                        className="text-xs text-gray-500"
                        style={{ fontFamily: DISP }}
                      >
                        {assignedAgent.name}
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
        {HISTORY_TICKETS.map(ticket => (
          <button
            key={ticket.id}
            onClick={() => {
              setActiveTicket(ticket);
              setMessages(ticket.messages);
              setView("chat");
            }}
            className="w-full text-left p-4 rounded-2xl transition-all hover:opacity-80"
            style={{ background: CARD, border: `1px solid ${BORDER}` }}
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-base">{CAT_ICON[ticket.category]}</span>
                  <span
                    className="text-sm font-bold text-white"
                    style={{ fontFamily: DISP }}
                  >
                    {ticket.subject}
                  </span>
                </div>
                <div
                  className="text-xs text-gray-500"
                  style={{ fontFamily: MONO }}
                >
                  {ticket.id}
                </div>
              </div>
              <span
                className="text-xs px-2 py-0.5 rounded-full font-semibold capitalize flex-shrink-0"
                style={{
                  background: `${TICKET_STATUS_COLOR[ticket.status]}20`,
                  color: TICKET_STATUS_COLOR[ticket.status],
                }}
              >
                {ticket.status}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500">
                  {ticket.createdAt}
                </span>
                {ticket.supportAgent && (
                  <span className="text-xs text-gray-600">
                    · {ticket.supportAgent}
                  </span>
                )}
              </div>
              {ticket.rating && (
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <span key={i} className="text-xs">
                      {i < ticket.rating! ? "⭐" : "☆"}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
