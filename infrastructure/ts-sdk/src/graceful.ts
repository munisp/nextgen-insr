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

export class HealthRegistry {
  private checks: Map<string, HealthCheckFn> = new Map();
  private started: number = Date.now();
  private ready = true;
  private serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  register(name: string, checkFn: HealthCheckFn): void {
    this.checks.set(name, checkFn);
  }

  setReady(ready: boolean): void {
    this.ready = ready;
  }

  get isReady(): boolean {
    return this.ready;
  }

  async checkAll(): Promise<Record<string, unknown>> {
    const results: Record<string, ComponentHealth> = {};
    let allHealthy = true;

    for (const [name, checkFn] of this.checks) {
      const start = Date.now();
      try {
        const ok = await Promise.race([
          checkFn(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), 5000),
          ),
        ]);
        results[name] = {
          name,
          connected: ok,
          latencyMs: Date.now() - start,
        };
        if (!ok) allHealthy = false;
      } catch (error: any) {
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

  healthResponse(): Record<string, unknown> {
    return {
      status: this.ready ? 'healthy' : 'degraded',
      service: this.serviceName,
      uptimeSeconds: (Date.now() - this.started) / 1000,
    };
  }

  livenessResponse(): Record<string, unknown> {
    return { alive: true, service: this.serviceName };
  }

  readinessResponse(): Record<string, unknown> {
    return { ready: this.ready, service: this.serviceName };
  }
}

export class GracefulShutdown {
  private cleanupHooks: Array<() => Promise<void>> = [];
  private shuttingDown = false;
  private serviceName: string;

  constructor(serviceName: string) {
    this.serviceName = serviceName;
  }

  addCleanup(fn: () => Promise<void>): void {
    this.cleanupHooks.push(fn);
  }

  setupSignals(server?: Server): void {
    const handler = async (signal: string) => {
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

  async cleanup(): Promise<void> {
    console.log(`[${this.serviceName}] Running cleanup hooks...`);
    for (const hook of this.cleanupHooks.reverse()) {
      try {
        await Promise.race([
          hook(),
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error('cleanup timeout')), 10000),
          ),
        ]);
      } catch (error: any) {
        console.error(`[${this.serviceName}] Cleanup hook failed: ${error.message}`);
      }
    }
    console.log(`[${this.serviceName}] Graceful shutdown complete`);
  }

  get isShuttingDown(): boolean {
    return this.shuttingDown;
  }
}
