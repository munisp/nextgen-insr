/**
 * PWASettings — Push notification subscription management UI
 * 
 * Provides users with:
 * - Current subscription status
 * - Enable/disable push notifications
 * - Clear subscription and re-subscribe
 * - Connection status display
 */
import { useState, useCallback } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Bell,
  BellOff,
  CheckCircle,
  XCircle,
  RefreshCw,
  Shield,
  AlertTriangle,
} from "lucide-react";

export function PWASettings() {
  const {
    permission,
    isSubscribed,
    isRegistering,
    requestPermission,
  } = usePushNotifications();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleToggleNotifications = useCallback(async () => {
    if (!isSubscribed) {
      await requestPermission();
    }
  }, [isSubscribed, requestPermission]);

  const handleRefreshSubscription = useCallback(async () => {
    setIsRefreshing(true);
    try {
      // Unsubscribe and re-subscribe
      if ("serviceWorker" in navigator && "PushManager" in window) {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          await subscription.unsubscribe();
        }
        // Re-request permission
        await requestPermission();
      }
    } catch (error) {
      console.error("[PWASettings] Failed to refresh subscription:", error);
    } finally {
      setIsRefreshing(false);
    }
  }, [requestPermission]);

  const getPermissionIcon = () => {
    switch (permission) {
      case "granted":
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case "denied":
        return <XCircle className="w-4 h-4 text-red-500" />;
      case "unsupported":
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default:
        return <Bell className="w-4 h-4 text-gray-400" />;
    }
  };

  const getPermissionText = () => {
    switch (permission) {
      case "granted":
        return "Notifications allowed";
      case "denied":
        return "Notifications blocked";
      case "unsupported":
        return "Notifications not supported";
      default:
        return "Not set";
    }
  };

  const getSubscriptionStatus = () => {
    if (permission !== "granted") {
      return (
        <Badge variant="secondary" className="gap-1">
          <XCircle className="w-3 h-3" />
          Not subscribed
        </Badge>
      );
    }
    if (isSubscribed) {
      return (
        <Badge variant="default" className="gap-1 bg-green-600">
          <CheckCircle className="w-3 h-3" />
          Active
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="gap-1">
        <AlertTriangle className="w-3 h-3" />
        Pending
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Bell className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-card-foreground">
              Push Notifications
            </h3>
            <p className="text-xs text-muted-foreground">
              Manage your notification preferences
            </p>
          </div>
        </div>
        {getPermissionIcon()}
      </div>

      {/* Status */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Permission</span>
          <span className="text-card-foreground">{getPermissionText()}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subscription</span>
          {getSubscriptionStatus()}
        </div>
      </div>

      {/* Controls */}
      <div className="space-y-3 pt-2">
        {/* Enable/Disable Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isSubscribed ? (
              <Bell className="w-4 h-4 text-green-500" />
            ) : (
              <BellOff className="w-4 h-4 text-gray-400" />
            )}
            <span className="text-sm text-card-foreground">
              {isSubscribed ? "Notifications enabled" : "Notifications disabled"}
            </span>
          </div>
          <Switch
            checked={isSubscribed}
            onCheckedChange={handleToggleNotifications}
            disabled={permission === "denied" || permission === "unsupported" || isRegistering}
            className={isSubscribed ? "bg-green-600" : "bg-gray-600"}
          />
        </div>

        {/* Refresh Subscription */}
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefreshSubscription}
          disabled={isRefreshing || permission !== "granted"}
          className="w-full gap-2 text-xs"
        >
          <RefreshCw
            className={`w-3 h-3 ${isRefreshing ? "animate-spin" : ""}`}
          />
          {isRefreshing ? "Refreshing..." : "Refresh Subscription"}
        </Button>

        {/* Request Permission Button */}
        {permission === "default" && (
          <Button
            size="sm"
            onClick={requestPermission}
            disabled={isRegistering}
            className="w-full gap-2"
          >
            <Shield className="w-3 h-3" />
            {isRegistering ? "Requesting..." : "Enable Notifications"}
          </Button>
        )}

        {/* Denied State */}
        {permission === "denied" && (
          <div className="p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-lg">
            <p className="text-xs text-yellow-500">
              Notifications are blocked. Please enable them in your browser
              settings to receive alerts.
            </p>
          </div>
        )}

        {/* Unsupported State */}
        {permission === "unsupported" && (
          <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
            <p className="text-xs text-red-500">
              Push notifications are not supported in your browser. Please use a
              modern browser like Chrome, Firefox, or Edge.
            </p>
          </div>
        )}
      </div>

      {/* Info */}
      <div className="pt-2 border-t border-border">
        <div className="flex items-start gap-2">
          <Shield className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            Notifications are used to alert you about offline transaction sync,
            fraud alerts, and important system updates. Your subscription data is
            never shared with third parties.
          </p>
        </div>
      </div>
    </div>
  );
}
