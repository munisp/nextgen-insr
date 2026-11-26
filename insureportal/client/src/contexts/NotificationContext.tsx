import { createContext, useContext, ReactNode } from "react";
import {
  useRealtimeNotifications,
  ConnectionStatusBadge,
  type RealtimeNotification,
  type ConnectionState,
  type NotificationChannel,
} from "@/hooks/useRealtimeNotifications";

// ── Context Type ────────────────────────────────────────────────────────────

interface NotificationContextValue {
  notifications: RealtimeNotification[];
  unreadCount: number;
  connectionState: ConnectionState;
  markAsRead: (ids: string[]) => void;
  markAllAsRead: () => void;
  clearAll: () => void;
  subscribe: (channels: NotificationChannel[]) => void;
  unsubscribe: (channels: NotificationChannel[]) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null
);

// ── Provider ────────────────────────────────────────────────────────────────

export function NotificationProvider({ children }: { children: ReactNode }) {
  const value = useRealtimeNotifications({
    channels: [
      "transaction",
      "fraud",
      "system",
      "compliance",
      "rate_alert",
      "kyc",
      "settlement",
      "commission",
    ],
    maxNotifications: 50,
    showToasts: true,
    autoConnect: true,
  });

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────────────────────────

export function useNotificationContext() {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    // Return a safe fallback when used outside provider (e.g., login page)
    return {
      notifications: [] as RealtimeNotification[],
      unreadCount: 0,
      connectionState: {
        connected: false,
        connectedAt: "",
        lastHeartbeat: "",
        reconnectAttempts: 0,
        activeUsers: 0,
      } as ConnectionState,
      markAsRead: () => {},
      markAllAsRead: () => {},
      clearAll: () => {},
      subscribe: () => {},
      unsubscribe: () => {},
    };
  }
  return ctx;
}

// Re-export for convenience
export { ConnectionStatusBadge };
export type { RealtimeNotification, ConnectionState, NotificationChannel };
