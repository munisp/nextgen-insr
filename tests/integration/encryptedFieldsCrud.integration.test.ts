/**
 * encryptedFieldsCrud.integration.test.ts — DD-TSSEC (A7-4 / A7-6).
 *
 * Honest contract under test:
 *  1. store binds each record to the calling user (createdBy) and encrypts
 *     with a PER-RECORD random salt + IV (two stores of the same plaintext
 *     produce different ciphertext/salt/iv).
 *  2. retrieve/delete are owner-or-admin: another non-admin user gets
 *     FORBIDDEN (no IDOR by sequential id), admins get access.
 *  3. list is owner-scoped for non-admins.
 *  4. decrypt round-trips the exact plaintext.
 *
 * Exercises the REAL router through the REAL middleware chain against the
 * REAL database (same harness as pinResetOtp.integration.test.ts).
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { getDb } from "../../server/db";
import { encryptedFields } from "../../drizzle/schema";
import {
  callerFor,
  regularUser,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
  type TestUser,
} from "./helpers/trpc";

const FILE = "encryptedFieldsCrud";

/** Second non-admin identity — must NOT see regularUser's records. */
const otherUser: TestUser = {
  id: 91009,
  email: "other@integration.local",
  name: "Integration Other",
  role: "user",
};

const createdIds: number[] = [];

describe("encryptedFieldsCrud per-record crypto + owner-or-admin ACL (integration, real DB)", () => {
  beforeAll(() => {
    resetAssertionCount();
  });

  afterAll(async () => {
    const db = (await getDb())!;
    if (createdIds.length > 0) {
      await db
        .delete(encryptedFields)
        .where(inArray(encryptedFields.id, createdIds));
    }
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("store binds ownership and uses a per-record random salt/IV", async () => {
    const caller = callerFor(regularUser);
    const a = await caller.encryptedFields.store({
      fieldName: "integration-secret",
      entityType: "integration_test",
      entityId: 1,
      plaintext: "same-plaintext",
    });
    const b = await caller.encryptedFields.store({
      fieldName: "integration-secret",
      entityType: "integration_test",
      entityId: 1,
      plaintext: "same-plaintext",
    });
    createdIds.push(a.id, b.id);

    const db = (await getDb())!;
    const rows = await db.select().from(encryptedFields).where(
      inArray(encryptedFields.id, [a.id, b.id])
    );
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.createdBy).toBe(regularUser.id);
      expect(row.salt).toBeTruthy();
      expect(row.iv).toBeTruthy();
      expect(row.authTag).toBeTruthy();
      expect(row.encryptedValue).toBeTruthy();
      // The plaintext never appears in any persisted column.
      expect(row.encryptedValue).not.toContain("same-plaintext");
    }
    // Per-record randomness: identical plaintexts never share crypto material.
    expect(rows[0]!.salt).not.toBe(rows[1]!.salt);
    expect(rows[0]!.iv).not.toBe(rows[1]!.iv);
    expect(rows[0]!.encryptedValue).not.toBe(rows[1]!.encryptedValue);
  });

  it("retrieve round-trips the plaintext for the owner", async () => {
    const caller = callerFor(regularUser);
    const stored = await caller.encryptedFields.store({
      fieldName: "roundtrip",
      entityType: "integration_test",
      entityId: 2,
      plaintext: "s3cr3t-value-✓",
    });
    createdIds.push(stored.id);

    const got = await caller.encryptedFields.retrieve({ id: stored.id });
    expect(got.value).toBe("s3cr3t-value-✓");
    expect(got.accessedBy).toBe(regularUser.id);
  });

  it("retrieve by a different non-admin user is FORBIDDEN (no IDOR)", async () => {
    const owner = callerFor(regularUser);
    const stored = await owner.encryptedFields.store({
      fieldName: "idor-target",
      entityType: "integration_test",
      entityId: 3,
      plaintext: "not-for-you",
    });
    createdIds.push(stored.id);

    const stranger = callerFor(otherUser);
    await expectTrpcError(
      stranger.encryptedFields.retrieve({ id: stored.id }),
      "FORBIDDEN"
    );
  });

  it("list is owner-scoped for non-admins", async () => {
    const stranger = callerFor(otherUser);
    const res = await stranger.encryptedFields.list({ limit: 100, offset: 0 });
    const visibleIds = res.items.map(i => i.id);
    for (const id of createdIds) {
      expect(visibleIds.includes(id)).toBe(false);
    }
  });

  it("admin can retrieve any record; non-owner non-admin cannot delete", async () => {
    const owner = callerFor(regularUser);
    const stored = await owner.encryptedFields.store({
      fieldName: "admin-read",
      entityType: "integration_test",
      entityId: 4,
      plaintext: "admin-visible",
    });
    createdIds.push(stored.id);

    const admin = callerFor(adminUser);
    const got = await admin.encryptedFields.retrieve({ id: stored.id });
    expect(got.value).toBe("admin-visible");

    const stranger = callerFor(otherUser);
    await expectTrpcError(
      stranger.encryptedFields.delete({ id: stored.id }),
      "FORBIDDEN"
    );

    // Owner delete succeeds and the record is gone.
    const del = await owner.encryptedFields.delete({ id: stored.id });
    expect(del.success).toBe(true);
    await expectTrpcError(
      owner.encryptedFields.retrieve({ id: stored.id }),
      "NOT_FOUND"
    );
  });
});
