/**
 * OfflineIndicator — Persistent banner shown when the device is offline.
 * Shows sync queue depth and provides a manual retry trigger.
 * Uses the existing useOfflineSync hook from the platform.
 */
import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, CheckCircle } from "lucide-react";

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [queueDepth, setQueueDepth] = useState(0);
  const [justReconnected, setJustReconnected] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setJustReconnected(true);
      setTimeout(() => setJustReconnected(false), 3000);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Poll IndexedDB offline queue depth
    const pollQueue = setInterval(async () => {
      try {
        const db = await openQueueDb();
        const count = await countQueueItems(db);
        setQueueDepth(count);
      } catch {
        // IndexedDB not available
      }
    }, 2000);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(pollQueue);
    };
  }, []);

  const handleRetry = async () => {
    if (!isOnline) return;
    setSyncing(true);
    // Trigger service worker background sync
    if ("serviceWorker" in navigator && "SyncManager" in window) {
      const reg = await navigator.serviceWorker.ready;
      await (reg as any).sync.register("offline-queue-sync");
    }
    setTimeout(() => setSyncing(false), 2000);
  };

  if (isOnline && !justReconnected && queueDepth === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-center gap-2 px-4 py-2 text-xs font-medium transition-all duration-300"
      style={{
        background: justReconnected
          ? "var(--risk-low)"
          : isOnline && queueDepth > 0
          ? "var(--risk-medium)"
          : "var(--risk-critical)",
        color: "#fff",
        boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
      }}
    >
      {justReconnected ? (
        <>
          <CheckCircle size={13} />
          <span>Back online{queueDepth > 0 ? ` — syncing ${queueDepth} queued items` : " — all synced"}</span>
        </>
      ) : isOnline && queueDepth > 0 ? (
        <>
          <RefreshCw size={13} className={syncing ? "animate-spin" : ""} />
          <span>{queueDepth} item{queueDepth !== 1 ? "s" : ""} pending sync</span>
          <button
            onClick={handleRetry}
            className="ml-2 underline underline-offset-2 hover:no-underline"
          >
            Sync now
          </button>
        </>
      ) : (
        <>
          <WifiOff size={13} />
          <span>You are offline — changes will sync when connection is restored</span>
          {queueDepth > 0 && (
            <span className="ml-1 opacity-80">({queueDepth} queued)</span>
          )}
        </>
      )}
    </div>
  );
}

// ─── Minimal IndexedDB helpers ────────────────────────────────────────────────
function openQueueDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("offline-queue", 1);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("queue")) {
        db.createObjectStore("queue", { keyPath: "id", autoIncrement: true });
      }
    };
  });
}

function countQueueItems(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction("queue", "readonly");
    const store = tx.objectStore("queue");
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export default OfflineIndicator;
