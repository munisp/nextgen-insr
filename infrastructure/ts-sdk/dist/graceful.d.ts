/**
 * Graceful shutdown and health probe support for TypeScript services.
 */
import { Server } from 'http';
export interface ComponentHealth {
    name: string;
    connected: boolean;
    latencyMs: number;
    error?: string;
}
export type HealthCheckFn = () => Promise<boolean>;
export declare class HealthRegistry {
    private checks;
    private started;
    private ready;
    private serviceName;
    constructor(serviceName: string);
    register(name: string, checkFn: HealthCheckFn): void;
    setReady(ready: boolean): void;
    get isReady(): boolean;
    checkAll(): Promise<Record<string, unknown>>;
    healthResponse(): Record<string, unknown>;
    livenessResponse(): Record<string, unknown>;
    readinessResponse(): Record<string, unknown>;
}
export declare class GracefulShutdown {
    private cleanupHooks;
    private shuttingDown;
    private serviceName;
    constructor(serviceName: string);
    addCleanup(fn: () => Promise<void>): void;
    setupSignals(server?: Server): void;
    cleanup(): Promise<void>;
    get isShuttingDown(): boolean;
}
