"use strict";
// 2026-10-03 (W8-B1): tRPC client factory for the platform monolith's member
// routers, generalized from whatsapp-bot/src/clients/platform.ts (R1a).
// Configuration is FAIL-FAST: the base URL has no localhost default and the
// service token is required. Every call honestly propagates failure
// (PlatformUnavailableError) — callers must fail closed and never invent data.
//
// Wire format: superjson over the monolith's /api/trpc/<procedure> endpoint
// (GET for queries, POST for mutations), Bearer service-token auth.
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlatformClient = exports.PlatformUnavailableError = exports.PlatformConfigError = void 0;
exports.loadPlatformConfig = loadPlatformConfig;
exports.createPlatformClient = createPlatformClient;
class PlatformConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = "PlatformConfigError";
    }
}
exports.PlatformConfigError = PlatformConfigError;
class PlatformUnavailableError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.name = "PlatformUnavailableError";
        this.statusCode = statusCode;
    }
}
exports.PlatformUnavailableError = PlatformUnavailableError;
/**
 * Load config from env, fail-fast. `serviceName` identifies the caller in
 * error messages and the x-channel-service header so the monolith can
 * attribute traffic per channel bot.
 */
function loadPlatformConfig(serviceName, env = process.env) {
    const rawUrl = (env.PLATFORM_API_URL ?? "").trim();
    if (!rawUrl) {
        // Fail-fast: no silent localhost fallback in production code.
        throw new PlatformConfigError(`PLATFORM_API_URL is not configured — ${serviceName} cannot reach the ` +
            "platform API and must not start (fail-closed).");
    }
    const serviceToken = (env.PLATFORM_SERVICE_TOKEN ?? "").trim();
    if (!serviceToken) {
        throw new PlatformConfigError(`PLATFORM_SERVICE_TOKEN is not configured — ${serviceName} cannot ` +
            "authenticate to the platform API and must not start (fail-closed).");
    }
    const timeoutMs = Number(env.PLATFORM_API_TIMEOUT_MS ?? 8000);
    return {
        baseUrl: rawUrl.replace(/\/+$/, ""),
        serviceToken,
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 8000,
        serviceName,
    };
}
/** Factory for callers that already hold config (tests, DI containers). */
function createPlatformClient(cfg) {
    return new PlatformClient(cfg);
}
class PlatformClient {
    constructor(cfg) {
        this.cfg = cfg;
    }
    headers() {
        return {
            authorization: `Bearer ${this.cfg.serviceToken}`,
            "content-type": "application/json",
            "x-channel-service": this.cfg.serviceName,
        };
    }
    async request(procedure, input, method) {
        const base = `${this.cfg.baseUrl}/api/trpc/${procedure}`;
        const url = method === "GET"
            ? `${base}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`
            : base;
        let resp;
        try {
            resp = await fetch(url, {
                method,
                headers: this.headers(),
                ...(method === "POST"
                    ? { body: JSON.stringify({ json: input }) }
                    : {}),
                signal: AbortSignal.timeout(this.cfg.timeoutMs),
            });
        }
        catch (err) {
            throw new PlatformUnavailableError(`platform unreachable for ${procedure} (${this.cfg.serviceName}): ${err instanceof Error ? err.message : String(err)}`);
        }
        if (!resp.ok) {
            throw new PlatformUnavailableError(`platform rejected ${procedure} with HTTP ${resp.status}`, resp.status);
        }
        let body;
        try {
            body = await resp.json();
        }
        catch {
            throw new PlatformUnavailableError(`platform returned non-JSON for ${procedure}`);
        }
        if (body?.error) {
            throw new PlatformUnavailableError(`platform error for ${procedure}: ${JSON.stringify(body.error).slice(0, 300)}`);
        }
        // superjson: { result: { data: { json: ... } } }
        return body?.result?.data?.json;
    }
    /** GET-style tRPC query against /api/trpc/<procedure>. */
    query(procedure, input) {
        return this.request(procedure, input, "GET");
    }
    /** POST-style tRPC mutation against /api/trpc/<procedure>. */
    mutate(procedure, input) {
        return this.request(procedure, input, "POST");
    }
}
exports.PlatformClient = PlatformClient;
//# sourceMappingURL=platformClient.js.map