// @ts-check

/**
 * Connectivity Resilience Adapter (S88-06)
 * Bridges Node.js to Go connectivity-resilience for offline queue management
 */
import {
  connectivityResilience,
  type AdapterResponse,
} from "./goServiceAdapter";

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  avgProcessingMs: number;
}

export interface QueueItem {
  id: string;
  payload: unknown;
  priority: number;
  createdAt: string;
  status: string;
  retries: number;
}

export async function enqueue(
  payload: unknown,
  priority?: number
): Promise<AdapterResponse<{ id: string }>> {
  return connectivityResilience.post<{ id: string }>("/api/enqueue", {
    payload,
    priority: priority || 0,
  });
}

export async function batchEnqueue(
  items: Array<{ payload: unknown; priority?: number }>
): Promise<AdapterResponse<{ ids: string[] }>> {
  return connectivityResilience.post<{ ids: string[] }>("/api/batch-enqueue", {
    items,
  });
}

export async function getQueueStats(): Promise<AdapterResponse<QueueStats>> {
  return connectivityResilience.get<QueueStats>("/api/queue/stats");
}

export async function getPendingItems(
  limit?: number
): Promise<AdapterResponse<QueueItem[]>> {
  return connectivityResilience.get<QueueItem[]>(
    "/api/queue/pending",
    limit ? { limit: String(limit) } : undefined
  );
}

export async function drainQueue(): Promise<
  AdapterResponse<{ drained: number }>
> {
  return connectivityResilience.post<{ drained: number }>("/api/queue/drain");
}
