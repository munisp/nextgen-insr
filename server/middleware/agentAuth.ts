// TypeScript enabled — Sprint 96 security audit
import { createHash } from "node:crypto";

import type { Request } from "express";
import { jwtVerify } from "jose";

import type { Agent } from "../../drizzle/schema";
import { getAgentById } from "../db";
import { getJwtSecret } from "../lib/envValidation";
import {
  blacklistToken,
  isTokenBlacklisted,
  isUserTokenRevoked,
} from "../lib/redisClient";

export interface AgentSession {
  id: number;
  agentId: string;
  name: string;
  tier: string;
  role: string;
}

/** Stable Redis key namespace for per-agent session revocation (F6-1). */
export function agentSessionRevocationKey(agentPk: number): string {
  return `agent:${agentPk}`;
}

/** Deterministic fingerprint of a session token for blacklist storage. */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Session-revocation checks are fail-CLOSED in production: if the revocation
 * store is unreachable the session is treated as revoked rather than letting
 * a killed session stay valid (F6-1). Outside production the helpers fail
 * open so dev/test environments without Redis keep working (logged).
 */
const revocationFailClosed = (): boolean =>
  process.env.NODE_ENV === "production";

/**
 * Verify an agent_session JWT and enforce the revocation lists:
 *  1. per-token blacklist (logout, suspension)
 *  2. per-agent revocation timestamp (PIN reset, force-logout-all)
 * Returns null for any invalid/expired/revoked token.
 */
export async function verifyAgentSessionToken(
  token: string
): Promise<AgentSession | null> {
  try {
    const secret = new TextEncoder().encode(getJwtSecret());
    const { payload } = await jwtVerify(token, secret);
    const failClosed = revocationFailClosed();
    if (await isTokenBlacklisted(hashSessionToken(token), failClosed)) {
      return null;
    }
    if (
      payload.sub &&
      typeof payload.iat === "number" &&
      (await isUserTokenRevoked(
        agentSessionRevocationKey(Number(payload.sub)),
        payload.iat,
        failClosed
      ))
    ) {
      return null;
    }
    return {
      id: Number(payload.sub),
      agentId: payload.agentId as string,
      name: payload.name as string,
      tier: payload.tier as string,
      role: (payload.role as string) ?? "agent",
    };
  } catch {
    return null;
  }
}

/**
 * Blacklist one agent_session token (single-device logout). The blacklist
 * entry expires with the token itself, so storage is bounded.
 */
export async function revokeAgentSessionToken(token: string): Promise<void> {
  try {
    const secret = new TextEncoder().encode(getJwtSecret());
    const { payload } = await jwtVerify(token, secret);
    const exp =
      typeof payload.exp === "number"
        ? payload.exp
        : Math.floor(Date.now() / 1000);
    await blacklistToken(hashSessionToken(token), exp);
  } catch {
    // Token failed verification — it is already unusable, nothing to revoke.
  }
}

export function extractAgentSessionToken(req: Request): string | null {
  const cookieHeader = req.headers.cookie ?? "";
  const match = cookieHeader.match(/agent_session=([^;]+)/);
  return match?.[1] ?? null;
}

export async function getAgentFromCookie(
  req: Request
): Promise<AgentSession | null> {
  const token = extractAgentSessionToken(req);
  if (!token) return null;
  return verifyAgentSessionToken(token);
}

export type AgentScopeResult =
  | { ok: true; agentId: number }
  | { ok: false; code: "FORBIDDEN" | "BAD_REQUEST"; message: string };

/**
 * F7-1: resolve which agent record the caller may act on, using session
 * identity ONLY — never caller-supplied identity alone.
 *  - An agent_session holder acts ONLY on their own record; a body agentId
 *    that disagrees with the session is rejected.
 *  - A Keycloak admin (no agent session) may act on an explicit agentId for
 *    ops tooling.
 *  - Everything else is denied (fail-closed).
 */
export async function resolveAgentScope(
  req: Request,
  userRole: string | null | undefined,
  inputAgentId: number | null | undefined
): Promise<AgentScopeResult> {
  const sessionAgent = await getAgentFromCookie(req);
  if (sessionAgent) {
    if (inputAgentId != null && inputAgentId !== sessionAgent.id) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "Session agent does not match the supplied agentId",
      };
    }
    return { ok: true, agentId: sessionAgent.id };
  }
  if (userRole === "admin") {
    if (inputAgentId == null) {
      return {
        ok: false,
        code: "BAD_REQUEST",
        message: "agentId is required for admin-initiated changes",
      };
    }
    return { ok: true, agentId: inputAgentId };
  }
  return {
    ok: false,
    code: "FORBIDDEN",
    message: "Agent session required — identity must come from the session",
  };
}

function agentAuthError(
  message: string,
  code: string
): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = code;
  return err;
}

export async function requireAgent(req: Request): Promise<Agent> {
  const session = await getAgentFromCookie(req);
  if (!session) {
    throw agentAuthError("Agent session required", "UNAUTHORIZED");
  }
  const agent = await getAgentById(session.id);
  if (!agent) {
    throw agentAuthError("Agent not found", "NOT_FOUND");
  }
  // F6-6: a suspended/terminated agent's still-unexpired JWT must not keep
  // transacting. Login enforces this; every authenticated request now does too.
  if (!agent.isActive) {
    throw agentAuthError(
      "Agent account is suspended. Contact support.",
      "FORBIDDEN"
    );
  }
  return agent;
}
