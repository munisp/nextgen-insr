export interface PlatformConfig {
    baseUrl: string;
    serviceToken: string;
    timeoutMs: number;
    /** Caller identity for logs/headers, e.g. "whatsapp-bot", "ussd-gateway". */
    serviceName: string;
}
export declare class PlatformConfigError extends Error {
    constructor(message: string);
}
export declare class PlatformUnavailableError extends Error {
    readonly statusCode?: number;
    constructor(message: string, statusCode?: number);
}
export declare const PLATFORM_TIMEOUT_MIN_MS = 100;
export declare const PLATFORM_TIMEOUT_MAX_MS = 120000;
export declare const PLATFORM_TIMEOUT_DEFAULT_MS = 8000;
/**
 * Validate a fully-formed config object (fail-closed at construction so a
 * bad config never defers to a first-call failure). Throws
 * PlatformConfigError naming the exact problem. Returns the normalized cfg.
 */
export declare function validatePlatformConfig(cfg: PlatformConfig): PlatformConfig;
/**
 * Load config from env, fail-fast. `serviceName` identifies the caller in
 * error messages and the x-channel-service header so the monolith can
 * attribute traffic per channel bot.
 */
export declare function loadPlatformConfig(serviceName: string, env?: NodeJS.ProcessEnv): PlatformConfig;
/** Factory for callers that already hold config (tests, DI containers). */
export declare function createPlatformClient(cfg: PlatformConfig): PlatformClient;
export declare class PlatformClient {
    private readonly cfg;
    constructor(cfg: PlatformConfig);
    private headers;
    private request;
    /** GET-style tRPC query against /api/trpc/<procedure>. */
    query<T>(procedure: string, input: unknown): Promise<T>;
    /** POST-style tRPC mutation against /api/trpc/<procedure>. */
    mutate<T>(procedure: string, input: unknown): Promise<T>;
}
//# sourceMappingURL=platformClient.d.ts.map