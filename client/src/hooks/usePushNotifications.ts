/**
 * usePushNotifications — Web Push API integration for InsurePortal Shell.
 *
 * Responsibilities:
 *  1. Register the Service Worker (sw.js)
 *  2. Request Notification permission from the user
 *  3. Subscribe to Push via PushManager (VAPID public key from server)
 *  4. Persist the PushSubscription server-side via resilience.savePushSubscription
 *  5. Trigger server-side notifyPendingSync when app is backgrounded with pending items
 *  6. Expose helpers to trigger local notifications for critical fraud events
 *     when the tab is in the foreground (Socket.IO events bypass the SW)
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { usePosStore } from "../store/posStore";
import { trpc } from "../lib/trpc";

export type PushPermission = "default" | "granted" | "denied" | "unsupported";

export interface PushState {
  permission: PushPermission;
  isSubscribed: boolean;
  isRegistering: boolean;
  requestPermission: () => Promise<void>;
  sendLocalAlert: (title: string, body: string, severity?: string) => void;
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray.buffer as ArrayBuffer;
}

export function usePushNotifications(): PushState {
  const [permission, setPermission] = useState<PushPermission>("default");
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [swRegistration, setSwRegistration] =
    useState<ServiceWorkerRegistration | null>(null);

  const agent = usePosStore(s => s.agent);
  const offlineQueue = usePosStore(s => s.offlineQueue);

  // Fetch VAPID public key from server (replaces hardcoded placeholder)
  const { data: vapidData } = trpc.system.vapidPublicKey.useQuery(undefined, {
    retry: false,
    staleTime: Infinity,
  });
  const vapidPublicKey = vapidData?.key ?? null;

  // Mutations for server-side subscription management
  const savePushSub = trpc.resilience.savePushSubscription.useMutation();
  const notifyPending = trpc.resilience.notifyPendingSync.useMutation();

  // Track last notified pending count to avoid duplicate notifications
  const lastNotifiedCount = useRef(0);

  // ── Register Service Worker on mount ───────────────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      setPermission("unsupported");
      return;
    }

    // Reflect current permission state
    setPermission(Notification.permission as PushPermission);

    navigator.serviceWorker
      .register("/sw.js", { scope: "/" })
      .then(reg => {
        setSwRegistration(reg);
        // Check if already subscribed
        return reg.pushManager.getSubscription();
      })
      .then(sub => {
        if (sub) setIsSubscribed(true);
      })
      .catch(err => {
        console.warn("[PushNotifications] SW registration failed:", err);
      });
  }, []);

  // ── Listen for SW messages (background sync results) ──────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "SYNC_FRAUD_STATUS") {
        // Trigger a re-fetch of fraud alerts
        window.dispatchEvent(new CustomEvent("fraud-sync-requested"));
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () =>
      navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  // ── Notify server when app is backgrounded with pending offline items ──────
  useEffect(() => {
    if (!isSubscribed || !agent?.agentCode) return;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        const pendingCount = offlineQueue.length;
        // Only notify if there are pending items and count has changed
        if (pendingCount > 0 && pendingCount !== lastNotifiedCount.current) {
          lastNotifiedCount.current = pendingCount;
          notifyPending.mutate({
            agentCode: agent.agentCode,
            pendingCount,
          });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isSubscribed, agent, offlineQueue, notifyPending]);

  // ── Request permission and subscribe ──────────────────────────────────────
  const requestPermission = useCallback(async () => {
    if (!swRegistration) {
      toast.error("Service Worker not ready. Please refresh and try again.");
      return;
    }
    if (!("PushManager" in window)) {
      toast.error("Push notifications are not supported in this browser.");
      return;
    }

    setIsRegistering(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result as PushPermission);

      if (result !== "granted") {
        toast.warning(
          "Notification permission denied. You won't receive offline sync alerts."
        );
        return;
      }

      if (!vapidPublicKey) {
        toast.error(
          "Push notification configuration not loaded. Please try again."
        );
        return;
      }

      // Subscribe to push using server-provided VAPID key
      const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      console.info(
        "[PushNotifications] Subscribed:",
        JSON.stringify(subscription)
      );
      setIsSubscribed(true);

      // ── Persist subscription server-side ──────────────────────────────────
      if (agent?.agentCode) {
        const subJson = subscription.toJSON();
        const keys = subJson.keys ?? {};
        try {
          await savePushSub.mutateAsync({
            agentCode: agent.agentCode,
            endpoint: subscription.endpoint,
            p256dhKey: keys.p256dh ?? "",
            authKey: keys.auth ?? "",
            userAgent: navigator.userAgent,
          });
          console.info(
            "[PushNotifications] Subscription saved to server for agent:",
            agent.agentCode
          );
        } catch (saveErr) {
          // Non-fatal: subscription works locally even if server save fails
          console.warn(
            "[PushNotifications] Failed to save subscription to server:",
            saveErr
          );
        }
      }

      toast.success(
        "Notifications enabled! You'll be alerted when offline items need syncing."
      );
    } catch (err) {
      console.error("[PushNotifications] Subscription failed:", err);
      toast.error(
        "Failed to enable push notifications. Check browser settings."
      );
    } finally {
      setIsRegistering(false);
    }
  }, [swRegistration, vapidPublicKey, agent, savePushSub]);

  // ── Send a local (foreground) notification ────────────────────────────────
  const sendLocalAlert = useCallback(
    (title: string, body: string, severity = "high") => {
      if (permission !== "granted") return;

      // When the tab is visible, show a toast instead of a system notification
      if (document.visibilityState === "visible") {
        if (severity === "critical") {
          toast.error(`🚨 ${title}: ${body}`, { duration: 8000 });
        } else {
          toast.warning(`⚠ ${title}: ${body}`, { duration: 5000 });
        }
        return;
      }

      // Tab is hidden — show a real system notification
      if (swRegistration) {
        swRegistration.showNotification(title, {
          body,
          icon: "/favicon.ico",
          badge: "/favicon.ico",
          tag: `fraud-${Date.now()}`,
          requireInteraction: severity === "critical",
          data: { url: "/admin", severity },
        });
      }
    },
    [permission, swRegistration]
  );

  return {
    permission,
    isSubscribed,
    isRegistering,
    requestPermission,
    sendLocalAlert,
  };
}
