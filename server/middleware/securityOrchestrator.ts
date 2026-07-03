// TypeScript enabled — Sprint 96 security audit
/**
 * Security Orchestrator — TypeScript Integration Layer
 * Wires Rust DDoS Shield, Go PBAC Engine, and Python Fraud ML Service
 * into the Express middleware pipeline.
 *
 * Architecture:
 *   Client → Rust DDoS Shield → Go PBAC Engine → Python Fraud ML → App
 *   (port 8090)              (port 8091)        (port 8092)
 *
 * In production, each service runs as a sidecar container.
 * This middleware communicates via HTTP to each service.
 */

import { Request, Response, NextFunction, Express } from "express";
import { Request, Response, NextFunction, Express } from "express";
import { logger } from './_core/logger';

// ── Service Configuration ────────────────────────────────────────────

const DDOS_SHIELD_URL = process.env.DDOS_SHIELD_URL || "http://localhost:8090";
const PBAC_ENGINE_URL = process.env.PBAC_ENGINE_URL || "http://localhost:8091";
const FRAUD_ML_URL = process.env.FRAUD_ML_URL || "http://localhost:8092";

const SERVICE_TIMEOUT_MS = parseInt(
  process.env.SECURITY_SERVICE_TIMEOUT || "3000"
);
const FAIL_OPEN =
  process.env.NODE_ENV === "production"
    ? process.env.SECURITY_FAIL_OPEN === "true" // Production: fail-closed by default (must explicitly opt in to fail-open)
    : process.env.SECURITY_FAIL_OPEN !== "false"; // Dev: fail-open by default (sidecars may not be deployed)

// ── HTTP Client with Timeout ─────────────────────────────────────────

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = SERVICE_TIMEOUT_MS
): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timer);
    return resp as any;
  } catch (err: any) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      logger.warn(`[SecurityOrchestrator] Timeout calling ${url}`);
    } else {
      // Service is down — expected in dev, logged in prod
      if (process.env.NODE_ENV === "production") {
        logger.error(
          `[SecurityOrchestrator] Failed to reach ${url}:`,
          err.message
        );
      }
    }
    return null;
  }
}

// ── DDoS Shield Middleware ───────────────────────────────────────────

interface DDoSCheckResult {
  allowed: boolean;
  reason?: string;
  rate_limit_remaining?: number;
  circuit_state?: string;
  threat_level?: string;
}

async function checkDDoS(req: Request): Promise<DDoSCheckResult> {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const resp = await fetchWithTimeout(`${DDOS_SHIELD_URL}/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ip,
      path: req.path,
      method: req.method,
      user_agent: req.headers["user-agent"] || "",
      content_length: parseInt(req.headers["content-length"] || "0"),
    }),
  });

  if (!resp) {
    return { allowed: FAIL_OPEN, reason: "DDoS service unavailable" };
  }

  try {
    const data = await (resp as any).json();
    return data;
  } catch {
    return {
      allowed: FAIL_OPEN,
      reason: "DDoS service returned invalid response",
    };
  }
}

// ── PBAC Authorization Middleware ────────────────────────────────────

interface PBACCheckResult {
  allowed: boolean;
  reason: string;
  matched_policy: string;
  eval_time_ms: number;
  required_actions?: string[];
}

async function checkPBAC(
  req: Request,
  userId: string,
  roles: string[],
  kycLevel: number = 0
): Promise<PBACCheckResult> {
  const action = mapHttpMethodToAction(req.method);
  const ip = req.ip || req.socket.remoteAddress || "unknown";

  const resp = await fetchWithTimeout(`${PBAC_ENGINE_URL}/authorize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: {
        user_id: userId,
        roles: roles,
        kyc_level: kycLevel,
        ip_address: ip,
        device_id: req.headers["x-device-id"] || "",
        session_id: req.headers["x-session-id"] || "",
      },
      resource: {
        id: req.path,
        type: detectResourceType(req.path),
        owner_id: "",
        tenant_id: req.headers["x-tenant-id"] || "",
      },
      action: action,
      context: {
        amount: extractAmount(req),
        channel: req.headers["x-channel"] || "web",
        mfa_verified: req.headers["x-mfa-verified"] === "true",
        ip_address: ip,
        geo_country: req.headers["x-geo-country"] || "",
        risk_score: 0,
        time_of_day: new Date().getHours(),
        day_of_week: new Date().getDay(),
      },
    }),
  });

  if (!resp) {
    return {
      allowed: FAIL_OPEN,
      reason: "PBAC service unavailable",
      matched_policy: "fallback",
      eval_time_ms: 0,
    };
  }

  try {
    const data = await (resp as any).json();
    return data;
  } catch {
    return {
      allowed: FAIL_OPEN,
      reason: "PBAC service returned invalid response",
      matched_policy: "fallback",
      eval_time_ms: 0,
    };
  }
}

// ── Fraud ML Scoring Middleware ──────────────────────────────────────

interface FraudScoreResult {
  transaction_id: string;
  overall_score: number;
  risk_level: string;
  decision: string;
  component_scores: Record<string, number>;
  risk_factors: string[];
  recommendations: string[];
}

async function scoreFraud(
  req: Request,
  userId: string,
  transactionId: string,
  amount: number
): Promise<FraudScoreResult | null> {
  const ip = req.ip || req.socket.remoteAddress || "unknown";

  const resp = await fetchWithTimeout(`${FRAUD_ML_URL}/score`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transaction_id: transactionId,
      user_id: userId,
      amount: amount,
      currency: "NGN",
      transaction_type: detectTransactionType(req.path),
      channel: req.headers["x-channel"] || "web",
      ip_address: ip,
      device_id: req.headers["x-device-id"] || "",
      user_agent: req.headers["user-agent"] || "",
      geo_country: req.headers["x-geo-country"] || "",
      timestamp: Date.now(),
      session_age_seconds: parseInt(
        String(req.headers["x-session-age"] || "0")
      ),
      kyc_level: parseInt(String(req.headers["x-kyc-level"] || "0")),
      is_new_recipient: req.headers["x-new-recipient"] === "true",
      is_international: req.headers["x-international"] === "true",
    }),
  });

  if (!resp) return null;

  try {
    return await (resp as any).json();
  } catch {
    return null;
  }
}

// ── Helper Functions ─────────────────────────────────────────────────

function mapHttpMethodToAction(method: string): string {
  const map: Record<string, string> = {
    GET: "read",
    POST: "create",
    PUT: "update",
    PATCH: "update",
    DELETE: "delete",
  };
  return map[method] || "read";
}

function detectResourceType(path: string): string {
  if (path.includes("/transactions")) return "transaction";
  if (path.includes("/agents")) return "agent";
  if (path.includes("/merchants")) return "merchant";
  if (path.includes("/users")) return "user";
  if (path.includes("/reports")) return "report";
  if (path.includes("/settings")) return "settings";
  if (path.includes("/admin")) return "admin";
  return "general";
}

function detectTransactionType(path: string): string {
  if (path.includes("transfer")) return "transfer";
  if (path.includes("withdraw")) return "withdrawal";
  if (path.includes("deposit")) return "deposit";
  if (path.includes("bill")) return "bill_payment";
  return "transfer";
}

function extractAmount(req: Request): number {
  try {
    if (req.body && typeof req.body === "object") {
      return parseFloat(req.body.amount || req.body.input?.amount || "0") || 0;
    }
  } catch (err) { logger.error("[securityOrchestrator] operation failed:", err); }
  return 0;
}

function isTransactionEndpoint(path: string): boolean {
  return (
    path.includes("/transactions") &&
    (path.includes("create") ||
      path.includes("transfer") ||
      path.includes("withdraw"))
  );
}

function isProtectedEndpoint(path: string): boolean {
  // Skip health checks, static assets, and public endpoints
  if (path.startsWith("/api/health")) return false;
  if (path.startsWith("/api/docs")) return false;
  if (path.startsWith("/api/oauth")) return false;
  if (path.startsWith("/api/stripe/webhook")) return false;
  if (!path.startsWith("/api/")) return false;
  return true;
}

// ── Orchestrator Registration ────────────────────────────────────────

export function applySecurityOrchestrator(app: Express): void {
  logger.info(
    "[SecurityOrchestrator] Registering multi-language security stack"
  );
  logger.info(`  → Rust DDoS Shield: ${DDOS_SHIELD_URL}`);
  logger.info(`  → Go PBAC Engine: ${PBAC_ENGINE_URL}`);
  logger.info(`  → Python Fraud ML: ${FRAUD_ML_URL}`);
  logger.info(`  → Fail-open mode: ${FAIL_OPEN}`);

  // ── Layer 1: DDoS Protection (Rust) ──
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!isProtectedEndpoint(req.path)) return next();

    try {
      const ddosResult = await checkDDoS(req);

      // Attach to request for downstream use
      (req as any).ddosResult = ddosResult;

      if (!ddosResult.allowed) {
        logger.warn(
          `[DDoS] Blocked: ip=${req.ip} path=${req.path} reason=${ddosResult.reason}`
        );
        return res.status(429).json({
          error: "Too Many Requests",
          message: ddosResult.reason || "Rate limit exceeded",
          threat_level: ddosResult.threat_level,
          retry_after: 60,
        });
      }

      // Add rate limit headers
      if (ddosResult.rate_limit_remaining !== undefined) {
        res.setHeader(
          "X-RateLimit-Remaining",
          ddosResult.rate_limit_remaining.toString()
        );
      }
      if (ddosResult.circuit_state) {
        res.setHeader("X-Circuit-State", ddosResult.circuit_state);
      }
    } catch (err) {
      if (!FAIL_OPEN) {
        return res.status(503).json({ error: "Security service unavailable" });
      }
    }

    next();
  });

  // ── Layer 2: PBAC Authorization (Go) ──
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!isProtectedEndpoint(req.path)) return next();

    // Extract user from session/JWT (set by auth middleware)
    const user = (req as any).user;
    if (!user) return next(); // Let auth middleware handle unauthenticated

    try {
      const pbacResult = await checkPBAC(
        req,
        user.id?.toString() || "",
        [user.role || "user"],
        user.kycLevel || 0
      );

      (req as any).pbacResult = pbacResult;

      if (!pbacResult.allowed) {
        logger.warn(
          `[PBAC] Denied: user=${user.id} path=${req.path} policy=${pbacResult.matched_policy} reason=${pbacResult.reason}`
        );
        return res.status(403).json({
          error: "Forbidden",
          message: pbacResult.reason || "Access denied by policy",
          policy: pbacResult.matched_policy,
          required_actions: pbacResult.required_actions,
        });
      }

      // Add PBAC headers
      res.setHeader("X-PBAC-Policy", pbacResult.matched_policy);
      res.setHeader("X-PBAC-EvalTime", pbacResult.eval_time_ms.toString());
    } catch (err) {
      if (!FAIL_OPEN) {
        return res
          .status(503)
          .json({ error: "Authorization service unavailable" });
      }
    }

    next();
  });

  // ── Layer 3: Fraud ML Scoring (Python) — only for transactions ──
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (!isTransactionEndpoint(req.path)) return next();
    if (req.method !== "POST") return next();

    const user = (req as any).user;
    if (!user) return next();

    try {
      const amount = extractAmount(req);
      if (amount <= 0) return next();

      const txId = `tx_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const fraudResult = await scoreFraud(
        req,
        user.id?.toString() || "",
        txId,
        amount
      );

      if (fraudResult) {
        (req as any).fraudScore = fraudResult;

        if (fraudResult.decision === "block") {
          logger.warn(
            `[FraudML] Blocked: user=${user.id} amount=${amount} score=${fraudResult.overall_score} factors=${fraudResult.risk_factors.join(", ")}`
          );
          return res.status(403).json({
            error: "Transaction Blocked",
            message: "This transaction has been flagged for review",
            risk_level: fraudResult.risk_level,
            risk_factors: fraudResult.risk_factors,
            recommendations: fraudResult.recommendations,
          });
        }

        // Add fraud headers for downstream use
        res.setHeader("X-Fraud-Score", fraudResult.overall_score.toString());
        res.setHeader("X-Fraud-Decision", fraudResult.decision);
        res.setHeader("X-Fraud-Risk", fraudResult.risk_level);
      }
    } catch (err) {
      // Fraud scoring failure should not block transactions in fail-open mode
      if (!FAIL_OPEN) {
        logger.error("[FraudML] Scoring failed, blocking transaction:", err);
        return res
          .status(503)
          .json({ error: "Fraud scoring service unavailable" });
      }
    }

    next();
  });

  // ── Security Health Endpoint ──
  app.get("/api/security/health", async (_req: Request, res: Response) => {
    const results = await Promise.allSettled([
      fetchWithTimeout(`${DDOS_SHIELD_URL}/health`, { method: "GET" }, 2000),
      fetchWithTimeout(`${PBAC_ENGINE_URL}/health`, { method: "GET" }, 2000),
      fetchWithTimeout(`${FRAUD_ML_URL}/health`, { method: "GET" }, 2000),
    ]);

    const services = {
      ddos_shield: {
        status:
          results[0].status === "fulfilled" && results[0].value
            ? "healthy"
            : "unavailable",
        url: DDOS_SHIELD_URL,
        language: "Rust",
      },
      pbac_engine: {
        status:
          results[1].status === "fulfilled" && results[1].value
            ? "healthy"
            : "unavailable",
        url: PBAC_ENGINE_URL,
        language: "Go",
      },
      fraud_ml: {
        status:
          results[2].status === "fulfilled" && results[2].value
            ? "healthy"
            : "unavailable",
        url: FRAUD_ML_URL,
        language: "Python",
      },
    };

    const allHealthy = Object.values(services).every(
      s => s.status === "healthy"
    );

    res.json({
      status: allHealthy ? "all_services_healthy" : "degraded",
      fail_open: FAIL_OPEN,
      services,
      timestamp: new Date().toISOString(),
    });
  });

  // ── PBAC Policy Management Endpoints ──
  app.get("/api/security/policies", async (_req: Request, res: Response) => {
    const resp = await fetchWithTimeout(`${PBAC_ENGINE_URL}/policies`, {
      method: "GET",
    });
    if (!resp)
      return res.status(503).json({ error: "PBAC service unavailable" });
    const data = await (resp as any).json();
    res.json(data);
  });

  app.post("/api/security/policies", async (req: Request, res: Response) => {
    const resp = await fetchWithTimeout(`${PBAC_ENGINE_URL}/policies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
    });
    if (!resp)
      return res.status(503).json({ error: "PBAC service unavailable" });
    const data = await (resp as any).json();
    res.json(data);
  });

  // ── Fraud ML Stats Endpoint ──
  app.get("/api/security/fraud-stats", async (_req: Request, res: Response) => {
    const resp = await fetchWithTimeout(`${FRAUD_ML_URL}/stats`, {
      method: "GET",
    });
    if (!resp)
      return res.status(503).json({ error: "Fraud ML service unavailable" });
    const data = await (resp as any).json();
    res.json(data);
  });

  logger.info("[SecurityOrchestrator] ✓ All security layers registered");
}
