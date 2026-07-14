/**
 * PWAInstallBanner — Displays a non-intrusive banner prompting users to install
 * the InsurePortal POS Shell as a PWA. Automatically hides if already installed or
 * if the user dismisses it (stored in localStorage).
 */
import { useState, useEffect } from "react";
import { usePWAInstall } from "../hooks/usePWAInstall";
import { Button } from "@/components/ui/button";
import { X, Download, Smartphone } from "lucide-react";

const DISMISSED_KEY = "pwa_install_banner_dismissed";

export function PWAInstallBanner() {
  const { canInstall, install } = usePWAInstall();
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const wasDismissed = localStorage.getItem(DISMISSED_KEY) === "true";
    setDismissed(wasDismissed);
  }, []);

  if (!canInstall || dismissed) return null;

  const handleInstall = async () => {
    setInstalling(true);
    const accepted = await install();
    if (!accepted) setInstalling(false);
  };

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem(DISMISSED_KEY, "true");
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96">
      <div className="bg-card border border-border rounded-xl shadow-lg p-4 flex items-start gap-3">
        <div className="flex-shrink-0 w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
          <Smartphone className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-card-foreground">
            Install InsurePortal POS Shell
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Install for faster access, offline support, and push notifications.
          </p>
          <div className="flex gap-2 mt-3">
            <Button
              size="sm"
              onClick={handleInstall}
              disabled={installing}
              className="h-7 text-xs gap-1.5"
            >
              <Download className="w-3 h-3" />
              {installing ? "Installing…" : "Install"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDismiss}
              className="h-7 text-xs text-muted-foreground"
            >
              Not now
            </Button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss install banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
