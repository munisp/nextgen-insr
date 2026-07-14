/**
 * Infrastructure middleware that wires all 12 components into Express/Node services.
 * Enforces KYC gates, rate limiting, RBAC, HTTP caching, and audit logging on every request.
 */
import { Platform } from './platform';
export interface RequestContext {
    userId: string;
    kycLevel: number;
    clientIp: string;
    token: string;
}
export declare class InfraMiddleware {
    private platform;
    constructor(platform: Platform);
    expressMiddleware(): (req: any, res: any, next: any) => Promise<void>;
}
