/**
 * managementSettings.integration.test.ts — real-DB integration tests for
 * management.settings (platform_settings upsert + merged read).
 *
 * Proves:
 *   - settings.update upserts a real platform_settings row (updatedBy = admin
 *     email)
 *   - settings.get merges stored values over defaults (JSON round-trip)
 *   - updating the same key twice keeps exactly one row
 *   - non-admin is FORBIDDEN, anonymous is UNAUTHORIZED
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, count } from "drizzle-orm";
import { getDb } from "../../server/db";
import { platformSettings } from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "managementSettings";

async function settingRow(key: string) {
  const db = (await getDb())!;
  const rows = await db
    .select()
    .from(platformSettings)
    .where(eq(platformSettings.key, key));
  return rows;
}

describe("management.settings router (integration, real DB)", () => {
  beforeAll(() => {
    resetAssertionCount();
  });

  afterAll(() => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("settings.update upserts a real platform_settings row", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.management.settings.update({
      key: "platformName",
      value: "InsurePortal IT",
    });
    expect(res.success).toBe(true);

    const rows = await settingRow("settings.platformName");
    expect(rows.length).toBe(1);
    expect(rows[0]!.updatedBy).toBe(adminUser.email);
    expect(JSON.parse(String(rows[0]!.value))).toBe("InsurePortal IT");
  });

  it("settings.get merges stored values over defaults", async () => {
    const caller = callerFor(adminUser);
    const merged = await caller.management.settings.get();
    // Stored value wins…
    expect(merged.platformName).toBe("InsurePortal IT");
    // …and untouched keys keep their defaults.
    expect(merged.defaultCurrency).toBe("NGN");
    expect(merged.maintenanceMode).toBe(false);
  });

  it("values round-trip through JSON (numbers stay numbers)", async () => {
    const caller = callerFor(adminUser);
    await caller.management.settings.update({
      key: "fraudScoreThreshold",
      value: 0.9,
    });
    const merged = await caller.management.settings.get();
    expect(merged.fraudScoreThreshold).toBe(0.9);
    expect(typeof merged.fraudScoreThreshold).toBe("number");
  });

  it("double update of the same key keeps exactly one row", async () => {
    const caller = callerFor(adminUser);
    await caller.management.settings.update({
      key: "maxTransactionAmount",
      value: 750000,
    });
    await caller.management.settings.update({
      key: "maxTransactionAmount",
      value: 800000,
    });

    const rows = await settingRow("settings.maxTransactionAmount");
    expect(rows.length).toBe(1);
    expect(JSON.parse(String(rows[0]!.value))).toBe(800000);

    const merged = await caller.management.settings.get();
    expect(merged.maxTransactionAmount).toBe(800000);
  });

  it("non-admin caller is FORBIDDEN from updating settings", async () => {
    const caller = callerFor(regularUser);
    await expectTrpcError(
      caller.management.settings.update({
        key: "maintenanceMode",
        value: true,
      }),
      "FORBIDDEN"
    );

    // The forbidden write did not happen.
    const rows = await settingRow("settings.maintenanceMode");
    expect(rows.length).toBe(0);
  });

  it("anonymous caller is UNAUTHORIZED for both read and write", async () => {
    const caller = callerFor(null);
    await expectTrpcError(caller.management.settings.get(), "UNAUTHORIZED");
    await expectTrpcError(
      caller.management.settings.update({ key: "platformName", value: "hax" }),
      "UNAUTHORIZED"
    );
  });
});
