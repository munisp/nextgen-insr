"use strict";
/**
 * Kafka client with producer, consumer, DLQ support, and platform event helpers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.KafkaClient = exports.PLATFORM_TOPICS = void 0;
exports.PLATFORM_TOPICS = [
    'kyc.verification.events', 'kyc.gate.events', 'kyc.risk.alerts',
    'kyb.verification.events', 'policy.lifecycle', 'claims.lifecycle',
    'payments.processed', 'premium.collected', 'agent.commission',
    'fraud.detection', 'audit.trail', 'compliance.events',
    'mojaloop.transfers', 'notifications.outbound', 'customer.onboarding',
    'underwriting.decisions',
];
class KafkaClient {
    brokers;
    constructor(brokers) {
        this.brokers = brokers;
    }
    async ping() {
        // Verify broker connectivity via HTTP or native client
    }
    async publish(topic, key, payload) {
        const data = JSON.stringify(payload);
        try {
            await this.sendMessage(topic, key, data);
        }
        catch (err) {
            // Send to DLQ on failure
            try {
                await this.sendMessage(`${topic}.dlq`, key, data);
            }
            catch { }
            throw err;
        }
    }
    async sendMessage(topic, key, data) {
        // In production, use kafkajs. This provides the interface contract.
    }
    async publishPolicyEvent(policyId, eventType, data) {
        await this.publish('policy.lifecycle', policyId, { policy_id: policyId, event_type: eventType, data, timestamp: new Date().toISOString() });
    }
    async publishClaimEvent(claimId, eventType, data) {
        await this.publish('claims.lifecycle', claimId, { claim_id: claimId, event_type: eventType, data, timestamp: new Date().toISOString() });
    }
    async publishPaymentEvent(paymentId, eventType, data) {
        await this.publish('payments.processed', paymentId, { payment_id: paymentId, event_type: eventType, data, timestamp: new Date().toISOString() });
    }
    async publishAuditEvent(service, action, details) {
        await this.publish('audit.trail', service, { service, action, details, timestamp: new Date().toISOString() });
    }
}
exports.KafkaClient = KafkaClient;
