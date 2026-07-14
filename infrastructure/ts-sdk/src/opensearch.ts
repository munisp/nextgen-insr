/**
 * OpenSearch client with bulk indexing, ILM, audit trail, and compliance reporting.
 */

export const PLATFORM_INDICES = [
  'audit-trail', 'kyc-events', 'compliance', 'metrics',
  'policies', 'claims', 'payments', 'fraud-alerts', 'security-events',
];

export class OpenSearchClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  async ping(): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/_cluster/health`);
    if (!resp.ok) throw new Error(`OpenSearch unhealthy: ${resp.status}`);
  }

  async setupPlatformIndices(): Promise<void> {
    for (const idx of PLATFORM_INDICES) {
      await this.createIndex(idx);
    }
    await this.createILMPolicy();
  }

  async createIndex(name: string): Promise<void> {
    await fetch(`${this.baseUrl}/${name}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: { number_of_shards: 1, number_of_replicas: 1 },
        mappings: { properties: { timestamp: { type: 'date' }, service: { type: 'keyword' }, action: { type: 'keyword' }, entity_type: { type: 'keyword' }, entity_id: { type: 'keyword' }, user_id: { type: 'keyword' }, details: { type: 'object', enabled: true }, severity: { type: 'keyword' } } },
      }),
    });
  }

  async createILMPolicy(): Promise<void> {
    await fetch(`${this.baseUrl}/_plugins/_ism/policies/ngapp-retention`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        policy: { description: 'NGApp data retention', default_state: 'hot',
          states: [
            { name: 'hot', actions: [], transitions: [{ state_name: 'warm', conditions: { min_index_age: '30d' } }] },
            { name: 'warm', actions: [{ replica_count: { number_of_replicas: 0 } }], transitions: [{ state_name: 'delete', conditions: { min_index_age: '365d' } }] },
            { name: 'delete', actions: [{ delete: {} }], transitions: [] },
          ],
        },
      }),
    });
  }

  async indexDocument(index: string, id: string, doc: Record<string, unknown>): Promise<void> {
    await fetch(`${this.baseUrl}/${index}/_doc/${id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
    });
  }

  async bulkIndex(index: string, docs: Array<{ id: string; doc: Record<string, unknown> }>): Promise<void> {
    const lines: string[] = [];
    for (const { id, doc } of docs) {
      lines.push(JSON.stringify({ index: { _index: index, _id: id } }));
      lines.push(JSON.stringify(doc));
    }
    await fetch(`${this.baseUrl}/_bulk`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-ndjson' }, body: lines.join('\n') + '\n',
    });
  }

  async indexAudit(service: string, action: string, entityType: string, entityId: string, userId: string, details: Record<string, unknown>): Promise<void> {
    const id = `${service}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await this.indexDocument('audit-trail', id, { timestamp: new Date().toISOString(), service, action, entity_type: entityType, entity_id: entityId, user_id: userId, details });
  }

  async search(index: string, query: Record<string, unknown>, size: number = 20, from: number = 0): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.baseUrl}/${index}/_search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, size, from, sort: [{ timestamp: { order: 'desc' } }] }),
    });
    if (!resp.ok) return { hits: { total: { value: 0 }, hits: [] } };
    return resp.json() as Promise<Record<string, unknown>>;
  }

  async generateComplianceReport(startDate: string, endDate: string): Promise<Record<string, unknown>> {
    const resp = await fetch(`${this.baseUrl}/compliance/_search`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: { range: { timestamp: { gte: startDate, lte: endDate } } }, size: 0,
        aggs: { by_type: { terms: { field: 'action' } }, by_severity: { terms: { field: 'severity' } } },
      }),
    });
    if (!resp.ok) return { total: 0, by_type: {}, by_severity: {} };
    return resp.json() as Promise<Record<string, unknown>>;
  }
}
