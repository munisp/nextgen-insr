// @ts-check

/**
 * USSD Transaction Processor Adapter (S88-10)
 * Bridges Node.js to Go ussd-tx-processor for USSD transaction processing
 */
import { ussdTxProcessor, type AdapterResponse } from "./goServiceAdapter";

export interface UssdTransaction {
  id: string;
  sessionId: string;
  type: string;
  amount: number;
  status: "pending" | "processing" | "completed" | "failed";
  phoneNumber: string;
  createdAt: string;
}

export async function processTransaction(
  sessionId: string,
  type: string,
  amount: number,
  phoneNumber: string
): Promise<AdapterResponse<UssdTransaction>> {
  return ussdTxProcessor.post<UssdTransaction>("/process", {
    sessionId,
    type,
    amount,
    phoneNumber,
  });
}

export async function completeTransaction(
  txId: string
): Promise<AdapterResponse<UssdTransaction>> {
  return ussdTxProcessor.post<UssdTransaction>("/complete", { txId });
}

export async function validateTransaction(
  type: string,
  amount: number,
  phoneNumber: string
): Promise<AdapterResponse<{ valid: boolean; errors: string[] }>> {
  return ussdTxProcessor.post<{ valid: boolean; errors: string[] }>(
    "/validate",
    { type, amount, phoneNumber }
  );
}

export async function getTransactionStats(): Promise<
  AdapterResponse<{ total: number; completed: number; failed: number }>
> {
  return ussdTxProcessor.get<{
    total: number;
    completed: number;
    failed: number;
  }>("/stats");
}
