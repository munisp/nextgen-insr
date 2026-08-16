/**
 * gdprDataRights.integration.test.ts — real-DB integration tests for the
 * GDPR/NDPR data-rights workflows (F-08, engineering side).
 *
 * Proves against real PostgreSQL (PGlite):
 *   - gdprDashboard.exportCustomerData returns the subject's actual rows
 *     (customer profile, policies, transactions linked by phone, kyc status)
 *   - gdprDashboard.requestErasure (admin-gated) ANONYMIZES the customers row
 *     and transactions.customerPhone linkage, revokes consent records, and
 *     registers the erasure in data_rights_requests — verified by reading the
 *     real rows back; uncovered stores are asserted as RETAINED (audit_log,
 *     policies) matching the documented coverage
 *   - requestErasure is FORBIDDEN for non-admin and UNAUTHORIZED anonymous
 *   - gdprDashboard.updateConsent persists real data_consent_records rows and
 *     getDashboard/getNdprStatus report real counts (previously these
 *     procedures ran raw SQL against nonexistent snake_case columns and the
 *     router was not mounted at all)
 *   - the erasure/export audit events remain chained (hash chain intact)
 *
 * Honest scope note: erasure coverage is customers PII + transaction phone
 * linkage + consent revocation. kyc_verifications document numbers,
 * audit_log references, and backups are NOT erased (documented gaps).
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../server/db";
import {
  customers,
  kycVerifications,
  policies,
  transactions,
  dataConsentRecords,
  dataRightsRequests,
  auditLog,
} from "../../drizzle/schema";
import { verifyAuditChain } from "../../server/lib/auditChain";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "gdprDataRights";

const CUSTOMER_PHONE = "2348099887766";
const CUSTOMER_EMAIL = "gdpr.subject@integration.local";

describe("gdprDashboard data-rights workflows (integration, real DB)", () => {
  let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
  let customerId: number;
  let transactionId: number;

  beforeAll(async () => {
    resetAssertionCount();
    db = (await getDb())!;
    expect(db).toBeTruthy();

    // Seed a real data subject with linked rows across stores.
    const [c] = await db
      .insert(customers)
      .values({
        firstName: "Gdpr",
        lastName: "Subject",
        email: CUSTOMER_EMAIL,
        phone: CUSTOMER_PHONE,
        bvn: "12345678901",
        nin: "98765432109",
        dateOfBirth: "1990-05-15",
        address: "12 Integration Close, Lagos",
      })
      .returning();
    customerId = c!.id;

    await db.insert(kycVerifications).values({
      customerId,
      verificationType: "bvn",
      documentNumber: "DOC-998877",
      status: "verified",
      verifiedAt: new Date(),
    });

    await db.insert(policies).values({
      policyNumber: `POL-GDPR-${customerId}`,
      productId: 1,
      customerId,
      coverageType: "motor",
      sumInsured: "5000000.00",
      annualPremium: "150000.00",
      status: "active",
      startDate: new Date("2025-01-01T00:00:00Z"),
      endDate: new Date("2026-01-01T00:00:00Z"),
    });

    const [t] = await db
      .insert(transactions)
      .values({
        ref: `GDPR-TX-${customerId}`,
        agentId: regularUser.id,
        type: "Insurance",
        amount: "150000.00",
        status: "success",
        customerName: "Gdpr Subject",
        customerPhone: CUSTOMER_PHONE,
      })
      .returning();
    transactionId = t!.id;

    // An active consent record for the subject.
    await db.insert(dataConsentRecords).values({
      entityType: "customer",
      entityId: customerId,
      consentType: "data_processing",
      granted: true,
      grantedAt: new Date(),
    });
  });

  afterAll(() => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("exportCustomerData returns the subject's real rows across stores", async () => {
    const caller = callerFor(regularUser);
    const res = await caller.gdprDashboard.exportCustomerData({ customerId });

    expect(res.data.personal.id).toBe(customerId);
    expect(res.data.personal.name).toBe("Gdpr Subject");
    expect(res.data.personal.email).toBe(CUSTOMER_EMAIL);
    expect(res.data.personal.phone).toBe(CUSTOMER_PHONE);
    expect(res.data.personal.dateOfBirth).toBe("1990-05-15");

    expect(res.data.kyc?.status).toBe("verified");

    expect(res.data.policies.length).toBe(1);
    expect(res.data.policies[0]!.type).toBe("motor");
    expect(res.data.policies[0]!.status).toBe("active");

    expect(res.data.transactions.length).toBe(1);
    expect(res.data.transactions[0]!.id).toBe(transactionId);
    expect(res.data.transactions[0]!.amount).toBe("150000.00");

    // Export of a nonexistent subject fails closed.
    await expectTrpcError(
      caller.gdprDashboard.exportCustomerData({ customerId: 999_999_999 }),
      "NOT_FOUND"
    );
  });

  it("requestErasure is admin-gated (user FORBIDDEN, anonymous UNAUTHORIZED)", async () => {
    await expectTrpcError(
      callerFor(regularUser).gdprDashboard.requestErasure({
        customerId,
        reason: "consent_withdrawn",
      }),
      "FORBIDDEN"
    );
    await expectTrpcError(
      callerFor(null).gdprDashboard.requestErasure({
        customerId,
        reason: "consent_withdrawn",
      }),
      "UNAUTHORIZED"
    );
  });

  it("requestErasure anonymizes covered stores and honestly retains the rest", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.gdprDashboard.requestErasure({
      customerId,
      reason: "consent_withdrawn",
      retainForLegal: true,
    });
    expect(res.status).toBe("anonymized");
    expect(res.coverage.anonymized.length).toBeGreaterThan(0);
    expect(res.coverage.retained.length).toBeGreaterThan(0);

    // COVERED: customers PII is anonymized in the real row.
    const [c] = await db.select().from(customers).where(eq(customers.id, customerId));
    expect(c!.firstName).toBe("ANONYMIZED");
    expect(c!.lastName).toBe("ANONYMIZED");
    expect(c!.email).toBe(`anon_${customerId}@deleted.insureportal.ng`);
    expect(c!.phone).toBe(`anon_${customerId}`);
    expect(c!.address).toBe("ANONYMIZED");
    expect(c!.dateOfBirth).toBeNull();
    expect(c!.bvn).toBeNull();
    expect(c!.nin).toBeNull();
    expect(c!.passwordHash).toBeNull();
    expect(c!.refreshToken).toBeNull();

    // COVERED: transactions keep regulated financial data but lose the PII link.
    const [t] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
    expect(t!.customerPhone).toBe(`anon_${customerId}`);
    expect(t!.customerName).toBe("ANONYMIZED");
    expect(t!.amount).toBe("150000.00"); // regulated data preserved
    expect(t!.status).toBe("success");

    // COVERED: active consent records are revoked.
    const consentRows = await db
      .select()
      .from(dataConsentRecords)
      .where(eq(dataConsentRecords.entityId, customerId));
    expect(consentRows.length).toBeGreaterThan(0);
    for (const r of consentRows) {
      expect(r.revokedAt).not.toBeNull();
    }

    // The erasure is registered in the data-rights register.
    const drr = await db
      .select()
      .from(dataRightsRequests)
      .where(eq(dataRightsRequests.requesterId, customerId));
    expect(drr.length).toBe(1);
    expect(drr[0]!.requestType).toBe("erasure");
    expect(drr[0]!.status).toBe("completed");
    expect(drr[0]!.processedBy).toBe(adminUser.email);

    // RETAINED (honest gap): the export/erasure audit events referencing the
    // customer id remain in the tamper-evident chain.
    const auditRefs = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.resourceId, String(customerId)));
    expect(auditRefs.length).toBeGreaterThan(0);

    // RETAINED (honest gap): kyc_verifications document numbers untouched.
    const [kyc] = await db
      .select()
      .from(kycVerifications)
      .where(eq(kycVerifications.customerId, customerId));
    expect(kyc!.documentNumber).toBe("DOC-998877");

    // Post-erasure export can no longer return the PII (it is gone).
    const after = await callerFor(regularUser).gdprDashboard.exportCustomerData({ customerId });
    expect(after.data.personal.phone).toBe(`anon_${customerId}`);
    expect(after.data.transactions.length).toBe(1); // joined via anonymized phone
    expect(after.data.transactions[0]!.id).toBe(transactionId);

    // The erasure flow's own audit events kept the chain intact.
    const v = await verifyAuditChain(db, { strict: false });
    expect(v.ok).toBe(true);
  });

  it("updateConsent persists real consent records; dashboards report real counts", async () => {
    const caller = callerFor(regularUser);
    const res = await caller.gdprDashboard.updateConsent({
      customerId,
      consentGiven: true,
      consentPurposes: ["marketing", "analytics"],
    });
    expect(res.success).toBe(true);

    const rows = await db
      .select()
      .from(dataConsentRecords)
      .where(eq(dataConsentRecords.entityId, customerId));
    const active = rows.filter(r => r.revokedAt === null);
    expect(active.length).toBe(2);
    expect(active.map(r => r.consentType).sort()).toEqual(["analytics", "marketing"]);
    expect(active.every(r => r.granted)).toBe(true);

    // Dashboards execute against the real schema (previously broken raw SQL).
    const dash = await caller.gdprDashboard.getDashboard();
    expect(dash.overview.totalCustomers).toBeGreaterThanOrEqual(1);
    expect(dash.overview.consentedCustomers).toBeGreaterThanOrEqual(1);
    expect(dash.last30Days.erasureRequests).toBeGreaterThanOrEqual(1);
    expect(dash.last30Days.portabilityRequests).toBeGreaterThanOrEqual(1);

    const ndpr = await caller.gdprDashboard.getNdprStatus();
    expect(ndpr.consentedCustomers).toBeGreaterThanOrEqual(1);
    expect(ndpr.regulator).toBe("NITDA");
  });
});
