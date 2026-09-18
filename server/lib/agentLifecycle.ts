/**
 * agentLifecycle.ts — G3 (agent-onboarding audit) single choke point for
 * agent activation eligibility and deactivation teardown.
 *
 * Before this module, "suspend/delete" flipped ONE boolean and left sessions
 * (12h JWTs), sockets, float, and terminals live (audit #14), while
 * "activate" was possible for unverified agents registered through the
 * public self-registration path (audit #1/#8).
 *
 * Contracts:
 *  - deactivateAgentCascade: isActive=false + floatLocked=true +
 *    terminalEnabled=false, per-agent token revocation bump (F3/F6-1
 *    blacklist), socket disconnect, audit-log row. The DB write is
 *    fail-closed (throws). Token revocation/socket teardown are
 *    best-effort-with-error-logging because requireAgent already re-checks
 *    isActive from the DB on every request (the revocation bump closes the
 *    socket/me/cookie-scope paths that do not).
 *  - assertAgentActivationEligible: an agent may only be flipped to
 *    isActive=true when there is durable evidence of verification — a
 *    consumed phone-verify OTP (audit #1) or an approved KYC session.
 *    Fail-closed: no evidence, no activation.
 */
import { and, eq } from "drizzle-orm";

import {
  agents,
  agentSuspensionLog,
  kycSessions,
  otpTokens,
} from "../../drizzle/schema";
import { TRPCError } from "@trpc/server";
import { getDb, writeAuditLog } from "../db";
import { logger } from "../_core/logger";
import { revokeAllUserTokens } from "./redisClient";
import { agentSessionRevocationKey } from "../middleware/agentAuth";
import { disconnectAgentSockets } from "../socketSingleton";

export interface CascadeActor {
  /** Numeric platform-user id or agent PK of the actor, when known. */
  id?: number | null;
  /** Stable human/machine identity recorded in audit metadata. */
  label: string;
}

/**
 * Durable evidence that an agent's identity was verified:
 *  1. a consumed otp_tokens row with purpose='phone_verify' (G3 register
 *     flow), or
 *  2. a kyc_sessions row in status 'approved' (wizard/J04 flow).
 */
export async function agentHasVerificationEvidence(
  agentPk: number
): Promise<{ ok: boolean; evidence: string }> {
  const db = await getDb();
  if (!db) return { ok: false, evidence: "db_unavailable" };
  const [otp] = await db
    .select({ id: otpTokens.id })
    .from(otpTokens)
    .where(
      and(
        eq(otpTokens.agentId, agentPk),
        eq(otpTokens.purpose, "phone_verify"),
        eq(otpTokens.used, true)
      )
    )
    .limit(1);
  if (otp) return { ok: true, evidence: `phone_verify_otp:${otp.id}` };
  const [kyc] = await db
    .select({ id: kycSessions.id })
    .from(kycSessions)
    .where(
      and(eq(kycSessions.agentId, agentPk), eq(kycSessions.status, "approved"))
    )
    .limit(1);
  if (kyc) return { ok: true, evidence: `kyc_approved:${kyc.id}` };
  return { ok: false, evidence: "none" };
}

/**
 * Throws PRECONDITION_FAILED unless the agent has verification evidence.
 * Every path that flips isActive false→true must call this first
 * (bulkActivate, agentManagement.setActive, onboarding activation).
 */
export async function assertAgentActivationEligible(
  agentPk: number
): Promise<string> {
  const { ok, evidence } = await agentHasVerificationEvidence(agentPk);
  if (!ok) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Agent cannot be activated: no verification evidence (phone verification or approved KYC) on file",
    });
  }
  return evidence;
}

/**
 * Full deactivation teardown for one agent (suspend OR delete).
 * Returns the number of sockets disconnected.
 */
export async function deactivateAgentCascade(opts: {
  agentPk: number;
  agentCode?: string;
  reason: string;
  actor: CascadeActor;
  action: "AGENT_SUSPENDED" | "AGENT_DELETED" | "BULK_SUSPEND" | "BULK_DELETE";
}): Promise<{ socketsDisconnected: number }> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable — cannot deactivate agent (fail-closed)",
    });
  }
  // One guarded statement: identity + funds + hardware flags flip together.
  await db
    .update(agents)
    .set({
      isActive: false,
      floatLocked: true,
      terminalEnabled: false,
      terminalDisabledReason: opts.reason,
      ...(opts.action.includes("DELETE") ? { deletedAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(agents.id, opts.agentPk));

  // Revoke ALL live session tokens for this agent (F3 revocation timestamp).
  try {
    await revokeAllUserTokens(agentSessionRevocationKey(opts.agentPk));
  } catch (err) {
    logger.error(
      { err: String(err), agentPk: opts.agentPk },
      "[AgentLifecycle] token revocation bump failed — requireAgent isActive re-check remains the enforcement leg"
    );
  }

  // Drop live sockets bound to this agent identity (no-op under test runners
  // where Socket.IO is not initialised).
  const socketsDisconnected = disconnectAgentSockets(opts.agentPk);

  await writeAuditLog({
    agentId: opts.agentPk,
    action: opts.action,
    resource: "agent",
    resourceId: String(opts.agentPk),
    status: "success",
    metadata: {
      agentCode: opts.agentCode,
      reason: opts.reason,
      actor: opts.actor.label,
      socketsDisconnected,
      cascade: ["isActive=false", "floatLocked", "terminalDisabled", "tokensRevoked", "socketsDisconnected"],
    },
  });
  return { socketsDisconnected };
}

/**
 * Reactivation: flips isActive back on. Deliberately does NOT unlock float
 * or re-enable the terminal — those stay locked until an admin explicitly
 * unlocks them (setFloatLock/setTerminalEnabled), so a lift is not a silent
 * full-restore. Caller must have passed assertAgentActivationEligible.
 */
export async function reactivateAgent(opts: {
  agentPk: number;
  agentCode?: string;
  actor: CascadeActor;
  action?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable — cannot reactivate agent (fail-closed)",
    });
  }
  await db
    .update(agents)
    .set({ isActive: true, updatedAt: new Date() })
    .where(eq(agents.id, opts.agentPk));
  await writeAuditLog({
    agentId: opts.agentPk,
    action: opts.action ?? "AGENT_ACTIVATED",
    resource: "agent",
    resourceId: String(opts.agentPk),
    status: "success",
    metadata: { agentCode: opts.agentCode, actor: opts.actor.label },
  });
}

/**
 * G3 (audit #19): replace free-text "supervisor approval" strings with a
 * VERIFIED supervisor identity. The code must be the agent code of an
 * ACTIVE agent whose role is supervisor or admin, and must not be the agent
 * being approved (no self-approval). Returns the verified supervisor row's
 * identity for audit metadata; throws otherwise.
 */
export async function verifySupervisorApproval(opts: {
  code: string;
  contextAgentPk?: number;
}): Promise<{ supervisorPk: number; supervisorCode: string }> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable — supervisor identity cannot be verified (fail-closed)",
    });
  }
  const [sup] = await db
    .select({
      id: agents.id,
      agentId: agents.agentId,
      role: agents.role,
      isActive: agents.isActive,
    })
    .from(agents)
    .where(eq(agents.agentId, opts.code.toUpperCase()))
    .limit(1);
  if (
    !sup ||
    !sup.isActive ||
    (sup.role !== "supervisor" && sup.role !== "admin")
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Invalid supervisor approval: code must identify an active supervisor/admin agent",
    });
  }
  if (opts.contextAgentPk != null && sup.id === opts.contextAgentPk) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "An agent cannot self-approve — supervisor must be a different identity",
    });
  }
  return { supervisorPk: sup.id, supervisorCode: sup.agentId };
}

/** Append a row to the agent_suspension_log workflow table (real store for
 * agentSuspensionWorkflow.suspend/lift). */
export async function writeSuspensionLog(opts: {
  agentPk: number;
  action: "suspend" | "reactivate";
  reason: string;
  performedBy: number;
  previousStatus: string;
  newStatus: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "DB unavailable — suspension log write failed (fail-closed)",
    });
  }
  await db.insert(agentSuspensionLog).values({
    agentId: opts.agentPk,
    action: opts.action,
    reason: opts.reason,
    performedBy: opts.performedBy,
    previousStatus: opts.previousStatus,
    newStatus: opts.newStatus,
  });
}
