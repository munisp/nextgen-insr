"use strict";
/**
 * OpenSearch client with bulk indexing, ILM, audit trail, and compliance reporting.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenSearchClient = exports.PLATFORM_INDICES = void 0;
exports.PLATFORM_INDICES = [
    'audit-trail', 'kyc-events', 'compliance', 'metrics',
    'policies', 'claims', 'payments', 'fraud-alerts', 'security-events',
];
class OpenSearchClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    async ping() {
        const resp = await fetch(`${this.baseUrl}/_cluster/health`);
        if (!resp.ok)
            throw new Error(`OpenSearch unhealthy: ${resp.status}`);
    }
    async setupPlatformIndices() {
        for (const idx of exports.PLATFORM_INDICES) {
            await this.createIndex(idx);
        }
        await this.createILMPolicy();
    }
    async createIndex(name) {
        await fetch(`${this.baseUrl}/${name}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                settings: { number_of_shards: 1, number_of_replicas: 1 },
                mappings: { properties: { timestamp: { type: 'date' }, service: { type: 'keyword' }, action: { type: 'keyword' }, entity_type: { type: 'keyword' }, entity_id: { type: 'keyword' }, user_id: { type: 'keyword' }, details: { type: 'object', enabled: true }, severity: { type: 'keyword' } } },
            }),
        });
    }
    async createILMPolicy() {
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
    async indexDocument(index, id, doc) {
        await fetch(`${this.baseUrl}/${index}/_doc/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
        });
    }
    async bulkIndex(index, docs) {
        const lines = [];
        for (const { id, doc } of docs) {
            lines.push(JSON.stringify({ index: { _index: index, _id: id } }));
            lines.push(JSON.stringify(doc));
        }
        await fetch(`${this.baseUrl}/_bulk`, {
            method: 'POST', headers: { 'Content-Type': 'application/x-ndjson' }, body: lines.join('\n') + '\n',
        });
    }
    async indexAudit(service, action, entityType, entityId, userId, details) {
        const id = `${service}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await this.indexDocument('audit-trail', id, { timestamp: new Date().toISOString(), service, action, entity_type: entityType, entity_id: entityId, user_id: userId, details });
    }
    async search(index, query, size = 20, from = 0) {
        const resp = await fetch(`${this.baseUrl}/${index}/_search`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query, size, from, sort: [{ timestamp: { order: 'desc' } }] }),
        });
        if (!resp.ok)
            return { hits: { total: { value: 0 }, hits: [] } };
        return resp.json();
    }
    async generateComplianceReport(startDate, endDate) {
        const resp = await fetch(`${this.baseUrl}/compliance/_search`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                query: { range: { timestamp: { gte: startDate, lte: endDate } } }, size: 0,
                aggs: { by_type: { terms: { field: 'action' } }, by_severity: { terms: { field: 'severity' } } },
            }),
        });
        if (!resp.ok)
            return { total: 0, by_type: {}, by_severity: {} };
        return resp.json();
    }
}
exports.OpenSearchClient = OpenSearchClient;
