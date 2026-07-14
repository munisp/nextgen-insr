/**
 * EnableNotificationsButton
 *
 * Handles the full VAPID Web Push subscription flow:
 *  1. Fetch the VAPID public key from the server via tRPC
 *  2. Request Notification permission from the browser
 *  3. Subscribe to push notifications via the service worker
 *  4. Send the PushSubscription object to the server via tRPC
 *  5. Show status feedback (subscribed / unsubscribed / unsupported)
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { usePosStore } from "@/store/posStore";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function EnableNotificationsButton() {
  const [status, setStatus] = useState<
    "idle" | "loading" | "subscribed" | "denied" | "unsupported"
  >("idle");
  const agent = usePosStore(s => s.agent);

  const { data: vapidData } = trpc.push.getVapidPublicKey.useQuery(undefined, {
    retry: false,
  });

  const subscribeMutation = trpc.push.subscribePush.useMutation({
    onSuccess: () => {
      setStatus("subscribed");
      toast.success("Push notifications enabled", {
        description:
          "You will receive alerts for float approvals and SIM failovers.",
      });
    },
    onError: err => {
      toast.error("Failed to enable notifications", {
        description: err.message,
      });
      setStatus("idle");
    },
  });

  const unsubscribeMutation = trpc.push.unsubscribePush.useMutation({
    onSuccess: () => {
      setStatus("idle");
      toast.info("Push notifications disabled");
    },
  });

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setStatus("denied");
      return;
    }
    // Check if already subscribed
    navigator.serviceWorker.ready.then(reg => {
      reg.pushManager.getSubscription().then(sub => {
        if (sub) setStatus("subscribed");
      });
    });
  }, []);

  const handleEnable = async () => {
    if (!vapidData?.publicKey) {
      toast.error("VAPID key not available — check server configuration");
      return;
    }

    setStatus("loading");

    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus("denied");
        toast.warning("Notification permission denied", {
          description:
            "Enable notifications in your browser settings to receive alerts.",
        });
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(
          vapidData.publicKey
        ) as unknown as ArrayBuffer,
      });

      const subJson = subscription.toJSON();
      await subscribeMutation.mutateAsync({
        subscription: {
          endpoint: subJson.endpoint!,
          keys: {
            p256dh: subJson.keys!.p256dh,
            auth: subJson.keys!.auth,
          },
        },
        agentId: (agent as any)?.agentId ?? "",
        deviceName: navigator.userAgent.slice(0, 100),
        userAgent: navigator.userAgent,
      });
    } catch (err) {
      console.error("Push subscription error:", err);
      toast.error("Failed to subscribe to push notifications");
      setStatus("idle");
    }
  };

  const handleDisable = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        await unsubscribeMutation.mutateAsync({
          endpoint: sub.endpoint,
          agentId: (agent as any)?.agentId ?? "",
        });
      }
    } catch (err) {
      console.error("Push unsubscribe error:", err);
    }
  };

  if (status === "unsupported") {
    return (
      <Button variant="outline" disabled size="sm">
        Push Not Supported
      </Button>
    );
  }

  if (status === "denied") {
    return (
      <Button
        variant="outline"
        disabled
        size="sm"
        className="text-destructive border-destructive"
      >
        Notifications Blocked
      </Button>
    );
  }

  if (status === "subscribed") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleDisable}
        className="border-green-500 text-green-600 hover:bg-green-50 dark:hover:bg-green-950"
      >
        <span className="mr-1.5 h-2 w-2 rounded-full bg-green-500 inline-block" />
        Notifications On
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleEnable}
      disabled={status === "loading"}
    >
      {status === "loading" ? "Enabling..." : "Enable Notifications"}
    </Button>
  );
}
