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
exports.PlatformClient = exports.PLATFORM_TIMEOUT_DEFAULT_MS = exports.PLATFORM_TIMEOUT_MAX_MS = exports.PLATFORM_TIMEOUT_MIN_MS = exports.PlatformUnavailableError = exports.PlatformConfigError = void 0;
exports.validatePlatformConfig = validatePlatformConfig;
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
// 2026-10-03 (W8-B7): sane-bounds for the request timeout. Values outside
// this range are a config error, not something to silently coerce.
exports.PLATFORM_TIMEOUT_MIN_MS = 100;
exports.PLATFORM_TIMEOUT_MAX_MS = 120000;
exports.PLATFORM_TIMEOUT_DEFAULT_MS = 8000;
/**
 * Validate a fully-formed config object (fail-closed at construction so a
 * bad config never defers to a first-call failure). Throws
 * PlatformConfigError naming the exact problem. Returns the normalized cfg.
 */
function validatePlatformConfig(cfg) {
    if (!cfg || typeof cfg !== "object") {
        throw new PlatformConfigError("platform config is missing entirely");
    }
    const name = (cfg.serviceName ?? "").trim();
    if (!name) {
        throw new PlatformConfigError("platform config has no serviceName — the platform API could not " +
            "attribute this caller (fail-closed).");
    }
    const rawUrl = (cfg.baseUrl ?? "").trim();
    if (!rawUrl) {
        throw new PlatformConfigError(`platform baseUrl is not configured — ${name} cannot reach the ` +
            "platform API and must not start (fail-closed).");
    }
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        throw new PlatformConfigError(`platform baseUrl for ${name} is not a valid URL: ${JSON.stringify(rawUrl)}`);
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new PlatformConfigError(`platform baseUrl for ${name} must be http(s), got ` +
            JSON.stringify(parsed.protocol));
    }
    if (!(cfg.serviceToken ?? "").trim()) {
        throw new PlatformConfigError(`platform serviceToken is not configured — ${name} cannot ` +
            "authenticate to the platform API and must not start (fail-closed).");
    }
    if (typeof cfg.timeoutMs !== "number" ||
        !Number.isFinite(cfg.timeoutMs) ||
        cfg.timeoutMs < exports.PLATFORM_TIMEOUT_MIN_MS ||
        cfg.timeoutMs > exports.PLATFORM_TIMEOUT_MAX_MS) {
        throw new PlatformConfigError(`platform timeoutMs for ${name} must be a number in ` +
            `[${exports.PLATFORM_TIMEOUT_MIN_MS}, ${exports.PLATFORM_TIMEOUT_MAX_MS}], got ` +
            JSON.stringify(cfg.timeoutMs));
    }
    return {
        ...cfg,
        baseUrl: rawUrl.replace(/\/+$/, ""),
        serviceName: name,
        serviceToken: cfg.serviceToken.trim(),
    };
}
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
    // 2026-10-03 (W8-B7): an explicitly-set but invalid timeout is now a loud
    // config error instead of a silent fallback to the default.
    const rawTimeout = (env.PLATFORM_API_TIMEOUT_MS ?? "").trim();
    let timeoutMs = exports.PLATFORM_TIMEOUT_DEFAULT_MS;
    if (rawTimeout) {
        const n = Number(rawTimeout);
        if (!Number.isFinite(n) ||
            n < exports.PLATFORM_TIMEOUT_MIN_MS ||
            n > exports.PLATFORM_TIMEOUT_MAX_MS) {
            throw new PlatformConfigError(`PLATFORM_API_TIMEOUT_MS=${JSON.stringify(rawTimeout)} is invalid — ` +
                `must be a number in [${exports.PLATFORM_TIMEOUT_MIN_MS}, ${exports.PLATFORM_TIMEOUT_MAX_MS}] ` +
                `(fail-closed; ${serviceName} must not start with a guessed timeout).`);
        }
        timeoutMs = n;
    }
    // validatePlatformConfig normalizes (trailing slashes, whitespace) and
    // re-checks every field, so this path and the DI path share one contract.
    return validatePlatformConfig({
        baseUrl: rawUrl,
        serviceToken,
        timeoutMs,
        serviceName,
    });
}
/** Factory for callers that already hold config (tests, DI containers). */
function createPlatformClient(cfg) {
    return new PlatformClient(cfg);
}
class PlatformClient {
    constructor(cfg) {
        // 2026-10-03 (W8-B7): validate at construction (fail-closed) so a
        // misconfigured client throws here, not on the first call.
        this.cfg = validatePlatformConfig(cfg);
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