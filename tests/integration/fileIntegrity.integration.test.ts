/**
 * fileIntegrity.integration.test.ts — B4 integration coverage for the FIM
 * pipeline (system_config allowlist -> recordBaseline -> checkIntegrity ->
 * securityAudit.getFileIntegrity / recordFileBaseline) against the REAL PG
 * (PGlite) schema and REAL temp files hashed with REAL sha256.
 *
 * Change/missing/new detection cases create actual files in a temp directory
 * and assert the diff against independently computed sha256 digests. The
 * router-level case baselines real repo files (package.json) via the admin
 * mutation.
 *
 * This is the only suite file that writes file_integrity_baseline or the
 * 'fim_monitored_paths' system_config key (grep-verified), so the fail-loud
 * cases run FIRST, before any baseline/config exists.
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";

import { systemConfig } from "../../drizzle/schema";
import { fileIntegrityBaseline } from "../../drizzle/schema.additions";
import { getDb } from "../../server/db";
import {
  checkIntegrity,
  computeFileSha256,
  FIM_CONFIG_KEY,
  FimConfigError,
  FimNoBaselineError,
  getMonitoredPaths,
  recordBaseline,
  scanAllowlist,
} from "../../server/lib/fileIntegrity";
import {
  callerFor,
  adminUser,
  regularUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "fileIntegrity";

function sha256Of(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

let tmpDir: string;

async function setAllowlist(paths: string[]): Promise<void> {
  const db = (await getDb())!;
  await db.delete(systemConfig).where(eq(systemConfig.key, FIM_CONFIG_KEY));
  await db.insert(systemConfig).values({
    key: FIM_CONFIG_KEY,
    value: JSON.stringify(paths),
    description: "integration test allowlist",
  });
}

describe(`${FILE}: file-integrity monitoring (B4)`, () => {
  beforeAll(async () => {
    resetAssertionCount();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fim-it-"));
  });

  afterAll(async () => {
    const db = (await getDb())!;
    await db.delete(fileIntegrityBaseline);
    await db.delete(systemConfig).where(eq(systemConfig.key, FIM_CONFIG_KEY));
    await fs.rm(tmpDir, { recursive: true, force: true });
    console.log(`[${FILE}] assertions: ${getAssertionCount()}`);
  });

  it("getFileIntegrity fails loud NO_BASELINE before any baseline exists", async () => {
    const admin = callerFor(adminUser);
    const err = await expectTrpcError(
      admin.securityAudit.getFileIntegrity({}),
      "PRECONDITION_FAILED"
    );
    expect(err.message).toContain("NO_BASELINE");
    expect(err.message).toContain("recordFileBaseline");
  });

  it("getMonitoredPaths fails loud with config instructions when the allowlist is unset", async () => {
    const db = (await getDb())!;
    await expect(getMonitoredPaths(db)).rejects.toBeInstanceOf(FimConfigError);
    await expect(getMonitoredPaths(db)).rejects.toThrow(FIM_CONFIG_KEY);
  });

  it("scanner hashes REAL temp files; baseline persists the real digests", async () => {
    await fs.writeFile(path.join(tmpDir, "config-a.json"), '{"a":1}\n');
    await fs.mkdir(path.join(tmpDir, "conf.d"));
    await fs.writeFile(path.join(tmpDir, "conf.d", "b.conf"), "key=value\n");
    await setAllowlist(["."]); // whole temp dir, relative to rootDir below

    const db = (await getDb())!;
    const scanned = await recordBaseline(db, { rootDir: tmpDir, baselinedBy: "integration-test" });
    expect(scanned.length).toBe(2);
    const a = scanned.find(f => f.path.endsWith("config-a.json"))!;
    // Independently computed digest of the real bytes.
    expect(a.sha256).toBe(sha256Of(Buffer.from('{"a":1}\n')));
    expect(a.fileSize).toBe(Buffer.byteLength('{"a":1}\n'));

    const rows = await db.select().from(fileIntegrityBaseline);
    expect(rows.length).toBe(2);
    expect(rows.find(r => r.path.endsWith("b.conf"))!.sha256).toBe(
      sha256Of(Buffer.from("key=value\n"))
    );

    // Clean diff against an untouched filesystem.
    const clean = await checkIntegrity(db, { rootDir: tmpDir });
    expect(clean.status).toBe("clean");
    expect(clean.unchanged).toBe(2);
    expect(clean.changed.length).toBe(0);
  });

  it("diff detects a REAL modification, a REAL deletion, and a REAL new file", async () => {
    const db = (await getDb())!;
    // Modify one baselined file.
    await fs.writeFile(path.join(tmpDir, "config-a.json"), '{"a":2}\n');
    // Add a brand-new file inside the allowlisted tree.
    await fs.writeFile(path.join(tmpDir, "conf.d", "c.conf"), "new=true\n");

    let diff = await checkIntegrity(db, { rootDir: tmpDir });
    expect(diff.status).toBe("violations_detected");
    expect(diff.changed.length).toBe(1);
    expect(diff.changed[0]!.path.endsWith("config-a.json")).toBe(true);
    expect(diff.changed[0]!.baselineSha256).toBe(sha256Of(Buffer.from('{"a":1}\n')));
    expect(diff.changed[0]!.currentSha256).toBe(sha256Of(Buffer.from('{"a":2}\n')));
    expect(diff.newFiles.length).toBe(1);
    expect(diff.newFiles[0]!.path.endsWith("c.conf")).toBe(true);
    expect(diff.newFiles[0]!.currentSha256).toBe(sha256Of(Buffer.from("new=true\n")));

    // Delete a baselined file.
    await fs.rm(path.join(tmpDir, "conf.d", "b.conf"));
    diff = await checkIntegrity(db, { rootDir: tmpDir });
    expect(diff.missing.length).toBe(1);
    expect(diff.missing[0]!.path.endsWith("b.conf")).toBe(true);
    expect(diff.missing[0]!.baselineSha256).toBe(sha256Of(Buffer.from("key=value\n")));
  });

  it("checkIntegrity fails loud NO_BASELINE after the baseline is cleared", async () => {
    const db = (await getDb())!;
    await db.delete(fileIntegrityBaseline);
    await expect(checkIntegrity(db, { rootDir: tmpDir })).rejects.toBeInstanceOf(FimNoBaselineError);
  });

  it("router: recordFileBaseline is admin-gated; getFileIntegrity returns a real diff of the repo", async () => {
    // Allowlist real repo files, relative to the server cwd (repo root).
    await setAllowlist(["package.json"]);
    const regular = callerFor(regularUser);
    await expectTrpcError(
      regular.securityAudit.recordFileBaseline({}),
      "FORBIDDEN"
    );
    const admin = callerFor(adminUser);
    const rec = await admin.securityAudit.recordFileBaseline({});
    expect(rec.success).toBe(true);
    expect(rec.baselinedFiles).toBe(1);
    expect(rec.paths).toEqual(["package.json"]);

    const result = await admin.securityAudit.getFileIntegrity({});
    expect(result.monitoredPaths).toBe(1);
    // The repo's package.json is unmodified since baseline -> clean.
    expect(result.status).toBe("clean");
    expect(result.unchanged).toBe(1);
    const digest = await computeFileSha256(path.join(process.cwd(), "package.json"));
    const db = (await getDb())!;
    const [row] = await db.select().from(fileIntegrityBaseline);
    expect(row.sha256).toBe(digest);
  });

  it("recordBaseline fails loud when the allowlist matches no real files", async () => {
    await setAllowlist(["does/not/exist-anywhere.xyz"]);
    const db = (await getDb())!;
    await expect(recordBaseline(db, { rootDir: tmpDir })).rejects.toBeInstanceOf(FimConfigError);
  });

  it("scanAllowlist refuses path traversal outside the root", async () => {
    const scanned = await scanAllowlist(["../../etc"], tmpDir);
    expect(scanned.length).toBe(0);
  });
});
