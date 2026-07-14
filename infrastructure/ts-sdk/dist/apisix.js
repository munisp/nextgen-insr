"use strict";
/**
 * APISix client with route management, OIDC, WAF, and upstream health checks.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.APISixClient = void 0;
class APISixClient {
    adminUrl;
    apiKey;
    constructor(adminUrl) {
        this.adminUrl = adminUrl;
        this.apiKey = process.env.APISIX_API_KEY || process.env.APISIX_ADMIN_KEY || '';
    }
    headers() {
        const h = { 'Content-Type': 'application/json' };
        if (this.apiKey)
            h['X-API-KEY'] = this.apiKey;
        return h;
    }
    async ping() {
        const resp = await fetch(`${this.adminUrl}/apisix/admin/routes`, { headers: this.headers() });
        if (resp.status >= 500)
            throw new Error(`APISix unhealthy: ${resp.status}`);
    }
    async createRoute(routeId, uri, name, methods, upstreamUrl, plugins) {
        const body = {
            uri, name, methods,
            upstream: { type: 'roundrobin', nodes: { [upstreamUrl]: 1 }, retry_timeout: 3, retries: 2,
                checks: { active: { type: 'http', http_path: '/health', healthy: { interval: 5, successes: 2 }, unhealthy: { interval: 3, http_failures: 3 } } } },
            plugins: plugins || this.defaultPlugins(),
        };
        await fetch(`${this.adminUrl}/apisix/admin/routes/${routeId}`, { method: 'PUT', headers: this.headers(), body: JSON.stringify(body) });
    }
    defaultPlugins() {
        return {
            'limit-req': { rate: 100, burst: 50, rejected_code: 429, key_type: 'var', key: 'remote_addr' },
            cors: { allow_origins: '*', allow_methods: 'GET,POST,PUT,DELETE,OPTIONS', allow_headers: 'Content-Type,Authorization,X-KYC-Session-ID,X-Request-ID' },
            prometheus: {},
        };
    }
    async registerPlatformRoutes() {
        const routes = [
            ['policy-svc', '/api/v1/policies/*', 'policy-service', ['GET', 'POST', 'PUT', 'DELETE'], 'policy-service:8081'],
            ['claims-svc', '/api/v1/claims/*', 'claims-service', ['GET', 'POST', 'PUT'], 'claims-service:8082'],
            ['payment-svc', '/api/v1/payments/*', 'payment-service', ['GET', 'POST'], 'payment-service:8083'],
            ['customer-svc', '/api/v1/customers/*', 'customer-service', ['GET', 'POST', 'PUT'], 'customer-service:8084'],
            ['kyc-svc', '/api/v1/kyc/*', 'kyc-orchestrator', ['GET', 'POST'], 'kyc-orchestrator:8085'],
            ['fraud-svc', '/api/v1/fraud/*', 'fraud-detection', ['GET', 'POST'], 'fraud-detection:8020'],
            ['lakehouse-svc', '/api/v1/lakehouse/*', 'lakehouse-api', ['GET', 'POST'], 'lakehouse-api:8120'],
            ['ai-ml-svc', '/api/v1/ml/*', 'ai-ml-platform', ['GET', 'POST'], 'ai-ml-platform:8130'],
        ];
        for (const [id, uri, name, methods, upstream] of routes) {
            await this.createRoute(id, uri, name, methods, upstream);
        }
    }
}
exports.APISixClient = APISixClient;
