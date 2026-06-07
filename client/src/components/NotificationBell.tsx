/**
 * NotificationBell — Header button that shows unread count and manages
 * Web Push notification permission for the InsurePortal InsurePortal Platform.
 */
import { usePushNotifications } from "../hooks/usePushNotifications";
import { toast } from "sonner";

interface Props {
  unreadCount: number;
  onClick: () => void;
  cardStyle: string;
  borderStyle: string;
  redColor: string;
}

export function NotificationBell({
  unreadCount,
  onClick,
  cardStyle,
  borderStyle,
  redColor,
}: Props) {
  const { permission, isSubscribed, isRegistering, requestPermission } =
    usePushNotifications();

  const handleEnablePush = () => {
    if (permission === "unsupported") {
      toast.error("Push notifications are not supported in this browser.");
      return;
    }
    if (permission === "denied") {
      toast.error(
        "Notifications are blocked. Enable them in your browser settings, then refresh."
      );
      return;
    }
    if (!isSubscribed) {
      requestPermission();
    } else {
      toast.success("Push notifications are already enabled.");
    }
  };

  return (
    <button
      onClick={onClick}
      onContextMenu={e => {
        e.preventDefault();
        handleEnablePush();
      }}
      title={
        isSubscribed
          ? "Notifications enabled — right-click to manage"
          : "Tap to open notifications • Right-click to enable push alerts"
      }
      className="relative w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
      style={{ background: cardStyle, border: `1px solid ${borderStyle}` }}
      disabled={isRegistering}
    >
      <span className="text-base">{isRegistering ? "⏳" : "🔔"}</span>
      {/* Unread badge */}
      {unreadCount > 0 && (
        <div
          className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-xs font-bold text-white"
          style={{ background: redColor, fontSize: 9 }}
        >
          {unreadCount > 9 ? "9+" : unreadCount}
        </div>
      )}
      {/* Push enabled indicator */}
      {isSubscribed && (
        <div
          className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-black"
          style={{ background: "oklch(0.65 0.18 160)" }}
        />
      )}
    </button>
  );
}
