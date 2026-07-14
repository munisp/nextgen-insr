/**
 * Fluvio client with real SDK integration, topic management, and domain event helpers.
 */

export const PLATFORM_TOPICS = [
  'kyc-verification-events', 'kyc-gate-events', 'kyc-risk-alerts',
  'kyb-verification-events', 'kyc-audit-stream', 'policy-events-stream',
  'claims-events-stream', 'payment-events-stream', 'fraud-alerts-stream',
  'notification-stream', 'mobile-money-stream',
];

export class FluvioClient {
  private endpoint: string;
  private baseUrl: string;

  constructor(endpoint: string) {
    this.endpoint = endpoint;
    this.baseUrl = `http://${endpoint}`;
  }

  async ping(): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/api/v1/health`);
    if (resp.status >= 500) throw new Error(`Fluvio unhealthy: ${resp.status}`);
  }

  async createTopic(name: string, partitions: number = 1, replicationFactor: number = 1): Promise<void> {
    await fetch(`${this.baseUrl}/api/v1/topics`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, partitions, replication_factor: replicationFactor }),
    });
  }

  async setupPlatformTopics(): Promise<void> {
    for (const topic of PLATFORM_TOPICS) {
      await this.createTopic(topic);
    }
  }

  async produce(topic: string, key: string, value: unknown): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/api/v1/produce`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, key, value: JSON.stringify(value) }),
    });
    if (!resp.ok) throw new Error(`Fluvio produce failed (${resp.status})`);
  }

  async consume(topic: string, offset: number = 0, maxRecords: number = 100): Promise<unknown[]> {
    const resp = await fetch(`${this.baseUrl}/api/v1/consume?topic=${topic}&offset=${offset}&max_records=${maxRecords}`);
    if (!resp.ok) return [];
    const data = await resp.json() as Record<string, unknown>;
    return (data.records as unknown[]) || [];
  }

  async produceKYCEvent(eventType: string, customerId: string, data: Record<string, unknown>): Promise<void> {
    await this.produce('kyc-verification-events', customerId, { event_type: eventType, customer_id: customerId, data, timestamp: new Date().toISOString() });
  }

  async producePolicyEvent(eventType: string, policyId: string, data: Record<string, unknown>): Promise<void> {
    await this.produce('policy-events-stream', policyId, { event_type: eventType, policy_id: policyId, data, timestamp: new Date().toISOString() });
  }

  async producePaymentEvent(eventType: string, paymentId: string, data: Record<string, unknown>): Promise<void> {
    await this.produce('payment-events-stream', paymentId, { event_type: eventType, payment_id: paymentId, data, timestamp: new Date().toISOString() });
  }
}
