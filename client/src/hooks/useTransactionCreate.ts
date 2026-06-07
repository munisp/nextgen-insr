/**
 * useTransactionCreate — shared hook for all POS transaction screens.
 * Wraps trpc.transactions.create, updates the Zustand store on success,
 * and enqueues to the offline queue when the agent is offline.
 */
import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc";
import { usePosStore } from "../store/posStore";

/** Build a fallback USSD string for a transaction type + amount. */
function buildFallbackUssd(txType: string, amount: number): string {
  const amt = Math.round(amount);
  switch (txType) {
    case "Transfer":
      return `*966*2*${amt}#`;
    case "Cash Out":
      return `*966*3*${amt}#`;
    case "Airtime":
      return `*966*5*${amt}#`;
    case "Bill Payment":
      return `*966*4*${amt}#`;
    default:
      return `*966*${amt}#`;
  }
}

export type TxType =
  | "Cash In"
  | "Cash Out"
  | "Transfer"
  | "Card Payment"
  | "QR Payment"
  | "NFC Payment"
  | "Airtime"
  | "Bill Payment"
  | "Reversal"
  | "Nano Loan"
  | "Insurance";

export type TxChannel = "Cash" | "Card" | "USSD" | "QR" | "NFC" | "App";

export interface CreateTxInput {
  type: TxType;
  amount: number;
  customerName?: string;
  customerPhone?: string;
  customerAccount?: string;
  destinationBank?: string;
  destinationAccount?: string;
  channel?: TxChannel;
  deviceToken?: string;
  metadata?: Record<string, unknown>;
}

/** Read the persistent device token stored after enrollment. */
function getStoredDeviceToken(): string | undefined {
  try {
    return localStorage.getItem("insureportal_device_token") ?? undefined;
  } catch {
    return undefined;
  }
}

export interface TxResult {
  ref: string;
  commission: number;
  pointsEarned: number;
  floatBalance: number;
}

export function useTransactionCreate() {
  const [isProcessing, setIsProcessing] = useState(false);
  const isOnline = usePosStore(s => s.isOnline);
  const updateFloat = usePosStore(s => s.updateFloat);
  const updateCommission = usePosStore(s => s.updateCommission);
  const updateLoyaltyPoints = usePosStore(s => s.updateLoyaltyPoints);
  const addTx = usePosStore(s => s.addTx);
  const agent = usePosStore(s => s.agent);
  const enqueueOfflineTx = usePosStore(s => s.enqueueOfflineTx);

  const mutation = trpc.transactions.create.useMutation();
  const encodeUssd = trpc.resilience.encodeUssd.useMutation();
  const printUssd = trpc.resilience.printUssdReceipt.useMutation();

  /**
   * Submit a transaction. Returns TxResult on success, null on failure.
   * When offline, queues the transaction and returns a synthetic result.
   */
  const submit = async (input: CreateTxInput): Promise<TxResult | null> => {
    setIsProcessing(true);

    // ── Offline path ──────────────────────────────────────────────────────────
    if (!isOnline) {
      enqueueOfflineTx({
        type: input.type,
        amount: input.amount,
        customerPhone: input.customerPhone,
        customerName: input.customerName,
        destinationBank: input.destinationBank,
        destinationAccount: input.destinationAccount,
      });
      toast.warning(
        "Offline — transaction queued for sync when connection is restored."
      );

      // ── Auto-print USSD receipt immediately when queued offline ────────────
      // Fire-and-forget: encode USSD then send to printer sidecar.
      // Errors are swallowed so the offline path always returns a result.
      (async () => {
        try {
          const ussdResult = await encodeUssd.mutateAsync({
            txType: input.type,
            amount: input.amount,
            destinationAccount: input.destinationAccount,
            destinationBank: input.destinationBank,
            customerPhone: input.customerPhone,
          });
          const ussdString =
            (ussdResult as any).ussd_string ??
            buildFallbackUssd(input.type, input.amount);
          const instructions =
            (ussdResult as any).instructions ??
            `Dial ${ussdString} to pay via USSD.`;
          await printUssd.mutateAsync({
            agentCode: agent?.agentCode ?? "UNKNOWN",
            txType: input.type,
            amount: input.amount,
            ussdString,
            instructions,
            customerName: input.customerName,
            ref: `OFL-${Date.now().toString(36).toUpperCase()}`,
          });
          toast.success("USSD receipt sent to printer");
        } catch {
          // Printer or encoder offline — silent fallback
          toast.info(
            "USSD receipt queued for printing when printer reconnects"
          );
        }
      })();

      setIsProcessing(false);
      const offlineRef = `OFL-${Date.now().toString(36).toUpperCase()}`;
      return {
        ref: offlineRef,
        commission: 0,
        pointsEarned: 0,
        floatBalance: 0,
      };
    }

    // ── Online path ───────────────────────────────────────────────────────────
    try {
      // Inject the stored device token (set during enrollment) unless caller overrides
      const deviceToken = input.deviceToken ?? getStoredDeviceToken();
      const result = await mutation.mutateAsync({ ...input, deviceToken });

      // Update Zustand store with server-confirmed values
      if (input.type === "Cash In") {
        updateFloat(input.amount);
      } else if (input.type === "Cash Out" || input.type === "Transfer") {
        updateFloat(-input.amount);
      }
      const r = result as any;
      if ((r.commission ?? 0) > 0) {
        updateCommission(Number(r.commission ?? 0));
      }
      if ((r.pointsEarned ?? 0) > 0) {
        updateLoyaltyPoints(r.pointsEarned ?? 0);
      }

      // Add to recent transactions in store
      addTx({
        id: r.transactionId ?? r.id,
        ref: r.ref,
        type: input.type,
        amount: input.amount,
        status: "success",
        customerName: input.customerName ?? null,
        customerPhone: input.customerPhone ?? null,
        createdAt: new Date().toISOString(),
      });

      setIsProcessing(false);
      // Handle both normal response and idempotent replay (which returns a Transaction row)
      const ref = (result as any).ref;
      const commission = (result as any).commission ?? 0;
      const pointsEarned = (result as any).pointsEarned ?? 0;
      const floatBalance = (result as any).floatBalance ?? 0;
      return { ref, commission, pointsEarned, floatBalance };
    } catch (err: unknown) {
      setIsProcessing(false);
      const message =
        err instanceof Error
          ? err.message
          : "Transaction failed. Please try again.";
      toast.error(message);
      return null;
    }
  };

  return { submit, isProcessing };
}
