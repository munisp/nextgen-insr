// @ts-check

/**
 * TigerBeetle Integrated Adapter (S88-03)
 * Bridges Node.js to Go tigerbeetle-integrated ledger service
 */
import {
  tigerbeetleIntegrated,
  type AdapterResponse,
} from "./goServiceAdapter";

export interface LedgerAccount {
  id: string;
  debitsPending: number;
  debitsPosted: number;
  creditsPending: number;
  creditsPosted: number;
  userData: string;
  ledger: number;
  code: number;
}

export interface TransferInput {
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  ledger: number;
  code: number;
  userData?: string;
}

export async function createAccount(
  id: string,
  ledger: number,
  code: number
): Promise<AdapterResponse<LedgerAccount>> {
  return tigerbeetleIntegrated.post<LedgerAccount>("/api/v1/accounts", {
    id,
    ledger,
    code,
  });
}

export async function createTransfer(
  input: TransferInput
): Promise<AdapterResponse<{ transferId: string }>> {
  return tigerbeetleIntegrated.post<{ transferId: string }>(
    "/api/v1/transfers",
    input
  );
}

export async function getAccountBalance(
  accountId: string
): Promise<AdapterResponse<LedgerAccount>> {
  return tigerbeetleIntegrated.get<LedgerAccount>(
    `/api/v1/accounts/${accountId}/balance`
  );
}

export async function getStatus(): Promise<
  AdapterResponse<{ version: string; accounts: number; transfers: number }>
> {
  return tigerbeetleIntegrated.get<{
    version: string;
    accounts: number;
    transfers: number;
  }>("/api/v1/status");
}

export async function getMetrics(): Promise<
  AdapterResponse<Record<string, number>>
> {
  return tigerbeetleIntegrated.get<Record<string, number>>("/api/v1/metrics");
}
