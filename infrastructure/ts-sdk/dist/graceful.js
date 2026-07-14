"use strict";
/**
 * Graceful shutdown and health probe support for TypeScript services.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GracefulShutdown = exports.HealthRegistry = void 0;
class HealthRegistry {
    checks = new Map();
    started = Date.now();
    ready = true;
    serviceName;
    constructor(serviceName) {
        this.serviceName = serviceName;
    }
    register(name, checkFn) {
        this.checks.set(name, checkFn);
    }
    setReady(ready) {
        this.ready = ready;
    }
    get isReady() {
        return this.ready;
    }
    async checkAll() {
        const results = {};
        let allHealthy = true;
        for (const [name, checkFn] of this.checks) {
            const start = Date.now();
            try {
                const ok = await Promise.race([
                    checkFn(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
                ]);
                results[name] = {
                    name,
                    connected: ok,
                    latencyMs: Date.now() - start,
                };
                if (!ok)
                    allHealthy = false;
            }
            catch (error) {
                allHealthy = false;
                results[name] = {
                    name,
                    connected: false,
                    latencyMs: Date.now() - start,
                    error: error.message,
                };
            }
        }
        return {
            status: allHealthy ? 'healthy' : 'degraded',
            service: this.serviceName,
            uptimeSeconds: (Date.now() - this.started) / 1000,
            components: results,
        };
    }
    healthResponse() {
        return {
            status: this.ready ? 'healthy' : 'degraded',
            service: this.serviceName,
            uptimeSeconds: (Date.now() - this.started) / 1000,
        };
    }
    livenessResponse() {
        return { alive: true, service: this.serviceName };
    }
    readinessResponse() {
        return { ready: this.ready, service: this.serviceName };
    }
}
exports.HealthRegistry = HealthRegistry;
class GracefulShutdown {
    cleanupHooks = [];
    shuttingDown = false;
    serviceName;
    constructor(serviceName) {
        this.serviceName = serviceName;
    }
    addCleanup(fn) {
        this.cleanupHooks.push(fn);
    }
    setupSignals(server) {
        const handler = async (signal) => {
            if (this.shuttingDown) {
                console.error(`[${this.serviceName}] Force shutdown`);
                process.exit(1);
            }
            this.shuttingDown = true;
            console.log(`[${this.serviceName}] ${signal} received, shutting down gracefully...`);
            if (server) {
                server.close(() => {
                    console.log(`[${this.serviceName}] HTTP server closed`);
                });
            }
            await this.cleanup();
            process.exit(0);
        };
        process.on('SIGINT', () => handler('SIGINT'));
        process.on('SIGTERM', () => handler('SIGTERM'));
    }
    async cleanup() {
        console.log(`[${this.serviceName}] Running cleanup hooks...`);
        for (const hook of this.cleanupHooks.reverse()) {
            try {
                await Promise.race([
                    hook(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('cleanup timeout')), 10000)),
                ]);
            }
            catch (error) {
                console.error(`[${this.serviceName}] Cleanup hook failed: ${error.message}`);
            }
        }
        console.log(`[${this.serviceName}] Graceful shutdown complete`);
    }
    get isShuttingDown() {
        return this.shuttingDown;
    }
}
exports.GracefulShutdown = GracefulShutdown;
