// @ts-check

/**
 * OpenSearch Analytics Adapter (S88-14)
 * Bridges Node.js to Go opensearch-analytics for search and analytics
 */
import { opensearchAnalytics, type AdapterResponse } from "./goServiceAdapter";

export interface SearchQuery {
  index: string;
  query: string;
  filters?: Record<string, unknown>;
  from?: number;
  size?: number;
  sort?: Array<{ field: string; order: "asc" | "desc" }>;
}

export interface SearchResult {
  total: number;
  hits: Array<{ id: string; score: number; source: Record<string, unknown> }>;
  took: number;
  aggregations?: Record<string, unknown>;
}

export interface AggregationQuery {
  index: string;
  aggregations: Record<string, unknown>;
  filters?: Record<string, unknown>;
}

export async function search(
  query: SearchQuery
): Promise<AdapterResponse<SearchResult>> {
  return opensearchAnalytics.post<SearchResult>("/api/v1/search", query);
}

export async function aggregate(
  query: AggregationQuery
): Promise<AdapterResponse<Record<string, unknown>>> {
  return opensearchAnalytics.post<Record<string, unknown>>(
    "/api/v1/aggregate",
    query
  );
}

export async function indexDocument(
  index: string,
  id: string,
  document: Record<string, unknown>
): Promise<AdapterResponse<{ indexed: boolean }>> {
  return opensearchAnalytics.post<{ indexed: boolean }>("/api/v1/index", {
    index,
    id,
    document,
  });
}

export async function bulkIndex(
  index: string,
  documents: Array<{ id: string; body: Record<string, unknown> }>
): Promise<AdapterResponse<{ indexed: number; errors: number }>> {
  return opensearchAnalytics.post<{ indexed: number; errors: number }>(
    "/api/v1/bulk-index",
    { index, documents }
  );
}
