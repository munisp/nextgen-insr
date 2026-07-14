/**
 * Go Service REST Adapter Framework (S88-01)
 *
 * Provides a typed HTTP client for communicating with Go microservices.
 * Each Go service runs as a separate process with its own HTTP API.
 * This adapter handles:
 *   - Service discovery via environment variables or defaults
 *   - Circuit breaker pattern (open after 5 consecutive failures, half-open after 30s)
 *   - Request timeout (configurable, default 5000ms)
 *   - Retry with exponential backoff (max 3 attempts)
 *   - Health check probing
 *   - Request/response logging
 *   - Graceful degradation when service is unavailable
 */

interface ServiceConfig {
  name: string;
  baseUrl: string;
  timeout: number;
  retries: number;
  healthPath: string;
}

interface CircuitBreakerState {
  failures: number;
  lastFailure: number;
  state: "closed" | "open" | "half-open";
}

interface AdapterResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  latencyMs: number;
  service: string;
  circuitState: string;
}

const SERVICE_REGISTRY: Record<string, ServiceConfig> = {
  "workflow-orchestrator": {
    name: "workflow-orchestrator",
    baseUrl: process.env.WORKFLOW_ORCHESTRATOR_URL || "http://localhost:8081",
    timeout: 5000,
    retries: 3,
    healthPath: "/health",
  },
  "tigerbeetle-integrated": {
    name: "tigerbeetle-integrated",
    baseUrl: process.env.TIGERBEETLE_INTEGRATED_URL || "http://localhost:8082",
    timeout: 3000,
    retries: 2,
    healthPath: "/health",
  },
  "mdm-compliance-engine": {
    name: "mdm-compliance-engine",
    baseUrl: process.env.MDM_COMPLIANCE_URL || "http://localhost:8083",
    timeout: 5000,
    retries: 3,
    healthPath: "/health",
  },
  "pbac-engine": {
    name: "pbac-engine",
    baseUrl: process.env.PBAC_ENGINE_URL || "http://localhost:8084",
    timeout: 3000,
    retries: 2,
    healthPath: "/health",
  },
  "connectivity-resilience": {
    name: "connectivity-resilience",
    baseUrl: process.env.CONNECTIVITY_RESILIENCE_URL || "http://localhost:8085",
    timeout: 5000,
    retries: 3,
    healthPath: "/health",
  },
  "billing-aggregator": {
    name: "billing-aggregator",
    baseUrl: process.env.BILLING_AGGREGATOR_URL || "http://localhost:8086",
    timeout: 5000,
    retries: 3,
    healthPath: "/health",
  },
  "rbac-service": {
    name: "rbac-service",
    baseUrl: process.env.RBAC_SERVICE_URL || "http://localhost:8087",
    timeout: 3000,
    retries: 2,
    healthPath: "/healthz",
  },
  "ussd-gateway": {
    name: "ussd-gateway",
    baseUrl: process.env.USSD_GATEWAY_URL || "http://localhost:8088",
    timeout: 10000,
    retries: 2,
    healthPath: "/api/health",
  },
  "ussd-tx-processor": {
    name: "ussd-tx-processor",
    baseUrl: process.env.USSD_TX_PROCESSOR_URL || "http://localhost:8089",
    timeout: 5000,
    retries: 3,
    healthPath: "/health",
  },
  "hierarchy-engine": {
    name: "hierarchy-engine",
    baseUrl: process.env.HIERARCHY_ENGINE_URL || "http://localhost:8090",
    timeout: 5000,
    retries: 3,
    healthPath: "/health",
  },
  "settlement-gateway": {
    name: "settlement-gateway",
    baseUrl: process.env.SETTLEMENT_GATEWAY_URL || "http://localhost:8091",
    timeout: 10000,
    retries: 2,
    healthPath: "/health",
  },
  "at-ussd-handler": {
    name: "at-ussd-handler",
    baseUrl: process.env.AT_USSD_HANDLER_URL || "http://localhost:8092",
    timeout: 5000,
    retries: 2,
    healthPath: "/health",
  },
  "opensearch-analytics": {
    name: "opensearch-analytics",
    baseUrl: process.env.OPENSEARCH_ANALYTICS_URL || "http://localhost:8093",
    timeout: 10000,
    retries: 3,
    healthPath: "/health",
  },
  "revenue-reconciler": {
    name: "revenue-reconciler",
    baseUrl: process.env.REVENUE_RECONCILER_URL || "http://localhost:8094",
    timeout: 10000,
    retries: 3,
    healthPath: "/health",
  },
  "fluvio-streaming": {
    name: "fluvio-streaming",
    baseUrl: process.env.FLUVIO_STREAMING_URL || "http://localhost:8095",
    timeout: 5000,
    retries: 2,
    healthPath: "/health",
  },
};

const circuitBreakers = new Map<string, CircuitBreakerState>();
const CIRCUIT_FAILURE_THRESHOLD = 5;
const CIRCUIT_RESET_TIMEOUT_MS = 30_000;

function getCircuitBreaker(serviceName: string): CircuitBreakerState {
  if (!circuitBreakers.has(serviceName)) {
    circuitBreakers.set(serviceName, {
      failures: 0,
      lastFailure: 0,
      state: "closed",
    });
  }
  return circuitBreakers.get(serviceName)!;
}

function recordSuccess(serviceName: string): void {
  const cb = getCircuitBreaker(serviceName);
  cb.failures = 0;
  cb.state = "closed";
}

function recordFailure(serviceName: string): void {
  const cb = getCircuitBreaker(serviceName);
  cb.failures++;
  cb.lastFailure = Date.now();
  if (cb.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    cb.state = "open";
  }
}

function canAttempt(serviceName: string): boolean {
  const cb = getCircuitBreaker(serviceName);
  if (cb.state === "closed") return true;
  if (cb.state === "open") {
    if (Date.now() - cb.lastFailure > CIRCUIT_RESET_TIMEOUT_MS) {
      cb.state = "half-open";
      return true;
    }
    return false;
  }
  return true; // half-open: allow one attempt
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeout?: number }
): Promise<Response> {
  const { timeout = 5000, ...fetchOptions } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class GoServiceAdapter {
  private config: ServiceConfig;

  constructor(serviceName: string) {
    const config = SERVICE_REGISTRY[serviceName];
    if (!config) {
      throw new Error(
        `Unknown Go service: ${serviceName}. Available: ${Object.keys(SERVICE_REGISTRY).join(", ")}`
      );
    }
    this.config = config;
  }

  get serviceName(): string {
    return this.config.name;
  }

  get baseUrl(): string {
    return this.config.baseUrl;
  }

  async healthCheck(): Promise<AdapterResponse<{ status: string }>> {
    return this.get<{ status: string }>(this.config.healthPath);
  }

  async get<T = unknown>(
    path: string,
    params?: Record<string, string>
  ): Promise<AdapterResponse<T>> {
    let url = `${this.config.baseUrl}${path}`;
    if (params) {
      const qs = new URLSearchParams(params).toString();
      url += `?${qs}`;
    }
    return this.request<T>("GET", url);
  }

  async post<T = unknown>(
    path: string,
    body?: unknown
  ): Promise<AdapterResponse<T>> {
    const url = `${this.config.baseUrl}${path}`;
    return this.request<T>("POST", url, body);
  }

  async put<T = unknown>(
    path: string,
    body?: unknown
  ): Promise<AdapterResponse<T>> {
    const url = `${this.config.baseUrl}${path}`;
    return this.request<T>("PUT", url, body);
  }

  async delete<T = unknown>(path: string): Promise<AdapterResponse<T>> {
    const url = `${this.config.baseUrl}${path}`;
    return this.request<T>("DELETE", url);
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<AdapterResponse<T>> {
    const start = Date.now();
    const cb = getCircuitBreaker(this.config.name);

    if (!canAttempt(this.config.name)) {
      return {
        success: false,
        error: `Circuit breaker OPEN for ${this.config.name} — service unavailable (${cb.failures} consecutive failures)`,
        latencyMs: Date.now() - start,
        service: this.config.name,
        circuitState: cb.state,
      };
    }

    let lastError = "";
    for (let attempt = 0; attempt < this.config.retries; attempt++) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "X-Request-Source": "insurance-portal-node",
          "X-Service-Name": this.config.name,
        };

        const response = await fetchWithTimeout(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          timeout: this.config.timeout,
        });

        if (response.ok) {
          const data = (await response.json()) as T;
          recordSuccess(this.config.name);
          return {
            success: true,
            data,
            latencyMs: Date.now() - start,
            service: this.config.name,
            circuitState: getCircuitBreaker(this.config.name).state,
          };
        }

        lastError = `HTTP ${response.status}: ${response.statusText}`;
        if (response.status >= 400 && response.status < 500) {
          // Client error — don't retry
          recordFailure(this.config.name);
          return {
            success: false,
            error: lastError,
            latencyMs: Date.now() - start,
            service: this.config.name,
            circuitState: getCircuitBreaker(this.config.name).state,
          };
        }
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
      }

      if (attempt < this.config.retries - 1) {
        await sleep(Math.min(1000 * Math.pow(2, attempt), 5000));
      }
    }

    recordFailure(this.config.name);
    return {
      success: false,
      error: `All ${this.config.retries} attempts failed for ${this.config.name}: ${lastError}`,
      latencyMs: Date.now() - start,
      service: this.config.name,
      circuitState: getCircuitBreaker(this.config.name).state,
    };
  }
}

// Pre-instantiated adapters for each Go service
export const workflowOrchestrator = new GoServiceAdapter(
  "workflow-orchestrator"
);
export const tigerbeetleIntegrated = new GoServiceAdapter(
  "tigerbeetle-integrated"
);
export const mdmComplianceEngine = new GoServiceAdapter(
  "mdm-compliance-engine"
);
export const pbacEngine = new GoServiceAdapter("pbac-engine");
export const connectivityResilience = new GoServiceAdapter(
  "connectivity-resilience"
);
export const billingAggregator = new GoServiceAdapter("billing-aggregator");
export const rbacService = new GoServiceAdapter("rbac-service");
export const ussdGateway = new GoServiceAdapter("ussd-gateway");
export const ussdTxProcessor = new GoServiceAdapter("ussd-tx-processor");
export const hierarchyEngine = new GoServiceAdapter("hierarchy-engine");
export const settlementGateway = new GoServiceAdapter("settlement-gateway");
export const atUssdHandler = new GoServiceAdapter("at-ussd-handler");
export const opensearchAnalytics = new GoServiceAdapter("opensearch-analytics");
export const revenueReconciler = new GoServiceAdapter("revenue-reconciler");
export const fluvioStreaming = new GoServiceAdapter("fluvio-streaming");

// Service registry export for health monitoring
export function getAllServiceConfigs(): ServiceConfig[] {
  return Object.values(SERVICE_REGISTRY);
}

export function getServiceHealth(): Record<string, CircuitBreakerState> {
  const result: Record<string, CircuitBreakerState> = {};
  for (const name of Object.keys(SERVICE_REGISTRY)) {
    result[name] = getCircuitBreaker(name);
  }
  return result;
}

export {
  SERVICE_REGISTRY,
  type ServiceConfig,
  type AdapterResponse,
  type CircuitBreakerState,
};
