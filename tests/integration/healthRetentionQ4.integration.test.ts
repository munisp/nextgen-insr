/**
 * healthRetentionQ4.integration.test.ts — Q4 health & retention wave
 * (2026-09-25, migration 0089).
 *
 * Covers:
 *  1. Teleconsult FAIL-CLOSED when unconfigured (no fake consultations) and
 *     the adapter contract via a TEST-LAYER injected fetch mock
 *     (vi.stubGlobal) — the production path (server/lib/teleconsultAdapter.ts
 *     -> resilientFetch) contains no stubs.
 *  2. Wellness content: staff-gated CRUD + locale-aware bounded member feed.
 *  3. One-tap photo reimbursement end-to-end: EXISTING presigned PUT flow
 *     (documentManagement.requestUploadUrl) -> submit -> staff adjudication
 *     reusing claim statuses; foreign doc-refs / foreign claims denied; OCR
 *     disclosed manual-entry fallback (no fake OCR).
 *  4. Provider portal (Curacel): API-key provider auth, tariff CRUD,
 *     pre-auth pricing fail-closed on provider_tariffs, and claim-status
 *     scoping (cross-provider denied, audited).
 */
import { describe, it, beforeAll, afterEach, expect, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

import { getDb } from "../../server/db";
import { claims, claimWorkflowEvents, users } from "../../drizzle/schema";
import {
  adminUser,
  callerFor,
  regularUser,
  resetAssertionCount,
} from "./helpers/trpc";

beforeAll(async () => {
  resetAssertionCount();
  // api_keys.userId is a NOT NULL FK to users.id — the shared fixtures are
  // ctx-only identities, so materialize them (idempotent; same discipline as
  // lWaveEco.integration.test.ts).
  const db = (await getDb())!;
  for (const u of [adminUser, regularUser]) {
    await db
      .insert(users)
      .values({
        id: u.id,
        keycloakSub: `q4-fixture-${u.id}`,
        email: u.email,
        name: u.name,
        role: u.role === "admin" ? "admin" : "user",
      })
      .onConflictDoNothing();
  }
});

afterEach(() => {
  // Test-layer stubs must never leak into other files (single-fork suite).
  vi.unstubAllGlobals();
  delete process.env.TELECONSULT_PROVIDER_URL;
  delete process.env.TELECONSULT_API_KEY;
  delete process.env.TELECONSULT_PROVIDER_CODE;
  delete process.env.OCR_PROVIDER_URL;
  delete process.env.OCR_API_KEY;
});

/** Canned teleconsult provider; everything else behaves like the dead-port
 * integration infra (fetch throws) so sidecar/permify paths are unchanged. */
function stubTeleconsultFetch(
  handler: (url: string, init?: unknown) => unknown
) {
  vi.stubGlobal("fetch", async (url: unknown, init?: unknown) => {
    const u = String(url);
    if (u.includes("teleconsult.test")) {
      return handler(u, init);
    }
    throw new Error("fetch failed");
  });
}

const jsonResponse = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => body,
});

// ── 1. Teleconsult ──────────────────────────────────────────────────────────
describe("Q4 (2026-09-25): teleconsult fail-closed when unconfigured", () => {
  it("booking rejects PRECONDITION_FAILED and creates NO session row", async () => {
    const caller = callerFor(regularUser);
    await expect(
      caller.careRetention.teleconsultBook({
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const db = (await getDb())!;
    // No fake consultation may exist for this member.
    const rows = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM teleconsult_sessions WHERE "memberId" = ${regularUser.id}`
    );
    expect(Number((rows.rows[0] as { n: number }).n)).toBe(0);
  });

  it("anonymous callers are rejected (member auth reused)", async () => {
    const caller = callerFor(null);
    await expect(
      caller.careRetention.teleconsultBook({
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("Q4: teleconsult adapter contract (test-layer fetch stub only)", () => {
  it("books a real provider session and stores refs only", async () => {
    process.env.TELECONSULT_PROVIDER_URL = "https://teleconsult.test";
    process.env.TELECONSULT_API_KEY = "test-key";
    process.env.TELECONSULT_PROVIDER_CODE = "alan-ng";
    stubTeleconsultFetch(() =>
      jsonResponse({ sessionId: "prov-sess-001", status: "scheduled" })
    );
    const caller = callerFor(regularUser);
    const when = new Date(Date.now() + 3_600_000).toISOString();
    const booked = await caller.careRetention.teleconsultBook({
      scheduledAt: when,
    });
    expect(booked.status).toBe("scheduled");
    expect(booked.providerCode).toBe("alan-ng");

    // Status poll mirrors the provider's coarse status.
    const st = await caller.careRetention.teleconsultStatus({ id: booked.id });
    expect(st.status).toBe("scheduled");

    // Cross-member scoping: another user cannot see this session.
    const other = callerFor({ ...regularUser, id: 91999 });
    await expect(
      other.careRetention.teleconsultStatus({ id: booked.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("provider 2xx without sessionId is an honest failure, not a booking", async () => {
    process.env.TELECONSULT_PROVIDER_URL = "https://teleconsult.test";
    process.env.TELECONSULT_API_KEY = "test-key";
    stubTeleconsultFetch(() => jsonResponse({ ok: true }));
    const caller = callerFor(regularUser);
    await expect(
      caller.careRetention.teleconsultBook({
        scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      })
    ).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
  });

  it("unrecognized provider status is rejected, never persisted", async () => {
    process.env.TELECONSULT_PROVIDER_URL = "https://teleconsult.test";
    process.env.TELECONSULT_API_KEY = "test-key";
    stubTeleconsultFetch((url: string) =>
      url.includes("/v1/sessions/")
        ? jsonResponse({ sessionId: "prov-sess-002", status: "evil-phi-dump" })
        : jsonResponse({ sessionId: "prov-sess-002", status: "scheduled" })
    );
    const caller = callerFor(regularUser);
    const booked = await caller.careRetention.teleconsultBook({
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await expect(
      caller.careRetention.teleconsultStatus({ id: booked.id })
    ).rejects.toThrow();
  });
});

// ── 2. Wellness content ─────────────────────────────────────────────────────
describe("Q4: wellness content CRUD + member feed", () => {
  it("members cannot create/update content (staff-gated)", async () => {
    const member = callerFor(regularUser);
    await expect(
      member.careRetention.wellnessCreate({
        title: "x",
        body: "y",
        category: "nutrition",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("draft content never appears in the member feed; published does, locale-aware", async () => {
    const staff = callerFor(adminUser);
    const member = callerFor(regularUser);
    const draft = await staff.careRetention.wellnessCreate({
      title: "Draft EN",
      body: "draft body",
      category: "nutrition",
      locale: "en",
    });
    const pub = await staff.careRetention.wellnessCreate({
      title: "Published EN",
      body: "published body",
      category: "nutrition",
      locale: "en",
      publish: true,
    });
    await staff.careRetention.wellnessCreate({
      title: "Publié FR",
      body: "corps",
      category: "nutrition",
      locale: "fr",
      publish: true,
    });

    const feedEn = await member.careRetention.wellnessFeed({
      locale: "en",
      category: "nutrition",
    });
    const ids = feedEn.items.map(i => i.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(draft.id);

    const feedFr = await member.careRetention.wellnessFeed({ locale: "fr" });
    expect(feedFr.items.every(i => i.locale === "fr")).toBe(true);

    // Publish via update path.
    await staff.careRetention.wellnessUpdate({
      id: draft.id,
      status: "published",
    });
    const feedAfter = await member.careRetention.wellnessFeed({
      locale: "en",
      category: "nutrition",
    });
    expect(feedAfter.items.map(i => i.id)).toContain(draft.id);

    // Bounded pagination: limit=1 returns one item and honest total.
    const page = await member.careRetention.wellnessFeed({
      locale: "en",
      category: "nutrition",
      limit: 1,
    });
    expect(page.items.length).toBe(1);
    expect(page.total).toBeGreaterThanOrEqual(2);
    // Hard cap enforced by input validation.
    await expect(
      member.careRetention.wellnessFeed({ locale: "en", limit: 500 })
    ).rejects.toThrow();
  });
});

// ── 3. Photo reimbursement end-to-end ───────────────────────────────────────
describe("Q4: one-tap photo reimbursement (presign -> submit -> review)", () => {
  async function presignReceipt(user = regularUser) {
    const caller = callerFor(user);
    const out = await caller.documentManagement.requestUploadUrl({
      fileName: "receipt.jpg",
      mimeType: "image/jpeg",
      fileSize: 250_000,
      purpose: "claim_document",
    });
    return out.fileKey;
  }

  async function makeClaim(claimantId: number, providerCode?: string) {
    const db = (await getDb())!;
    const [claim] = await db
      .insert(claims)
      .values({
        claimNumber: `CLM-Q4-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
        policyId: 1,
        claimantId,
        status: "submitted",
        claimType: "health",
        incidentDate: new Date(),
        claimedAmount: "45000.00",
        incidentDescription: "Q4 test claim",
        metadata: providerCode ? { providerCode } : null,
      } as any)
      .returning();
    return claim;
  }

  it("full flow: presigned upload refs -> linked submission -> staff approval drives claim status; OCR disclosed manual-entry", async () => {
    const member = callerFor(regularUser);
    const staff = callerFor(adminUser);
    const fileKey = await presignReceipt();
    expect(fileKey).toContain(`claim_document/${regularUser.id}/`);
    const claim = await makeClaim(regularUser.id);

    const submitted = await member.careRetention.photoReimbursementSubmit({
      claimId: claim.id,
      documentRefs: [fileKey],
      amount: 45000,
      description: "Pharmacy receipt",
    });
    expect(submitted.status).toBe("under_review");
    // OCR is not configured in the integration env: disclosed manual entry,
    // NOT a fabricated extraction.
    expect(submitted.ocrStatus).toBe("manual_entry");
    expect(submitted.ocrDisclosure).toMatch(/manual entry/i);

    const mine = await member.careRetention.photoReimbursementList();
    expect(mine.reimbursements.map(r => r.id)).toContain(submitted.id);

    const reviewed = await staff.careRetention.photoReimbursementReview({
      id: submitted.id,
      decision: "approved",
    });
    expect(reviewed.status).toBe("approved");

    // Linked claim reuses the EXISTING claim_status vocabulary.
    const db = (await getDb())!;
    const [after] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, claim.id))
      .limit(1);
    expect(after.status).toBe("approved");

    // Double adjudication refused.
    await expect(
      staff.careRetention.photoReimbursementReview({
        id: submitted.id,
        decision: "rejected",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("direct-to-review queue without a claim", async () => {
    const member = callerFor(regularUser);
    const fileKey = await presignReceipt();
    const submitted = await member.careRetention.photoReimbursementSubmit({
      documentRefs: [fileKey],
      amount: 5000,
    });
    expect(submitted.status).toBe("pending_review");
    expect(submitted.claimId).toBeNull();
  });

  it("rejects document refs not issued for this member (forgery guard)", async () => {
    const member = callerFor(regularUser);
    await expect(
      member.careRetention.photoReimbursementSubmit({
        documentRefs: ["uploads/claim_document/424242/1-stolen.jpg"],
        amount: 1000,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects linking to another member's claim", async () => {
    const member = callerFor(regularUser);
    const foreign = await makeClaim(424242);
    const fileKey = await presignReceipt();
    await expect(
      member.careRetention.photoReimbursementSubmit({
        claimId: foreign.id,
        documentRefs: [fileKey],
        amount: 1000,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("members cannot adjudicate (staff-only)", async () => {
    const member = callerFor(regularUser);
    await expect(
      member.careRetention.photoReimbursementReview({
        id: 1,
        decision: "approved",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── 2026-09-26 (Q24 fix): claim state-machine guard + workflow provenance ──
  it("a PAID linked claim cannot be regressed by adjudication (terminal-state guard)", async () => {
    const member = callerFor(regularUser);
    const staff = callerFor(adminUser);
    const db = (await getDb())!;
    const [paidClaim] = await db
      .insert(claims)
      .values({
        claimNumber: `CLM-Q4-PAID-${Date.now()}`,
        policyId: 1,
        claimantId: regularUser.id,
        status: "paid",
        claimType: "health",
        incidentDate: new Date(),
        claimedAmount: "45000.00",
        approvedAmount: "45000.00",
        paidAmount: "45000.00",
        incidentDescription: "Q4 paid-claim regression probe",
      } as any)
      .returning();
    const fileKey = await presignReceipt();
    const submitted = await member.careRetention.photoReimbursementSubmit({
      claimId: paidClaim.id,
      documentRefs: [fileKey],
      amount: 45000,
    });
    await expect(
      staff.careRetention.photoReimbursementReview({
        id: submitted.id,
        decision: "approved",
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Claim untouched: still paid, no regression, no workflow event.
    const [after] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, paidClaim.id))
      .limit(1);
    expect(after.status).toBe("paid");
    const events = await db
      .select()
      .from(claimWorkflowEvents)
      .where(eq(claimWorkflowEvents.claimId, paidClaim.id));
    expect(events.length).toBe(0);
  });

  it("legal adjudication transition writes a claimWorkflowEvents row and sets bounded approvedAmount", async () => {
    const member = callerFor(regularUser);
    const staff = callerFor(adminUser);
    const claim = await makeClaim(regularUser.id); // claimedAmount 45000, submitted
    const fileKey = await presignReceipt();
    const submitted = await member.careRetention.photoReimbursementSubmit({
      claimId: claim.id,
      documentRefs: [fileKey],
      amount: 60000, // above the claimed amount — must be clamped
    });
    const reviewed = await staff.careRetention.photoReimbursementReview({
      id: submitted.id,
      decision: "approved",
    });
    expect(reviewed.status).toBe("approved");
    const db = (await getDb())!;
    const [after] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, claim.id))
      .limit(1);
    expect(after.status).toBe("approved");
    // approvedAmount bounded by the claimed amount (fail-closed clamp).
    expect(Number(after.approvedAmount)).toBe(45000);

    const events = await db
      .select()
      .from(claimWorkflowEvents)
      .where(eq(claimWorkflowEvents.claimId, claim.id));
    expect(events.length).toBe(1);
    const ev = events[0];
    expect(ev.eventType).toBe("claim.approved");
    expect(ev.fromStatus).toBe("submitted");
    expect(ev.toStatus).toBe("approved");
    expect(ev.triggeredBy).toBe(adminUser.id);
    expect(
      (ev.payload as { photoReimbursementId?: number } | null)
        ?.photoReimbursementId
    ).toBe(submitted.id);
  });

  it("rejection writes a claim.rejected workflow event with from → to statuses", async () => {
    const member = callerFor(regularUser);
    const staff = callerFor(adminUser);
    const claim = await makeClaim(regularUser.id);
    const fileKey = await presignReceipt();
    const submitted = await member.careRetention.photoReimbursementSubmit({
      claimId: claim.id,
      documentRefs: [fileKey],
      amount: 10000,
    });
    await staff.careRetention.photoReimbursementReview({
      id: submitted.id,
      decision: "rejected",
      notes: "Receipt illegible",
    });
    const db = (await getDb())!;
    const [after] = await db
      .select()
      .from(claims)
      .where(eq(claims.id, claim.id))
      .limit(1);
    expect(after.status).toBe("rejected");
    expect(after.rejectionReason).toBe("Receipt illegible");
    const events = await db
      .select()
      .from(claimWorkflowEvents)
      .where(eq(claimWorkflowEvents.claimId, claim.id));
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("claim.rejected");
    expect(events[0].fromStatus).toBe("submitted");
    expect(events[0].toStatus).toBe("rejected");
    expect(events[0].triggeredBy).toBe(adminUser.id);
  });

  it("OCR adapter returns real fields only when a provider answers (test-layer stub)", async () => {
    process.env.OCR_PROVIDER_URL = "https://teleconsult.test/ocr";
    process.env.OCR_API_KEY = "ocr-key";
    stubTeleconsultFetch(() =>
      jsonResponse({ fields: { total: "45000.00", vendor: "MediPlus" } })
    );
    const member = callerFor(regularUser);
    const fileKey = await presignReceipt();
    const submitted = await member.careRetention.photoReimbursementSubmit({
      documentRefs: [fileKey],
      amount: 45000,
    });
    expect(submitted.ocrStatus).toBe("completed");
    const db = (await getDb())!;
    const rows = await db.execute(
      sql`SELECT "ocrExtracted" FROM photo_reimbursements WHERE id = ${submitted.id}`
    );
    expect(
      (rows.rows[0] as { ocrExtracted: { vendor: string } }).ocrExtracted
        .vendor
    ).toBe("MediPlus");
  });
});

// ── 4. Provider portal (Curacel) ────────────────────────────────────────────
describe("Q4: provider portal scoping + tariff pre-auth", () => {
  it("tariff CRUD staff-gated; pre-auth priced fail-closed; cross-provider denied + audited", async () => {
    const staff = callerFor(adminUser);
    const member = callerFor(regularUser);

    // Members cannot manage tariffs or mint provider keys.
    await expect(
      member.providerPortal.upsertTariff({
        providerCode: "prov-a",
        serviceCode: "CONSULT",
        negotiatedPrice: 15000,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const keyA = await staff.providerPortal.createProviderKey({
      providerCode: "prov-a",
      name: "Provider A portal key",
    });
    const keyB = await staff.providerPortal.createProviderKey({
      providerCode: "prov-b",
      name: "Provider B portal key",
    });
    expect(keyA.apiKey).toMatch(/^54lk_/);

    await staff.providerPortal.upsertTariff({
      providerCode: "prov-a",
      serviceCode: "CONSULT",
      serviceName: "General consultation",
      negotiatedPrice: 15000,
    });
    const tariffs = await staff.providerPortal.listTariffs({
      providerCode: "prov-a",
    });
    expect(tariffs.count).toBe(1);

    // Provider A reads only its own tariffs via API key.
    const anonA = callerFor(null);
    const mineA = await anonA.providerPortal.myTariffs({
      apiKey: keyA.apiKey,
    });
    expect(mineA.providerCode).toBe("prov-a");
    expect(mineA.count).toBe(1);

    // Pre-auth against the tariff: priced from the negotiated row.
    const preAuth = await anonA.providerPortal.submitPreAuthorization({
      apiKey: keyA.apiKey,
      serviceCode: "CONSULT",
      memberRef: "member-12345",
    });
    expect(String(preAuth.quotedPrice)).toBe("15000.00");
    expect(preAuth.status).toBe("submitted");

    // Fail-closed pricing: no tariff -> no quote.
    await expect(
      anonA.providerPortal.submitPreAuthorization({
        apiKey: keyA.apiKey,
        serviceCode: "MRI-SCAN",
        memberRef: "member-12345",
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Claim bound to prov-a via claims.metadata.providerCode.
    const db = (await getDb())!;
    const [claimA] = await db
      .insert(claims)
      .values({
        claimNumber: `CLM-Q4P-${Date.now()}`,
        policyId: 1,
        claimantId: regularUser.id,
        status: "submitted",
        claimType: "health",
        incidentDate: new Date(),
        claimedAmount: "15000.00",
        incidentDescription: "provider-scoped claim",
        metadata: { providerCode: "prov-a" },
      } as any)
      .returning();

    // Provider A sees their claim (limited, non-PHI fields).
    const status = await anonA.providerPortal.checkClaimStatus({
      apiKey: keyA.apiKey,
      claimId: claimA.id,
    });
    expect(status.claimNumber).toBe(claimA.claimNumber);

    // Provider B is denied — NOT_FOUND, no existence leak.
    await expect(
      anonA.providerPortal.checkClaimStatus({
        apiKey: keyB.apiKey,
        claimId: claimA.id,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    // Denial is audited (audit_status enum: failure; metadata.allowed=false).
    const audit = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM audit_log WHERE action = 'provider_claim_status_check' AND status = 'failure' AND "resourceId" = ${String(claimA.id)}`
    );
    expect(Number((audit.rows[0] as { n: number }).n)).toBeGreaterThanOrEqual(
      1
    );

    // Garbage key is rejected.
    await expect(
      anonA.providerPortal.myTariffs({ apiKey: "54lk_forged" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});
