// @ts-check

/**
 * Fluvio Streaming Adapter (S88-16b)
 * Bridges Node.js to Go fluvio-streaming for event streaming
 */
import { fluvioStreaming, type AdapterResponse } from "./goServiceAdapter";

export interface StreamTopic {
  name: string;
  partitions: number;
  replicationFactor: number;
  retentionMs: number;
}

export interface StreamMessage {
  topic: string;
  key: string;
  value: unknown;
  timestamp: string;
  partition: number;
  offset: number;
}

export async function createTopic(
  topic: StreamTopic
): Promise<AdapterResponse<StreamTopic>> {
  return fluvioStreaming.post<StreamTopic>("/api/v1/topics", topic);
}

export async function produce(
  topic: string,
  key: string,
  value: unknown
): Promise<AdapterResponse<{ offset: number }>> {
  return fluvioStreaming.post<{ offset: number }>("/api/v1/produce", {
    topic,
    key,
    value,
  });
}

export async function batchProduce(
  topic: string,
  messages: Array<{ key: string; value: unknown }>
): Promise<AdapterResponse<{ count: number }>> {
  return fluvioStreaming.post<{ count: number }>("/api/v1/batch-produce", {
    topic,
    messages,
  });
}

export async function consume(
  topic: string,
  offset?: number,
  limit?: number
): Promise<AdapterResponse<StreamMessage[]>> {
  const params: Record<string, string> = {};
  if (offset !== undefined) params.offset = String(offset);
  if (limit !== undefined) params.limit = String(limit);
  return fluvioStreaming.get<StreamMessage[]>(
    `/api/v1/consume/${topic}`,
    Object.keys(params).length ? params : undefined
  );
}

export async function getTopicStats(topic: string): Promise<
  AdapterResponse<{
    messageCount: number;
    sizeBytes: number;
    partitions: number;
  }>
> {
  return fluvioStreaming.get<{
    messageCount: number;
    sizeBytes: number;
    partitions: number;
  }>(`/api/v1/topics/${topic}/stats`);
}
