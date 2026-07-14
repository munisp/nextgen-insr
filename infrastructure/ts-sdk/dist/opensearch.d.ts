/**
 * OpenSearch client with bulk indexing, ILM, audit trail, and compliance reporting.
 */
export declare const PLATFORM_INDICES: string[];
export declare class OpenSearchClient {
    private baseUrl;
    constructor(baseUrl: string);
    ping(): Promise<void>;
    setupPlatformIndices(): Promise<void>;
    createIndex(name: string): Promise<void>;
    createILMPolicy(): Promise<void>;
    indexDocument(index: string, id: string, doc: Record<string, unknown>): Promise<void>;
    bulkIndex(index: string, docs: Array<{
        id: string;
        doc: Record<string, unknown>;
    }>): Promise<void>;
    indexAudit(service: string, action: string, entityType: string, entityId: string, userId: string, details: Record<string, unknown>): Promise<void>;
    search(index: string, query: Record<string, unknown>, size?: number, from?: number): Promise<Record<string, unknown>>;
    generateComplianceReport(startDate: string, endDate: string): Promise<Record<string, unknown>>;
}
