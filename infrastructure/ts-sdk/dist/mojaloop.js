"use strict";
/**
 * Mojaloop client with KYC-gated transfers, idempotency, and mobile money.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MojaloopClient = void 0;
const KYC_TRANSFER_LIMITS = { 0: 5000, 1: 50000, 2: 500000, 3: 10000000 };
class MojaloopClient {
    baseUrl;
    fspId;
    constructor(baseUrl, fspId = 'ngapp-insurance') {
        this.baseUrl = baseUrl;
        this.fspId = fspId;
    }
    async ping() {
        const resp = await fetch(`${this.baseUrl}/health`);
        if (resp.status >= 500)
            throw new Error(`Mojaloop unhealthy: ${resp.status}`);
    }
    fspiopHeaders() {
        return {
            'Content-Type': 'application/vnd.interoperability.transfers+json;version=1.1',
            'Accept': 'application/vnd.interoperability.transfers+json;version=1.1',
            'FSPIOP-Source': this.fspId,
        };
    }
    async lookupParticipant(idType, idValue) {
        const resp = await fetch(`${this.baseUrl}/participants/${idType}/${idValue}`, { headers: this.fspiopHeaders() });
        const data = await resp.json();
        return data.fspId || '';
    }
    async executeTransfer(transferId, payerFsp, payeeFsp, amount, currency, kycLevel, idempotencyKey) {
        const limit = KYC_TRANSFER_LIMITS[kycLevel];
        if (limit === undefined)
            throw new Error(`Invalid KYC level: ${kycLevel}`);
        if (parseFloat(amount) > limit)
            throw new Error(`Amount ${amount} exceeds KYC level ${kycLevel} limit of ${limit}`);
        const headers = { ...this.fspiopHeaders() };
        if (idempotencyKey)
            headers['X-Idempotency-Key'] = idempotencyKey;
        const resp = await fetch(`${this.baseUrl}/transfers`, {
            method: 'POST', headers,
            body: JSON.stringify({ transferId, payerFsp, payeeFsp, amount: { amount, currency }, ilpPacket: '', condition: '', expiration: '' }),
        });
        if (!resp.ok)
            throw new Error(`Transfer failed (${resp.status}): ${await resp.text()}`);
        return resp.json();
    }
    async collectPremiumViaMobileMoney(customerPhone, amount, currency, kycLevel, policyId) {
        return this.executeTransfer(`prem-${policyId}-${Date.now()}`, 'mobile-money-provider', this.fspId, amount, currency, kycLevel, `prem-${policyId}`);
    }
    async payoutClaim(customerPhone, amount, currency, claimId) {
        return this.executeTransfer(`payout-${claimId}-${Date.now()}`, this.fspId, 'mobile-money-provider', amount, currency, 3, `payout-${claimId}`);
    }
}
exports.MojaloopClient = MojaloopClient;
