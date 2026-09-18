/**
 * agentOnboardingG3.integration.test.ts — G3 agent-onboarding audit fixes,
 * exercised through the REAL routers + REAL PG (PGlite) + mini-Redis.
 *
 * Covered findings (audit/agent-onboarding.md):
 *  #1  register → PENDING (isActive=false, terminal disabled, zero float,
 *      no serial), server PIN policy, NG phone validation, duplicate phone
 *      rejected, phone-verify OTP issued; activation gate requires
 *      verification evidence (bulkActivate fails closed without it).
 *  #2  approveSession is admin-only, records the approver, blocks self-
 *      approval (SoD by email match).
 *  #3  agent.update privilege attributes are admin-only; non-admin cannot
 *      even edit non-privilege fields of another agent.
 *  #4/#5/#6/#7/#25  onboarding step gates: order enforced, advanceStep
 *      cannot forge verified steps, completeKyc accepts the REAL approval
 *      signal ("approved"), completeTerminal is admin + serial-unique.
 *  #14 deactivation cascade: bulkSuspend flips isActive/floatLocked/
 *      terminalEnabled AND bumps the per-agent token-revocation key in
 *      Redis; agentSuspensionWorkflow.suspend/lift work for real.
 *  #21 terminalLeasing.createLease: unauthenticated denied, no stealing an
 *      assigned terminal, inactive target rejected, happy path assigns.
 *
 * All seeded phones/serials use the 0913xxxxxxx range, unused elsewhere.
 */
import { eq } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";

import {
  agents,
  agentOnboardingProgress,
  kycSessions,
  otpTokens,
  agentSuspensionLog,
} from "../../drizzle/schema";
import { posTerminals } from "../../drizzle/schema.additions";
import { getDb } from "../../server/db";
import { getRedisClient } from "../../server/lib/redisClient";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const PHONE_A = "09130000001"; // self-registered agent
const PHONE_B = "09130000002"; // seeded active agent
const PHONE_SUP = "09130000003"; // seeded supervisor
const CODE_A = "AGTG3-SELF-001";
const CODE_B = "AGTG3-ACTIVE-001";
const CODE_SUP = "AGTG3-SUP-001";
const SERIAL_1 = "G3-SN-0001";

let agentAPk: number;
let agentBPk: number;

async function seedActiveAgent() {
  const db = (await getDb())!;
  const [b] = await db
    .insert(agents)
    .values({
      agentId: CODE_B,
      name: "G3 Active Agent",
      phone: PHONE_B,
      pinHash: await bcrypt.hash("5937", 10),
      // 2026-05 (G3): isActive defaults to false — active fixtures must
      // opt in explicitly (this fixture tests ACTIVE-agent behavior).
      isActive: true,
      premiumReserve: "50000.00",
    })
    .returning();
  agentBPk = b.id;
  await db.insert(agents).values({
    agentId: CODE_SUP,
    name: "G3 Supervisor",
    phone: PHONE_SUP,
    pinHash: await bcrypt.hash("6842", 10),
    role: "supervisor",
    isActive: true,
  });
}

beforeAll(async () => {
  resetAssertionCount();
  await seedActiveAgent();
});

afterAll(() => {
  console.log(`[agentOnboardingG3] assertions: ${getAssertionCount()}`);
});

describe("G3 #1: self-registration creates a PENDING agent", () => {
  it("rejects weak PINs (server-enforced policy)", async () => {
    const anon = callerFor(null);
    for (const weak of ["123456", "1111", "1234"]) {
      await expectTrpcError(
        anon.agent.register({
          agentId: `AGTG3-WEAK-${weak}`,
          name: "Weak Pin",
          phone: PHONE_A,
          pin: weak,
        }),
        "BAD_REQUEST"
      );
    }
  });

  it("rejects non-Nigerian phone numbers", async () => {
    const anon = callerFor(null);
    await expectTrpcError(
      anon.agent.register({
        agentId: "AGTG3-BADPHONE",
        name: "Bad Phone",
        phone: "12345",
        pin: "4826",
      }),
      "BAD_REQUEST"
    );
  });

  it("registers pending: inactive, terminal disabled, zero float, no serial, OTP issued", async () => {
    const anon = callerFor(null);
    const res = await anon.agent.register({
      agentId: CODE_A,
      name: "G3 Self Agent",
      phone: PHONE_A,
      pin: "4826",
      email: "g3-self@integration.local",
    });
    expect(res.status).toBe("pending");
    expect(res.phoneVerificationRequired).toBe(true);
    agentAPk = res.agentId;

    const db = (await getDb())!;
    const [row] = await db.select().from(agents).where(eq(agents.id, agentAPk));
    expect(row.isActive).toBe(false);
    expect(row.terminalEnabled).toBe(false);
    expect(Number(row.floatLimit)).toBe(0);
    expect(row.terminalSerial).toBeNull();

    const [otp] = await db
      .select()
      .from(otpTokens)
      .where(eq(otpTokens.agentId, agentAPk));
    expect(otp.purpose).toBe("phone_verify");
    expect(otp.used).toBe(false);
  });

  it("rejects a duplicate phone identity", async () => {
    const anon = callerFor(null);
    await expectTrpcError(
      anon.agent.register({
        agentId: "AGTG3-DUP",
        name: "Dup Phone",
        phone: PHONE_A,
        pin: "5937",
      }),
      "CONFLICT"
    );
  });

  it("verifyPhone rejects a wrong OTP and counts attempts", async () => {
    const anon = callerFor(null);
    await expectTrpcError(
      anon.agent.verifyPhone({ agentId: CODE_A, otp: "000000" }),
      "UNAUTHORIZED"
    );
    const db = (await getDb())!;
    const [otp] = await db
      .select()
      .from(otpTokens)
      .where(eq(otpTokens.agentId, agentAPk));
    expect(otp.attempts).toBe(1);
  });

  it("activation gate: bulkActivate fails closed without verification evidence", async () => {
    await expectTrpcError(
      callerFor(adminUser).agent.bulkActivate({ ids: [agentAPk] }),
      "PRECONDITION_FAILED"
    );
    const db = (await getDb())!;
    const [row] = await db.select().from(agents).where(eq(agents.id, agentAPk));
    expect(row.isActive).toBe(false);
  });

  it("activation gate: bulkActivate succeeds once the phone is verified", async () => {
    // Consume the OTP as a real verifyPhone success would (the SMS body is
    // only ever delivered to the agent's phone; the fixture drives the store
    // directly rather than intercepting the SMS).
    const db = (await getDb())!;
    await db
      .update(otpTokens)
      .set({ used: true, usedAt: new Date() })
      .where(eq(otpTokens.agentId, agentAPk));

    const res = await callerFor(adminUser).agent.bulkActivate({ ids: [agentAPk] });
    expect(res.count).toBe(1);
    const [row] = await db.select().from(agents).where(eq(agents.id, agentAPk));
    expect(row.isActive).toBe(true);
  });

  it("bulkActivate is admin-gated", async () => {
    await expectTrpcError(
      callerFor(regularUser).agent.bulkActivate({ ids: [agentBPk] }),
      "FORBIDDEN"
    );
  });
});

describe("G3 #2: KYC approval is admin-only with SoD + approver identity", () => {
  let sessionId: number;

  it("non-admin cannot approve", async () => {
    const db = (await getDb())!;
    const [s] = await db
      .insert(kycSessions)
      .values({ agentId: agentBPk, type: "standard", status: "pending" })
      .returning();
    sessionId = s.id;
    await expectTrpcError(
      callerFor(regularUser).agentKyc.approveSession({ sessionId }),
      "FORBIDDEN"
    );
  });

  it("self-approval is blocked (approver email matches KYC subject)", async () => {
    const db = (await getDb())!;
    await db
      .update(agents)
      .set({ email: adminUser.email })
      .where(eq(agents.id, agentBPk));
    await expectTrpcError(
      callerFor(adminUser).agentKyc.approveSession({ sessionId }),
      "FORBIDDEN"
    );
    await db
      .update(agents)
      .set({ email: "g3-active@integration.local" })
      .where(eq(agents.id, agentBPk));
  });

  it("admin approval records the approver identity", async () => {
    const res = await callerFor(adminUser).agentKyc.approveSession({
      sessionId,
      reviewNotes: "docs sighted",
    });
    expect(res.session.status).toBe("approved");
    expect(res.session.reviewedBy).toBe(String(adminUser.id));
  });
});

describe("G3 #3: agent.update privilege attributes are admin-only", () => {
  it("non-admin cannot escalate role", async () => {
    await expectTrpcError(
      callerFor(regularUser).agent.update({ id: agentBPk, role: "admin" }),
      "FORBIDDEN"
    );
    await expectTrpcError(
      callerFor(regularUser).agent.update({ id: agentBPk, floatLimit: 9999999 }),
      "FORBIDDEN"
    );
  });

  it("non-admin cannot edit another agent's plain fields either", async () => {
    await expectTrpcError(
      callerFor(regularUser).agent.update({ id: agentBPk, name: "Hijacked" }),
      "FORBIDDEN"
    );
  });

  it("admin can set tier; duplicate terminal serial is rejected", async () => {
    const admin = callerFor(adminUser);
    const ok = await admin.agent.update({ id: agentBPk, tier: "Silver" });
    expect(ok.success).toBe(true);
    const db = (await getDb())!;
    await db
      .update(agents)
      .set({ terminalSerial: SERIAL_1 })
      .where(eq(agents.id, agentAPk));
    await expectTrpcError(
      admin.agent.update({ id: agentBPk, terminalSerial: SERIAL_1 }),
      "CONFLICT"
    );
  });
});

describe("G3 #4/#5/#6/#7/#25: onboarding step gates", () => {
  const CODE_W = "AGTG3-WIZ-001";
  let wizPk: number;

  beforeAll(async () => {
    const db = (await getDb())!;
    const [w] = await db
      .insert(agents)
      .values({
        agentId: CODE_W,
        name: "G3 Wizard Agent",
        phone: "09130000004",
        pinHash: "x",
        isActive: false,
        premiumReserve: "0.00",
      })
      .returning();
    wizPk = w.id;
    await db.insert(agentOnboardingProgress).values({
      agentId: CODE_W,
      currentStep: "profile",
    });
  });

  it("completeKyc requires the profile step first", async () => {
    await expectTrpcError(
      callerFor(regularUser).agentOnboarding.completeKyc({ agentId: CODE_W }),
      "PRECONDITION_FAILED"
    );
  });

  it("completeKyc requires an APPROVED kyc session (real approval signal)", async () => {
    const db = (await getDb())!;
    await db
      .update(agentOnboardingProgress)
      .set({ profileComplete: true, currentStep: "kyc" })
      .where(eq(agentOnboardingProgress.agentId, CODE_W));
    await expectTrpcError(
      callerFor(regularUser).agentOnboarding.completeKyc({ agentId: CODE_W }),
      "BAD_REQUEST"
    );
    // A 'pending' session must NOT satisfy the gate; an 'approved' one must.
    await db
      .insert(kycSessions)
      .values({ agentId: wizPk, type: "standard", status: "pending" });
    await expectTrpcError(
      callerFor(regularUser).agentOnboarding.completeKyc({ agentId: CODE_W }),
      "BAD_REQUEST"
    );
    const [approved] = await db
      .insert(kycSessions)
      .values({ agentId: wizPk, type: "standard", status: "approved" })
      .returning();
    expect(approved.status).toBe("approved");
    const prog = await callerFor(regularUser).agentOnboarding.completeKyc({
      agentId: CODE_W,
    });
    expect(prog.kycComplete).toBe(true);
  });

  it("advanceStep cannot forge verified steps", async () => {
    const admin = callerFor(adminUser);
    for (const step of [2, 3, 4, 5]) {
      await expectTrpcError(
        admin.agentOnboarding.advanceStep({ agentId: wizPk, stepNumber: step }),
        "BAD_REQUEST"
      );
    }
    const db = (await getDb())!;
    const [prog] = await db
      .select()
      .from(agentOnboardingProgress)
      .where(eq(agentOnboardingProgress.agentId, CODE_W));
    expect(prog.floatFunded).toBe(false);
    expect(prog.terminalAssigned).toBe(false);
    expect(prog.trainingComplete).toBe(false);
  });

  it("completeFloat requires kycComplete; completeTerminal is admin + ordered + serial-unique", async () => {
    const db = (await getDb())!;
    // Not yet float-eligible amount; first prove ordering: reset kycComplete.
    await db
      .update(agentOnboardingProgress)
      .set({ kycComplete: false })
      .where(eq(agentOnboardingProgress.agentId, CODE_W));
    await expectTrpcError(
      callerFor(regularUser).agentOnboarding.completeFloat({ agentId: CODE_W }),
      "PRECONDITION_FAILED"
    );
    await db
      .update(agentOnboardingProgress)
      .set({ kycComplete: true })
      .where(eq(agentOnboardingProgress.agentId, CODE_W));
    await db
      .update(agents)
      .set({ premiumReserve: "20000.00" })
      .where(eq(agents.id, wizPk));
    const progF = await callerFor(regularUser).agentOnboarding.completeFloat({
      agentId: CODE_W,
    });
    expect(progF.floatFunded).toBe(true);

    // Terminal: non-admin denied.
    await expectTrpcError(
      callerFor(regularUser).agentOnboarding.completeTerminal({
        agentId: CODE_W,
        terminalSerial: "G3-SN-WIZ",
      }),
      "FORBIDDEN"
    );
    // Admin + duplicate serial rejected (SERIAL_1 belongs to agent A).
    await expectTrpcError(
      callerFor(adminUser).agentOnboarding.completeTerminal({
        agentId: CODE_W,
        terminalSerial: SERIAL_1,
      }),
      "CONFLICT"
    );
    const progT = await callerFor(adminUser).agentOnboarding.completeTerminal({
      agentId: CODE_W,
      terminalSerial: "G3-SN-WIZ",
    });
    expect(progT.terminalAssigned).toBe(true);
  });

  it("completeTraining activates only after ALL steps + verification evidence", async () => {
    // All step flags are set by the real endpoints above; KYC approval is the
    // verification evidence.
    const res = await callerFor(adminUser).agentOnboarding.completeTraining({
      agentId: CODE_W,
    });
    expect(res.trainingComplete).toBe(true);
    const db = (await getDb())!;
    const [row] = await db.select().from(agents).where(eq(agents.id, wizPk));
    expect(row.isActive).toBe(true);
  });
});

describe("G3 #14: deactivation cascade + suspension workflow", () => {
  it("bulkSuspend flips float/terminal flags and revokes tokens in Redis", async () => {
    const admin = callerFor(adminUser);
    const res = await admin.agent.bulkSuspend({
      ids: [agentBPk],
      reason: "G3 cascade test",
    });
    expect(res.count).toBe(1);
    const db = (await getDb())!;
    const [row] = await db.select().from(agents).where(eq(agents.id, agentBPk));
    expect(row.isActive).toBe(false);
    expect(row.floatLocked).toBe(true);
    expect(row.terminalEnabled).toBe(false);
    const redis = getRedisClient();
    const revokedAt = await redis.get(
      `blacklist:user:agent:${agentBPk}:revoked_at`
    );
    expect(revokedAt).not.toBeNull();
  });

  it("suspensionWorkflow.suspend/lift are real (admin-only, logged)", async () => {
    await expectTrpcError(
      callerFor(regularUser).agentSuspensionWorkflow.suspend({ id: agentAPk }),
      "FORBIDDEN"
    );
    const admin = callerFor(adminUser);
    const sus = await admin.agentSuspensionWorkflow.suspend({
      id: agentAPk,
      data: { reason: "G3 workflow test" },
    });
    expect(sus.status).toBe("suspended");
    const db = (await getDb())!;
    const logs = await db
      .select()
      .from(agentSuspensionLog)
      .where(eq(agentSuspensionLog.agentId, agentAPk));
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].action).toBe("suspend");

    const lift = await admin.agentSuspensionWorkflow.lift({ id: agentAPk });
    expect(lift.status).toBe("active");
    const [row] = await db.select().from(agents).where(eq(agents.id, agentAPk));
    expect(row.isActive).toBe(true);
    // Lift must NOT silently unlock float/terminal.
    expect(row.floatLocked).toBe(true);
    expect(row.terminalEnabled).toBe(false);
  });
});

describe("G3 #21: terminalLeasing.createLease ownership/approval", () => {
  let termId: number;

  beforeAll(async () => {
    const db = (await getDb())!;
    const [t] = await db
      .insert(posTerminals)
      .values({
        terminalId: "TERM-G3-001",
        serialNumber: "G3-POS-0001",
        model: "PAX A920 MAX",
        status: "inactive",
      })
      .returning();
    termId = t.id;
  });

  it("requires a session or admin; rejects lease to inactive agent", async () => {
    await expectTrpcError(
      callerFor(regularUser).terminalLeasing.createLease({
        terminalId: termId,
        agentId: agentBPk,
        monthlyRate: 5000,
        durationMonths: 12,
      }),
      "UNAUTHORIZED"
    );
    const db = (await getDb())!;
    const [inactive] = await db
      .insert(agents)
      .values({
        agentId: "AGTG3-INACTIVE",
        name: "Inactive",
        phone: "09130000005",
        pinHash: "x",
        isActive: false,
      })
      .returning();
    await expectTrpcError(
      callerFor(adminUser).terminalLeasing.createLease({
        terminalId: termId,
        agentId: inactive.id,
        monthlyRate: 5000,
        durationMonths: 12,
      }),
      "PRECONDITION_FAILED"
    );
  });

  it("admin lease assigns the terminal; a second lease for another agent is a CONFLICT", async () => {
    const admin = callerFor(adminUser);
    // Reactivate agent B for the happy path.
    const db = (await getDb())!;
    await db
      .update(agents)
      .set({ isActive: true, floatLocked: false })
      .where(eq(agents.id, agentBPk));

    const lease = await admin.terminalLeasing.createLease({
      terminalId: termId,
      agentId: agentBPk,
      monthlyRate: 5000,
      durationMonths: 12,
    });
    expect(lease.status).toBe("active");
    const [t] = await db
      .select()
      .from(posTerminals)
      .where(eq(posTerminals.id, termId));
    expect(t.agentId).toBe(agentBPk);

    await expectTrpcError(
      admin.terminalLeasing.createLease({
        terminalId: termId,
        agentId: agentAPk,
        monthlyRate: 5000,
        durationMonths: 12,
      }),
      "CONFLICT"
    );
  });
});
