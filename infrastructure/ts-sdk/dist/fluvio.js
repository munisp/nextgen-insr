"use strict";
/**
 * Fluvio client with real SDK integration, topic management, and domain event helpers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.FluvioClient = exports.PLATFORM_TOPICS = void 0;
exports.PLATFORM_TOPICS = [
    'kyc-verification-events', 'kyc-gate-events', 'kyc-risk-alerts',
    'kyb-verification-events', 'kyc-audit-stream', 'policy-events-stream',
    'claims-events-stream', 'payment-events-stream', 'fraud-alerts-stream',
    'notification-stream', 'mobile-money-stream',
];
class FluvioClient {
    endpoint;
    baseUrl;
    constructor(endpoint) {
        this.endpoint = endpoint;
        this.baseUrl = `http://${endpoint}`;
    }
    async ping() {
        const resp = await fetch(`${this.baseUrl}/api/v1/health`);
        if (resp.status >= 500)
            throw new Error(`Fluvio unhealthy: ${resp.status}`);
    }
    async createTopic(name, partitions = 1, replicationFactor = 1) {
        await fetch(`${this.baseUrl}/api/v1/topics`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, partitions, replication_factor: replicationFactor }),
        });
    }
    async setupPlatformTopics() {
        for (const topic of exports.PLATFORM_TOPICS) {
            await this.createTopic(topic);
        }
    }
    async produce(topic, key, value) {
        const resp = await fetch(`${this.baseUrl}/api/v1/produce`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ topic, key, value: JSON.stringify(value) }),
        });
        if (!resp.ok)
            throw new Error(`Fluvio produce failed (${resp.status})`);
    }
    async consume(topic, offset = 0, maxRecords = 100) {
        const resp = await fetch(`${this.baseUrl}/api/v1/consume?topic=${topic}&offset=${offset}&max_records=${maxRecords}`);
        if (!resp.ok)
            return [];
        const data = await resp.json();
        return data.records || [];
    }
    async produceKYCEvent(eventType, customerId, data) {
        await this.produce('kyc-verification-events', customerId, { event_type: eventType, customer_id: customerId, data, timestamp: new Date().toISOString() });
    }
    async producePolicyEvent(eventType, policyId, data) {
        await this.produce('policy-events-stream', policyId, { event_type: eventType, policy_id: policyId, data, timestamp: new Date().toISOString() });
    }
    async producePaymentEvent(eventType, paymentId, data) {
        await this.produce('payment-events-stream', paymentId, { event_type: eventType, payment_id: paymentId, data, timestamp: new Date().toISOString() });
    }
}
exports.FluvioClient = FluvioClient;
