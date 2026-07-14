"use strict";
/**
 * Circuit breaker and retry with exponential backoff for TypeScript services.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResilientHTTPClient = exports.defaultRetryConfig = exports.CircuitBreaker = exports.CircuitBreakerError = exports.defaultCircuitBreakerConfig = void 0;
exports.retryWithBackoff = retryWithBackoff;
const defaultCircuitBreakerConfig = (name) => ({
    name,
    failureThreshold: 5,
    successThreshold: 3,
    timeoutMs: 30000,
    halfOpenMax: 1,
});
exports.defaultCircuitBreakerConfig = defaultCircuitBreakerConfig;
class CircuitBreakerError extends Error {
    constructor(name) {
        super(`Circuit breaker '${name}' is open`);
        this.name = 'CircuitBreakerError';
    }
}
exports.CircuitBreakerError = CircuitBreakerError;
class CircuitBreaker {
    state = 'closed';
    failureCount = 0;
    successCount = 0;
    lastFailure = 0;
    halfOpenCurrent = 0;
    config;
    constructor(config) {
        this.config = { ...(0, exports.defaultCircuitBreakerConfig)('default'), ...config };
    }
    async execute(fn) {
        if (!this.canExecute()) {
            throw new CircuitBreakerError(this.config.name);
        }
        try {
            const result = await fn();
            this.recordSuccess();
            return result;
        }
        catch (error) {
            this.recordFailure();
            throw error;
        }
    }
    getState() {
        return this.state;
    }
    canExecute() {
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
    recordSuccess() {
        if (this.state === 'half-open') {
            this.successCount++;
            if (this.successCount >= this.config.successThreshold) {
                this.state = 'closed';
                this.failureCount = 0;
                this.successCount = 0;
            }
        }
        else {
            this.failureCount = 0;
        }
    }
    recordFailure() {
        this.failureCount++;
        this.lastFailure = Date.now();
        if (this.state === 'half-open') {
            this.state = 'open';
        }
        else if (this.failureCount >= this.config.failureThreshold) {
            this.state = 'open';
        }
    }
}
exports.CircuitBreaker = CircuitBreaker;
exports.defaultRetryConfig = {
    maxRetries: 3,
    baseDelayMs: 100,
    maxDelayMs: 5000,
    multiplier: 2.0,
    jitterRatio: 0.1,
};
async function retryWithBackoff(fn, config = {}) {
    const cfg = { ...exports.defaultRetryConfig, ...config };
    let lastError;
    for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (attempt === cfg.maxRetries)
                break;
            const delay = Math.min(cfg.baseDelayMs * Math.pow(cfg.multiplier, attempt), cfg.maxDelayMs);
            const jitter = delay * cfg.jitterRatio * (Math.random() * 2 - 1);
            await new Promise((resolve) => setTimeout(resolve, delay + jitter));
        }
    }
    throw lastError;
}
class ResilientHTTPClient {
    breaker;
    retryConfig;
    baseUrl;
    timeoutMs;
    constructor(serviceName, baseUrl, timeoutMs = 10000, breakerConfig, retryConfig) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.timeoutMs = timeoutMs;
        this.breaker = new CircuitBreaker({ name: serviceName, ...breakerConfig });
        this.retryConfig = { ...exports.defaultRetryConfig, ...retryConfig };
    }
    async get(path, headers) {
        return this.request('GET', path, undefined, headers);
    }
    async post(path, body, headers) {
        return this.request('POST', path, body, headers);
    }
    async put(path, body, headers) {
        return this.request('PUT', path, body, headers);
    }
    async delete(path, headers) {
        return this.request('DELETE', path, undefined, headers);
    }
    async request(method, path, body, headers) {
        const url = `${this.baseUrl}${path}`;
        return this.breaker.execute(() => retryWithBackoff(async () => {
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
            }
            finally {
                clearTimeout(timeoutId);
            }
        }, this.retryConfig));
    }
    get circuitState() {
        return this.breaker.getState();
    }
}
exports.ResilientHTTPClient = ResilientHTTPClient;
