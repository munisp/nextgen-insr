// @ts-check

/**
 * Revenue Reconciler Adapter (S88-15)
 * Bridges Node.js to Go revenue-reconciler for revenue reconciliation
 */
import { revenueReconciler, type AdapterResponse } from "./goServiceAdapter";

export interface ReconciliationRequest {
  periodStart: string;
  periodEnd: string;
  agentId?: string;
  includeDetails?: boolean;
}

export interface ReconciliationResult {
  id: string;
  status: "matched" | "discrepancy" | "pending";
  expectedRevenue: number;
  actualRevenue: number;
  variance: number;
  variancePercent: number;
  discrepancies: Array<{ type: string; amount: number; description: string }>;
  reconciled: boolean;
}

export interface ReconciliationReport {
  periodStart: string;
  periodEnd: string;
  totalExpected: number;
  totalActual: number;
  totalVariance: number;
  matchRate: number;
  agentBreakdown: Array<{
    agentId: string;
    expected: number;
    actual: number;
    variance: number;
  }>;
}

export async function reconcile(
  request: ReconciliationRequest
): Promise<AdapterResponse<ReconciliationResult>> {
  return revenueReconciler.post<ReconciliationResult>(
    "/api/v1/reconcile",
    request
  );
}

export async function getDiscrepancies(
  reconciliationId: string
): Promise<
  AdapterResponse<Array<{ type: string; amount: number; description: string }>>
> {
  return revenueReconciler.get<
    Array<{ type: string; amount: number; description: string }>
  >(`/api/v1/reconcile/${reconciliationId}/discrepancies`);
}

export async function generateReport(
  request: ReconciliationRequest
): Promise<AdapterResponse<ReconciliationReport>> {
  return revenueReconciler.post<ReconciliationReport>(
    "/api/v1/report",
    request
  );
}
