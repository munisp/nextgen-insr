// @ts-check

/**
 * Sprint 91 — Middleware Integration Health Verification
 *
 * Verifies connectivity and health of all middleware services:
 * - Kafka (event streaming)
 * - Dapr (sidecar orchestration)
 * - Fluvio (real-time streaming)
 * - Temporal (workflow orchestration)
 * - Keycloak (identity management)
 * - Permify (fine-grained authorization)
 * - Redis (caching & pub/sub)
 * - Mojaloop (interoperability layer)
 * - OpenSearch (analytics & search)
 * - APISIX (API gateway)
 * - TigerBeetle (financial ledger)
 * - Lakehouse (data warehouse)
 */

export interface ServiceHealth {
  name: string;
  status: "healthy" | "degraded" | "unhealthy" | "not_configured";
  latencyMs: number;
  lastChecked: number;
  version?: string;
  details?: string;
  endpoint?: string;
}

export interface PlatformHealth {
  overall: "healthy" | "degraded" | "critical";
  services: ServiceHealth[];
  timestamp: number;
  uptime: number;
}

const startTime = Date.now();

async function checkTCP(
  host: string,
  port: number,
  timeoutMs: number = 3000
): Promise<{ reachable: boolean; latencyMs: number }> {
  const start = Date.now();
  try {
    const { createConnection } = await import("net");
    return new Promise(resolve => {
      const socket = createConnection(
        { host, port, timeout: timeoutMs },
        () => {
          socket.destroy();
          resolve({ reachable: true, latencyMs: Date.now() - start });
        }
      );
      socket.on("error", () => {
        socket.destroy();
        resolve({ reachable: false, latencyMs: Date.now() - start });
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ reachable: false, latencyMs: timeoutMs });
      });
    });
  } catch {
    return { reachable: false, latencyMs: Date.now() - start };
  }
}

async function checkHTTP(
  url: string,
  timeoutMs: number = 5000
): Promise<{ reachable: boolean; latencyMs: number; status?: number }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return {
      reachable: res.ok || res.status < 500,
      latencyMs: Date.now() - start,
      status: res.status,
    };
  } catch {
    return { reachable: false, latencyMs: Date.now() - start };
  }
}

// ─── Individual Service Checks ───────────────────────────────────────────────

async function checkKafka(): Promise<ServiceHealth> {
  const host = process.env.KAFKA_BROKER_HOST ?? "localhost";
  const port = parseInt(process.env.KAFKA_BROKER_PORT ?? "9092");
  const { reachable, latencyMs } = await checkTCP(host, port);
  return {
    name: "Kafka",
    status: reachable
      ? "healthy"
      : process.env.KAFKA_BROKER_HOST
        ? "unhealthy"
        : "not_configured",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: `${host}:${port}`,
    details: reachable ? "Broker reachable" : "Connection refused",
  };
}

async function checkDapr(): Promise<ServiceHealth> {
  const port = process.env.DAPR_HTTP_PORT ?? "3500";
  const url = `http://localhost:${port}/v1.0/healthz`;
  const { reachable, latencyMs } = await checkHTTP(url);
  return {
    name: "Dapr",
    status: reachable
      ? "healthy"
      : process.env.DAPR_HTTP_PORT
        ? "unhealthy"
        : "not_configured",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: url,
    details: reachable ? "Sidecar healthy" : "Sidecar not running",
  };
}

async function checkFluvio(): Promise<ServiceHealth> {
  const host = process.env.FLUVIO_HOST ?? "localhost";
  const port = parseInt(process.env.FLUVIO_PORT ?? "9003");
  const { reachable, latencyMs } = await checkTCP(host, port);
  return {
    name: "Fluvio",
    status: reachable
      ? "healthy"
      : process.env.FLUVIO_HOST
        ? "unhealthy"
        : "not_configured",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: `${host}:${port}`,
    details: reachable ? "SPU cluster reachable" : "Cluster not available",
  };
}

async function checkTemporal(): Promise<ServiceHealth> {
  const host = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
  const [h, p] = host.split(":");
  const { reachable, latencyMs } = await checkTCP(h, parseInt(p ?? "7233"));
  return {
    name: "Temporal",
    status: reachable
      ? "healthy"
      : process.env.TEMPORAL_ADDRESS
        ? "unhealthy"
        : "not_configured",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: host,
    details: reachable ? "Frontend service reachable" : "Server not available",
  };
}

async function checkKeycloak(): Promise<ServiceHealth> {
  const url = process.env.KEYCLOAK_URL ?? process.env.OAUTH_SERVER_URL;
  if (!url)
    return {
      name: "Keycloak",
      status: "not_configured",
      latencyMs: 0,
      lastChecked: Date.now(),
    };
  const healthUrl = `${url}/health/ready`;
  const { reachable, latencyMs } = await checkHTTP(healthUrl);
  return {
    name: "Keycloak",
    status: reachable ? "healthy" : "degraded",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: url,
    details: reachable ? "Realm ready" : "Health check failed (may still work)",
  };
}

async function checkPermify(): Promise<ServiceHealth> {
  const host = process.env.PERMIFY_HOST ?? "localhost";
  const port = parseInt(process.env.PERMIFY_PORT ?? "3476");
  const { reachable, latencyMs } = await checkTCP(host, port);
  return {
    name: "Permify",
    status: reachable
      ? "healthy"
      : process.env.PERMIFY_HOST
        ? "unhealthy"
        : "not_configured",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: `${host}:${port}`,
    details: reachable ? "Authorization engine reachable" : "Not available",
  };
}

async function checkRedis(): Promise<ServiceHealth> {
  const host = process.env.REDIS_HOST ?? "localhost";
  const port = parseInt(process.env.REDIS_PORT ?? "6379");
  const { reachable, latencyMs } = await checkTCP(host, port);
  return {
    name: "Redis",
    status: reachable
      ? "healthy"
      : process.env.REDIS_HOST
        ? "unhealthy"
        : "not_configured",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: `${host}:${port}`,
    details: reachable ? "Cache layer reachable" : "Not available",
  };
}

async function checkMojaloop(): Promise<ServiceHealth> {
  const url = process.env.MOJALOOP_HUB_URL;
  if (!url)
    return {
      name: "Mojaloop",
      status: "not_configured",
      latencyMs: 0,
      lastChecked: Date.now(),
    };
  const { reachable, latencyMs } = await checkHTTP(`${url}/health`);
  return {
    name: "Mojaloop",
    status: reachable ? "healthy" : "unhealthy",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: url,
    details: reachable ? "Hub operational" : "Hub unreachable",
  };
}

async function checkOpenSearch(): Promise<ServiceHealth> {
  const url = process.env.OPENSEARCH_URL ?? "http://localhost:9200";
  const { reachable, latencyMs } = await checkHTTP(`${url}/_cluster/health`);
  return {
    name: "OpenSearch",
    status: reachable
      ? "healthy"
      : process.env.OPENSEARCH_URL
        ? "unhealthy"
        : "not_configured",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: url,
    details: reachable ? "Cluster green/yellow" : "Cluster unreachable",
  };
}

async function checkAPISIX(): Promise<ServiceHealth> {
  const url = process.env.APISIX_ADMIN_URL ?? "http://localhost:9180";
  const { reachable, latencyMs } = await checkHTTP(
    `${url}/apisix/admin/routes`,
    3000
  );
  return {
    name: "APISIX",
    status: reachable
      ? "healthy"
      : process.env.APISIX_ADMIN_URL
        ? "unhealthy"
        : "not_configured",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: url,
    details: reachable ? "Gateway operational" : "Admin API unreachable",
  };
}

async function checkTigerBeetle(): Promise<ServiceHealth> {
  const host = process.env.TIGERBEETLE_HOST ?? "localhost";
  const port = parseInt(process.env.TIGERBEETLE_PORT ?? "3001");
  const { reachable, latencyMs } = await checkTCP(host, port);
  return {
    name: "TigerBeetle",
    status: reachable
      ? "healthy"
      : process.env.TIGERBEETLE_HOST
        ? "unhealthy"
        : "not_configured",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: `${host}:${port}`,
    details: reachable ? "Financial ledger reachable" : "Ledger not available",
  };
}

async function checkLakehouse(): Promise<ServiceHealth> {
  const url = process.env.LAKEHOUSE_URL ?? process.env.TRINO_URL;
  if (!url)
    return {
      name: "Lakehouse (Trino)",
      status: "not_configured",
      latencyMs: 0,
      lastChecked: Date.now(),
    };
  const { reachable, latencyMs } = await checkHTTP(`${url}/v1/info`);
  return {
    name: "Lakehouse (Trino)",
    status: reachable ? "healthy" : "unhealthy",
    latencyMs,
    lastChecked: Date.now(),
    endpoint: url,
    details: reachable ? "Query engine ready" : "Engine unreachable",
  };
}

// ─── Aggregate Health Check ──────────────────────────────────────────────────

export async function checkAllServices(): Promise<PlatformHealth> {
  const checks = await Promise.allSettled([
    checkKafka(),
    checkDapr(),
    checkFluvio(),
    checkTemporal(),
    checkKeycloak(),
    checkPermify(),
    checkRedis(),
    checkMojaloop(),
    checkOpenSearch(),
    checkAPISIX(),
    checkTigerBeetle(),
    checkLakehouse(),
  ]);

  const services: ServiceHealth[] = checks.map((result, i) => {
    if (result.status === "fulfilled") return result.value;
    const names = [
      "Kafka",
      "Dapr",
      "Fluvio",
      "Temporal",
      "Keycloak",
      "Permify",
      "Redis",
      "Mojaloop",
      "OpenSearch",
      "APISIX",
      "TigerBeetle",
      "Lakehouse",
    ];
    return {
      name: names[i],
      status: "unhealthy" as const,
      latencyMs: 0,
      lastChecked: Date.now(),
      details: "Check failed",
    };
  });

  // Determine overall health
  const configured = services.filter(s => s.status !== "not_configured");
  const unhealthy = configured.filter(s => s.status === "unhealthy");
  const degraded = configured.filter(s => s.status === "degraded");

  let overall: "healthy" | "degraded" | "critical" = "healthy";
  if (unhealthy.length > configured.length / 2) overall = "critical";
  else if (unhealthy.length > 0 || degraded.length > 0) overall = "degraded";

  return {
    overall,
    services,
    timestamp: Date.now(),
    uptime: Date.now() - startTime,
  };
}
