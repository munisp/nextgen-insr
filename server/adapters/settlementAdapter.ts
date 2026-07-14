/**
 * Settlement Gateway Adapter (S88-12)
 * Bridges Node.js to Go settlement-gateway for settlement processing
 */
import { settlementGateway, type AdapterResponse } from "./goServiceAdapter";

export interface SettlementRequest {
  agentId: string;
  amount: number;
  bankAccount: string;
  bankCode: string;
  reference?: string;
}

export interface SettlementResult {
  id: string;
  status: "initiated" | "processing" | "completed" | "failed";
  amount: number;
  reference: string;
  processedAt?: string;
}

export interface SettlementBatch {
  batchId: string;
  totalAmount: number;
  count: number;
  status: string;
  createdAt: string;
}

export async function initiateSettlement(
  request: SettlementRequest
): Promise<AdapterResponse<SettlementResult>> {
  return settlementGateway.post<SettlementResult>(
    "/api/v1/settlement/initiate",
    request
  );
}

export async function getSettlementStatus(
  settlementId: string
): Promise<AdapterResponse<SettlementResult>> {
  return settlementGateway.get<SettlementResult>(
    `/api/v1/settlement/${settlementId}/status`
  );
}

export async function createBatch(
  settlements: SettlementRequest[]
): Promise<AdapterResponse<SettlementBatch>> {
  return settlementGateway.post<SettlementBatch>("/api/v1/settlement/batch", {
    settlements,
  });
}

export async function listBatches(
  status?: string
): Promise<AdapterResponse<SettlementBatch[]>> {
  return settlementGateway.get<SettlementBatch[]>(
    "/api/v1/settlement/batches",
    status ? { status } : undefined
  );
}
