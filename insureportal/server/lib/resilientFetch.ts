/**
 * Resilient HTTP Client — Production-grade inter-service communication
 *
 * Combines:
 *  - Circuit breaker (prevents cascading failures)
 *  - Exponential backoff retry (handles transient errors)
 *  - Request timeout (prevents hung connections)
 *  - Structured logging and metrics
 */
import logger from "../_core/logger";
import { getMtlsAgent } from "./mtlsAgent";

// ── Circuit Breaker ──────────────────────────────────────────────────────────
type CircuitState = "closed" | "open" | "half_open";

interface CircuitBreakerConfig {
  failureThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
}

class ServiceCircuitBreaker {
  private state: CircuitState = "closed";
  private failures = 0;
  private lastFailureTime = 0;
  private halfOpenSuccesses = 0;
  private readonly config: CircuitBreakerConfig;

  constructor(
    public readonly serviceName: string,
    config?: Partial<CircuitBreakerConfig>
  ) {
    this.config = {
      failureThreshold: config?.failureThreshold ?? 5,
      resetTimeoutMs: config?.resetTimeoutMs ?? 30_000,
      halfOpenMaxAttempts: config?.halfOpenMaxAttempts ?? 3,
    };
  }

  canExecute(): boolean {
    if (this.state === "closed") return true;
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime > this.config.resetTimeoutMs) {
        this.state = "half_open";
        this.halfOpenSuccesses = 0;
        logger.info(
          { service: this.serviceName },
          "Circuit breaker half-open, allowing probe request"
        );
        return true;
      }
      return false;
    }
    return true; // half_open — allow probe
  }

  recordSuccess(): void {
    if (this.state === "half_open") {
      this.halfOpenSuccesses++;
      if (this.halfOpenSuccesses >= this.config.halfOpenMaxAttempts) {
        this.state = "closed";
        this.failures = 0;
        logger.info(
          { service: this.serviceName },
          "Circuit breaker closed (recovered)"
        );
      }
    } else {
      this.failures = Math.max(0, this.failures - 1);
    }
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();
    if (
      this.failures >= this.config.failureThreshold &&
      this.state !== "open"
    ) {
      this.state = "open";
      logger.warn(
        { service: this.serviceName, failures: this.failures },
        "Circuit breaker OPEN — requests will be rejected"
      );
    }
  }

  getState(): { state: CircuitState; failures: number } {
    return { state: this.state, failures: this.failures };
  }
}

// ── Global circuit breaker registry ──────────────────────────────────────────
const breakers = new Map<string, ServiceCircuitBreaker>();

function getBreaker(serviceName: string): ServiceCircuitBreaker {
  let breaker = breakers.get(serviceName);
  if (!breaker) {
    breaker = new ServiceCircuitBreaker(serviceName);
    breakers.set(serviceName, breaker);
  }
  return breaker;
}

// ── Retry with exponential backoff ───────────────────────────────────────────
interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_RETRY: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 200,
  maxDelayMs: 5_000,
};

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

// ── Resilient fetch ──────────────────────────────────────────────────────────
export interface ResilientFetchOptions {
  timeoutMs?: number;
  retry?: Partial<RetryConfig>;
  serviceName: string;
  fallback?: unknown;
  /** When true, attach mTLS client certificates for inter-service calls. */
  useMtls?: boolean;
}

export async function resilientFetch<T>(
  url: string,
  init: RequestInit & { method?: string },
  options: ResilientFetchOptions
): Promise<T> {
  const { serviceName, timeoutMs = 5_000, fallback, useMtls } = options;
  const retryConfig = { ...DEFAULT_RETRY, ...options.retry };
  const breaker = getBreaker(serviceName);
  const mtlsAgent = useMtls ? getMtlsAgent() : null;

  if (!breaker.canExecute()) {
    if (fallback !== undefined) {
      logger.debug(
        { service: serviceName },
        "Circuit open — returning fallback"
      );
      return fallback as T;
    }
    throw new Error(
      `[${serviceName}] Circuit breaker is OPEN — request rejected`
    );
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retryConfig.maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      const fetchInit: RequestInit & Record<string, unknown> = {
        ...init,
        signal: controller.signal,
      };
      if (mtlsAgent) {
        (fetchInit as Record<string, unknown>).agent = mtlsAgent;
      }

      const response = await fetch(url, fetchInit);

      clearTimeout(timeout);

      if (!response.ok) {
        if (isRetryable(response.status) && attempt < retryConfig.maxRetries) {
          const delay = Math.min(
            retryConfig.baseDelayMs * Math.pow(2, attempt) +
              Math.random() * 100,
            retryConfig.maxDelayMs
          );
          logger.debug(
            { service: serviceName, status: response.status, attempt, delay },
            "Retrying request"
          );
          await sleep(delay);
          continue;
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as T;
      breaker.recordSuccess();
      return data;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (lastError.name === "AbortError") {
        lastError = new Error(
          `[${serviceName}] Request timed out after ${timeoutMs}ms`
        );
      }

      if (attempt < retryConfig.maxRetries) {
        const delay = Math.min(
          retryConfig.baseDelayMs * Math.pow(2, attempt) + Math.random() * 100,
          retryConfig.maxDelayMs
        );
        await sleep(delay);
        continue;
      }
    }
  }

  breaker.recordFailure();

  if (fallback !== undefined) {
    logger.warn(
      { service: serviceName, error: lastError?.message },
      "All retries exhausted — returning fallback"
    );
    return fallback as T;
  }

  throw lastError ?? new Error(`[${serviceName}] Request failed`);
}

/**
 * Get health status of all circuit breakers.
 */
export function getCircuitBreakerStatus(): Record<
  string,
  { state: CircuitState; failures: number }
> {
  const status: Record<string, { state: CircuitState; failures: number }> = {};
  breakers.forEach((breaker, name) => {
    status[name] = breaker.getState();
  });
  return status;
}
