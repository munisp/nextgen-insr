export declare class TestRedisUrlError extends Error {
    constructor(message: string);
}
/**
 * Validate a Redis URL intended for TEST use and return it unchanged.
 * Throws TestRedisUrlError with a loud message when the URL is not on the
 * test allowlist. Never silently rewrites the URL.
 */
export declare function assertTestRedisUrl(url: string, env?: NodeJS.ProcessEnv): string;
//# sourceMappingURL=testRedisGuard.d.ts.map