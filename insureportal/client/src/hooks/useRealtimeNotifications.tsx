/**
 * useRealtimeNotifications — Client-side hook for real-time notification WebSocket
 *
 * Features:
 * - Auto-connect to /notifications namespace
 * - JWT authentication
 * - Channel subscription management
 * - Auto-reconnect with exponential backoff
 * - Heartbeat monitoring
 * - Toast notifications for critical alerts
 * - Unread count tracking
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { toast } from "sonner";

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

export interface ConnectionState {
  connected: boolean;
  connectedAt: string | null;
  lastHeartbeat: string | null;
  reconnectAttempts: number;
  activeUsers: number;
}

interface UseRealtimeNotificationsOptions {
  channels?: NotificationChannel[];
  maxNotifications?: number;
  showToasts?: boolean;
  autoConnect?: boolean;
}

const DEFAULT_CHANNELS: NotificationChannel[] = [
  "transaction",
  "fraud",
  "rate_alert",
  "kyc",
  "settlement",
  "system",
];

export function useRealtimeNotifications(
  options: UseRealtimeNotificationsOptions = {}
) {
  const {
    channels = DEFAULT_CHANNELS,
    maxNotifications = 100,
    showToasts = true,
    autoConnect = true,
  } = options;

  const [notifications, setNotifications] = useState<RealtimeNotification[]>(
    []
  );
  const [unreadCount, setUnreadCount] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    connected: false,
    connectedAt: null,
    lastHeartbeat: null,
    reconnectAttempts: 0,
    activeUsers: 0,
  });

  const socketRef = useRef<Socket | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Connect to WebSocket
  useEffect(() => {
    if (!autoConnect) return;

    const socket = io("/notifications", {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30000,
      reconnectionAttempts: Infinity,
      timeout: 10000,
      auth: {
        // Token will be extracted from cookie on server side
      },
    });

    socketRef.current = socket;

    // Connection events
    socket.on("connect", () => {
      reconnectAttemptsRef.current = 0;
      setConnectionState(prev => ({
        ...prev,
        connected: true,
        connectedAt: new Date().toISOString(),
        reconnectAttempts: 0,
      }));
    });

    socket.on("notification:connected", (data: { activeUsers: number }) => {
      setConnectionState(prev => ({ ...prev, activeUsers: data.activeUsers }));
      // Subscribe to channels
      socket.emit("notification:subscribe", channels);
    });

    socket.on("disconnect", reason => {
      setConnectionState(prev => ({
        ...prev,
        connected: false,
      }));
      if (reason === "io server disconnect") {
        // Server disconnected us, try to reconnect
        socket.connect();
      }
    });

    socket.on("reconnect_attempt", attempt => {
      reconnectAttemptsRef.current = attempt;
      setConnectionState(prev => ({
        ...prev,
        reconnectAttempts: attempt,
      }));
    });

    // Heartbeat
    socket.on(
      "notification:heartbeat",
      (data: { timestamp: string; activeUsers: number }) => {
        setConnectionState(prev => ({
          ...prev,
          lastHeartbeat: data.timestamp,
          activeUsers: data.activeUsers,
        }));
        socket.emit("notification:pong");
      }
    );

    // New notification
    socket.on("notification:new", (notification: RealtimeNotification) => {
      setNotifications(prev => {
        const updated = [notification, ...prev].slice(0, maxNotifications);
        return updated;
      });
      setUnreadCount(prev => prev + 1);

      // Show toast for warnings and critical
      if (showToasts) {
        if (notification.severity === "critical") {
          toast.error(notification.title, {
            description: notification.body,
            duration: 8000,
          });
        } else if (notification.severity === "warning") {
          toast.warning(notification.title, {
            description: notification.body,
            duration: 5000,
          });
        } else {
          toast.info(notification.title, {
            description: notification.body,
            duration: 3000,
          });
        }
      }
    });

    // Personal notification (targeted to this user)
    socket.on("notification:personal", (notification: RealtimeNotification) => {
      setNotifications(prev => {
        const updated = [notification, ...prev].slice(0, maxNotifications);
        return updated;
      });
      setUnreadCount(prev => prev + 1);

      if (showToasts) {
        toast(notification.title, {
          description: notification.body,
          duration: 5000,
        });
      }
    });

    // Mark as read sync from other tabs
    socket.on("notification:markedRead", (data: { ids: string[] }) => {
      setNotifications(prev =>
        prev.map(n =>
          data.ids.includes(n.id) ? ({ ...n, read: true } as any) : n
        )
      );
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [autoConnect, maxNotifications, showToasts]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mark notifications as read
  const markAsRead = useCallback((ids: string[]) => {
    setUnreadCount(prev => Math.max(0, prev - ids.length));
    socketRef.current?.emit("notification:markRead", ids);
  }, []);

  // Mark all as read
  const markAllAsRead = useCallback(() => {
    const allIds = notifications.map(n => n.id);
    setUnreadCount(0);
    socketRef.current?.emit("notification:markRead", allIds);
  }, [notifications]);

  // Clear all notifications
  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
  }, []);

  // Subscribe to additional channels
  const subscribe = useCallback((newChannels: NotificationChannel[]) => {
    socketRef.current?.emit("notification:subscribe", newChannels);
  }, []);

  // Unsubscribe from channels
  const unsubscribe = useCallback((removeChannels: NotificationChannel[]) => {
    socketRef.current?.emit("notification:unsubscribe", removeChannels);
  }, []);

  return {
    notifications,
    unreadCount,
    connectionState,
    markAsRead,
    markAllAsRead,
    clearAll,
    subscribe,
    unsubscribe,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Connection Status Indicator Component
// ═══════════════════════════════════════════════════════════════════════════════
export function ConnectionStatusBadge({ state }: { state: ConnectionState }) {
  if (state.connected) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-emerald-500">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        Live
        {state.activeUsers > 0 && (
          <span className="text-muted-foreground ml-1">
            ({state.activeUsers} online)
          </span>
        )}
      </div>
    );
  }

  if (state.reconnectAttempts > 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-amber-500">
        <span className="animate-spin h-2 w-2 border border-amber-500 border-t-transparent rounded-full" />
        Reconnecting ({state.reconnectAttempts})
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs text-red-500">
      <span className="h-2 w-2 rounded-full bg-red-500" />
      Disconnected
    </div>
  );
}
