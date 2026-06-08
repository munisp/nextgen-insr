/**
 * useOfflineSync — Auto-sync hook for InsurePortal
 *
 * Drains two queues on reconnect:
 *   1. Zustand in-memory offlineQueue (current session)
 *   2. Rust offline-queue service (durable SQLite WAL queue — survives page reloads)
 *
 * Dead-letter guarantee: if createTx fails for a dequeued Rust item, the item is
 * re-enqueued via trpc.resilience.enqueueOffline before the drain loop stops.
 */

import { useEffect, useRef, useCallback } from "react";
import { usePosStore } from "../store/posStore";
import { trpc } from "../lib/trpc";
import { toast } from "sonner";

export function useOfflineSync() {
  const { isOnline, offlineQueue, dequeueOfflineTx } = usePosStore();
  const createTx = trpc.transactions.create.useMutation();
  const dequeue = trpc.resilience.dequeueOffline.useMutation();
  const requeue = trpc.resilience.enqueueOffline.useMutation();
  const utils = trpc.useUtils();

  const isSyncing = useRef(false);
  const wasOffline = useRef(!navigator.onLine);
  // Track previous Zustand isOnline value to detect POS-level reconnect
  const prevIsOnline = useRef(isOnline);

  // ── Sync Zustand in-memory queue ──────────────────────────────────────────
  const syncZustandQueue = useCallback(async () => {
    if (!isOnline || offlineQueue.length === 0) return;
    console.log(
      `[OfflineSync] Syncing ${offlineQueue.length} in-memory queued transactions...`
    );

    for (const tx of offlineQueue) {
      try {
        await createTx.mutateAsync({
          type: tx.type as any,
          amount: tx.amount,
          customerPhone: tx.customerPhone,
          customerName: tx.customerName,
          destinationBank: tx.destinationBank,
          destinationAccount: tx.destinationAccount,
          metadata: { offlineId: tx.id, queuedAt: tx.createdAt },
        });
        dequeueOfflineTx(tx.id);
        toast.success(
          `Offline transaction synced: ₦${tx.amount.toLocaleString()} ${tx.type}`
        );
      } catch (err) {
        console.error(`[OfflineSync] Failed to sync ${tx.id}:`, err);
      }
    }
  }, [isOnline, offlineQueue, createTx, dequeueOfflineTx]);

  // ── Sync Rust durable queue ───────────────────────────────────────────────
  const syncRustQueue = useCallback(async () => {
    if (isSyncing.current) return;
    isSyncing.current = true;

    let synced = 0;
    let failed = 0;

    try {
      // Drain up to 50 items per reconnect cycle
      for (let i = 0; i < 50; i++) {
        let item: {
          id: string;
          tx_type: string;
          amount: number;
          customer_name?: string;
          customer_phone?: string;
          channel?: string;
        } | null = null;

        try {
          const result = await dequeue.mutateAsync({});
          item = (result as any)?.item ?? null;
        } catch {
          break; // Queue empty or service unavailable
        }

        if (!item) break;

        try {
          await createTx.mutateAsync({
            type: item.tx_type as any,
            amount: item.amount,
            customerName: item.customer_name ?? "Offline Customer",
            customerPhone: item.customer_phone,
            channel: (item.channel as any) ?? "Offline",
            metadata: { rustQueueId: item.id, source: "rust-offline-queue" },
          });
          synced++;
        } catch (createErr) {
          // Dead-letter guarantee: re-enqueue via typed tRPC mutation so the item is not lost
          failed++;
          console.error(
            `[OfflineSync] createTx failed for rustQueueId=${item.id}, re-enqueueing:`,
            createErr
          );
          try {
            await requeue.mutateAsync({
              txType: item.tx_type,
              amount: item.amount,
              customerName: item.customer_name ?? "Offline Customer",
              customerPhone: item.customer_phone ?? "",
              channel: item.channel ?? "Offline",
            });
            console.log(
              `[OfflineSync] Re-enqueued ${item.id} to Rust queue after createTx failure`
            );
          } catch (requeueErr) {
            console.error(
              `[OfflineSync] Re-enqueue also failed for ${item.id}:`,
              requeueErr
            );
          }
          break; // Stop draining — backend is rejecting; avoid data-loss loop
        }
      }
    } finally {
      isSyncing.current = false;
    }

    if (synced > 0 || failed > 0) {
      await utils.transactions.list.invalidate();
      await utils.resilience.queueCount.invalidate();

      if (synced > 0 && failed === 0) {
        toast.success(
          `${synced} offline transaction${synced > 1 ? "s" : ""} synced from durable queue`
        );
      } else if (synced > 0 && failed > 0) {
        toast.warning(
          `${synced} synced, ${failed} failed — items re-enqueued for next retry`
        );
      } else if (failed > 0) {
        toast.error(
          `${failed} offline transaction${failed > 1 ? "s" : ""} failed — re-enqueued for retry`
        );
      }
    }
  }, [dequeue, requeue, createTx, utils]);

  // ── Sync Zustand queue when isOnline flips ────────────────────────────────
  useEffect(() => {
    if (isOnline && offlineQueue.length > 0) {
      const timer = setTimeout(syncZustandQueue, 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, offlineQueue.length, syncZustandQueue]);

  // ── Sync Rust queue on browser online event ───────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      if (wasOffline.current) {
        wasOffline.current = false;
        toast.info("Connection restored — syncing offline transactions…");
        setTimeout(() => syncRustQueue(), 1500);
      }
    };

    const handleOffline = () => {
      wasOffline.current = true;
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncRustQueue]);

  // ── Sync on Zustand isOnline transition (POS-level probe reconnect) ───────
  // This catches cases where the browser stays "online" but the POS probe
  // detects the backend is reachable again after a network hiccup.
  useEffect(() => {
    const wasOfflinePrev = !prevIsOnline.current;
    const isNowOnline = isOnline;
    prevIsOnline.current = isOnline;

    if (wasOfflinePrev && isNowOnline) {
      // POS-level reconnect detected — drain both queues
      console.log(
        "[OfflineSync] POS probe reconnect detected — triggering auto-sync"
      );
      toast.info("POS reconnected — syncing queued transactions…");
      const timer = setTimeout(async () => {
        await syncZustandQueue();
        await syncRustQueue();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isOnline, syncZustandQueue, syncRustQueue]);

  return { pendingCount: offlineQueue.length, syncZustandQueue, syncRustQueue };
}
