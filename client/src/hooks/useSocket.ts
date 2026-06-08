import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { usePosStore, FraudEvent, ChatMessage } from "../store/posStore";
import { toast } from "sonner";

const SOCKET_URL = typeof window !== "undefined" ? window.location.origin : "";

// ─── Fraud feed: dual-channel (Socket.IO + SSE) ───────────────────────────────
//
// Socket.IO  → manual / admin-triggered alerts from the socket server
// SSE        → server-side fraud detection engine alerts (transactions.create)
//
// Both channels normalise into the same FraudEvent shape and push into posStore.

/** Normalise a raw SSE fraud alert payload into the FraudEvent store shape */
function normaliseSseFraudAlert(raw: Record<string, unknown>): FraudEvent {
  return {
    id: String(raw.id ?? Date.now()),
    type: String(raw.type ?? "unknown"),
    severity: (raw.severity as FraudEvent["severity"]) ?? "medium",
    reason: String(raw.reason ?? ""),
    amount: Number(raw.amount ?? 0),
    agentCode: String(raw.agentId ?? ""),
    customerName: raw.customerName ? String(raw.customerName) : "",
    timestamp: raw.createdAt
      ? new Date(raw.createdAt as string).toISOString()
      : new Date().toISOString(),
    fraudScore: String(raw.fraudScore ?? "0.00"),
  };
}

export function useFraudSocket() {
  const socketRef = useRef<Socket | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const addFraudEvent = usePosStore(s => s.addFraudEvent);

  /** Shared handler: add to store + show toast/push notification */
  const handleFraudEvent = (event: FraudEvent) => {
    addFraudEvent(event);
    if (event.severity === "critical" || event.severity === "high") {
      const title = `🚨 ${event.severity.toUpperCase()} Fraud Alert`;
      const body = `${event.type} — ${event.customerName || "Unknown"} — ₦${Number(event.amount).toLocaleString("en-NG")}`;
      if (document.visibilityState === "visible") {
        if (event.severity === "critical") {
          toast.error(`${title}: ${body}`, { duration: 8000 });
        } else {
          toast.warning(`${title}: ${body}`, { duration: 5000 });
        }
      } else if ("serviceWorker" in navigator) {
        navigator.serviceWorker.ready
          .then(reg => {
            reg.showNotification(title, {
              body,
              icon: "/favicon.ico",
              badge: "/favicon.ico",
              tag: `fraud-${event.id}`,
              requireInteraction: event.severity === "critical",
              data: { url: "/admin", severity: event.severity },
            });
          })
          .catch(() => {});
      }
    }
  };

  useEffect(() => {
    // ── Channel 1: Socket.IO (manual / admin-triggered alerts) ───────────────
    const socket = io(`${SOCKET_URL}/fraud`, {
      path: "/api/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    socket.on("connect", () =>
      console.log("[Fraud Socket] Connected:", socket.id)
    );
    socket.on("fraud:event", handleFraudEvent);
    socket.on("disconnect", () => console.log("[Fraud Socket] Disconnected"));

    // ── Channel 2: SSE (server-side fraud detection engine) ───────────────────
    const sse = new EventSource("/api/fraud/alerts/stream", {
      withCredentials: true,
    });
    sseRef.current = sse;
    sse.onmessage = e => {
      try {
        const raw = JSON.parse(e.data) as Record<string, unknown>;
        handleFraudEvent(normaliseSseFraudAlert(raw));
      } catch {
        // Malformed SSE frame — ignore silently
      }
    };
    sse.onerror = () => {
      // Browser auto-reconnects on error after a short delay
      console.warn(
        "[Fraud SSE] Connection error — browser will auto-reconnect"
      );
    };

    return () => {
      socket.disconnect();
      sse.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addFraudEvent]);

  return socketRef;
}

// ─── Chat socket ──────────────────────────────────────────────────────────────
export function useChatSocket(sessionRef: string | null) {
  const socketRef = useRef<Socket | null>(null);
  const addChatMessage = usePosStore(s => s.addChatMessage);

  useEffect(() => {
    if (!sessionRef) return;

    const socket = io(`${SOCKET_URL}/chat`, {
      path: "/api/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      socket.emit("chat:join", sessionRef);
    });

    socket.on("chat:message", (msg: ChatMessage) => {
      addChatMessage(msg);
    });

    return () => {
      socket.disconnect();
    };
  }, [sessionRef, addChatMessage]);

  const sendMessage = (content: string) => {
    socketRef.current?.emit("chat:message", { sessionRef, content });
  };

  const sendTyping = () => {
    socketRef.current?.emit("chat:typing", { sessionRef });
  };

  const sendStopTyping = () => {
    socketRef.current?.emit("chat:stopTyping", { sessionRef });
  };

  return { sendMessage, sendTyping, sendStopTyping };
}

// ─── Terminal heartbeat socket ────────────────────────────────────────────────
export function useTerminalSocket(agentCode?: string) {
  const setOnline = usePosStore(s => s.setOnline);
  const addFraudEvent = usePosStore(s => s.addFraudEvent);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(`${SOCKET_URL}/terminal`, {
      path: "/api/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      setOnline(true);
      // Register agent room so server can target fraud alerts to this terminal
      if (agentCode) {
        socket.emit("terminal:register", agentCode);
      }
    });

    socket.on("disconnect", () => setOnline(false));
    socket.on("terminal:heartbeat", () => setOnline(true));

    // ── Real-time fraud alert notifications to the cashier ────────────────────
    socket.on(
      "terminal:fraud_alert",
      (alert: {
        severity: string;
        type: string;
        reason: string;
        amount: number;
        timestamp: string;
      }) => {
        // Add to fraud feed in store so the admin panel also sees it
        addFraudEvent({
          id: `ALERT-${Date.now()}`,
          type: alert.type.replace(/_/g, " "),
          severity: alert.severity.toLowerCase() as
            | "high"
            | "medium"
            | "low"
            | "critical",
          reason: alert.reason,
          amount: alert.amount,
          agentCode: agentCode ?? "",
          customerName: "",
          timestamp: alert.timestamp,
          fraudScore: "0.90",
        });
        // Show a prominent error toast to the cashier
        const label =
          alert.type === "VELOCITY_BREACH"
            ? "⚠️ Transaction Blocked — Velocity Limit Exceeded"
            : "🚨 Transaction Blocked — Device Not Enrolled";
        toast.error(`${label}\n${alert.reason}`, { duration: 10000 });
      }
    );

    // ── Velocity threshold warnings (80% of hourly/daily limit) ─────────────────
    socket.on(
      "terminal:velocity_warning",
      (data: {
        type: "hourly_count" | "daily_volume";
        used: number;
        limit: number;
        pct: number;
        tier: string;
        timestamp: string;
      }) => {
        // Dispatch DOM event so InsurancePortal can show an amber banner
        window.dispatchEvent(
          new CustomEvent("terminal:velocity_warning", { detail: data })
        );
        const label =
          data.type === "hourly_count"
            ? `⚠️ Hourly Limit Warning — ${data.pct}% used (${data.used}/${data.limit} transactions)`
            : `⚠️ Daily Volume Warning — ${data.pct}% used (₦${Number(data.used).toLocaleString("en-NG")} of ₦${Number(data.limit).toLocaleString("en-NG")})`;
        toast.warning(label, {
          duration: 8000,
          id: `velocity-warning-${data.type}`,
        });
      }
    );

    // ── Remote kill-switch events (from admin) ─────────────────────────────────
    socket.on(
      "terminal:kill-switch",
      (data: { reason: string; disabledBy: string; disabledAt: string }) => {
        // Persist in localStorage so the overlay survives a page reload
        localStorage.setItem("insurance_service_disabled", JSON.stringify(data));
        // Dispatch custom DOM event so InsurancePortal reacts immediately
        window.dispatchEvent(
          new CustomEvent("terminal:kill-switch", { detail: data })
        );
        toast.error(`🔴 Terminal Disabled: ${data.reason}`, {
          duration: 0,
          id: "kill-switch",
        });
      }
    );
    socket.on(
      "terminal:kill-switch-lift",
      (data: { enabledBy: string; enabledAt: string }) => {
        localStorage.removeItem("insurance_service_disabled");
        window.dispatchEvent(
          new CustomEvent("terminal:kill-switch-lift", { detail: data })
        );
        toast.dismiss("kill-switch");
        toast.success("✅ Terminal re-enabled by admin.", { duration: 5000 });
      }
    );

    // Browser online/offline events
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      socket.disconnect();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [setOnline, addFraudEvent, agentCode]);

  return socketRef;
}

// ─── Settlement batch progress socket ────────────────────────────────────────

export interface BatchProgressEvent {
  batchId: string;
  type: "batch.progress" | "batch.started" | "batch.completed" | "batch.failed";
  processed: number;
  total: number;
  percentage: number;
  rate: number;
  estimatedSecondsRemaining: number;
  errors: number;
  startedAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export function useSettlementProgressSocket(
  onProgress?: (event: BatchProgressEvent) => void
) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(`${SOCKET_URL}/settlement`, {
      path: "/api/socket.io",
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[Settlement Socket] Connected:", socket.id);
    });

    // Listen for all batch progress events
    socket.on("settlement:progress:all", (event: BatchProgressEvent) => {
      onProgress?.(event);
    });

    // Also listen for targeted progress
    socket.on("settlement:progress", (event: BatchProgressEvent) => {
      onProgress?.(event);
    });

    socket.on("disconnect", () => {
      console.log("[Settlement Socket] Disconnected");
    });

    return () => {
      socket.disconnect();
    };
  }, [onProgress]);

  const subscribeToBatch = (batchId: string) => {
    socketRef.current?.emit("settlement:subscribe", batchId);
  };

  const unsubscribeFromBatch = (batchId: string) => {
    socketRef.current?.emit("settlement:unsubscribe", batchId);
  };

  return { subscribeToBatch, unsubscribeFromBatch, socket: socketRef };
}
