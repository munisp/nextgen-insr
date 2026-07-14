// @ts-check
// TypeScript enabled — Sprint 96 security audit
import { Server as SocketIOServer } from "socket.io";
import type { Server as HttpServer } from "http";
import { jwtVerify } from "jose";
import { eq, desc, gte } from "drizzle-orm";
import {
  getAgentById,
  addChatMessage,
  getChatMessages,
  getChatSession,
  getDb,
} from "./db";
import { setIO } from "./socketSingleton";
import { initRealtimeNotifications } from "./lib/realtimeNotifications";
import { invokeLLM } from "./_core/llm";
import { fraudAlerts } from "../drizzle/schema";
import { getJwtSecret } from "./lib/envValidation";
import { logger } from "./_core/logger";

// ─── Support chat: LLM-powered auto-reply ────────────────────────────────────
async function generateSupportReply(
  agentMessage: string,
  sessionRef: string
): Promise<string> {
  try {
    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content:
            "You are a helpful InsurePortal insurance support agent. " +
            "Respond concisely (1-3 sentences) to agent queries about transactions, float, " +
            "disputes, and account issues. Be professional and empathetic. " +
            "If you cannot resolve the issue immediately, acknowledge it and provide a reference number.",
        },
        { role: "user", content: agentMessage },
      ],
    });
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content === "string" && content.trim()) return content.trim();
  } catch (err) {
    logger.error({ err: String(err) }, "[Chat] LLM auto-reply failed, using fallback");
  }
  // Fallback if LLM is unavailable
  const ref = `SUP-${Date.now().toString(36).toUpperCase()}`;
  return `Thank you for reaching out. Your request has been logged with reference ${ref}. Our team will respond within 15 minutes.`;
}

// ─── Fraud feed: last-seen cursor for polling ─────────────────────────────────
let lastFraudAlertId = 0;

async function pollNewFraudAlerts(): Promise<any[]> {
  try {
    const db = await getDb();
    if (!db) return [];
    const rows = await db
      .select()
      .from(fraudAlerts)
      .where(gte(fraudAlerts.id, lastFraudAlertId + 1))
      .orderBy(desc(fraudAlerts.id))
      .limit(20);
    if (rows.length > 0) {
      lastFraudAlertId = Math.max(...rows.map(r => r.id));
    }
    return rows;
  } catch {
    return [];
  }
}

export function initSocketIO(httpServer: HttpServer) {
  // SECURITY: Restrict Socket.IO CORS to known origins only.
  // In production, set ALLOWED_ORIGINS env var to comma-separated list.
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
    : ["https://insureportal.io", "https://app.insureportal.io", "https://admin.insureportal.io"];
  const isDev = process.env.NODE_ENV !== "production";

  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: isDev ? true : allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    path: "/api/socket.io",
  });

  // ── Fraud monitoring namespace ──────────────────────────────────────────────
  const fraudNs = io.of("/fraud");

  // Seed the cursor to current max ID so we only emit new alerts going forward
  getDb().then(async db => {
    if (!db) return;
    try {
      const rows = await db
        .select({ id: fraudAlerts.id })
        .from(fraudAlerts)
        .orderBy(desc(fraudAlerts.id))
        .limit(1);
      if (rows[0]) lastFraudAlertId = rows[0].id;
    } catch {
      /* ignore */
    }
  });

  // Poll the DB every 5 seconds and broadcast any new fraud_alerts rows
  setInterval(async () => {
    if (fraudNs.sockets.size === 0) return; // no admins connected, skip
    const newAlerts = await pollNewFraudAlerts();
    for (const alert of newAlerts) {
      fraudNs.emit("fraud:event", {
        id: `EVT-${alert.id}`,
        type: alert.type ?? "Fraud Alert",
        severity: alert.severity ?? "high",
        reason: alert.reason ?? "",
        amount: Number(alert.amount ?? 0),
        agentId: alert.agentId ?? "",
        customerName: alert.customerName ?? "Unknown",
        timestamp: alert.createdAt?.toISOString() ?? new Date().toISOString(),
        fraudScore: alert.riskScore ?? "75.0",
        status: alert.status ?? "open",
      });
    }
  }, 5000);

  fraudNs.on("connection", socket => {
    logger.info({ socketId: socket.id }, "[Fraud] Admin connected");

    socket.on(
      "alert:updateStatus",
      async (data: { alertId: number; status: string }) => {
        fraudNs.emit("alert:statusUpdated", data);
      }
    );

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "[Fraud] Admin disconnected");
    });
  });

  // ── Chat namespace ────────────────────────────────────────────────────────
  const chatNs = io.of("/chat");

  chatNs.use(async (socket, next) => {
    const cookie = socket.handshake.headers.cookie ?? "";
    const match = cookie.match(/agent_session=([^;]+)/);
    if (match) {
      try {
        const secret = new TextEncoder().encode(getJwtSecret());
        const { payload } = await jwtVerify(match[1], secret);
        (socket as any).agentId = Number(payload.sub);
        (socket as any).agentName = payload.name;
      } catch {
        // Allow unauthenticated for demo
      }
    }
    next();
  });

  chatNs.on("connection", socket => {
    const agentName = (socket as any).agentName ?? "Agent";
    logger.info({ socketId: socket.id, agentName }, "[Chat] Agent connected");

    socket.on("chat:join", (sessionRef: string) => {
      socket.join(`session:${sessionRef}`);
    });

    socket.on(
      "chat:message",
      async (data: { sessionRef: string; content: string }) => {
        try {
          const session = await getChatSession(data.sessionRef);
          if (!session) return;

          // Persist agent message
          const agentMsg = await addChatMessage(
            session.id,
            "agent",
            agentName,
            data.content
          );
          chatNs
            .to(`session:${data.sessionRef}`)
            .emit("chat:message", agentMsg);

          // Show support typing indicator
          setTimeout(() => {
            chatNs.to(`session:${data.sessionRef}`).emit("chat:typing", {
              senderType: "support",
              name: session.supportAgentName ?? "Support",
            });
          }, 400);

          // LLM-powered support auto-reply
          const reply = await generateSupportReply(
            data.content,
            data.sessionRef
          );
          const supportMsg = await addChatMessage(
            session.id,
            "support",
            session.supportAgentName ?? "Support Agent",
            reply
          );
          chatNs
            .to(`session:${data.sessionRef}`)
            .emit("chat:message", supportMsg);
          chatNs
            .to(`session:${data.sessionRef}`)
            .emit("chat:stopTyping", { senderType: "support" });
        } catch (err) {
          logger.error({ err: String(err) }, "[Chat] Error handling message");
        }
      }
    );

    socket.on("chat:typing", (data: { sessionRef: string }) => {
      socket.to(`session:${data.sessionRef}`).emit("chat:typing", {
        senderType: "agent",
        name: agentName,
      });
    });

    socket.on("chat:stopTyping", (data: { sessionRef: string }) => {
      socket
        .to(`session:${data.sessionRef}`)
        .emit("chat:stopTyping", { senderType: "agent" });
    });

    socket.on("disconnect", () => {
      logger.info({ agentName }, "[Chat] Agent disconnected");
    });
  });

  // ── Terminal status namespace ─────────────────────────────────────────────
  const terminalNs = io.of("/terminal");

  terminalNs.on("connection", socket => {
    socket.on("terminal:register", (agentId: string) => {
      if (agentId) {
        socket.join(`agent:${agentId}`);
        logger.info({ agentId, socketId: socket.id }, "[Terminal] Agent registered");
      }
    });

    // Heartbeat every 5 seconds
    const heartbeat = setInterval(() => {
      socket.emit("terminal:heartbeat", {
        timestamp: new Date().toISOString(),
        status: "connected",
        serverTime: Date.now(),
      });
    }, 5000);

    socket.on("disconnect", () => clearInterval(heartbeat));
  });

  // ── Settlement batch progress namespace ────────────────────────────────────
  const settlementNs = io.of("/settlement");

  settlementNs.on("connection", socket => {
    logger.info({ socketId: socket.id }, "[Settlement] Dashboard connected");

    // Client can subscribe to a specific batch
    socket.on("settlement:subscribe", (batchId: string) => {
      socket.join(`batch:${batchId}`);
      logger.info({ socketId: socket.id, batchId }, "[Settlement] Subscribed to batch");
    });

    socket.on("settlement:unsubscribe", (batchId: string) => {
      socket.leave(`batch:${batchId}`);
    });

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "[Settlement] Dashboard disconnected");
    });
  });

  // Initialize real-time notification system with pub/sub
  initRealtimeNotifications(io);

  // Register singleton so routers can emit events
  setIO(io);

  logger.info("[Socket.IO] Initialized — /fraud, /chat, /terminal, /settlement, /notifications namespaces ready");
  return io;
}
