/**
 * useQRCode — Offline-capable QR code hook for InsurePortal POS Shell
 *
 * Capabilities:
 *  1. Generate QR codes with real qrcode.react canvas (works fully offline)
 *  2. Scan QR codes via device camera using jsQR (works offline — no cloud OCR)
 *  3. Persist generated QR codes in IndexedDB so they survive page reloads
 *  4. Sync IndexedDB-persisted QR codes to the server when connectivity is restored
 *  5. Parse InsurePortal QR payload format: 54LINK:{ref}:{amount}:{agentId}
 *
 * Offline strategy:
 *  - QR generation: fully offline — canvas rendering is pure client-side
 *  - QR scanning: fully offline — jsQR decodes from camera frame in browser
 *  - QR persistence: IndexedDB (survives page reload, no network required)
 *  - QR sync: queued in IndexedDB, flushed when online
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

// ── IndexedDB helpers ─────────────────────────────────────────────────────────

const IDB_NAME = "insureportal-qr-store";
const IDB_VERSION = 1;
const IDB_STORE = "offline_qr_codes";

export interface OfflineQRRecord {
  id: string;
  code: string;
  amount: number;
  agentId: string;
  label: string;
  payload: string; // 54LINK:{ref}:{amount}:{agentId}
  createdAt: string;
  synced: boolean;
}

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        const store = db.createObjectStore(IDB_STORE, { keyPath: "id" });
        store.createIndex("synced", "synced", { unique: false });
        store.createIndex("agentId", "agentId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record: OfflineQRRecord): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function idbGetAll(): Promise<OfflineQRRecord[]> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = () => {
      db.close();
      resolve(req.result as OfflineQRRecord[]);
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

async function idbMarkSynced(id: string): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result as OfflineQRRecord | undefined;
      if (record) {
        store.put({ ...record, synced: true });
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

async function idbDelete(id: string): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(id);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

// ── InsurePortal QR payload format ──────────────────────────────────────────────────

export interface ParsedQRPayload {
  valid: boolean;
  ref?: string;
  amount?: number;
  agentId?: string;
  raw: string;
  /** true if this is a InsurePortal QR; false for external QR (Masterpass, Visa QR, NIBSS, etc.) */
  isInsurePortal: boolean;
  /** For external QR, the raw string is the payment reference */
  externalType?: "NIBSS" | "Masterpass" | "VisaQR" | "NIPQr" | "Unknown";
}

export function parseQRPayload(raw: string): ParsedQRPayload {
  // InsurePortal format: 54LINK:{ref}:{amount}:{agentId}
  if (raw.startsWith("54LINK:")) {
    const parts = raw.split(":");
    if (parts.length >= 4) {
      const amount = parseFloat(parts[2]);
      return {
        valid: !isNaN(amount) && amount > 0,
        ref: parts[1],
        amount,
        agentId: parts[3],
        raw,
        isInsurePortal: true,
      };
    }
    return { valid: false, raw, isInsurePortal: true };
  }

  // NIBSS QR: starts with "NIBSS" or contains NIP
  if (raw.startsWith("NIBSS") || raw.includes("NIP")) {
    return { valid: true, raw, isInsurePortal: false, externalType: "NIBSS" };
  }

  // Masterpass
  if (raw.startsWith("MP:") || raw.includes("masterpass")) {
    return { valid: true, raw, isInsurePortal: false, externalType: "Masterpass" };
  }

  // Visa QR
  if (raw.startsWith("000201") || raw.includes("VISA")) {
    return { valid: true, raw, isInsurePortal: false, externalType: "VisaQR" };
  }

  return { valid: true, raw, isInsurePortal: false, externalType: "Unknown" };
}

export function buildInsurePortalQRPayload(
  ref: string,
  amount: number,
  agentId: string
): string {
  return `54LINK:${ref}:${amount}:${agentId}`;
}

// ── Camera QR scanner ─────────────────────────────────────────────────────────

export interface QRScanResult {
  data: string;
  parsed: ParsedQRPayload;
}

export function useQRScanner(onScan: (result: QRScanResult) => void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cameraAvailable, setCameraAvailable] = useState<boolean | null>(null);

  const stopScanning = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setScanning(false);
  }, []);

  const startScanning = useCallback(async () => {
    setError(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Camera not available in this browser");
      setCameraAvailable(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      setCameraAvailable(true);

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setScanning(true);

        // Dynamically import jsQR to avoid bundle size impact when not scanning
        const { default: jsQR } = await import("jsqr");

        const tick = () => {
          const video = videoRef.current;
          const canvas = canvasRef.current;
          if (
            !video ||
            !canvas ||
            video.readyState !== video.HAVE_ENOUGH_DATA
          ) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            rafRef.current = requestAnimationFrame(tick);
            return;
          }

          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: "dontInvert",
          });

          if (code?.data) {
            stopScanning();
            onScan({ data: code.data, parsed: parseQRPayload(code.data) });
            return;
          }

          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Camera access denied";
      setError(msg);
      setCameraAvailable(false);
      console.error("[QRScanner]", e);
    }
  }, [onScan, stopScanning]);

  // Cleanup on unmount
  useEffect(() => () => stopScanning(), [stopScanning]);

  return {
    videoRef,
    canvasRef,
    scanning,
    error,
    cameraAvailable,
    startScanning,
    stopScanning,
  };
}

// ── Offline QR code generator with IndexedDB persistence ─────────────────────

export function useOfflineQRGenerator(agentId: string) {
  const [offlineQRCodes, setOfflineQRCodes] = useState<OfflineQRRecord[]>([]);
  const [loading, setLoading] = useState(false);

  // Load from IndexedDB on mount
  useEffect(() => {
    idbGetAll()
      .then(records =>
        setOfflineQRCodes(records.filter(r => r.agentId === agentId))
      )
      .catch(e => console.error("[QR IDB] Load failed:", e));
  }, [agentId]);

  const generateOfflineQR = useCallback(
    async (amount: number, label?: string): Promise<OfflineQRRecord> => {
      setLoading(true);
      try {
        const ref = `QR-${agentId}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
        const payload = buildInsurePortalQRPayload(ref, amount, agentId);
        const record: OfflineQRRecord = {
          id: ref,
          code: ref,
          amount,
          agentId,
          label: label ?? `₦${amount.toLocaleString()} QR Code`,
          payload,
          createdAt: new Date().toISOString(),
          synced: false,
        };
        await idbPut(record);
        setOfflineQRCodes(prev => [record, ...prev]);
        return record;
      } finally {
        setLoading(false);
      }
    },
    [agentId]
  );

  const syncToServer = useCallback(
    async (
      serverCreate: (record: OfflineQRRecord) => Promise<void>
    ): Promise<{ synced: number; failed: number }> => {
      const unsynced = offlineQRCodes.filter(r => !r.synced);
      let synced = 0;
      let failed = 0;
      for (const record of unsynced) {
        try {
          await serverCreate(record);
          await idbMarkSynced(record.id);
          setOfflineQRCodes(prev =>
            prev.map(r => (r.id === record.id ? { ...r, synced: true } : r))
          );
          synced++;
        } catch {
          failed++;
        }
      }
      if (synced > 0)
        toast.success(
          `${synced} offline QR code${synced > 1 ? "s" : ""} synced`
        );
      if (failed > 0)
        toast.error(`${failed} QR code${failed > 1 ? "s" : ""} failed to sync`);
      return { synced, failed };
    },
    [offlineQRCodes]
  );

  const deleteOfflineQR = useCallback(async (id: string) => {
    await idbDelete(id);
    setOfflineQRCodes(prev => prev.filter(r => r.id !== id));
  }, []);

  return {
    offlineQRCodes,
    loading,
    generateOfflineQR,
    syncToServer,
    deleteOfflineQR,
    unsyncedCount: offlineQRCodes.filter(r => !r.synced).length,
  };
}
