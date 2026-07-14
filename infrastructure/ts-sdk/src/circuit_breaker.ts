/**
 * Circuit breaker and retry with exponential backoff for TypeScript services.
 */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerConfig {
  name: string;
  failureThreshold: number;
  successThreshold: number;
  timeoutMs: number;
  halfOpenMax: number;
}

export const defaultCircuitBreakerConfig = (name: string): CircuitBreakerConfig => ({
  name,
  failureThreshold: 5,
  successThreshold: 3,
  timeoutMs: 30000,
  halfOpenMax: 1,
});

export class CircuitBreakerError extends Error {
  constructor(name: string) {
    super(`Circuit breaker '${name}' is open`);
    this.name = 'CircuitBreakerError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailure = 0;
  private halfOpenCurrent = 0;
  private config: CircuitBreakerConfig;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...defaultCircuitBreakerConfig('default'), ...config };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.canExecute()) {
      throw new CircuitBreakerError(this.config.name);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  private canExecute(): boolean {
    switch (this.state) {
      case 'closed':
        return true;
      case 'open':
        if (Date.now() - this.lastFailure > this.config.timeoutMs) {
          this.state = 'half-open';
          this.halfOpenCurrent = 0;
          this.successCount = 0;
          return true;
        }
        return false;
      case 'half-open':
        if (this.halfOpenCurrent >= this.config.halfOpenMax) {
          return false;
        }
        this.halfOpenCurrent++;
        return true;
    }
  }

  private recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.config.successThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else {
      this.failureCount = 0;
    }
  }

  private recordFailure(): void {
    this.failureCount++;
    this.lastFailure = Date.now();

    if (this.state === 'half-open') {
      this.state = 'open';
    } else if (this.failureCount >= this.config.failureThreshold) {
      this.state = 'open';
    }
  }
}

export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  multiplier: number;
  jitterRatio: number;
}

export const defaultRetryConfig: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 100,
  maxDelayMs: 5000,
  multiplier: 2.0,
  jitterRatio: 0.1,
};

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {},
): Promise<T> {
  const cfg = { ...defaultRetryConfig, ...config };
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (attempt === cfg.maxRetries) break;

      const delay = Math.min(
        cfg.baseDelayMs * Math.pow(cfg.multiplier, attempt),
        cfg.maxDelayMs,
      );
      const jitter = delay * cfg.jitterRatio * (Math.random() * 2 - 1);
      await new Promise((resolve) => setTimeout(resolve, delay + jitter));
    }
  }

  throw lastError;
}

export class ResilientHTTPClient {
  private breaker: CircuitBreaker;
  private retryConfig: RetryConfig;
  private baseUrl: string;
  private timeoutMs: number;

  constructor(
    serviceName: string,
    baseUrl: string,
    timeoutMs = 10000,
    breakerConfig?: Partial<CircuitBreakerConfig>,
    retryConfig?: Partial<RetryConfig>,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.breaker = new CircuitBreaker({ name: serviceName, ...breakerConfig });
    this.retryConfig = { ...defaultRetryConfig, ...retryConfig };
  }

  async get(path: string, headers?: Record<string, string>): Promise<Response> {
    return this.request('GET', path, undefined, headers);
  }

  async post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response> {
    return this.request('POST', path, body, headers);
  }

  async put(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response> {
    return this.request('PUT', path, body, headers);
  }

  async delete(path: string, headers?: Record<string, string>): Promise<Response> {
    return this.request('DELETE', path, undefined, headers);
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Response> {
    const url = `${this.baseUrl}${path}`;

    return this.breaker.execute(() =>
      retryWithBackoff(async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

        try {
          const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...headers },
            body: body ? JSON.stringify(body) : undefined,
            signal: controller.signal,
          });

          if (response.status >= 500) {
            throw new Error(`Server error: ${response.status}`);
          }

          return response;
        } finally {
          clearTimeout(timeoutId);
        }
      }, this.retryConfig),
    );
  }

  get circuitState(): CircuitState {
    return this.breaker.getState();
  }
}
