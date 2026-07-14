/**
 * S94-01: Real-time WebSocket Push for Security Alerts
 * Uses Socket.IO to deliver instant notifications to admin dashboards
 * when critical security events (ransomware, DDoS, exfiltration) are detected.
 */
import type { Server as SocketIOServer, Socket } from "socket.io";
import { logger } from '../_core/logger';

// ── Types ──
export interface SecurityAlertPayload {
  alertId: string;
  category:
    | "ransomware"
    | "ddos"
    | "bulk_operation"
    | "data_exfiltration"
    | "brute_force"
    | "unauthorized_access";
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  description: string;
  sourceIp?: string;
  targetResource?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface AlertAcknowledgment {
  alertId: string;
  adminId: string;
  action: "acknowledged" | "investigating" | "resolved" | "escalated";
  note?: string;
  timestamp: number;
}

export interface AlertStats {
  totalActive: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  lastAlertTime: number | null;
  acknowledgedCount: number;
  unresolvedCount: number;
}

// ── In-memory alert store ──
const activeAlerts: Map<
  string,
  SecurityAlertPayload & { status: string; acknowledgedBy?: string }
> = new Map();
const alertHistory: Array<SecurityAlertPayload & { status: string }> = [];
const MAX_HISTORY = 1000;

// ── Socket.IO namespace handler ──
let securityNamespace: ReturnType<SocketIOServer["of"]> | null = null;

export function initSecurityAlertSocket(io: SocketIOServer): void {
  securityNamespace = io.of("/security-alerts");

  securityNamespace.use((socket: Socket, next) => {
    // In production, verify admin JWT here
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token) {
      // Allow connection but mark as unauthenticated for dev
      (socket as any).isAdmin = false;
    } else {
      (socket as any).isAdmin = true;
    }
    next();
  });

  securityNamespace.on("connection", (socket: Socket) => {
    logger.info(`[SecurityAlertSocket] Admin connected: ${socket.id}`);

    // Send current active alerts on connect
    socket.emit("alert:snapshot", {
      alerts: Array.from(activeAlerts.values()),
      stats: computeStats(),
    });

    // Handle acknowledgment from admin
    socket.on("alert:acknowledge", (data: AlertAcknowledgment) => {
      const alert = activeAlerts.get(data.alertId);
      if (alert) {
        alert.status = data.action;
        alert.acknowledgedBy = data.adminId;
        // Broadcast acknowledgment to all connected admins
        securityNamespace?.emit("alert:updated", {
          alertId: data.alertId,
          status: data.action,
          acknowledgedBy: data.adminId,
          note: data.note,
          timestamp: data.timestamp,
        });
        securityNamespace?.emit("alert:stats", computeStats());

        if (data.action === "resolved") {
          activeAlerts.delete(data.alertId);
        }
      }
    });

    // Handle request for alert history
    socket.on(
      "alert:getHistory",
      (params: { limit?: number; offset?: number }) => {
        const limit = params?.limit || 50;
        const offset = params?.offset || 0;
        socket.emit("alert:history", {
          alerts: alertHistory.slice(offset, offset + limit),
          total: alertHistory.length,
        });
      }
    );

    // Handle request for stats refresh
    socket.on("alert:getStats", () => {
      socket.emit("alert:stats", computeStats());
    });

    socket.on("disconnect", () => {
      logger.info(`[SecurityAlertSocket] Admin disconnected: ${socket.id}`);
    });
  });

  logger.info("[SecurityAlertSocket] /security-alerts namespace initialized");
}

/**
 * Broadcast a security alert to all connected admin dashboards in real-time.
 * Called by the security middleware when threats are detected.
 */
export function broadcastSecurityAlert(alert: SecurityAlertPayload): void {
  // Store in active alerts
  activeAlerts.set(alert.alertId, { ...alert, status: "active" });

  // Add to history
  alertHistory.unshift({ ...alert, status: "active" });
  if (alertHistory.length > MAX_HISTORY) {
    alertHistory.splice(MAX_HISTORY);
  }

  // Broadcast to all connected admins
  if (securityNamespace) {
    securityNamespace.emit("alert:new", alert);
    securityNamespace.emit("alert:stats", computeStats());

    // For critical alerts, also emit a priority notification
    if (alert.severity === "critical") {
      securityNamespace.emit("alert:critical", {
        ...alert,
        requiresImmediate: true,
        escalationDeadline: Date.now() + 5 * 60 * 1000, // 5 min to acknowledge
      });
    }
  }
}

/**
 * Broadcast a batch of alerts (e.g., from periodic scan)
 */
export function broadcastAlertBatch(alerts: SecurityAlertPayload[]): void {
  for (const alert of alerts) {
    activeAlerts.set(alert.alertId, { ...alert, status: "active" });
    alertHistory.unshift({ ...alert, status: "active" });
  }
  if (alertHistory.length > MAX_HISTORY) {
    alertHistory.splice(MAX_HISTORY);
  }

  if (securityNamespace) {
    securityNamespace.emit("alert:batch", { alerts, count: alerts.length });
    securityNamespace.emit("alert:stats", computeStats());
  }
}

/**
 * Get the current connected admin count
 */
export function getConnectedAdminCount(): number {
  if (!securityNamespace) return 0;
  return securityNamespace.sockets.size;
}

/**
 * Get current alert statistics
 */
export function getAlertStats(): AlertStats {
  return computeStats();
}

function computeStats(): AlertStats {
  const alerts = Array.from(activeAlerts.values());
  return {
    totalActive: alerts.length,
    criticalCount: alerts.filter(a => a.severity === "critical").length,
    highCount: alerts.filter(a => a.severity === "high").length,
    mediumCount: alerts.filter(a => a.severity === "medium").length,
    lowCount: alerts.filter(a => a.severity === "low").length,
    lastAlertTime:
      alerts.length > 0 ? Math.max(...alerts.map(a => a.timestamp)) : null,
    acknowledgedCount: alerts.filter(
      a => a.status === "acknowledged" || a.status === "investigating"
    ).length,
    unresolvedCount: alerts.filter(a => a.status === "active").length,
  };
}
