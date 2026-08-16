/**
 * auditChain.integration.test.ts — real-DB integration tests for the F-08
 * tamper-evident audit hash chain.
 *
 * Proves (against real PostgreSQL / PGlite):
 *   - writeAuditLog maintains prevHash/entryHash links across N interleaved
 *     events written directly AND through tRPC procedures
 *   - auditCompliance.verifyChain (admin-gated) recomputes the chain: OK
 *   - tampering with a historical row (direct SQL UPDATE) => verification
 *     fails with the exact broken row id (entry-hash-mismatch); restoring
 *     the original value heals the chain
 *   - deleting a middle row => verification fails with prev-hash-mismatch at
 *     the successor row (the exact broken link); re-inserting heals it
 *   - DOCUMENTED LIMITATION: deleting the chain TIP is not detectable by
 *     recompute alone (pinned by a test so the limit is executable evidence,
 *     not a claim) — external tip anchoring is the documented next step
 *   - a direct-insert bypass row (NULL hashes) fails strict verification and
 *     is tolerated (counted) with allowUnchained
 *   - scripts/verify-audit-chain.mjs agrees with the server implementation
 *     (format parity: same tip hash; same tamper verdict)
 *   - auditCompliance.export: admin-gated, paginated in chain order, includes
 *     entryHash, and the export itself is audit-logged
 *   - auditCompliance.retentionPolicy returns config and marks deletion and
 *     external anchoring as open items (fail-honest, not "implemented")
 *
 * Every tamper is restored within the same test so the shared suite database
 * is left with an intact chain for later files.
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { asc, desc, eq, isNull } from "drizzle-orm";
import { getDb, writeAuditLog } from "../../server/db";
import { auditLog, type AuditLog } from "../../drizzle/schema";
import {
  computeEntryHash,
  entryFieldsFromRow,
  verifyAuditChain,
} from "../../server/lib/auditChain";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const execFileAsync = promisify(execFile);
const FILE = "auditChain";
const repoRoot = path.resolve(import.meta.dirname, "../..");

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

async function allRows(db: Db): Promise<AuditLog[]> {
  return db.select().from(auditLog).orderBy(asc(auditLog.id));
}

async function tipRow(db: Db): Promise<AuditLog | undefined> {
  const [row] = await db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1);
  return row;
}

/** Chained rows only, ascending. */
function chained(rows: AuditLog[]): AuditLog[] {
  return rows.filter(r => r.entryHash);
}

async function runVerifierScript(
  extra: string[]
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [path.join(repoRoot, "scripts", "verify-audit-chain.mjs"), ...extra],
      { env: { ...process.env, TZ: "UTC" }, timeout: 60_000 }
    );
    return { code: 0, stdout, stderr };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? -1, stdout: e.stdout ?? "", stderr: e.stderr ?? "" };
  }
}

describe("audit chain (F-08) — integration, real DB", () => {
  let db: Db;
  /** Ids of rows this file wrote via writeAuditLog in test 1. */
  let myRowIds: number[] = [];

  beforeAll(async () => {
    resetAssertionCount();
    db = (await getDb())!;
    expect(db).toBeTruthy();
  });

  afterAll(async () => {
    // Safety net: chain must be intact when this file finishes so later
    // suite files keep appending to a valid chain.
    const v = await verifyAuditChain(db, { strict: false });
    if (!v.ok) {
      console.error(`[integration] ${FILE}: chain left broken!`, v.failure);
    }
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("writeAuditLog chains N interleaved events (direct + via tRPC procedures)", async () => {
    const N = 6;
    for (let i = 0; i < N; i++) {
      if (i % 2 === 0) {
        // Direct writer path.
        await writeAuditLog({
          agentId: regularUser.id,
          action: `CHAIN_TEST_DIRECT_${i}`,
          resource: "audit_chain_test",
          resourceId: `res-${i}`,
          status: "success",
          metadata: { i, nested: { b: i, a: [i, null, "x"] } },
        });
      } else {
        // Interleaved tRPC procedure that itself calls writeAuditLog.
        const caller = callerFor(regularUser);
        await caller.gdprDashboard.submitDsar({
          customerId: 424000 + i,
          requestType: "access",
          reason: `chain-test-${i}`,
        });
      }
    }

    const rows = await allRows(db);
    const mine = rows.filter(
      r =>
        r.resource === "audit_chain_test" ||
        (r.action === "DSAR_REQUEST" && r.resourceId?.startsWith("4240"))
    );
    expect(mine.length).toBe(N);
    myRowIds = mine.map(r => r.id);

    // Every row written via writeAuditLog carries both hash fields.
    for (const row of mine) {
      expect(row.entryHash).toMatch(/^[0-9a-f]{64}$/);
      // Independent recompute of the stored hash pins the canonical format.
      expect(computeEntryHash(row.prevHash ?? null, entryFieldsFromRow(row))).toBe(
        row.entryHash
      );
    }

    // Linkage: each chained row's prevHash is the previous row's entryHash,
    // with NULL only at a segment genesis (first row / after unchained row).
    for (let i = 1; i < rows.length; i++) {
      const cur = rows[i]!;
      if (!cur.entryHash) continue;
      const prev = rows[i - 1]!;
      expect(cur.prevHash ?? null).toBe(prev.entryHash ? prev.entryHash : null);
    }

    // Full verification, server lib.
    const v = await verifyAuditChain(db, { strict: false });
    expect(v.ok).toBe(true);
    expect(v.checkedRows).toBeGreaterThanOrEqual(N);
    expect(v.tipHash).toBe((await tipRow(db))?.entryHash ?? null);

    // Same via the admin procedure.
    const admin = callerFor(adminUser);
    const proc = await admin.auditCompliance.verifyChain({ allowUnchained: true });
    expect(proc.ok).toBe(true);
    expect(proc.tipHash).toBe(v.tipHash);
  });

  it("verifyChain is admin-gated (anonymous UNAUTHORIZED, user FORBIDDEN)", async () => {
    await expectTrpcError(
      callerFor(null).auditCompliance.verifyChain({ allowUnchained: true }),
      "UNAUTHORIZED"
    );
    await expectTrpcError(
      callerFor(regularUser).auditCompliance.verifyChain({ allowUnchained: true }),
      "FORBIDDEN"
    );
    await expectTrpcError(
      callerFor(regularUser).auditCompliance.export({}),
      "FORBIDDEN"
    );
    await expectTrpcError(
      callerFor(null).auditCompliance.retentionPolicy(),
      "UNAUTHORIZED"
    );
  });

  it("tampering a historical row (SQL UPDATE) breaks verification at the exact row", async () => {
    const rows = chained(await allRows(db));
    // Choose one of this file's rows that has a chained successor.
    const target = rows.find(
      r => myRowIds.includes(r.id) && rows.some(s => s.id > r.id && s.entryHash)
    )!;
    expect(target).toBeTruthy();
    const originalAction = target.action;

    await db
      .update(auditLog)
      .set({ action: "TAMPERED_ACTION" })
      .where(eq(auditLog.id, target.id));

    try {
      const v = await verifyAuditChain(db, { strict: false });
      expect(v.ok).toBe(false);
      expect(v.failure?.rowId).toBe(target.id);
      expect(v.failure?.reason).toBe("entry-hash-mismatch");
      expect(v.failure?.actual).toBe(target.entryHash);

      const proc = await callerFor(adminUser).auditCompliance.verifyChain({
        allowUnchained: true,
      });
      expect(proc.ok).toBe(false);
      expect(proc.failure?.rowId).toBe(target.id);

      // CLI verifier agrees (exit 1, same broken row).
      const cli = await runVerifierScript(["--allow-unchained", "--json"]);
      expect(cli.code).toBe(1);
      const report = JSON.parse(cli.stdout);
      expect(Number(report.failure.rowId)).toBe(target.id);
      expect(report.failure.reason).toBe("entry-hash-mismatch");
    } finally {
      // Restore the original content: the stored entryHash becomes valid again.
      await db
        .update(auditLog)
        .set({ action: originalAction })
        .where(eq(auditLog.id, target.id));
    }
    const healed = await verifyAuditChain(db, { strict: false });
    expect(healed.ok).toBe(true);
  });

  it("deleting a middle row is detected as a broken link at the successor", async () => {
    const rows = chained(await allRows(db));
    const idx = rows.findIndex(
      r => myRowIds.includes(r.id) && rows.some(s => s.id > r.id && s.entryHash)
    );
    const victim = rows[idx]!;
    const successor = rows.slice(idx + 1).find(r => r.entryHash)!;
    expect(successor.prevHash).toBe(victim.entryHash);

    await db.delete(auditLog).where(eq(auditLog.id, victim.id));

    try {
      const v = await verifyAuditChain(db, { strict: false });
      expect(v.ok).toBe(false);
      // The exact broken link: the successor row now dangles. The reason is
      // "prev-hash-mismatch" when the row before the victim was chained, or
      // "bad-genesis" when it was an unchained bypass/middleware row (the
      // successor's non-null prevHash can no longer open a segment).
      expect(v.failure?.rowId).toBe(successor.id);
      expect(["prev-hash-mismatch", "bad-genesis"]).toContain(v.failure?.reason);
      expect(v.failure?.actual).toBe(victim.entryHash);
    } finally {
      // Re-insert the exact original row: chain heals.
      await db.insert(auditLog).values(victim);
    }
    const healed = await verifyAuditChain(db, { strict: false });
    expect(healed.ok).toBe(true);
  });

  it("DOCUMENTED LIMITATION: deleting the chain tip is not detectable by recompute", async () => {
    // This test pins the honest limit: without external tip anchoring,
    // truncation at the head verifies "ok". External WORM anchoring of the
    // tip hash is the documented next step (OPEN ITEM).
    const tip = (await tipRow(db))!;
    expect(tip.entryHash).toBeTruthy();

    await db.delete(auditLog).where(eq(auditLog.id, tip.id));
    const v = await verifyAuditChain(db, { strict: false });
    expect(v.ok).toBe(true); // limitation: no successor link to break
    expect(v.tipId).not.toBe(tip.id);

    // Restore.
    await db.insert(auditLog).values(tip);
    const healed = await verifyAuditChain(db, { strict: false });
    expect(healed.ok).toBe(true);
    expect(healed.tipId).toBe(tip.id);
  });

  it("a direct-insert bypass row (NULL hashes) fails strict verification", async () => {
    const baselineUnchained = (
      await db.select({ id: auditLog.id }).from(auditLog).where(isNull(auditLog.entryHash))
    ).length;

    const [bypass] = await db
      .insert(auditLog)
      .values({
        action: "BYPASS_DIRECT_INSERT",
        resource: "audit_chain_test",
        status: "success",
      })
      .returning();
    expect(bypass!.entryHash).toBeNull();

    // Strict: fails on an unchained row (the bypass row is the last one; if
    // no earlier suite file left unchained rows, it is THE failure).
    const strict = await verifyAuditChain(db, { strict: true });
    expect(strict.ok).toBe(false);
    expect(strict.failure?.reason).toBe("unchained-row");
    if (baselineUnchained === 0) {
      expect(strict.failure?.rowId).toBe(bypass!.id);
    }

    // Tolerant: chained segments still verify, bypass counted.
    const tolerant = await verifyAuditChain(db, { strict: false });
    expect(tolerant.ok).toBe(true);
    expect(tolerant.unchainedRows).toBe(baselineUnchained + 1);

    // Remove the bypass row BEFORE any further chained write so the next
    // writeAuditLog links to the previous chained tip, keeping the table
    // strictly-verifiable again for later files.
    await db.delete(auditLog).where(eq(auditLog.id, bypass!.id));
    const cleaned = await verifyAuditChain(db, { strict: false });
    expect(cleaned.ok).toBe(true);
    expect(
      (await db.select({ id: auditLog.id }).from(auditLog).where(isNull(auditLog.entryHash))).length
    ).toBe(baselineUnchained);
  });

  it("verify-audit-chain.mjs reports OK and the same tip hash on an intact chain", async () => {
    const v = await verifyAuditChain(db, { strict: false });
    const cli = await runVerifierScript(["--allow-unchained", "--json"]);
    expect(cli.code).toBe(0);
    const report = JSON.parse(cli.stdout);
    expect(report.ok).toBe(true);
    expect(report.tipHash).toBe(v.tipHash);
    expect(report.checkedRows).toBe(v.checkedRows);
  });

  it("export is paginated in chain order, includes entryHash, and is itself audited", async () => {
    const admin = callerFor(adminUser);
    const page1 = await admin.auditCompliance.export({ cursor: 0, limit: 5 });
    expect(page1.items.length).toBe(5);
    expect(page1.nextCursor).toBe(page1.items[4]!.id);
    expect(page1.chainVersion).toBe("insureportal-audit-v1");
    expect(page1.tipAtExport?.entryHash).toBeTruthy();
    // Ascending id order (chain order).
    for (let i = 1; i < page1.items.length; i++) {
      expect(page1.items[i]!.id).toBeGreaterThan(page1.items[i - 1]!.id);
    }

    const page2 = await admin.auditCompliance.export({
      cursor: page1.nextCursor!,
      limit: 5,
    });
    expect(page2.items.length).toBe(5);
    expect(page2.items[0]!.id).toBeGreaterThan(page1.nextCursor!);

    // Every exported row carries its hash material for offline verification.
    const exportedMine = [...page1.items, ...page2.items].filter(r =>
      myRowIds.includes(r.id)
    );
    for (const row of exportedMine) {
      expect(row.entryHash).toMatch(/^[0-9a-f]{64}$/);
    }

    // The export itself wrote chained AUDIT_EXPORT rows (two exports above).
    const exportEvents = (await allRows(db)).filter(r => r.action === "AUDIT_EXPORT");
    expect(exportEvents.length).toBeGreaterThanOrEqual(2);
    for (const ev of exportEvents) {
      expect(ev.entryHash).toMatch(/^[0-9a-f]{64}$/);
    }

    // Chain still verifies after the export events.
    const v = await verifyAuditChain(db, { strict: false });
    expect(v.ok).toBe(true);
  });

  it("retentionPolicy returns config and honestly marks deletion/anchoring as open", async () => {
    const admin = callerFor(adminUser);
    const policy = await admin.auditCompliance.retentionPolicy();
    expect(policy.retentionDays).toBeGreaterThan(0);
    expect(policy.enforcement.deletionImplemented).toBe(false);
    expect(policy.enforcement.status).toBe("OPEN ITEM");
    expect(policy.externalAnchoring.implemented).toBe(false);
    expect(policy.externalAnchoring.status).toBe("OPEN ITEM");
  });
});
