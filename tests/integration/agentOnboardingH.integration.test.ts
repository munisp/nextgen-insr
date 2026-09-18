/**
 * agentOnboardingH.integration.test.ts — H-wave adversarial-verifier fixes,
 * REAL routers + PGlite + mini-Redis.
 *
 *  #1 agentOnboardingWizard.approveAgent: admin-only, requires durable
 *     verification evidence (assertAgentActivationEligible), approver logged.
 *  #2 agentKyc.approveSession SoD: NULL subject email fails CLOSED (honest
 *     PRECONDITION_FAILED) instead of silently skipping the check.
 *  #3 agent.bulkSetTier: admin-only with actor in audit metadata.
 *
 * Phones in the 0914xxxxxxx range, unused elsewhere.
 */
import { eq } from "drizzle-orm";
import { describe, it, beforeAll, afterAll } from "vitest";
import bcrypt from "bcryptjs";

import {
  agents,
  kycSessions,
  otpTokens,
  auditLog,
} from "../../drizzle/schema";
import { getDb } from "../../server/db";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const PHONE_ELIG = "09140000001"; // eligible pending agent (verified phone)
const PHONE_INELIG = "09140000002"; // pending, no verification
const PHONE_NULLEMAIL = "09140000003"; // KYC subject with NULL email
const PHONE_KYC = "09140000004"; // KYC subject with own email

let eligPk: number;
let ineligPk: number;
let nullEmailPk: number;
let kycPk: number;

beforeAll(async () => {
  resetAssertionCount();
  const db = (await getDb())!;
  const [e] = await db
    .insert(agents)
    .values({
      agentId: "AGTH-ELIG-001",
      name: "H Eligible",
      phone: PHONE_ELIG,
      pinHash: await bcrypt.hash("4826", 10),
      isActive: false,
      email: "h-elig@integration.local",
    })
    .returning();
  eligPk = e.id;
  // Durable phone-verification evidence (what a consumed G3 register OTP
  // looks like) — makes the agent activation-eligible.
  await db.insert(otpTokens).values({
    agentId: eligPk,
    hashedOtp: await bcrypt.hash("123456", 10),
    purpose: "phone_verify",
    expiresAt: new Date(Date.now() + 600_000),
    used: true,
    usedAt: new Date(),
  });

  const [i] = await db
    .insert(agents)
    .values({
      agentId: "AGTH-INELIG-001",
      name: "H Ineligible",
      phone: PHONE_INELIG,
      pinHash: "x",
      isActive: false,
      email: "h-inelig@integration.local",
    })
    .returning();
  ineligPk = i.id;

  const [n] = await db
    .insert(agents)
    .values({
      agentId: "AGTH-NULLEMAIL",
      name: "H Null Email",
      phone: PHONE_NULLEMAIL,
      pinHash: "x",
      isActive: false,
      email: null, // no identity binding — SoD must fail closed
    })
    .returning();
  nullEmailPk = n.id;

  const [k] = await db
    .insert(agents)
    .values({
      agentId: "AGTH-KYC-001",
      name: "H Kyc Subject",
      phone: PHONE_KYC,
      pinHash: "x",
      isActive: false,
      email: "h-kyc@integration.local",
    })
    .returning();
  kycPk = k.id;
});

afterAll(() => {
  console.log(`[agentOnboardingH] assertions: ${getAssertionCount()}`);
});

describe("H #1: wizard approveAgent is admin-gated + evidence-gated", () => {
  it("non-admin is denied", async () => {
    await expectTrpcError(
      callerFor(regularUser).agentOnboardingWizard.approveAgent({
        agentId: eligPk,
      }),
      "FORBIDDEN"
    );
    const db = (await getDb())!;
    const [row] = await db.select().from(agents).where(eq(agents.id, eligPk));
    expect(row.isActive).toBe(false);
  });

  it("admin cannot activate an agent with NO verification evidence", async () => {
    await expectTrpcError(
      callerFor(adminUser).agentOnboardingWizard.approveAgent({
        agentId: ineligPk,
      }),
      "PRECONDITION_FAILED"
    );
    const db = (await getDb())!;
    const [row] = await db.select().from(agents).where(eq(agents.id, ineligPk));
    expect(row.isActive).toBe(false);
  });

  it("admin CAN activate an eligible agent; approver identity is audited", async () => {
    const res = await callerFor(adminUser).agentOnboardingWizard.approveAgent({
      agentId: eligPk,
    });
    expect(res.success).toBe(true);
    const db = (await getDb())!;
    const [row] = await db.select().from(agents).where(eq(agents.id, eligPk));
    expect(row.isActive).toBe(true);
    const [log] = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.resourceId, String(eligPk)))
      .limit(1);
    expect(log.action).toBe("agent_onboarding_approved");
    const md = log.metadata as Record<string, unknown>;
    expect(md.approverUserId).toBe(adminUser.id);
  });

  it("approving a nonexistent agent fails honestly", async () => {
    await expectTrpcError(
      callerFor(adminUser).agentOnboardingWizard.approveAgent({
        agentId: 999999,
      }),
      "NOT_FOUND"
    );
  });
});

describe("H #2: KYC self-approval SoD fails closed on NULL email", () => {
  it("NULL subject email → honest refusal (not silent allow)", async () => {
    const db = (await getDb())!;
    const [s] = await db
      .insert(kycSessions)
      .values({ agentId: nullEmailPk, type: "standard", status: "pending" })
      .returning();
    await expectTrpcError(
      callerFor(adminUser).agentKyc.approveSession({ sessionId: s.id }),
      "PRECONDITION_FAILED"
    );
    const [row] = await db
      .select()
      .from(kycSessions)
      .where(eq(kycSessions.id, s.id));
    expect(row.status).toBe("pending"); // NOT silently approved
  });

  it("email match → FORBIDDEN (self-approval)", async () => {
    const db = (await getDb())!;
    await db
      .update(agents)
      .set({ email: adminUser.email })
      .where(eq(agents.id, kycPk));
    const [s] = await db
      .insert(kycSessions)
      .values({ agentId: kycPk, type: "standard", status: "pending" })
      .returning();
    await expectTrpcError(
      callerFor(adminUser).agentKyc.approveSession({ sessionId: s.id }),
      "FORBIDDEN"
    );
    await db
      .update(agents)
      .set({ email: "h-kyc@integration.local" })
      .where(eq(agents.id, kycPk));
  });

  it("distinct emails → admin approval still works (gate not over-broad)", async () => {
    const db = (await getDb())!;
    const [s] = await db
      .insert(kycSessions)
      .values({ agentId: kycPk, type: "standard", status: "pending" })
      .returning();
    const res = await callerFor(adminUser).agentKyc.approveSession({
      sessionId: s.id,
    });
    expect(res.session.status).toBe("approved");
    expect(res.session.reviewedBy).toBe(String(adminUser.id));
  });
});

describe("H #3: bulkSetTier is admin-only", () => {
  it("non-admin denied", async () => {
    await expectTrpcError(
      callerFor(regularUser).agent.bulkSetTier({
        ids: [kycPk],
        tier: "Gold",
      }),
      "FORBIDDEN"
    );
    const db = (await getDb())!;
    const [row] = await db.select().from(agents).where(eq(agents.id, kycPk));
    expect(row.tier).toBe("Bronze");
  });

  it("admin can bulk-set tier", async () => {
    const res = await callerFor(adminUser).agent.bulkSetTier({
      ids: [kycPk],
      tier: "Silver",
    });
    expect(res.count).toBe(1);
    const db = (await getDb())!;
    const [row] = await db.select().from(agents).where(eq(agents.id, kycPk));
    expect(row.tier).toBe("Silver");
  });
});
