/**
 * states.tsx — Q-wave Q6 (2026-09-25)
 * Shared honest loading / error / empty / not-yet-available states for the
 * innovation member surfaces. Design language: low-saturation warm neutrals
 * (stone/amber), ample whitespace, no gradients.
 */
import { AlertCircle, CloudOff, Inbox, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-3 py-16 text-stone-500"
      role="status"
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
      <AlertCircle className="h-6 w-6 text-red-500" aria-hidden />
      <p className="text-sm text-red-700">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-stone-200 bg-stone-50 px-6 py-12 text-center">
      <Inbox className="h-6 w-6 text-stone-400" aria-hidden />
      <p className="text-sm font-medium text-stone-700">{title}</p>
      {hint && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  );
}

/**
 * 2026-09-25 — Rendered when a forward-looking Q1/Q2/Q3 backend surface is
 * not deployed yet (the binding feature-detected NOT_FOUND/FORBIDDEN and
 * resolved to null). This is a DISCLOSED state, not an error and never a
 * fabricated preview.
 */
export function UnavailableState({ feature }: { feature: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-6 py-12 text-center">
      <CloudOff className="h-6 w-6 text-amber-600" aria-hidden />
      <p className="text-sm font-medium text-stone-800">
        {feature} isn’t available on this deployment yet
      </p>
      <p className="max-w-md text-xs text-stone-500">
        This service is being rolled out. Nothing here is simulated — the page
        activates automatically once the backend service is live for your
        account.
      </p>
    </div>
  );
}
