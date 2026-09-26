/**
 * embedded-factory.test.ts — Q-wave Q1 (2026-09-25)
 *
 * Real-behavior PGlite integration tests for the embedded partner product
 * factory (migration 0086 + server/routers/embeddedPartnerFactory.ts).
 * No mocks for the behavior under test: real PostgreSQL (PGlite wire
 * protocol), real HTTP mobile-money endpoint (local server), real sha256 key
 * hashing, real router createCaller invocations.
 *
 * Covers: partner product lifecycle, embedded quote→bind→claim authz,
 * cross-partner deny, sandbox isolation, freemium enroll + fail-closed
 * upgrade + real-HTTP upgrade success, scenario instantiation, embed-scope
 * allow/deny, cache invalidation, and non-blocking event publication.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

// 54398 (not 54399 — auth-f3 uses that) so the suites can run concurrently.
const PG_PORT = 54398;
const PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
let pgliteChild: ChildProcess | null = null;
let mmServer: HttpServer | null = null;
// Fixed port: the adapter module captures EMBEDDED_MM_COLLECT_URL at import
// time, so the provider must be restartable on the SAME address.
const MM_PORT = 41911;

type Caller = ReturnType<
  Awaited<typeof import("./routers/embeddedPartnerFactory")>["embeddedPartnerFactoryRouter"]["createCaller"]
>;
let adminCaller: Caller;
let userCaller: Caller;
let publicCaller: Caller;
let db: NonNullable<Awaited<ReturnType<typeof import("./db")["getDb"]>>>;

const adminCtx = {
  user: { id: 9001, username: "admin", role: "admin", name: "Admin", email: "a@t.io" },
} as any;
const userCtx = {
  user: { id: 9002, username: "cust", role: "user", name: "Cust", email: "c@t.io" },
} as any;
const otherUserCtx = {
  user: { id: 9003, username: "other", role: "user", name: "Other", email: "o@t.io" },
} as any;

async function startPglite(): Promise<void> {
  const script = path.resolve(__dirname, "../tests/integration/setup/pgliteServer.mjs");
  pgliteChild = spawn(process.execPath, [script], {
    env: { ...process.env, PGLITE_PORT: String(PG_PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("PGlite start timeout")), 30_000);
    pgliteChild!.stdout!.on("data", d => {
      if (String(d).includes("PGLITE_READY")) {
        clearTimeout(to);
        resolve();
      }
    });
    pgliteChild!.on("exit", c => reject(new Error(`pglite exited ${c}`)));
  });
  process.env.POSTGRES_URL = PG_URL;
  // Unit-test env: no Permify sidecar. Explicit insecure opt-in (same pattern
  // as auth-f3) so protectedProcedure/adminProcedure pass the base gate; the
  // partner-key authz under test is enforced by the router itself.
  process.env.PERMIFY_FAIL_OPEN = "true";
}

/** Real HTTP stand-in for the airtime/mobile-money aggregator. */
async function startMmEndpoint(): Promise<void> {
  mmServer = createServer((req, res) => {
    let body = "";
    req.on("data", c => (body += c));
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      if (parsed.amount > 0 && typeof parsed.reference === "string") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: true, providerRef: `MM-${parsed.reference}` }));
      } else {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false }));
      }
    });
  });
  await new Promise<void>(resolve => mmServer!.listen(MM_PORT, "127.0.0.1", resolve));
}

async function createTables() {
  const { sql } = await import("drizzle-orm");
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY)`,
    `CREATE TABLE IF NOT EXISTS insurance_products (
      id serial PRIMARY KEY,
      "productCode" varchar(32) NOT NULL UNIQUE,
      name varchar(256) NOT NULL,
      description text,
      "coverageType" varchar(64) NOT NULL,
      "minPremium" numeric(18,2),
      "maxCoverageAmount" numeric(18,2),
      "minAge" integer,
      "maxAge" integer,
      "waitingPeriodDays" integer DEFAULT 0,
      "policyTermMonths" integer DEFAULT 12,
      "isActive" boolean NOT NULL DEFAULT true,
      "regulatoryApprovalRef" varchar(128),
      "naicomProductCode" varchar(64),
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS partner_products (
      id serial PRIMARY KEY,
      "partnerCode" varchar(32) NOT NULL UNIQUE,
      "partnerName" varchar(128) NOT NULL,
      "productId" integer NOT NULL,
      "maxSumInsured" numeric(18,2) NOT NULL,
      "commissionRate" numeric(5,2) NOT NULL DEFAULT '5.0',
      branding jsonb DEFAULT '{}',
      whitelabel boolean NOT NULL DEFAULT false,
      sandbox boolean NOT NULL DEFAULT false,
      "apiKeyHash" varchar(64),
      status varchar(16) NOT NULL DEFAULT 'active',
      "createdByUserId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS freemium_tiers (
      id serial PRIMARY KEY,
      "tierCode" varchar(32) NOT NULL UNIQUE,
      name varchar(128) NOT NULL,
      "productId" integer NOT NULL,
      "monthlyPremium" numeric(18,2) NOT NULL DEFAULT '0',
      "sumInsured" numeric(18,2) NOT NULL,
      "coverageType" varchar(64) NOT NULL,
      "isFree" boolean NOT NULL DEFAULT false,
      "sortOrder" integer NOT NULL DEFAULT 0,
      "isActive" boolean NOT NULL DEFAULT true,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS freemium_enrollments (
      id serial PRIMARY KEY,
      "customerId" integer NOT NULL,
      "tierId" integer NOT NULL,
      "policyId" integer,
      status varchar(16) NOT NULL DEFAULT 'active',
      "enrolledAt" timestamp NOT NULL DEFAULT now(),
      "upgradedAt" timestamp,
      metadata jsonb DEFAULT '{}'
    )`,
    `CREATE TABLE IF NOT EXISTS scenario_templates (
      id serial PRIMARY KEY,
      "templateCode" varchar(32) NOT NULL UNIQUE,
      name varchar(128) NOT NULL,
      "productId" integer NOT NULL,
      "triggerEvent" varchar(64) NOT NULL,
      "coverageType" varchar(64) NOT NULL,
      "sumInsured" numeric(18,2) NOT NULL,
      "premiumAmount" numeric(18,2) NOT NULL,
      "durationHours" integer NOT NULL DEFAULT 24,
      terms jsonb DEFAULT '{}',
      "isActive" boolean NOT NULL DEFAULT true,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS api_keys (
      id serial PRIMARY KEY,
      "keyHash" varchar(128) NOT NULL UNIQUE,
      "keyPrefix" varchar(12) NOT NULL,
      name varchar(128) NOT NULL,
      description text,
      "userId" integer NOT NULL,
      "tenantId" integer,
      status varchar(20) NOT NULL DEFAULT 'active',
      scopes json DEFAULT '[]',
      "rateLimit" integer NOT NULL DEFAULT 1000,
      "lastUsedAt" timestamp,
      "expiresAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "revokedAt" timestamp
    )`,
    `CREATE TABLE IF NOT EXISTS policy_quotes (
      id serial PRIMARY KEY,
      "customerId" integer,
      "agentId" integer,
      "productId" integer,
      "productName" text,
      "productType" varchar(64),
      "sumInsured" numeric(18,2),
      "premiumAmount" numeric(18,2),
      "stampDuty" numeric(18,2),
      "totalPayable" numeric(18,2),
      "durationMonths" integer,
      "coverageType" varchar(64),
      status varchar(32) NOT NULL DEFAULT 'pending',
      "validUntil" timestamp,
      metadata jsonb,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "policyNumber" varchar(64) NOT NULL UNIQUE,
      "productId" integer NOT NULL,
      "customerId" integer NOT NULL,
      "agentId" integer,
      "brokerId" integer,
      "underwriterId" integer,
      status varchar(32) NOT NULL DEFAULT 'draft',
      "coverageType" varchar(64) NOT NULL,
      "sumInsured" numeric(18,2) NOT NULL,
      "annualPremium" numeric(18,2) NOT NULL,
      "startDate" timestamp,
      "endDate" timestamp,
      "renewalDate" timestamp,
      "cancellationDate" timestamp,
      "cancellationReason" text,
      "policyDocument" text,
      "certificateNumber" varchar(64),
      "naicomRef" varchar(128),
      "termsAndConditions" json,
      metadata json,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
    `CREATE TABLE IF NOT EXISTS claims (
      id serial PRIMARY KEY,
      "claimNumber" varchar(64) NOT NULL UNIQUE,
      "policyId" integer NOT NULL,
      "claimantId" integer NOT NULL,
      "assignedAdjusterId" integer,
      status varchar(32) NOT NULL DEFAULT 'submitted',
      "claimType" varchar(64) NOT NULL,
      "incidentDate" timestamp NOT NULL,
      "reportedDate" timestamp NOT NULL DEFAULT now(),
      "claimedAmount" numeric(18,2) NOT NULL,
      "approvedAmount" numeric(18,2),
      "paidAmount" numeric(18,2),
      "deductible" numeric(18,2),
      "incidentDescription" text NOT NULL,
      "investigationNotes" text,
      "rejectionReason" text,
      "settlementDate" timestamp,
      "isFraudSuspected" boolean DEFAULT false,
      "fraudScore" numeric(5,4),
      documents json,
      metadata json,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`,
    // audit_log is written by the real writeAuditLog (hash-chained); provide
    // the columns that path touches.
    `CREATE TABLE IF NOT EXISTS audit_log (
      id bigserial PRIMARY KEY,
      "agentId" integer,
      action varchar(128) NOT NULL,
      resource varchar(64),
      "resourceId" varchar(64),
      "ipAddress" varchar(45),
      "userAgent" varchar(256),
      status varchar(16) DEFAULT 'success',
      metadata json,
      "tenantId" integer,
      "prevHash" varchar(64),
      "entryHash" varchar(64),
      "redactedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`,
    `INSERT INTO insurance_products (id, "productCode", name, "coverageType", "minPremium", "maxCoverageAmount")
      VALUES (1, 'MICRO-1', 'Micro Health', 'micro', 100, 500000) ON CONFLICT DO NOTHING`,
  ];
  for (const s of statements) {
    await db.execute(sql.raw(s));
  }
}

beforeAll(async () => {
  await startPglite();
  await startMmEndpoint();
  // Mobile-money adapter config: real local HTTP endpoint (set BEFORE the
  // adapter module is imported — it reads env at module load).
  process.env.EMBEDDED_MM_COLLECT_URL = `http://127.0.0.1:${MM_PORT}/collect`;
  process.env.EMBEDDED_MM_API_KEY = "test-mm-key";

  const { getDb } = await import("./db");
  const maybeDb = await getDb();
  if (!maybeDb) throw new Error("PGlite DB not reachable");
  db = maybeDb;
  await createTables();

  const mod = await import("./routers/embeddedPartnerFactory");
  adminCaller = mod.embeddedPartnerFactoryRouter.createCaller(adminCtx);
  userCaller = mod.embeddedPartnerFactoryRouter.createCaller(userCtx);
  publicCaller = mod.embeddedPartnerFactoryRouter.createCaller({} as any);
}, 90_000);

afterAll(async () => {
  pgliteChild?.kill();
  await new Promise<void>(r => (mmServer ? mmServer.close(() => r()) : r()));
});

// Shared state across the ordered lifecycle describes.
let liveProductId = 0;
let sandboxProductId = 0;
let liveEmbedKey = "";
let sandboxEmbedKey = "";
let boundPolicyId = 0;

describe("Q1 partner product lifecycle", () => {
  it("admin creates a live + a sandbox partner product; lookup works", async () => {
    const live = await adminCaller.createPartnerProduct({
      partnerCode: "ACME-LIVE",
      partnerName: "Acme Bank",
      productId: 1,
      maxSumInsured: 200_000,
      sandbox: false,
    });
    liveProductId = live.partnerProductId;
    expect(live.apiKey.startsWith("emb_")).toBe(true);

    const sb = await adminCaller.createPartnerProduct({
      partnerCode: "ACME-SBX",
      partnerName: "Acme Bank (sandbox)",
      productId: 1,
      maxSumInsured: 50_000,
      sandbox: true,
    });
    sandboxProductId = sb.partnerProductId;

    const fetched = await adminCaller.getPartnerProduct({ partnerProductId: liveProductId });
    expect(fetched.partnerCode).toBe("ACME-LIVE");
    expect(fetched).not.toHaveProperty("apiKeyHash");
  });

  it("non-admin cannot create partner products", async () => {
    await expect(
      userCaller.createPartnerProduct({
        partnerCode: "HACK-1",
        partnerName: "x",
        productId: 1,
        maxSumInsured: 1,
      })
    ).rejects.toThrow();
  });

  it("update invalidates nothing catastrophically and persists (cache-invalidation path)", async () => {
    // Prime the cache.
    await adminCaller.getPartnerProduct({ partnerProductId: liveProductId });
    await adminCaller.updatePartnerProduct({
      partnerProductId: liveProductId,
      maxSumInsured: 150_000,
    });
    const fetched = await adminCaller.getPartnerProduct({ partnerProductId: liveProductId });
    expect(Number(fetched.maxSumInsured)).toBe(150_000);
  });
});

describe("Q1 embed-scope allow/deny", () => {
  it("admin issues product-scoped embed keys; scopes are exact", async () => {
    const k1 = await adminCaller.issueEmbedKey({ partnerProductId: liveProductId, name: "live-key" });
    liveEmbedKey = k1.rawKey;
    expect(k1.scopes).toEqual([`embed:product:${liveProductId}`]);
    const k2 = await adminCaller.issueEmbedKey({ partnerProductId: sandboxProductId, name: "sbx-key" });
    sandboxEmbedKey = k2.rawKey;
  });

  it("non-owner non-admin cannot issue keys for another partner's product", async () => {
    const otherCaller = (await import("./routers/embeddedPartnerFactory"))
      .embeddedPartnerFactoryRouter.createCaller(otherUserCtx);
    await expect(
      otherCaller.issueEmbedKey({ partnerProductId: liveProductId, name: "stolen" })
    ).rejects.toThrow(/own partner products/i);
  });

  it("unknown key is rejected (fail-closed)", async () => {
    await expect(
      publicCaller.embeddedQuote({
        apiKey: `54lk_${"0".repeat(64)}`,
        partnerProductId: liveProductId,
        customerId: 9002,
        sumInsured: 10_000,
      })
    ).rejects.toThrow(/invalid partner credentials/i);
  });

  it("cross-product deny: sandbox key cannot quote the live product", async () => {
    await expect(
      publicCaller.embeddedQuote({
        apiKey: sandboxEmbedKey,
        partnerProductId: liveProductId,
        customerId: 9002,
        sumInsured: 10_000,
      })
    ).rejects.toThrow(/not scoped/i);
  });
});

describe("Q1 embedded quote→bind→claim lifecycle", () => {
  let quoteRef = "";

  it("quote enforces the partner cap (fail-closed)", async () => {
    await expect(
      publicCaller.embeddedQuote({
        apiKey: liveEmbedKey,
        partnerProductId: liveProductId,
        customerId: 9002,
        sumInsured: 999_999_999,
      })
    ).rejects.toThrow(/maximum/i);
  });

  it("quote → bind succeeds with server-side premium; event publication is non-blocking", async () => {
    const q = await publicCaller.embeddedQuote({
      apiKey: liveEmbedKey,
      partnerProductId: liveProductId,
      customerId: 9002,
      sumInsured: 100_000,
    });
    quoteRef = q.quoteRef;
    expect(q.premiumAmount).toBe(100); // product minPremium, never caller-supplied

    // Kafka/Fluvio are unconfigured here; bind must still succeed
    // (enqueue-and-return / buffered fan-out never blocks the request path).
    const b = await publicCaller.embeddedBind({
      apiKey: liveEmbedKey,
      quoteRef,
      startDate: new Date().toISOString(),
    });
    expect(b.status).toBe("bound");
    expect(b.premiumDue).toBe(100);
    boundPolicyId = b.policyId;
  });

  it("quote cannot be re-consumed", async () => {
    await expect(
      publicCaller.embeddedBind({
        apiKey: liveEmbedKey,
        quoteRef,
        startDate: new Date().toISOString(),
      })
    ).rejects.toThrow(/QUOTE_CONSUMED/i);
  });

  it("cross-partner deny: sandbox key cannot bind the live quote's policy or claim against it", async () => {
    await expect(
      publicCaller.embeddedClaim({
        apiKey: sandboxEmbedKey,
        policyId: boundPolicyId,
        claimType: "hospitalization",
        incidentDate: new Date().toISOString(),
        claimedAmount: 1_000,
        incidentDescription: "cross-partner attempt",
      })
    ).rejects.toThrow(/not scoped|not active/i);
  });

  it("claim requires ACTIVE policy (bound is not active — fail-closed)", async () => {
    await expect(
      publicCaller.embeddedClaim({
        apiKey: liveEmbedKey,
        policyId: boundPolicyId,
        claimType: "hospitalization",
        incidentDate: new Date().toISOString(),
        claimedAmount: 1_000,
        incidentDescription: "premature claim",
      })
    ).rejects.toThrow(/not active/i);
  });

  it("claim on activated policy succeeds within cap and is capped fail-closed", async () => {
    const { sql } = await import("drizzle-orm");
    await db.execute(sql.raw(`UPDATE policies SET status = 'active' WHERE id = ${boundPolicyId}`));

    await expect(
      publicCaller.embeddedClaim({
        apiKey: liveEmbedKey,
        policyId: boundPolicyId,
        claimType: "hospitalization",
        incidentDate: new Date().toISOString(),
        claimedAmount: 200_001, // above the 150k partner cap after the update
        incidentDescription: "over-cap claim",
      })
    ).rejects.toThrow(/maximum/i);

    const ok = await publicCaller.embeddedClaim({
      apiKey: liveEmbedKey,
      policyId: boundPolicyId,
      claimType: "hospitalization",
      incidentDate: new Date().toISOString(),
      claimedAmount: 50_000,
      incidentDescription: "legitimate embedded claim",
    });
    expect(ok.status).toBe("submitted");
    expect(ok.claimNumber.startsWith("CLM-")).toBe(true);
  });
});

describe("Q1 sandbox isolation", () => {
  it("sandbox product data never appears in live listings", async () => {
    const q = await publicCaller.embeddedQuote({
      apiKey: sandboxEmbedKey,
      partnerProductId: sandboxProductId,
      customerId: 9002,
      sumInsured: 10_000,
    });
    expect(q.sandbox).toBe(true);
    await publicCaller.embeddedBind({
      apiKey: sandboxEmbedKey,
      quoteRef: q.quoteRef,
      startDate: new Date().toISOString(),
    });

    const liveList = await publicCaller.embeddedListPolicies({
      apiKey: liveEmbedKey,
      partnerProductId: liveProductId,
    });
    const sbxList = await publicCaller.embeddedListPolicies({
      apiKey: sandboxEmbedKey,
      partnerProductId: sandboxProductId,
    });
    expect(sbxList.length).toBe(1);
    expect(liveList.every(p => !sbxList.some(s => s.id === p.id))).toBe(true);
    // And the sandbox key cannot enumerate the live product at all.
    await expect(
      publicCaller.embeddedListPolicies({ apiKey: sandboxEmbedKey, partnerProductId: liveProductId })
    ).rejects.toThrow(/not scoped/i);
  });
});

describe("Q1 freemium ladder", () => {
  let freeTierId = 0;
  let paidTierId = 0;
  let enrollmentId = 0;

  it("admin defines the ladder; paid tier rejects direct enroll", async () => {
    const free = await adminCaller.createFreemiumTier({
      tierCode: "FREE-1",
      name: "Free Basic",
      productId: 1,
      monthlyPremium: 0,
      sumInsured: 20_000,
      coverageType: "micro",
      isFree: true,
      sortOrder: 0,
    });
    freeTierId = free.tierId;
    const paid = await adminCaller.createFreemiumTier({
      tierCode: "PAID-1",
      name: "Standard",
      productId: 1,
      monthlyPremium: 200,
      sumInsured: 100_000,
      coverageType: "micro",
      isFree: false,
      sortOrder: 1,
    });
    paidTierId = paid.tierId;

    await expect(userCaller.enrollFreemium({ tierId: paidTierId })).rejects.toThrow(/upgrade path/i);
  });

  it("free enroll creates active zero-premium cover", async () => {
    const r = await userCaller.enrollFreemium({ tierId: freeTierId });
    enrollmentId = r.enrollmentId;
    expect(r.policyId).toBeGreaterThan(0);
    // Duplicate active enrollment is refused.
    await expect(userCaller.enrollFreemium({ tierId: freeTierId })).rejects.toThrow(/already/i);
  });

  it("IDOR: another customer cannot upgrade the enrollment", async () => {
    const otherCaller = (await import("./routers/embeddedPartnerFactory"))
      .embeddedPartnerFactoryRouter.createCaller(otherUserCtx);
    await expect(
      otherCaller.upgradeFreemium({
        enrollmentId,
        targetTierId: paidTierId,
        msisdn: "+2348012345678",
        channel: "mobile_money",
      })
    ).rejects.toThrow(/own enrollment/i);
  });

  it("upgrade against an unreachable provider FAILS CLOSED (no paid cover, tier unchanged)", async () => {
    // Real network failure through the actual router path: stop the provider.
    await new Promise<void>(r => mmServer!.close(() => r()));
    mmServer = null;
    const r = await userCaller.upgradeFreemium({
      enrollmentId,
      targetTierId: paidTierId,
      msisdn: "+2348012345678",
      channel: "mobile_money",
    });
    expect(r.upgraded).toBe(false);
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql.raw(`SELECT "tierId", "upgradedAt" FROM freemium_enrollments WHERE id = ${enrollmentId}`)
    );
    const row = (rows as any).rows?.[0] ?? (rows as any)[0];
    expect(Number(row.tierId)).toBe(freeTierId); // still free
    expect(row.upgradedAt).toBeNull();
    // Restart the provider for the success-path test.
    await startMmEndpoint();
    process.env.EMBEDDED_MM_COLLECT_URL = `http://127.0.0.1:${MM_PORT}/collect`;
  });

  it("upgrade via the real HTTP provider activates paid cover and upgrades the tier", async () => {
    const r = await userCaller.upgradeFreemium({
      enrollmentId,
      targetTierId: paidTierId,
      msisdn: "+2348012345678",
      channel: "mobile_money",
    });
    expect(r.upgraded).toBe(true);
    if (r.upgraded) {
      expect(r.providerRef).toMatch(/^MM-FREEMIUM-UPG-/);
    }
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql.raw(`SELECT "tierId", "upgradedAt" FROM freemium_enrollments WHERE id = ${enrollmentId}`)
    );
    const row = (rows as any).rows?.[0] ?? (rows as any)[0];
    expect(Number(row.tierId)).toBe(paidTierId);
    expect(row.upgradedAt).toBeTruthy();
  });
});

describe("Q1 scenario product builder", () => {
  it("template creation + instantiation produces a real pending quote", async () => {
    await adminCaller.createScenarioTemplate({
      templateCode: "FLIGHT-DELAY",
      name: "Flight Delay Cover",
      productId: 1,
      triggerEvent: "flight_delayed_2h",
      coverageType: "travel",
      sumInsured: 15_000,
      premiumAmount: 250,
      durationHours: 48,
    });
    const r = await userCaller.instantiateScenario({ templateCode: "FLIGHT-DELAY" });
    expect(r.quoteRef.startsWith("SCNQ-")).toBe(true);
    expect(r.premiumAmount).toBe(250); // template-priced, never caller-supplied

    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(
      sql.raw(
        `SELECT status, metadata->>'channel' AS channel FROM policy_quotes WHERE metadata->>'quoteRef' = '${r.quoteRef}'`
      )
    );
    const row = (rows as any).rows?.[0] ?? (rows as any)[0];
    expect(row.status).toBe("pending");
    expect(row.channel).toBe("scenario");
  });

  it("unknown template is refused", async () => {
    await expect(
      userCaller.instantiateScenario({ templateCode: "NOPE-99" })
    ).rejects.toThrow(/not found/i);
  });
});

describe("Q1 scope pattern (developerPortal allowlist extension)", () => {
  it("embed:product:<id> pattern validates; arbitrary scopes do not", async () => {
    const { isValidApiScope } = await import("./routers/developerPortal");
    expect(isValidApiScope("embed:product:1")).toBe(true);
    expect(isValidApiScope("embed:product:12345")).toBe(true);
    expect(isValidApiScope("transactions:read")).toBe(true);
    expect(isValidApiScope("embed:product:0")).toBe(false);
    expect(isValidApiScope("embed:product:")).toBe(false);
    expect(isValidApiScope("embed:product:abc")).toBe(false);
    expect(isValidApiScope("admin:*")).toBe(false);
    expect(isValidApiScope("embed:product:1 OR 1=1")).toBe(false);
  });
});
