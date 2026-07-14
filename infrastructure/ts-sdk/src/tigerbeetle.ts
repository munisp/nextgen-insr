/**
 * TigerBeetle client with KYC-level transfer limits, batch support, and ledger codes.
 */

const KYC_TRANSFER_LIMITS: Record<number, number> = {
  0: 500_000,       // Level 0: NGN 5,000 (kobo)
  1: 5_000_000,     // Level 1: NGN 50,000
  2: 50_000_000,    // Level 2: NGN 500,000
  3: 1_000_000_000, // Level 3: NGN 10,000,000
};

export const LEDGER = { PREMIUM: 1, CLAIMS: 2, COMMISSION: 3, PAYOUT: 4, RESERVE: 5, MOBILE_MONEY: 6 } as const;

export class TigerBeetleClient {
  private baseUrl: string;

  constructor(addr: string) {
    this.baseUrl = `http://${addr}`;
  }

  async ping(): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/health`);
    if (!resp.ok) throw new Error(`TigerBeetle unhealthy: ${resp.status}`);
  }

  async createAccount(id: string, ledger: number = 1, code: number = 1): Promise<void> {
    await this.post('/accounts/create', { id, ledger, code, flags: 0 });
  }

  async getBalance(accountId: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.baseUrl}/accounts/${accountId}`);
    return await resp.json() as Record<string, unknown>;
  }

  async createTransfer(id: string, debitAccount: string, creditAccount: string, amount: number, ledger: number = 1, code: number = 1, userData: string = ''): Promise<void> {
    await this.post('/transfers/create', { id, debit_account_id: debitAccount, credit_account_id: creditAccount, amount, ledger, code, user_data_128: userData });
  }

  async createBatchTransfers(transfers: Array<Record<string, unknown>>): Promise<void> {
    await this.post('/transfers/create_batch', transfers);
  }

  validateKYCLimit(kycLevel: number, amount: number): void {
    const limit = KYC_TRANSFER_LIMITS[kycLevel];
    if (limit === undefined) throw new Error(`Unknown KYC level: ${kycLevel}`);
    if (amount > limit) throw new Error(`Amount ${amount} exceeds KYC level ${kycLevel} limit of ${limit}`);
  }

  async createPremiumTransfer(customerAcct: string, reserveAcct: string, amount: number, kycLevel: number, policyId: string): Promise<void> {
    this.validateKYCLimit(kycLevel, amount);
    await this.createTransfer(`prem-${policyId}-${Date.now()}`, customerAcct, reserveAcct, amount, LEDGER.PREMIUM, 1, policyId);
  }

  async createClaimPayout(reserveAcct: string, customerAcct: string, amount: number, claimId: string): Promise<void> {
    await this.createTransfer(`claim-${claimId}-${Date.now()}`, reserveAcct, customerAcct, amount, LEDGER.CLAIMS, 2, claimId);
  }

  async createCommissionTransfer(companyAcct: string, agentAcct: string, amount: number, agentId: string): Promise<void> {
    await this.createTransfer(`comm-${agentId}-${Date.now()}`, companyAcct, agentAcct, amount, LEDGER.COMMISSION, 3, agentId);
  }

  private async post(path: string, body: unknown): Promise<void> {
    const resp = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!resp.ok) throw new Error(`TigerBeetle ${path} failed (${resp.status}): ${await resp.text()}`);
  }
}
