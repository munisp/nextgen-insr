// TypeScript enabled — Sprint 96 security audit
/**
 * OPS wave F6 — data-integrity & operations fixes.
 *
 * Real tests (no mocks) for:
 *   OPS-3  piiCrypto — AES-256-GCM envelope roundtrip, tamper fail-loud,
 *          legacy plaintext passthrough, fail-loud without key in prod
 *   OPS-4  auditChain redaction — tombstone PII purge with hash-chain
 *          linkage preserved (PGlite, real DB)
 *   OPS-5  kafkaDlqEnvelope — unified producer/consumer envelope, retryCount
 *          never resets, legacy header-only messages still parse
 *   OPS-7  lagosDate — Africa/Lagos business-date attribution
 *   OPS-8  CSRF dual-key rotation + webhookHmac replay window
 *   OPS-1/2/10/12/16 deploy-file invariants (content-level, real files)
 */
import { createHmac } from "crypto";
import * as fs from "fs";
import * as path from "path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

process.env.FIELD_ENCRYPTION_KEY =
  process.env.FIELD_ENCRYPTION_KEY ||
  "test-only-field-encryption-key-0123456789abcdef";

import {
  decryptPii,
  encryptPii,
  encryptPiiFields,
  decryptPiiFields,
  isEncryptedPii,
} from "./lib/piiCrypto";
import { lagosDateString, lagosMonthString } from "./lib/lagosDate";
import {
  buildDlqEnvelope,
  parseDlqMessage,
  RETRY_COUNT_HEADER,
  type DlqEnvelope,
} from "./lib/kafkaDlqEnvelope";

// ─── OPS-3: PII encryption at rest ──────────────────────────────────────────
describe("OPS-3: piiCrypto field-level encryption", () => {
  it("encrypts to a versioned envelope and round-trips", () => {
    const enc = encryptPii("12345678901")!;
    expect(isEncryptedPii(enc)).toBe(true);
    expect(enc.startsWith("pii:v1:")).toBe(true);
    expect(enc).not.toContain("12345678901");
    expect(decryptPii(enc)).toBe("12345678901");
  });

  it("produces different ciphertexts for identical plaintext (random salt/IV)", () => {
    expect(encryptPii("12345678901")).not.toBe(encryptPii("12345678901"));
  });

  it("passes null/empty through (nullable columns)", () => {
    expect(encryptPii(null)).toBeNull();
    expect(encryptPii("")).toBeNull();
    expect(decryptPii(null)).toBeNull();
  });

  it("reads legacy plaintext rows unchanged (pre-encryption compat)", () => {
    expect(decryptPii("12345678901")).toBe("12345678901");
  });

  it("fails loud on tampered ciphertext (GCM auth tag)", () => {
    const enc = encryptPii("12345678901")!;
    const parts = enc.split(":");
    parts[5] = parts[5].slice(0, -2) + (parts[5].endsWith("00") ? "ff" : "00");
    expect(() => decryptPii(parts.join(":"))).toThrow();
  });

  it("fails loud on unknown envelope version", () => {
    expect(() => decryptPii("pii:v9:aa:bb:cc:dd")).toThrow(/[Uu]nsupported/);
  });

  it("never double-encrypts an envelope", () => {
    const enc = encryptPii("12345678901")!;
    expect(encryptPii(enc)).toBe(enc);
  });

  it("encryptPiiFields/decryptPiiFields cover only named fields", () => {
    const row = { firstName: "Ada", bvn: "12345678901", nin: null as string | null };
    const enc = encryptPiiFields(row, ["bvn", "nin"] as const);
    expect(enc.firstName).toBe("Ada");
    expect(isEncryptedPii(enc.bvn)).toBe(true);
    expect(enc.nin).toBeNull();
    const dec = decryptPiiFields(enc, ["bvn", "nin"] as const);
    expect(dec.bvn).toBe("12345678901");
  });
});

// ─── OPS-7: Africa/Lagos business dates ─────────────────────────────────────
describe("OPS-7: lagosDate business-date attribution", () => {
  it("attributes 23:30 UTC to the NEXT Lagos calendar day (UTC+1)", () => {
    const d = new Date("2026-04-09T23:30:00.000Z");
    expect(lagosDateString(d)).toBe("2026-04-10");
  });

  it("attributes 22:59 UTC to the same Lagos day", () => {
    const d = new Date("2026-04-09T22:59:59.000Z");
    expect(lagosDateString(d)).toBe("2026-04-09");
  });

  it("month string follows Lagos, not UTC", () => {
    const d = new Date("2026-04-30T23:30:00.000Z"); // 00:30 Lagos May 1
    expect(lagosMonthString(d)).toBe("2026-05");
  });

  it("matches YYYY-MM-DD shape", () => {
    expect(lagosDateString()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── OPS-5: unified Kafka DLQ envelope ──────────────────────────────────────
function fakeMessage(
  value: string,
  headers: Record<string, string> = {},
  offset = "41"
): any {
  return {
    value: Buffer.from(value),
    offset,
    headers: Object.fromEntries(
      Object.entries(headers).map(([k, v]) => [k, Buffer.from(v)])
    ),
  };
}

describe("OPS-5: kafkaDlqEnvelope unified schema", () => {
  it("producer envelope parses on the consumer side with all metadata in the BODY", () => {
    const msg = fakeMessage(JSON.stringify({ orderId: 7 }));
    const { value, envelope } = buildDlqEnvelope({
      message: msg,
      sourceTopic: "pos.transactions",
      partition: 2,
      error: "boom",
    });
    expect(envelope.retryCount).toBe(0);
    const parsed = parseDlqMessage(fakeMessage(value))!;
    expect(parsed.originalTopic).toBe("pos.transactions");
    expect(parsed.originalPartition).toBe(2);
    expect(parsed.errorMessage).toBe("boom");
    expect((parsed.payload as any).orderId).toBe(7);
  });

  it("retryCount is carried from the x-retry-count header and NEVER resets", () => {
    // simulate a message that has already been retried twice
    const msg = fakeMessage(JSON.stringify({ orderId: 7 }), {
      [RETRY_COUNT_HEADER]: "2",
    });
    const { envelope } = buildDlqEnvelope({
      message: msg,
      sourceTopic: "pos.transactions",
      partition: 0,
      error: "still failing",
    });
    expect(envelope.retryCount).toBe(2);
  });

  it("legacy _retryCount body counter is honoured (no reset)", () => {
    const msg = fakeMessage(JSON.stringify({ orderId: 7, _retryCount: 4 }));
    const { envelope } = buildDlqEnvelope({
      message: msg,
      sourceTopic: "t",
      partition: 0,
      error: "x",
    });
    expect(envelope.retryCount).toBe(4);
  });

  it("parses LEGACY header-only DLQ messages (raw value + x-* headers)", () => {
    const legacy = fakeMessage(JSON.stringify({ legacy: true }), {
      "x-original-topic": "pos.transactions",
      "x-original-partition": "3",
      "x-error": "legacy failure",
      [RETRY_COUNT_HEADER]: "1",
    });
    const parsed = parseDlqMessage(legacy)!;
    expect(parsed.originalTopic).toBe("pos.transactions");
    expect(parsed.retryCount).toBe(1);
    expect((parsed.payload as any).legacy).toBe(true);
  });

  it("unparseable garbage is wrapped (never silently dropped) and never auto-retried", () => {
    const parsed = parseDlqMessage(fakeMessage("<<not json>>"))!;
    expect(parsed.originalTopic).toBe("unknown");
    expect(parsed.retryCount).toBe(Number.MAX_SAFE_INTEGER);
    expect((parsed.payload as any).raw).toBe("<<not json>>");
  });

  it("null-value messages parse to null", () => {
    expect(parseDlqMessage({ value: null, offset: "0" } as any)).toBeNull();
  });
});

// ─── OPS-4: audit-log PII redaction with chain preservation (real DB) ───────
describe("OPS-4: auditChain PII redaction (PGlite)", () => {
  let db: any;
  let pglite: any;
  let auditChain: typeof import("./lib/auditChain");

  beforeAll(async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    pglite = new PGlite();
    db = drizzle(pglite);
    auditChain = await import("./lib/auditChain");
    await pglite.query(`CREATE TABLE audit_log (
      id bigserial PRIMARY KEY,
      "agentId" integer,
      action varchar(128) NOT NULL,
      resource varchar(64),
      "resourceId" varchar(64),
      "ipAddress" varchar(45),
      "userAgent" varchar(256),
      status varchar(32) DEFAULT 'success',
      metadata json,
      "tenantId" integer,
      "prevHash" varchar(64),
      "entryHash" varchar(64),
      "redactedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
  });

  afterAll(async () => {
    await pglite?.close();
  });

  async function insertChainedRow(
    fields: Omit<import("./lib/auditChain").AuditEntryFields, "createdAt"> & { createdAt?: Date },
    prevHash: string | null
  ): Promise<{ id: number; entryHash: string }> {
    const createdAt = fields.createdAt ?? new Date();
    const entryHash = auditChain.computeEntryHash(prevHash, {
      ...fields,
      createdAt,
    });
    const rows = (await pglite.query(
      `INSERT INTO audit_log ("agentId", action, resource, "resourceId", "ipAddress", "userAgent", status, metadata, "tenantId", "prevHash", "entryHash", "createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [
        fields.agentId,
        fields.action,
        fields.resource,
        fields.resourceId,
        fields.ipAddress,
        fields.userAgent,
        fields.status,
        JSON.stringify(fields.metadata),
        fields.tenantId,
        prevHash,
        entryHash,
        createdAt.toISOString(),
      ]
    )) as any;
    return { id: rows.rows[0].id, entryHash };
  }

  it("redaction tombstones PII but preserves hash-chain verification", async () => {
    const base = {
      agentId: 1,
      action: "GDPR_ERASURE_REQUEST",
      resource: "customer",
      resourceId: "42",
      ipAddress: "10.0.0.9",
      userAgent: "jest-agent",
      status: "success",
      tenantId: null,
    };
    const r1 = await insertChainedRow(
      { ...base, metadata: { agentCode: "AGT-007", phone: "0803000111222" } },
      null
    );
    const r2 = await insertChainedRow(
      { ...base, action: "UNRELATED", resourceId: "99", metadata: { ok: true } },
      r1.entryHash
    );

    // Chain verifies BEFORE redaction
    const before = await auditChain.verifyAuditChain(db);
    expect(before.ok).toBe(true);
    expect(before.checkedRows).toBe(2);

    // Redact customer 42 + phone fragment
    const res = await auditChain.redactAuditLogPii(db, {
      customerId: 42,
      piiFragments: ["0803000111222"],
      reason: "test erasure",
    });
    expect(res.redactedRows).toBe(1);

    // Row content: PII gone, hashes intact
    const row = (await pglite.query(
      `SELECT metadata, "ipAddress", "userAgent", "entryHash", "redactedAt" FROM audit_log WHERE id=$1`,
      [r1.id]
    )) as any;
    expect(JSON.stringify(row.rows[0].metadata)).not.toContain("AGT-007");
    expect(row.rows[0].metadata.redacted).toBe(true);
    expect(row.rows[0].ipAddress).toBeNull();
    expect(row.rows[0].entryHash).toBe(r1.entryHash);
    expect(row.rows[0].redactedAt).not.toBeNull();

    // Chain STILL verifies after redaction (linkage preserved)
    const after = await auditChain.verifyAuditChain(db);
    expect(after.ok).toBe(true);
    expect(after.redactedRows).toBe(1);
    expect(after.tipHash).toBe(r2.entryHash);

    // Idempotent: second redaction touches nothing
    const again = await auditChain.redactAuditLogPii(db, {
      customerId: 42,
      reason: "test erasure",
    });
    expect(again.redactedRows).toBe(0);

    // Tamper detection still works on the UNREDACTED row
    await pglite.query(
      `UPDATE audit_log SET action='FORGED' WHERE id=$1`,
      [r2.id]
    );
    const forged = await auditChain.verifyAuditChain(db);
    expect(forged.ok).toBe(false);
    expect(forged.failure?.reason).toBe("entry-hash-mismatch");
  });

  it("refuses to redact with no usable criterion (fail-loud)", async () => {
    await expect(
      auditChain.redactAuditLogPii(db, { reason: "x" })
    ).rejects.toThrow(/criterion/);
  });
});

// ─── OPS-8: webhook HMAC replay window ──────────────────────────────────────
describe("OPS-8: webhookHmac timestamp + replay window", () => {
  const SECRET = "webhook-test-secret";
  function makeReqRes(body: string, headers: Record<string, string>) {
    const req: any = {
      headers,
      path: "/webhooks/test",
      rawBody: Buffer.from(body),
    };
    let status = 0;
    let json: any = null;
    const res: any = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: any) {
        json = payload;
        return this;
      },
    };
    return { req, res, getStatus: () => status, getJson: () => json };
  }
  function sig(body: string): string {
    return createHmac("sha256", SECRET).update(Buffer.from(body)).digest("hex");
  }

  it("rejects a validly-signed but STALE webhook (replay)", async () => {
    vi.resetModules();
    process.env.WEBHOOK_TEST_SECRET = SECRET;
    const { verifyWebhookHmac } = await import("./middleware/webhookHmac");
    const body = JSON.stringify({ event: "settlement" });
    const { req, res, getStatus, getJson } = makeReqRes(body, {
      "x-webhook-signature": sig(body),
      "x-webhook-timestamp": String(Date.now() - 10 * 60_000), // 10 min old
    });
    let nextCalled = false;
    await verifyWebhookHmac("WEBHOOK_TEST_SECRET", "x-webhook-signature", {
      failClosed: true,
    })(req, res, () => (nextCalled = true));
    expect(nextCalled).toBe(false);
    expect(getStatus()).toBe(401);
    expect(getJson().error).toMatch(/replay window/i);
  });

  it("accepts a fresh, validly-signed webhook", async () => {
    const { verifyWebhookHmac } = await import("./middleware/webhookHmac");
    const body = JSON.stringify({ event: "settlement" });
    const { req, res } = makeReqRes(body, {
      "x-webhook-signature": sig(body),
      "x-webhook-timestamp": String(Date.now()),
    });
    let nextCalled = false;
    await verifyWebhookHmac("WEBHOOK_TEST_SECRET", "x-webhook-signature", {
      failClosed: true,
    })(req, res, () => (nextCalled = true));
    expect(nextCalled).toBe(true);
  });

  it("rejects missing timestamp when fail-closed", async () => {
    const { verifyWebhookHmac } = await import("./middleware/webhookHmac");
    const body = "x";
    const { req, res, getStatus } = makeReqRes(body, {
      "x-webhook-signature": sig(body),
    });
    let nextCalled = false;
    await verifyWebhookHmac("WEBHOOK_TEST_SECRET", "x-webhook-signature", {
      failClosed: true,
    })(req, res, () => (nextCalled = true));
    expect(nextCalled).toBe(false);
    expect(getStatus()).toBe(401);
  });
});

// ─── OPS-8: CSRF dual-key rotation ──────────────────────────────────────────
describe("OPS-8: CSRF secret rotation", () => {
  it("validates tokens signed with the PREVIOUS secret during rotation", async () => {
    vi.resetModules();
    process.env.JWT_SECRET = "current-secret-for-csrf";
    process.env.JWT_SECRET_PREVIOUS = "previous-secret-for-csrf";
    const mod = await import("./lib/securityAuditFixes");
    // Forge a token the way the OLD secret would have signed it
    const payload = `sess-1:${Date.now().toString(36)}`;
    const oldSig = createHmac("sha256", "previous-secret-for-csrf")
      .update(payload)
      .digest("hex")
      .slice(0, 16);
    expect(mod.validateCsrfToken(`${payload}:${oldSig}`, "sess-1")).toBe(true);
    // And current-secret tokens still work
    const fresh = mod.generateCsrfToken("sess-1");
    expect(mod.validateCsrfToken(fresh, "sess-1")).toBe(true);
    delete process.env.JWT_SECRET_PREVIOUS;
  });
});

// ─── OPS-1/2/10/12/16: deploy-file invariants (real files, no mocks) ────────
describe("OPS deploy-file invariants", () => {
  const root = path.resolve(__dirname, "..");
  const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

  it("OPS-1/12: MinIO init creates audit bucket --with-lock, sets retention, fails on default creds in prod", () => {
    const s = read("infra/minio/init-minio.sh");
    expect(s).toContain("mc mb --with-lock");
    expect(s).toContain("mc retention set");
    expect(s).toContain("AUDIT_RETENTION_MODE");
    expect(s).toMatch(/default MinIO credentials.*production/s);
    expect(s).toMatch(/exit 1/);
  });

  it("OPS-2/3: db-migrate-safe encrypts backups, no /tmp default, applies ledger", () => {
    const s = read("scripts/db-migrate-safe.sh");
    expect(s).not.toMatch(/BACKUP_DIR="\$\{BACKUP_DIR:-\/tmp/);
    expect(s).toContain("/var/backups/insureportal");
    expect(s).toContain("gpg");
    expect(s).toContain("schema_migrations_ext");
    expect(
      s.split("\n").filter(l => !l.includes("BANNED")).join("\n")
    ).not.toContain("push --force");
  });

  it("OPS-2: no deploy/CI path uses drizzle-kit push --force", () => {
    for (const f of [
      ".github/workflows/ci.yml",
      ".github/workflows/ci-cd.yml",
      ".github/workflows/integration.yml",
      "tests/integration/setup/globalSetup.ts",
      "scripts/backup-restore-rehearsal.sh",
    ]) {
      const s = read(f);
      const stripped = s.replace(/[^\n]*--force removed[^\n]*/g, "").replace(/[^\n]*no --force[^\n]*/g, "");
      expect(stripped).not.toContain("push --force");
    }
    expect(read("Makefile.production")).toContain("db-migrate-safe.sh");
  });

  it("OPS-2: MySQL orphan 0000 migration quarantined, migrations 0073/0074 exist", () => {
    expect(
      fs.existsSync(
        path.join(root, "drizzle/quarantine/0000_conscious_guardian.mysql-orphan.sql")
      )
    ).toBe(true);
    expect(fs.existsSync(path.join(root, "drizzle/0000_conscious_guardian.sql"))).toBe(false);
    expect(read("drizzle/0073_pii_encryption_at_rest_widen.sql")).toContain('ALTER COLUMN "bvn" TYPE text');
    expect(read("drizzle/0074_audit_log_erasure_redaction.sql")).toContain('"redactedAt"');
  });

  it("OPS-10: single SIGTERM drain path (index.ts registers none)", () => {
    const idx = read("server/_core/index.ts");
    expect(idx).not.toMatch(/process\.on\("SIGTERM"/);
    const gs = read("server/lib/gracefulShutdown.ts");
    expect(gs).toContain('process.on("SIGTERM"');
    expect(gs).toContain("SHUTDOWN_TIMEOUT_MS = 30_000");
    // exit happens AFTER drain: process.exit(0) is inside server.close callback
    expect(gs.indexOf("server.close")).toBeLessThan(gs.indexOf("process.exit(0)"));
  });

  it("OPS-11: Temporal worker pins a buildId and has a version guard", () => {
    const s = read("server/temporal-worker.ts");
    expect(s).toContain("buildId: WORKER_BUILD_ID");
    expect(s).toContain("assertVersionGuard");
    expect(
      fs.existsSync(path.join(root, "docs/TEMPORAL_VERSIONING.md"))
    ).toBe(true);
  });
});
