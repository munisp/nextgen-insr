/**
 * Fluvio client with real SDK integration, topic management, and domain event helpers.
 */
export declare const PLATFORM_TOPICS: string[];
export declare class FluvioClient {
    private endpoint;
    private baseUrl;
    constructor(endpoint: string);
    ping(): Promise<void>;
    createTopic(name: string, partitions?: number, replicationFactor?: number): Promise<void>;
    setupPlatformTopics(): Promise<void>;
    produce(topic: string, key: string, value: unknown): Promise<void>;
    consume(topic: string, offset?: number, maxRecords?: number): Promise<unknown[]>;
    produceKYCEvent(eventType: string, customerId: string, data: Record<string, unknown>): Promise<void>;
    producePolicyEvent(eventType: string, policyId: string, data: Record<string, unknown>): Promise<void>;
    producePaymentEvent(eventType: string, paymentId: string, data: Record<string, unknown>): Promise<void>;
}
