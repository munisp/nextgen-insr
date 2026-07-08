// @ts-check

/**
 * Billing Aggregator Adapter (S88-07)
 * Bridges Node.js to Go billing-aggregator for billing period management
 */
import { billingAggregator, type AdapterResponse } from "./goServiceAdapter";

export interface BillingPeriod {
  id: string;
  startDate: string;
  endDate: string;
  status: "open" | "closed" | "invoiced";
  totalRevenue: number;
  totalTransactions: number;
}

export interface BillingModel {
  type: "flat" | "tiered" | "volume" | "per-transaction";
  rates: Record<string, number>;
  effectiveDate: string;
}

export async function getCurrentPeriod(): Promise<
  AdapterResponse<BillingPeriod>
> {
  return billingAggregator.get<BillingPeriod>("/api/v1/billing/current-period");
}

export async function setBillingModel(
  model: BillingModel
): Promise<AdapterResponse<BillingModel>> {
  return billingAggregator.post<BillingModel>("/api/v1/billing/model", model);
}

export async function generateInvoice(
  periodId: string
): Promise<AdapterResponse<{ invoiceId: string; totalAmount: number }>> {
  return billingAggregator.post<{ invoiceId: string; totalAmount: number }>(
    "/api/v1/billing/invoice",
    { periodId }
  );
}

export async function getTransactionEvents(
  limit?: number
): Promise<AdapterResponse<unknown[]>> {
  return billingAggregator.get<unknown[]>(
    "/api/v1/billing/events",
    limit ? { limit: String(limit) } : undefined
  );
}
