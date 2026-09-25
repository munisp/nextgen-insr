/**
 * InstallPrompt.tsx — Q-wave Q6 PWA hardening (2026-09-25)
 * Additive install prompt: captures the browser's beforeinstallprompt event
 * and offers a dismissible banner. Renders nothing when the event never
 * fires (already installed, iOS, or unsupported). The deferred prompt is
 * kept in memory only — nothing is persisted or sent anywhere.
 */
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "uip-install-dismissed-at";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // re-offer after a week

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
    const recentlyDismissed =
      Number.isFinite(dismissedAt) && Date.now() - dismissedAt < DISMISS_TTL_MS;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      if (recentlyDismissed) return;
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
    };
    const onInstalled = () => {
      setVisible(false);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!visible || !deferred) return null;

  const install = async () => {
    try {
      await deferred.prompt();
      await deferred.userChoice; // outcome either way: hide the banner
    } finally {
      setVisible(false);
      setDeferred(null);
    }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
    setDeferred(null);
  };

  return (
    <div
      role="dialog"
      aria-label="Install app"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-lg"
    >
      <Download className="h-6 w-6 shrink-0 text-amber-600" aria-hidden />
      <div className="flex-1">
        <p className="text-sm font-semibold text-stone-900">
          Install InsurePortal
        </p>
        <p className="text-xs text-stone-500">
          Faster access and an offline-ready shell for low connectivity.
        </p>
      </div>
      <button
        type="button"
        onClick={install}
        className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
      >
        Install
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="rounded-lg p-1 text-stone-400 hover:text-stone-600"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}
