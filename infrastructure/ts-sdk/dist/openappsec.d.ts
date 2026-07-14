/**
 * OpenAppSec WAF client with policy management, threat logs, and security dashboard.
 */
export declare class OpenAppSecClient {
    private baseUrl;
    constructor(baseUrl: string);
    ping(): Promise<void>;
    applyPolicy(policy: Record<string, unknown>): Promise<void>;
    applyPlatformPolicy(): Promise<void>;
    getThreatLog(limit?: number, severity?: string): Promise<unknown[]>;
    getSecurityDashboard(): Promise<Record<string, unknown>>;
}
