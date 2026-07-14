/**
 * Kafka client with producer, consumer, DLQ support, and platform event helpers.
 */
export declare const PLATFORM_TOPICS: string[];
export declare class KafkaClient {
    private brokers;
    constructor(brokers: string[]);
    ping(): Promise<void>;
    publish(topic: string, key: string, payload: unknown): Promise<void>;
    private sendMessage;
    publishPolicyEvent(policyId: string, eventType: string, data: Record<string, unknown>): Promise<void>;
    publishClaimEvent(claimId: string, eventType: string, data: Record<string, unknown>): Promise<void>;
    publishPaymentEvent(paymentId: string, eventType: string, data: Record<string, unknown>): Promise<void>;
    publishAuditEvent(service: string, action: string, details: Record<string, unknown>): Promise<void>;
}
