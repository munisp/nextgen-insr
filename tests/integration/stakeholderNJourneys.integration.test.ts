/**
 * stakeholderNJourneys.integration.test.ts — N-wave closure against the REAL
 * PG (PGlite) schema + mini-Redis + mini-TigerBeetle. No mocks.
 *
 *  Item 1 (authz/funds) — the V1 GENERIC trigger
 *        (insuranceJourneyOrchestrator.trigger) still started J03 with raw
 *        `input.input`: a non-staff caller could smuggle `initiatedByStaff:
 *        true` (+ staffContext / beneficiary fields) into the claims
 *        settlement workflow, reaching auto-adjudication + settlement.
 *        Closed to parity with the V2 generic trigger (M-wave W1):
 *          - V1 generic trigger REFUSES J03 (dedicated triggerJ03 only);
 *          - initiatedByStaff is computed SERVER-SIDE from the session role;
 *          - staffContext / beneficiaryAccount / beneficiaryBank / tenantId /
 *            userRole are stripped from caller input for ALL journey types
 *            (both V1 and V2 generic triggers).
 *
 *  Item 2 (tenant isolation) — buildTenantContext (journey-tenant-guard.ts)
 *        trusted caller-supplied tenantId/userRole from journey input for the
 *        Permify check. Now tenantId/userRole are derived ONLY from the
 *        authenticated session (injected server-side at the workflow-start
 *        boundary as authenticatedTenantId/authenticatedUserRole); caller
 *        fields are ignored and the guard FAILS CLOSED when the role is
 *        unresolvable.
 *
 * Note: Temporal is not running in this environment, so trigger success
 * paths are asserted to PASS ALL validation and fail only at workflow start
 * (INTERNAL_SERVER_ERROR from the Temporal client) — never with an
 * authz/validation error code (same convention as the M-wave suite).
 *
 * 2026-09-19. Ids 972xxx / policy numbers N-WAVE-* are unique to this file.
 */
import { describe, it, beforeAll, afterAll } from "vitest";

import { customers, insuranceProducts, policies } from "../../drizzle/schema";
import { getDb } from "../../server/db";
import { buildTenantContext } from "../../server/journey-tenant-guard";
import {
  sanitizeGenericJourneyInput,
  stripForgedTrustedFields,
} from "../../server/lib/journeyTriggerPolicy";
import {
  callerFor,
  adminUser,
  type TestUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const NOW = Date.now();
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();

/** Customer-account user (non-staff) whose customers row binds by keycloakSub. */
const customerUser: TestUser = {
  id: 972001,
  email: "n-wave-customer@integration.local",
  name: "N Customer",
  role: "user",
  keycloakSub: "kc-n-wave-customer-972001",
};
const staffUser: TestUser = {
  id: 972003,
  email: "n-wave-staff@integration.local",
  name: "N Staff",
  role: "supervisor",
  keycloakSub: "kc-n-wave-staff-972003",
};

const CUSTOMER_ID = 972021;
const OTHER_CUSTOMER_ID = 972022;

let ownPolicyId: number;    // CUSTOMER_ID-owned, active, sum 100k
let otherPolicyId: number;  // OTHER_CUSTOMER_ID-owned, active

beforeAll(async () => {
  resetAssertionCount();
  const db = (await getDb())!;

  await db.insert(customers).values([
    { id: CUSTOMER_ID, firstName: "N", lastName: "Customer", phone: "+234972000001", keycloakSub: String(customerUser.id) },
    { id: OTHER_CUSTOMER_ID, firstName: "N", lastName: "Other", phone: "+234972000002", keycloakSub: "kc-n-wave-other-972099" },
  ] as (typeof customers.$inferInsert)[]).onConflictDoNothing();

  const [prod] = await db.insert(insuranceProducts).values({
    productCode: "N-WAVE-1",
    name: "N-Wave Test Life",
    coverageType: "life",
    minPremium: "10000.00",
    maxCoverageAmount: "500000.00",
    isActive: true,
  } as typeof insuranceProducts.$inferInsert).returning();

  const seedPolicy = (over: Partial<typeof policies.$inferInsert> & { policyNumber: string }) =>
    db.insert(policies).values({
      productId: prod!.id,
      customerId: CUSTOMER_ID,
      coverageType: "life",
      status: "active",
      sumInsured: "100000.00",
      annualPremium: "10000.00",
      startDate: new Date(NOW - 100 * DAY),
      endDate: new Date(NOW + 265 * DAY),
      ...over,
    } as typeof policies.$inferInsert).returning();

  ownPolicyId = (await seedPolicy({ policyNumber: "N-WAVE-OWN-1" }))[0]!.id;
  otherPolicyId = (await seedPolicy({ policyNumber: "N-WAVE-OTHER-1", customerId: OTHER_CUSTOMER_ID }))[0]!.id;
});

afterAll(() => {
  console.log(`[stakeholderNJourneys] assertions: ${getAssertionCount()}`);
});

describe("Item 1: V1 generic trigger refuses J03 (parity with V2)", () => {
  const smuggle = {
    policyId: 0, // filled per-test
    customerId: CUSTOMER_ID,
    claimedAmount: 1000,
    initiatedByStaff: true,
    staffContext: true,
    beneficiaryAccount: "999888777",
    beneficiaryBank: "evil-bank",
  };

  it("non-staff caller cannot start J03 via the V1 generic trigger", async () => {
    await expectTrpcError(
      callerFor(customerUser).insuranceJourneyOrchestrator.trigger({
        journeyId: "J03",
        input: { ...smuggle, policyId: ownPolicyId },
      }),
      "BAD_REQUEST"
    );
  });

  it("staff caller cannot start J03 via the V1 generic trigger either", async () => {
    await expectTrpcError(
      callerFor(staffUser).insuranceJourneyOrchestrator.trigger({
        journeyId: "J03",
        input: { ...smuggle, policyId: ownPolicyId },
      }),
      "BAD_REQUEST"
    );
  });

  it("V2 generic trigger still refuses J03 (regression)", async () => {
    await expectTrpcError(
      callerFor(staffUser).journeyOrchestratorV2.trigger({
        journeyId: "J03",
        input: { ...smuggle, policyId: ownPolicyId },
      }),
      "BAD_REQUEST"
    );
  });
});

describe("Item 1: generic triggers strip staff/settlement/tenant context for ALL journeys", () => {
  it("sanitizeGenericJourneyInput overwrites smuggled initiatedByStaff with the server-computed flag", () => {
    const nonStaff = sanitizeGenericJourneyInput(
      { policyId: 1, initiatedByStaff: true, staffContext: true, beneficiaryAccount: "X", beneficiaryBank: "Y", tenantId: "evil-tenant", userRole: "admin" },
      false
    );
    expect(nonStaff.initiatedByStaff).toBe(false);
    expect("staffContext" in nonStaff).toBe(false);
    expect("beneficiaryAccount" in nonStaff).toBe(false);
    expect("beneficiaryBank" in nonStaff).toBe(false);
    expect("tenantId" in nonStaff).toBe(false);
    expect("userRole" in nonStaff).toBe(false);
    expect(nonStaff.policyId).toBe(1);

    const staff = sanitizeGenericJourneyInput({ initiatedByStaff: false }, true);
    expect(staff.initiatedByStaff).toBe(true);
  });

  it("V1 generic trigger with smuggled staff context passes validation for a non-J03 journey (fields stripped, fails only at Temporal start)", async () => {
    // J16 with a fully smuggle-loaded payload: had the smuggled fields been
    // honoured the workflow would carry them; we assert the call passes all
    // router validation and reaches the workflow-start boundary (Temporal is
    // down here → INTERNAL_SERVER_ERROR), while the sanitization unit test
    // above proves the fields are stripped before startJourneyWorkflow.
    try {
      await callerFor(customerUser).insuranceJourneyOrchestrator.trigger({
        journeyId: "J16",
        input: {
          customerId: CUSTOMER_ID,
          initiatedByStaff: true,
          staffContext: true,
          beneficiaryAccount: "999888777",
          beneficiaryBank: "evil-bank",
          tenantId: "evil-tenant",
          userRole: "admin",
        },
      });
      throw new Error("expected workflow start to fail without Temporal");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("V2 generic trigger with smuggled staff context passes validation for a non-J03 journey (fields stripped)", async () => {
    try {
      await callerFor(customerUser).journeyOrchestratorV2.trigger({
        journeyId: "J16",
        input: {
          customerId: CUSTOMER_ID,
          initiatedByStaff: true,
          staffContext: true,
          tenantId: "evil-tenant",
          userRole: "admin",
        },
      });
      throw new Error("expected workflow start to fail without Temporal");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });
});

describe("Item 2: buildTenantContext derives tenant identity from the session, never journey input", () => {
  it("caller-supplied tenantId/userRole in journey input are IGNORED — session-derived values win", () => {
    const ctx = buildTenantContext({
      triggeredBy: customerUser.id,
      tenantId: "evil-tenant",       // caller smuggle attempt
      userRole: "admin",             // caller smuggle attempt (admin bypass)
      authenticatedUserRole: "user", // server-injected from ctx.user.role
    });
    expect(ctx.userRole).toBe("user");
    expect(ctx.tenantId).toBe(process.env.PERMIFY_TENANT_ID ?? "insureportal");
    expect(ctx.userId).toBe(String(customerUser.id));
  });

  it("session-derived admin role is preserved (support/ops bypass still works)", () => {
    const ctx = buildTenantContext({
      triggeredBy: adminUser.id,
      authenticatedUserRole: "admin",
    });
    expect(ctx.userRole).toBe("admin");
  });

  it("fails closed when the authenticated role is unresolvable", () => {
    expect(() =>
      buildTenantContext({ triggeredBy: 1, tenantId: "insureportal", userRole: "agent" })
    ).toThrowError(/role unresolvable/i);
    try {
      buildTenantContext({ triggeredBy: 1 });
      throw new Error("expected fail-closed throw");
    } catch (err) {
      expect((err as { type?: string }).type).toBe("AUTHORIZATION_DENIED");
      expect((err as { nonRetryable?: boolean }).nonRetryable).toBe(true);
    }
  });

  it("caller-forged trusted fields are stripped at the workflow-start boundary", () => {
    const clean = stripForgedTrustedFields({
      policyId: 1,
      triggeredBy: 999999,
      authenticatedUserRole: "admin",
      authenticatedTenantId: "evil-tenant",
    });
    expect("triggeredBy" in clean).toBe(false);
    expect("authenticatedUserRole" in clean).toBe(false);
    expect("authenticatedTenantId" in clean).toBe(false);
    expect(clean.policyId).toBe(1);
  });
});

describe("Item 1: dedicated triggerJ03 paths still work (V1 + V2)", () => {
  const v1Input = {
    policyId: 0, // filled per-test
    customerId: CUSTOMER_ID,
    claimType: "death",
    incidentDate: iso(NOW - 9 * DAY),
    claimAmount: 5000,
    description: "N-wave V1 triggerJ03 probe",
  };
  const v2Input = {
    policyId: 0,
    customerId: CUSTOMER_ID,
    claimType: "death",
    incidentDate: iso(NOW - 9 * DAY),
    claimedAmount: 5000,
    description: "N-wave V2 triggerJ03 probe",
    paymentRef: "N-WAVE-PAY-1",
  };

  it("V1 triggerJ03: non-staff caller cannot file against someone else's customerId", async () => {
    await expectTrpcError(
      callerFor(customerUser).insuranceJourneyOrchestrator.triggerJ03({
        ...v1Input, policyId: otherPolicyId, customerId: OTHER_CUSTOMER_ID,
      }),
      "FORBIDDEN"
    );
  });

  it("V1 triggerJ03: non-staff caller with own policy passes validation (fails only at Temporal start)", async () => {
    try {
      await callerFor(customerUser).insuranceJourneyOrchestrator.triggerJ03({ ...v1Input, policyId: ownPolicyId });
      throw new Error("expected workflow start to fail without Temporal");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("V1 triggerJ03: staff on-behalf path still works (passes validation, fails only at Temporal start)", async () => {
    try {
      await callerFor(staffUser).insuranceJourneyOrchestrator.triggerJ03({ ...v1Input, policyId: ownPolicyId });
      throw new Error("expected workflow start to fail without Temporal");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });

  it("V2 triggerJ03: staff on-behalf path still works (regression)", async () => {
    try {
      await callerFor(staffUser).journeyOrchestratorV2.triggerJ03({ ...v2Input, policyId: ownPolicyId });
      throw new Error("expected workflow start to fail without Temporal");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });
});
