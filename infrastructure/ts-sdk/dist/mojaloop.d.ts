/**
 * Mojaloop client with KYC-gated transfers, idempotency, and mobile money.
 */
export declare class MojaloopClient {
    private baseUrl;
    private fspId;
    constructor(baseUrl: string, fspId?: string);
    ping(): Promise<void>;
    private fspiopHeaders;
    lookupParticipant(idType: string, idValue: string): Promise<string>;
    executeTransfer(transferId: string, payerFsp: string, payeeFsp: string, amount: string, currency: string, kycLevel: number, idempotencyKey?: string): Promise<Record<string, unknown>>;
    collectPremiumViaMobileMoney(customerPhone: string, amount: string, currency: string, kycLevel: number, policyId: string): Promise<Record<string, unknown>>;
    payoutClaim(customerPhone: string, amount: string, currency: string, claimId: string): Promise<Record<string, unknown>>;
}
