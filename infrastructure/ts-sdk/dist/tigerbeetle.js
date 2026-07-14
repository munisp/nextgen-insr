"use strict";
/**
 * TigerBeetle client with KYC-level transfer limits, batch support, and ledger codes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TigerBeetleClient = exports.LEDGER = void 0;
const KYC_TRANSFER_LIMITS = {
    0: 500_000, // Level 0: NGN 5,000 (kobo)
    1: 5_000_000, // Level 1: NGN 50,000
    2: 50_000_000, // Level 2: NGN 500,000
    3: 1_000_000_000, // Level 3: NGN 10,000,000
};
exports.LEDGER = { PREMIUM: 1, CLAIMS: 2, COMMISSION: 3, PAYOUT: 4, RESERVE: 5, MOBILE_MONEY: 6 };
class TigerBeetleClient {
    baseUrl;
    constructor(addr) {
        this.baseUrl = `http://${addr}`;
    }
    async ping() {
        const resp = await fetch(`${this.baseUrl}/health`);
        if (!resp.ok)
            throw new Error(`TigerBeetle unhealthy: ${resp.status}`);
    }
    async createAccount(id, ledger = 1, code = 1) {
        await this.post('/accounts/create', { id, ledger, code, flags: 0 });
    }
    async getBalance(accountId) {
        const resp = await fetch(`${this.baseUrl}/accounts/${accountId}`);
        return await resp.json();
    }
    async createTransfer(id, debitAccount, creditAccount, amount, ledger = 1, code = 1, userData = '') {
        await this.post('/transfers/create', { id, debit_account_id: debitAccount, credit_account_id: creditAccount, amount, ledger, code, user_data_128: userData });
    }
    async createBatchTransfers(transfers) {
        await this.post('/transfers/create_batch', transfers);
    }
    validateKYCLimit(kycLevel, amount) {
        const limit = KYC_TRANSFER_LIMITS[kycLevel];
        if (limit === undefined)
            throw new Error(`Unknown KYC level: ${kycLevel}`);
        if (amount > limit)
            throw new Error(`Amount ${amount} exceeds KYC level ${kycLevel} limit of ${limit}`);
    }
    async createPremiumTransfer(customerAcct, reserveAcct, amount, kycLevel, policyId) {
        this.validateKYCLimit(kycLevel, amount);
        await this.createTransfer(`prem-${policyId}-${Date.now()}`, customerAcct, reserveAcct, amount, exports.LEDGER.PREMIUM, 1, policyId);
    }
    async createClaimPayout(reserveAcct, customerAcct, amount, claimId) {
        await this.createTransfer(`claim-${claimId}-${Date.now()}`, reserveAcct, customerAcct, amount, exports.LEDGER.CLAIMS, 2, claimId);
    }
    async createCommissionTransfer(companyAcct, agentAcct, amount, agentId) {
        await this.createTransfer(`comm-${agentId}-${Date.now()}`, companyAcct, agentAcct, amount, exports.LEDGER.COMMISSION, 3, agentId);
    }
    async post(path, body) {
        const resp = await fetch(`${this.baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!resp.ok)
            throw new Error(`TigerBeetle ${path} failed (${resp.status}): ${await resp.text()}`);
    }
}
exports.TigerBeetleClient = TigerBeetleClient;
