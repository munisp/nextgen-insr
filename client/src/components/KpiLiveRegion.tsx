/**
 * KpiLiveRegion — ARIA live region that announces real-time KPI changes to screen readers.
 * Mount once at the app root. Other components post to it via the kpiAnnounce() helper.
 */
import { useEffect, useState } from "react";

// Global event bus for KPI announcements
const KPI_ANNOUNCE_EVENT = "kpi-announce";

export function kpiAnnounce(message: string) {
  window.dispatchEvent(new CustomEvent(KPI_ANNOUNCE_EVENT, { detail: message }));
}

export function KpiLiveRegion() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent<string>).detail;
      setMessage("");
      // Brief reset so repeated identical messages still fire
      requestAnimationFrame(() => setMessage(msg));
    };
    window.addEventListener(KPI_ANNOUNCE_EVENT, handler);
    return () => window.removeEventListener(KPI_ANNOUNCE_EVENT, handler);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {message}
    </div>
  );
}

export default KpiLiveRegion;
