// TypeScript enabled — Sprint 96 security audit
/**
 * Real-Time Notification System — InsurePortal Insurance Platform
 *
 * Uses Socket.IO /notifications namespace with Redis pub/sub for
 * cross-process event distribution. Supports JWT authentication,
 * heartbeat, auto-reconnect guidance, and typed event channels.
 */
import type { Server as SocketIOServer, Socket } from "socket.io";
import { jwtVerify } from "jose";
import { getJwtSecret } from "./envValidation";
import { logger } from '../_core/logger';

// ═══════════════════════════════════════════════════════════════════════════════
// Event Types
// ═══════════════════════════════════════════════════════════════════════════════
export type NotificationChannel =
  | "transaction"
  | "fraud"
  | "rate_alert"
  | "kyc"
  | "settlement"
  | "system"
  | "commission"
  | "compliance";

export interface RealtimeNotification {
  id: string;
  channel: NotificationChannel;
  title: string;
  body: string;
  severity: "info" | "warning" | "critical";
  timestamp: string;
  metadata?: Record<string, unknown>;
  actionUrl?: string;
  userId?: string;
}

export interface ConnectionStatus {
  connected: boolean;
  connectedAt: string | null;
  lastHeartbeat: string | null;
  reconnectAttempts: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Redis Pub/Sub Simulation (in-memory for environments without Redis)
// ═══════════════════════════════════════════════════════════════════════════════
type Subscriber = (channel: string, message: string) => void;

class InMemoryPubSub {
  private subscribers: Map<string, Set<Subscriber>> = new Map();

  subscribe(channel: string, callback: Subscriber): void {
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, new Set());
    }
    this.subscribers.get(channel)!.add(callback);
  }

  unsubscribe(channel: string, callback: Subscriber): void {
    this.subscribers.get(channel)?.delete(callback);
  }

  publish(channel: string, message: string): number {
    const subs = this.subscribers.get(channel);
    if (!subs) return 0;
    for (const cb of Array.from(subs)) {
      try {
        cb(channel, message);
      } catch (e) {
        logger.error("[PubSub] Subscriber error:: " + e);
      }
    }
    return subs.size;
  }
}

// Try to use Redis if available, fallback to in-memory
let pubSubInstance: InMemoryPubSub | null = null;
let redisPublisher: any = null;
let redisSubscriber: any = null;

// 2026-11-26 (W21): init retry state. Previously initRedisPubSub ran ONCE at
// module load (fire-and-forget), so a boot-time Redis blip pinned the process
// to in-memory pub/sub forever and notifications silently stopped propagating
// across instances. Now a failed init cleans up and a later publish re-arms
// init at most once per RETRY_INTERVAL_MS. Retries are non-blocking:
// publishNotification never waits on init, it uses the in-memory fallback.
const INIT_RETRY_INTERVAL_MS = 30_000;
let initInFlight: Promise<boolean> | null = null;
let nextInitAttemptAt = 0;

async function initRedisPubSub(): Promise<boolean> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return false;

  // 2026-11-26 (W21): connect LOCAL clients first and assign the module
  // singletons only AFTER both connects succeed (the W19 pattern from
  // server/redisClient.ts). Previously the singletons were assigned BEFORE
  // `await connect()`, so a failed connect left half-open non-null clients
  // behind and a retry could never happen cleanly.
  let publisher: any = null;
  let subscriber: any = null;
  try {
    const { createClient } = await import("redis" as string);
    publisher = createClient({ url: redisUrl });
    subscriber = createClient({ url: redisUrl });
    // 2026-11-26 (W21): 'error' listeners are load-bearing — node-redis emits
    // 'error' on socket failures and an unhandled 'error' EventEmitter event
    // THROWS, which can crash the process. Log only: publishes/subscriptions
    // degrade to the in-memory pub/sub via the isReady gates below.
    publisher.on("error", (err: Error) => {
      logger.error("[RealtimeNotifications] Redis publisher error:: " + err.message);
    });
    subscriber.on("error", (err: Error) => {
      logger.error("[RealtimeNotifications] Redis subscriber error:: " + err.message);
    });
    await publisher.connect();
    await subscriber.connect();
    redisPublisher = publisher;
    redisSubscriber = subscriber;
    logger.info("[RealtimeNotifications] Redis pub/sub connected");
    return true;
  } catch (e) {
    // 2026-11-26 (W21): dispose the half-open clients so a later init retries
    // with fresh sockets instead of leaking stuck connections.
    try { await publisher?.disconnect(); } catch { /* best-effort cleanup */ }
    try { await subscriber?.disconnect(); } catch { /* best-effort cleanup */ }
    redisPublisher = null;
    redisSubscriber = null;
    logger.info(
      "[RealtimeNotifications] Redis unavailable, using in-memory pub/sub"
    );
    return false;
  }
}

function maybeRetryRedisInit(): void {
  // Already connected (node-redis reconnects internally after socket errors)
  // or Redis not configured — nothing to do.
  if (redisPublisher || !process.env.REDIS_URL) return;
  const now = Date.now();
  if (initInFlight || now < nextInitAttemptAt) return; // one attempt per window
  nextInitAttemptAt = now + INIT_RETRY_INTERVAL_MS;
  initInFlight = initRedisPubSub()
    .catch(() => false)
    .finally(() => {
      initInFlight = null;
    });
}

function getPubSub(): InMemoryPubSub {
  if (!pubSubInstance) {
    pubSubInstance = new InMemoryPubSub();
  }
  return pubSubInstance;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Notification Publisher (call from any service)
// ═══════════════════════════════════════════════════════════════════════════════
export async function publishNotification(
  notification: RealtimeNotification
): Promise<void> {
  const channel = `notifications:${notification.channel}`;
  const message = JSON.stringify(notification);

  // 2026-11-26 (W21): non-blocking re-arm of Redis init after a failed
  // boot-time connect; this call still falls back to in-memory for now.
  maybeRetryRedisInit();

  if (redisPublisher?.isReady) {
    await redisPublisher.publish(channel, message);
  } else {
    getPubSub().publish(channel, message);
  }

  // Also publish to the "all" channel for inbox aggregation
  const allChannel = "notifications:all";
  if (redisPublisher?.isReady) {
    await redisPublisher.publish(allChannel, message);
  } else {
    getPubSub().publish(allChannel, message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connected Users Tracking
// ═══════════════════════════════════════════════════════════════════════════════
const connectedUsers = new Map<string, Set<string>>(); // userId -> Set<socketId>
const socketToUser = new Map<string, string>(); // socketId -> userId

export function getActiveUserCount(): number {
  return connectedUsers.size;
}

export function getActiveUsers(): string[] {
  return Array.from(connectedUsers.keys());
}

// ═══════════════════════════════════════════════════════════════════════════════
// Socket.IO Namespace Setup
// ═══════════════════════════════════════════════════════════════════════════════
export function initRealtimeNotifications(io: SocketIOServer): void {
  const notifNs = io.of("/notifications");

  // JWT Authentication middleware
  notifNs.use(async (socket: Socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace("Bearer ", "") ||
      extractCookieToken(socket.handshake.headers.cookie ?? "");

    if (token) {
      try {
        const secret = new TextEncoder().encode(getJwtSecret());
        const { payload } = await jwtVerify(token, secret);
        (socket as any).userId = String(payload.sub);
        (socket as any).userName = payload.name ?? "Unknown";
        (socket as any).userRole = payload.role ?? "user";
      } catch {
        // Allow connection but mark as unauthenticated for demo
        (socket as any).userId = `anon_${socket.id.slice(0, 8)}`;
        (socket as any).userName = "Anonymous";
        (socket as any).userRole = "guest";
      }
    } else {
      (socket as any).userId = `anon_${socket.id.slice(0, 8)}`;
      (socket as any).userName = "Anonymous";
      (socket as any).userRole = "guest";
    }
    next();
  });

  notifNs.on("connection", (socket: Socket) => {
    const userId = (socket as any).userId;
    const userName = (socket as any).userName;

    // Track connected user
    if (!connectedUsers.has(userId)) {
      connectedUsers.set(userId, new Set());
    }
    connectedUsers.get(userId)!.add(socket.id);
    socketToUser.set(socket.id, userId);

    logger.info(
      `[Notifications] ${userName} connected (${socket.id}), active users: ${connectedUsers.size}`
    );

    // Send connection confirmation
    socket.emit("notification:connected", {
      userId,
      userName,
      connectedAt: new Date().toISOString(),
      activeUsers: connectedUsers.size,
    });

    // ── Channel Subscriptions ──────────────────────────────────────────────
    socket.on("notification:subscribe", (channels: NotificationChannel[]) => {
      for (const channel of channels) {
        socket.join(`channel:${channel}`);
      }
      socket.emit("notification:subscribed", { channels });
    });

    socket.on("notification:unsubscribe", (channels: NotificationChannel[]) => {
      for (const channel of channels) {
        socket.leave(`channel:${channel}`);
      }
      socket.emit("notification:unsubscribed", { channels });
    });

    // ── Mark as Read ───────────────────────────────────────────────────────
    socket.on("notification:markRead", (notificationIds: string[]) => {
      // Broadcast to other tabs/devices of the same user
      const userSockets = connectedUsers.get(userId);
      if (userSockets) {
        for (const sid of Array.from(userSockets)) {
          if (sid !== socket.id) {
            notifNs
              .to(sid)
              .emit("notification:markedRead", { ids: notificationIds });
          }
        }
      }
    });

    // ── Heartbeat / Ping-Pong ──────────────────────────────────────────────
    const heartbeatInterval = setInterval(() => {
      socket.emit("notification:heartbeat", {
        timestamp: new Date().toISOString(),
        activeUsers: connectedUsers.size,
        serverUptime: process.uptime(),
      });
    }, 15000); // Every 15 seconds

    socket.on("notification:pong", () => {
      // Client responded to heartbeat — connection is healthy
    });

    // ── Disconnect ─────────────────────────────────────────────────────────
    socket.on("disconnect", reason => {
      clearInterval(heartbeatInterval);
      const userSocketSet = connectedUsers.get(userId);
      if (userSocketSet) {
        userSocketSet.delete(socket.id);
        if (userSocketSet.size === 0) {
          connectedUsers.delete(userId);
        }
      }
      socketToUser.delete(socket.id);
      logger.info(
        `[Notifications] ${userName} disconnected (${reason}), active users: ${connectedUsers.size}`
      );
    });
  });

  // ── Subscribe to pub/sub channels and broadcast to Socket.IO rooms ──────
  const allChannels: NotificationChannel[] = [
    "transaction",
    "fraud",
    "rate_alert",
    "kyc",
    "settlement",
    "system",
    "commission",
    "compliance",
  ];

  const handleMessage = (pubSubChannel: string, message: string) => {
    try {
      const notification: RealtimeNotification = JSON.parse(message);
      const socketChannel = notification.channel;

      // Broadcast to channel subscribers
      notifNs
        .to(`channel:${socketChannel}`)
        .emit("notification:new", notification);

      // If targeted to a specific user, also emit directly
      if (notification.userId) {
        const userSockets = connectedUsers.get(notification.userId);
        if (userSockets) {
          for (const sid of Array.from(userSockets)) {
            notifNs.to(sid).emit("notification:personal", notification);
          }
        }
      }
    } catch (e) {
      logger.error("[Notifications] Failed to parse pub/sub message:: " + e);
    }
  };

  // Subscribe to all notification channels
  if (redisSubscriber?.isReady) {
    for (const ch of allChannels) {
      redisSubscriber.subscribe(`notifications:${ch}`, (message: string) => {
        handleMessage(`notifications:${ch}`, message);
      });
    }
    redisSubscriber.subscribe("notifications:all", (message: string) => {
      // Already handled per-channel, but useful for inbox aggregation
    });
  } else {
    // In-memory pub/sub
    for (const ch of allChannels) {
      getPubSub().subscribe(`notifications:${ch}`, handleMessage);
    }
  }

  logger.info(
    "[RealtimeNotifications] /notifications namespace initialized with pub/sub"
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: Send notification to specific user
// ═══════════════════════════════════════════════════════════════════════════════
export async function notifyUser(
  userId: string,
  notification: Omit<RealtimeNotification, "id" | "timestamp" | "userId">
): Promise<void> {
  await publishNotification({
    ...notification,
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    userId,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: Broadcast to all connected users
// ═══════════════════════════════════════════════════════════════════════════════
export async function broadcastNotification(
  notification: Omit<RealtimeNotification, "id" | "timestamp">
): Promise<void> {
  await publishNotification({
    ...notification,
    id: `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: Extract token from cookie
// ═══════════════════════════════════════════════════════════════════════════════
function extractCookieToken(cookieStr: string): string | null {
  const match = cookieStr.match(/(?:agent_session|session)=([^;]+)/);
  return match ? match[1] : null;
}

// Initialize Redis on module load (non-blocking). 2026-11-26 (W21): goes
// through maybeRetryRedisInit so a failed boot connect is cleaned up and a
// later publishNotification re-arms init instead of pinning the process to
// in-memory pub/sub forever.
maybeRetryRedisInit();
