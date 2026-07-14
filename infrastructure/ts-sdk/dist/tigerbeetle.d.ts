/**
 * TigerBeetle client with KYC-level transfer limits, batch support, and ledger codes.
 */
export declare const LEDGER: {
    readonly PREMIUM: 1;
    readonly CLAIMS: 2;
    readonly COMMISSION: 3;
    readonly PAYOUT: 4;
    readonly RESERVE: 5;
    readonly MOBILE_MONEY: 6;
};
export declare class TigerBeetleClient {
    private baseUrl;
    constructor(addr: string);
    ping(): Promise<void>;
    createAccount(id: string, ledger?: number, code?: number): Promise<void>;
    getBalance(accountId: string): Promise<Record<string, unknown>>;
    createTransfer(id: string, debitAccount: string, creditAccount: string, amount: number, ledger?: number, code?: number, userData?: string): Promise<void>;
    createBatchTransfers(transfers: Array<Record<string, unknown>>): Promise<void>;
    validateKYCLimit(kycLevel: number, amount: number): void;
    createPremiumTransfer(customerAcct: string, reserveAcct: string, amount: number, kycLevel: number, policyId: string): Promise<void>;
    createClaimPayout(reserveAcct: string, customerAcct: string, amount: number, claimId: string): Promise<void>;
    createCommissionTransfer(companyAcct: string, agentAcct: string, amount: number, agentId: string): Promise<void>;
    private post;
}
