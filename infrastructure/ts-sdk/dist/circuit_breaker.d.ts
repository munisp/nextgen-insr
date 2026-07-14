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
export declare const defaultCircuitBreakerConfig: (name: string) => CircuitBreakerConfig;
export declare class CircuitBreakerError extends Error {
    constructor(name: string);
}
export declare class CircuitBreaker {
    private state;
    private failureCount;
    private successCount;
    private lastFailure;
    private halfOpenCurrent;
    private config;
    constructor(config?: Partial<CircuitBreakerConfig>);
    execute<T>(fn: () => Promise<T>): Promise<T>;
    getState(): CircuitState;
    private canExecute;
    private recordSuccess;
    private recordFailure;
}
export interface RetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    multiplier: number;
    jitterRatio: number;
}
export declare const defaultRetryConfig: RetryConfig;
export declare function retryWithBackoff<T>(fn: () => Promise<T>, config?: Partial<RetryConfig>): Promise<T>;
export declare class ResilientHTTPClient {
    private breaker;
    private retryConfig;
    private baseUrl;
    private timeoutMs;
    constructor(serviceName: string, baseUrl: string, timeoutMs?: number, breakerConfig?: Partial<CircuitBreakerConfig>, retryConfig?: Partial<RetryConfig>);
    get(path: string, headers?: Record<string, string>): Promise<Response>;
    post(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
    put(path: string, body?: unknown, headers?: Record<string, string>): Promise<Response>;
    delete(path: string, headers?: Record<string, string>): Promise<Response>;
    private request;
    get circuitState(): CircuitState;
}
