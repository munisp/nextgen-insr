/**
 * Mojaloop client with KYC-gated transfers, idempotency, and mobile money.
 */

const KYC_TRANSFER_LIMITS: Record<number, number> = { 0: 5000, 1: 50000, 2: 500000, 3: 10000000 };

export class MojaloopClient {
  private baseUrl: string;
  private fspId: string;

  constructor(baseUrl: string, fspId: string = 'ngapp-insurance') {
    this.baseUrl = baseUrl;
    this.fspId = fspId;
  }

  async ping(): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/health`);
    if (resp.status >= 500) throw new Error(`Mojaloop unhealthy: ${resp.status}`);
  }

  private fspiopHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/vnd.interoperability.transfers+json;version=1.1',
      'Accept': 'application/vnd.interoperability.transfers+json;version=1.1',
      'FSPIOP-Source': this.fspId,
    };
  }

  async lookupParticipant(idType: string, idValue: string): Promise<string> {
    const resp = await fetch(`${this.baseUrl}/participants/${idType}/${idValue}`, { headers: this.fspiopHeaders() });
    const data = await resp.json() as Record<string, unknown>;
    return (data.fspId as string) || '';
  }

  async executeTransfer(transferId: string, payerFsp: string, payeeFsp: string, amount: string, currency: string, kycLevel: number, idempotencyKey?: string): Promise<Record<string, unknown>> {
    const limit = KYC_TRANSFER_LIMITS[kycLevel];
    if (limit === undefined) throw new Error(`Invalid KYC level: ${kycLevel}`);
    if (parseFloat(amount) > limit) throw new Error(`Amount ${amount} exceeds KYC level ${kycLevel} limit of ${limit}`);

    const headers: Record<string, string> = { ...this.fspiopHeaders() };
    if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

    const resp = await fetch(`${this.baseUrl}/transfers`, {
      method: 'POST', headers,
      body: JSON.stringify({ transferId, payerFsp, payeeFsp, amount: { amount, currency }, ilpPacket: '', condition: '', expiration: '' }),
    });
    if (!resp.ok) throw new Error(`Transfer failed (${resp.status}): ${await resp.text()}`);
    return resp.json() as Promise<Record<string, unknown>>;
  }

  async collectPremiumViaMobileMoney(customerPhone: string, amount: string, currency: string, kycLevel: number, policyId: string): Promise<Record<string, unknown>> {
    return this.executeTransfer(`prem-${policyId}-${Date.now()}`, 'mobile-money-provider', this.fspId, amount, currency, kycLevel, `prem-${policyId}`);
  }

  async payoutClaim(customerPhone: string, amount: string, currency: string, claimId: string): Promise<Record<string, unknown>> {
    return this.executeTransfer(`payout-${claimId}-${Date.now()}`, this.fspId, 'mobile-money-provider', amount, currency, 3, `payout-${claimId}`);
  }
}
