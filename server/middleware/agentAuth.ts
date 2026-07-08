// @ts-check

// TypeScript enabled — Sprint 96 security audit
import type { Request } from "express";
import { jwtVerify } from "jose";
import { getAgentById } from "../db";
import type { Agent } from "../../drizzle/schema";
import { getJwtSecret } from "../lib/envValidation";

export interface AgentSession {
  id: number;
  agentId: string;
  name: string;
  tier: string;
  role: string;
}

export async function getAgentFromCookie(
  req: Request
): Promise<AgentSession | null> {
  const cookieHeader = req.headers.cookie ?? "";
  const match = cookieHeader.match(/agent_session=([^;]+)/);
  if (!match) return null;

  try {
    const secret = new TextEncoder().encode(getJwtSecret());
    const { payload } = await jwtVerify(match[1], secret);
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

export async function requireAgent(req: Request): Promise<Agent> {
  const session = await getAgentFromCookie(req);
  if (!session) {
    const err = new Error("Agent session required") as any;
    err.code = "UNAUTHORIZED";
    throw err;
  }
  const agent = await getAgentById(session.id);
  if (!agent) {
    const err = new Error("Agent not found") as any;
    err.code = "NOT_FOUND";
    throw err;
  }
  return agent;
}
