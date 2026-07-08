// @ts-check

/**
 * HTTP Agent Pool — Connection reuse for microservice calls
 *
 * Provides a shared HTTP/HTTPS Agent with keep-alive connections
 * to avoid TCP handshake overhead on repeated microservice calls.
 * Configured for high-throughput scenarios typical of inter-service
 * communication in a microservices architecture.
 */
import http from "http";
import https from "https";

const HTTP_AGENT = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 50, // Per-host concurrent connections
  maxTotalSockets: 200, // Total connections across all hosts
  maxFreeSockets: 10, // Keep idle connections ready
  timeout: 60_000,
  scheduling: "lifo", // Reuse most-recently-used sockets (better for keep-alive)
});

const HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30_000,
  maxSockets: 50,
  maxTotalSockets: 200,
  maxFreeSockets: 10,
  timeout: 60_000,
  scheduling: "lifo",
});

/**
 * Get the appropriate agent for a URL (http or https).
 */
export function getHttpAgent(url: string): http.Agent | https.Agent {
  return url.startsWith("https") ? HTTPS_AGENT : HTTP_AGENT;
}

/**
 * Get pool statistics for monitoring.
 */
export function getAgentStats(): {
  http: { sockets: number; freeSockets: number; requests: number };
  https: { sockets: number; freeSockets: number; requests: number };
} {
  const countEntries = (obj: NodeJS.ReadOnlyDict<unknown[]> | undefined) =>
    obj
      ? Object.values(obj).reduce((sum, arr) => sum + (arr?.length || 0), 0)
      : 0;

  return {
    http: {
      sockets: countEntries(
        (HTTP_AGENT as any).sockets as NodeJS.ReadOnlyDict<unknown[]>
      ),
      freeSockets: countEntries(
        (HTTP_AGENT as any).freeSockets as NodeJS.ReadOnlyDict<unknown[]>
      ),
      requests: countEntries(
        (HTTP_AGENT as any).requests as NodeJS.ReadOnlyDict<unknown[]>
      ),
    },
    https: {
      sockets: countEntries(
        (HTTPS_AGENT as any).sockets as NodeJS.ReadOnlyDict<unknown[]>
      ),
      freeSockets: countEntries(
        (HTTPS_AGENT as any).freeSockets as NodeJS.ReadOnlyDict<unknown[]>
      ),
      requests: countEntries(
        (HTTPS_AGENT as any).requests as NodeJS.ReadOnlyDict<unknown[]>
      ),
    },
  };
}

/**
 * Gracefully close all connections (called during shutdown).
 */
export function destroyAgents(): void {
  HTTP_AGENT.destroy();
  HTTPS_AGENT.destroy();
}
