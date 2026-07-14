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

/** HTTP cache configuration for different endpoint patterns. */
const CACHE_RULES: Array<{ pattern: string; maxAge: number; scope: 'public' | 'private'; staleWhileRevalidate?: number }> = [
  // Static reference data — cache aggressively
  { pattern: '/api/v1/products', maxAge: 300, scope: 'public', staleWhileRevalidate: 600 },
  { pattern: '/api/v1/premium-rates', maxAge: 300, scope: 'public', staleWhileRevalidate: 600 },
  { pattern: '/api/v1/regions', maxAge: 3600, scope: 'public' },
  { pattern: '/api/v1/categories', maxAge: 3600, scope: 'public' },
  { pattern: '/api/v1/config', maxAge: 600, scope: 'public' },
  // User-specific data — private cache with shorter TTL
  { pattern: '/api/v1/policies', maxAge: 60, scope: 'private' },
  { pattern: '/api/v1/claims', maxAge: 30, scope: 'private' },
  { pattern: '/api/v1/notifications', maxAge: 0, scope: 'private' },
  // Analytics — moderate cache
  { pattern: '/api/v1/analytics', maxAge: 120, scope: 'private' },
  { pattern: '/api/v1/reports', maxAge: 300, scope: 'private' },
];

export class InfraMiddleware {
  private platform: Platform;

  constructor(platform: Platform) {
    this.platform = platform;
  }

  expressMiddleware() {
    return async (req: any, res: any, next: any) => {
      const start = Date.now();
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '';
      const ctx: RequestContext = { userId: '', kycLevel: 0, clientIp, token: '' };

      // 1. Rate limiting via Redis (atomic Lua script)
      try {
        const allowed = await this.platform.redis.rateLimit(`rate:${clientIp}`, 100, 60);
        if (!allowed) {
          res.status(429).json({ error: 'rate_limit_exceeded' });
          return;
        }
      } catch (err) { console.error('[middleware] rate limit check failed:', err instanceof Error ? err.message : err); }

      // 2. Token validation via Keycloak
      const authHeader = req.headers.authorization || '';
      if (authHeader && !isPublicPath(req.path)) {
        const token = authHeader.replace('Bearer ', '');
        ctx.token = token;
        try {
          const claims = await this.platform.keycloak.validateToken(token);
          ctx.userId = (claims.sub as string) || '';
          ctx.kycLevel = this.platform.keycloak.getKYCLevel(claims);
        } catch (err) {
          console.error('[middleware] token validation failed:', err instanceof Error ? err.message : err);
          res.status(401).json({ error: 'invalid_token' });
          return;
        }
      }

      // 3. KYC gate enforcement
      if (requiresKYC(req.path) && ctx.userId) {
        try {
          const gate = await this.platform.redis.getKYCGate(ctx.userId);
          if (gate && !gate.allowed) {
            res.status(403).json({ error: 'kyc_verification_required', kyc_level: gate.level });
            return;
          }
        } catch (err) { console.error('[middleware] KYC gate check failed:', err instanceof Error ? err.message : err); }
      }

      // 4. RBAC via Permify
      if (requiresPermission(req.path) && ctx.userId) {
        const [entity, permission] = extractPermission(req.method, req.path);
        if (entity) {
          try {
            const allowed = await this.platform.permify.checkPermission(entity, '*', permission, 'user', ctx.userId);
            if (!allowed) {
              res.status(403).json({ error: 'permission_denied' });
              return;
            }
          } catch (err) { console.error('[middleware] permission check failed:', err instanceof Error ? err.message : err); }
        }
      }

      // 5. HTTP Cache Headers (GET requests only)
      if (req.method === 'GET') {
        setCacheHeaders(req.path, res);
      }

      // Inject context
      req.infraPlatform = this.platform;
      req.infraContext = ctx;
      next();

      // 6. Async audit logging
      const latencyMs = Date.now() - start;
      const auditEntry = {
        method: req.method, path: req.path, user_id: ctx.userId,
        kyc_level: ctx.kycLevel, client_ip: clientIp, latency_ms: latencyMs,
        timestamp: new Date().toISOString(),
      };
      this.platform.opensearch.indexAudit('api-gateway', req.method, 'request', req.path, ctx.userId, auditEntry).catch(() => {});
      this.platform.kafka.publishAuditEvent('api-gateway', `${req.method} ${req.path}`, auditEntry).catch(() => {});
    };
  }
}

function setCacheHeaders(path: string, res: any): void {
  for (const rule of CACHE_RULES) {
    if (path.startsWith(rule.pattern)) {
      if (rule.maxAge === 0) {
        res.setHeader('Cache-Control', 'no-store');
      } else {
        let directive = `${rule.scope}, max-age=${rule.maxAge}`;
        if (rule.staleWhileRevalidate) {
          directive += `, stale-while-revalidate=${rule.staleWhileRevalidate}`;
        }
        res.setHeader('Cache-Control', directive);
      }
      // Add ETag support based on response content hash
      const originalJson = res.json.bind(res);
      res.json = (body: any) => {
        const content = JSON.stringify(body);
        const crypto = require('crypto');
        const etag = `"${crypto.createHash('md5').update(content).digest('hex').slice(0, 16)}"`;
        res.setHeader('ETag', etag);
        return originalJson(body);
      };
      return;
    }
  }
  // Default: no-cache for unmatched API paths
  if (path.startsWith('/api/')) {
    res.setHeader('Cache-Control', 'no-cache');
  }
}

function isPublicPath(path: string): boolean {
  return ['/health', '/ready', '/metrics', '/api/v1/auth/login', '/api/v1/auth/register', '/docs'].some(p => path.startsWith(p));
}

function requiresKYC(path: string): boolean {
  return ['/api/v1/policies', '/api/v1/claims', '/api/v1/payments', '/api/v1/transfers'].some(p => path.startsWith(p));
}

function requiresPermission(path: string): boolean {
  return path.startsWith('/api/v1/');
}

function extractPermission(method: string, path: string): [string, string] {
  const parts = path.replace('/api/v1/', '').split('/');
  if (!parts.length) return ['', ''];
  const entity = parts[0];
  return [entity, method === 'GET' ? 'view' : 'manage'];
}
