// @ts-check
// TypeScript enabled — Sprint 96 security audit
import type { Server as HttpServer } from "http";

import { eq, desc, gte } from "drizzle-orm";
import { jwtVerify } from "jose";
import { Server as SocketIOServer } from "socket.io";

import { invokeLLM } from "./_core/llm";
import { logger } from "./_core/logger";
import {
  getAgentById,
  addChatMessage,
  getChatMessages,
  getChatSession,
  getDb,
} from "./db";
import { getJwtSecret } from "./lib/envValidation";
import { initRealtimeNotifications } from "./lib/realtimeNotifications";
import {
  isTokenBlacklisted,
  isUserTokenRevoked,
} from "./lib/redisClient";
import {
  agentSessionRevocationKey,
  hashSessionToken,
  socketRevocationFailClosed,
} from "./middleware/agentAuth";
import { setIO } from "./socketSingleton";
import { fraudAlerts } from "../drizzle/schema";

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

// ─── Shared socket auth (AUTH-1..4, fail-CLOSED) ────────────────────────────
// Every namespace that carries PII or financial events authenticates the
// agent_session cookie with the same JWT + revocation enforcement as HTTP
// agent requests. There is NO unauthenticated mode; the only bypass is the
// explicit, non-production demo flag that defaults OFF (F6-8 pattern).
async function authenticateAgentSocket(
  socket: Parameters<Parameters<ReturnType<SocketIOServer["of"]>["use"]>[0]>[0],
  next: (err?: Error) => void,
  namespace: string
): Promise<void> {
  const cookie = socket.handshake.headers.cookie ?? "";
  const match = cookie.match(/agent_session=([^;]+)/);
  if (match) {
    try {
      const secret = new TextEncoder().encode(getJwtSecret());
      const { payload } = await jwtVerify(match[1], secret);
      const failClosed = socketRevocationFailClosed();
      const blacklisted = await isTokenBlacklisted(
        hashSessionToken(match[1]),
        failClosed
      );
      const revoked =
        payload.sub && typeof payload.iat === "number"
          ? await isUserTokenRevoked(
              agentSessionRevocationKey(Number(payload.sub)),
              payload.iat,
              failClosed
            )
          : false;
      if (!blacklisted && !revoked) {
        // G3 (audit #14): a still-unexpired JWT must not keep a SUSPENDED
        // agent's socket alive. Re-check isActive from the DB at connection
        // time (same enforcement leg as requireAgent on HTTP). Fail-closed:
        // if the agent row cannot be loaded, the connection is denied.
        const agentPk = Number(payload.sub);
        const agent = await getAgentById(agentPk);
        if (agent && agent.isActive && !agent.deletedAt) {
          // Identity comes ONLY from the verified token — never from client
          // input on individual events (AUTH-2/4).
          socket.data.agentId = agentPk;
          socket.data.agentName = payload.name;
          return next();
        }
      }
    } catch {
      // fall through to deny
    }
  }
  if (
    process.env.CHAT_ALLOW_UNAUTHENTICATED_DEMO === "true" &&
    process.env.NODE_ENV !== "production"
  ) {
    logger.warn(
      { socketId: socket.id, namespace },
      "[Socket] UNAUTHENTICATED demo connection accepted (CHAT_ALLOW_UNAUTHENTICATED_DEMO=true, non-production)"
    );
    return next();
  }
  return next(new Error("Authentication required"));
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

  // AUTH-1: live fraud alerts carry PII and alert:updateStatus mutates state —
  // the namespace is authenticated fail-closed like /chat.
  fraudNs.use((socket, next) => authenticateAgentSocket(socket, next, "/fraud"));

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
        // AUTH-1: only an authenticated agent (see namespace middleware) can
        // broadcast status updates; tag the event with the acting identity
        // and validate the status transition target.
        const ALLOWED = new Set(["open", "investigating", "resolved", "dismissed"]);
        if (!data || typeof data.alertId !== "number" || !ALLOWED.has(data.status)) {
          return;
        }
        fraudNs.emit("alert:statusUpdated", {
          ...data,
          updatedBy: socket.data.agentId ?? null,
        });
      }
    );

    socket.on("disconnect", () => {
      logger.info({ socketId: socket.id }, "[Fraud] Admin disconnected");
    });
  });

  // ── Chat namespace ────────────────────────────────────────────────────────
  const chatNs = io.of("/chat");

  chatNs.use((socket, next) => authenticateAgentSocket(socket, next, "/chat"));

  /**
   * AUTH-4: per-room ownership. A socket may only join/post to a chat session
   * it owns (session.agentId === verified token sub). Demo-mode sockets (no
   * authenticated agentId) may not join any room.
   */
  async function ownsChatSession(
    socket: { data: Record<string, unknown> },
    sessionRef: string
  ): Promise<boolean> {
    const agentId = socket.data.agentId as number | undefined;
    if (typeof agentId !== "number" || !sessionRef) return false;
    try {
      const session = await getChatSession(sessionRef);
      return !!session && session.agentId === agentId;
    } catch {
      return false; // fail-closed
    }
  }

  chatNs.on("connection", socket => {
    const agentName = (socket.data.agentName as string | undefined) ?? "Agent";
    logger.info({ socketId: socket.id, agentName }, "[Chat] Agent connected");

    socket.on("chat:join", async (sessionRef: string) => {
      // AUTH-4: ownership-verified join — arbitrary sessionRef is rejected.
      if (await ownsChatSession(socket, sessionRef)) {
        socket.join(`session:${sessionRef}`);
      } else {
        logger.warn(
          { socketId: socket.id, agentId: socket.data.agentId, sessionRef },
          "[Chat] Denied join to session not owned by this agent"
        );
      }
    });

    socket.on(
      "chat:message",
      async (data: { sessionRef: string; content: string }) => {
        try {
          // AUTH-4: verify the socket's token identity owns this session.
          if (!(await ownsChatSession(socket, data?.sessionRef))) {
            logger.warn(
              { socketId: socket.id, agentId: socket.data.agentId, sessionRef: data?.sessionRef },
              "[Chat] Denied message to session not owned by this agent"
            );
            return;
          }
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

  // AUTH-2: terminal channel pushes per-agent transaction/status events —
  // authenticated fail-closed like /chat.
  terminalNs.use((socket, next) => authenticateAgentSocket(socket, next, "/terminal"));

  terminalNs.on("connection", socket => {
    socket.on("terminal:register", (_agentId: string) => {
      // AUTH-2: the room is derived from the VERIFIED token identity, never
      // from the client-supplied agentId (cross-agent room escape).
      const agentId = socket.data.agentId as number | undefined;
      if (typeof agentId === "number") {
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

  // AUTH-3: settlement batches carry payout data — authenticated fail-closed.
  settlementNs.use((socket, next) => authenticateAgentSocket(socket, next, "/settlement"));

  settlementNs.on("connection", socket => {
    logger.info({ socketId: socket.id }, "[Settlement] Dashboard connected");

    // Client can subscribe to a specific batch (authenticated agents only;
    // identity comes from the verified token — AUTH-3)
    socket.on("settlement:subscribe", (batchId: string) => {
      if (typeof batchId !== "string" || !batchId || socket.data.agentId == null) return;
      socket.join(`batch:${batchId}`);
      logger.info({ socketId: socket.id, batchId, agentId: socket.data.agentId }, "[Settlement] Subscribed to batch");
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
