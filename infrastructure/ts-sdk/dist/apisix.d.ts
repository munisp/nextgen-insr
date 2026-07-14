/**
 * APISix client with route management, OIDC, WAF, and upstream health checks.
 */
export declare class APISixClient {
    private adminUrl;
    private apiKey;
    constructor(adminUrl: string);
    private headers;
    ping(): Promise<void>;
    createRoute(routeId: string, uri: string, name: string, methods: string[], upstreamUrl: string, plugins?: Record<string, unknown>): Promise<void>;
    private defaultPlugins;
    registerPlatformRoutes(): Promise<void>;
}
