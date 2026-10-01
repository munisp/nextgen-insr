/**
 * memberBeneficiaries.test.ts — R3 batch 5 (2026-10-01, R3-b5)
 *
 * Real-behavior PGlite tests for server/routers/memberBeneficiaries.ts
 * (harness copied from memberIdentity.test.ts — real embedded PostgreSQL,
 * ephemeral probeFreePort, faithful minimal table projections matching
 * exactly the columns the router touches):
 *   - anonymous caller → UNAUTHORIZED on every proc
 *   - ownership: dual-space (users.id AND resolved customers.id) caller
 *     policies accepted; foreign policies (BOTH spaces) → NOT_FOUND, zero
 *     rows changed (non-enumerating IDOR probes)
 *   - validations copied from the source: minor-requires-guardian and the
 *     100% percentage-sum rule
 *   - PII: beneficiary nationalId is masked in list responses — the seeded
 *     full value NEVER appears in any payload
 *   - removeBeneficiary: foreign → NOT_FOUND with row intact; own → real
 *     delete + audit_log row
 *
 * Identity spaces (DISTINCT per row class): caller user id 1 → customer
 * 4242 (keycloakSub '1'); foreign user id 2 → customer 5555. Policies 101/102
 * are the caller's (users.id / customers.id space), 103/104 are foreign.
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

let PG_PORT = 0;
let PG_URL = "";

async function probeFreePort(): Promise<number> {
  const net = await import("node:net");
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => (port > 0 ? resolve(port) : reject(new Error("no port"))));
    });
  });
}
let pgliteChild: ChildProcess | null = null;

// Unit-test env: no Permify sidecar (same pattern as memberIdentity); the
// member authz under test is the router's own scoping.
process.env.PERMIFY_FAIL_OPEN = "true";

type Caller = ReturnType<
  (typeof import("../memberBeneficiaries"))["memberBeneficiariesRouter"]["createCaller"]
>;
let caller: Caller; // session user id 1 → customer 4242
let anonCaller: Caller;

const PII_NATIONAL_ID = "SECRETNATIONALID1234"; // must never appear unmasked

const POLICY_OWN_USERS = 101; // customerId = 1 (users.id space)
const POLICY_OWN_CUST = 102; // customerId = 4242 (customers.id space)
const POLICY_FOREIGN_USERS = 103; // customerId = 2
const POLICY_FOREIGN_CUST = 104; // customerId = 5555

async function startPglite(): Promise<void> {
  PG_PORT = await probeFreePort();
  PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
  const script = path.resolve(
    __dirname,
    "../../../tests/integration/setup/pgliteServer.mjs"
  );
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
}

async function createTablesAndSeed() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");

  await db.execute(sql`
    CREATE TYPE customer_status AS ENUM
      ('pending_kyc', 'active', 'suspended', 'blacklisted')`);
  await db.execute(sql`
    CREATE TYPE policy_status AS ENUM
      ('draft', 'quoted', 'bound', 'active', 'endorsed', 'renewed',
       'cancelled', 'lapsed', 'expired', 'suspended')`);
  await db.execute(sql`
    CREATE TYPE coverage_type AS ENUM
      ('life', 'health', 'motor', 'property', 'liability', 'marine',
       'aviation', 'agriculture', 'credit', 'travel', 'micro', 'group_life',
       'annuity', 'pension')`);

  // Faithful customers projection (resolution selects id via keycloakSub).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customers (
      id serial PRIMARY KEY,
      "firstName" varchar(64) NOT NULL,
      "lastName" varchar(64) NOT NULL,
      phone varchar(20) NOT NULL,
      status customer_status NOT NULL DEFAULT 'pending_kyc',
      "keycloakSub" varchar(128) UNIQUE,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Faithful policies projection (ownership reads + status gate).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS policies (
      id serial PRIMARY KEY,
      "policyNumber" varchar(64) NOT NULL UNIQUE,
      "productId" integer NOT NULL,
      "customerId" integer NOT NULL,
      status policy_status NOT NULL DEFAULT 'draft',
      "coverageType" coverage_type NOT NULL,
      "sumInsured" numeric(18,2) NOT NULL,
      "annualPremium" numeric(18,2) NOT NULL,
      "startDate" timestamp,
      "endDate" timestamp,
      "renewalDate" timestamp,
      "certificateNumber" varchar(64),
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Full beneficiaries column set (drizzle/schema.ts:4962).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS beneficiaries (
      id serial PRIMARY KEY,
      "policyId" integer NOT NULL,
      name varchar(256) NOT NULL,
      relationship varchar(64) NOT NULL,
      percentage numeric(5,2) NOT NULL DEFAULT '100',
      "dateOfBirth" timestamp,
      "nationalId" varchar(64),
      phone varchar(32),
      email varchar(320),
      address text,
      "isMinor" boolean DEFAULT false,
      "guardianName" varchar(256),
      "guardianId" varchar(64),
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Full audit_log column set (the router's insert lists defaults).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id bigserial PRIMARY KEY,
      "agentId" integer,
      action varchar(128) NOT NULL,
      resource varchar(64),
      "resourceId" varchar(64),
      "ipAddress" varchar(45),
      "userAgent" varchar(256),
      status varchar(20) DEFAULT 'success',
      metadata json,
      "tenantId" integer,
      "prevHash" varchar(64),
      "entryHash" varchar(64),
      "redactedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  await db.execute(sql`
    INSERT INTO customers (id, "firstName", "lastName", phone, status, "keycloakSub")
    VALUES
      (4242, 'Member', 'A', '09000000001', 'active', '1'),
      (5555, 'Foreign', 'F', '09000000002', 'active', '2')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO policies
      (id, "policyNumber", "productId", "customerId", status, "coverageType",
       "sumInsured", "annualPremium", "endDate")
    VALUES
      (${POLICY_OWN_USERS}, 'POL-OWN-1', 1, 1, 'active', 'life', 100000, 1000, '2027-01-01'),
      (${POLICY_OWN_CUST}, 'POL-OWN-2', 1, 4242, 'active', 'life', 100000, 1000, '2027-01-01'),
      (${POLICY_FOREIGN_USERS}, 'POL-FGN-1', 1, 2, 'active', 'life', 100000, 1000, '2027-01-01'),
      (${POLICY_FOREIGN_CUST}, 'POL-FGN-2', 1, 5555, 'active', 'life', 100000, 1000, '2027-01-01')`);

  // Beneficiaries: caller's policy has one adult 60% row carrying REAL PII;
  // foreign policy has one row (IDOR probe target).
  await db.execute(sql`
    INSERT INTO beneficiaries
      ("policyId", name, relationship, percentage, "dateOfBirth", "nationalId", "isMinor")
    VALUES
      (${POLICY_OWN_USERS}, 'Spouse A', 'spouse', 60, '1990-01-01', ${PII_NATIONAL_ID}, false),
      (${POLICY_FOREIGN_USERS}, 'Foreign Ben', 'child', 100, '2015-01-01', ${PII_NATIONAL_ID}, true)`);
  // The foreign row is a minor without guardian (seeded directly — the
  // validation only guards the API path).
}

async function beneficiaryCount(policyId: number): Promise<number> {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = (await getDb())!;
  const r = await db.execute(
    sql`SELECT COUNT(*)::int AS n FROM beneficiaries WHERE "policyId" = ${policyId}`
  );
  return Number((r as any).rows?.[0]?.n ?? (r as any)[0]?.n);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
  const { memberBeneficiariesRouter } = await import("../memberBeneficiaries");
  caller = memberBeneficiariesRouter.createCaller(makeAuthenticatedCtx());
  anonCaller = memberBeneficiariesRouter.createCaller(makeUnauthenticatedCtx());
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("memberBeneficiaries router (2026-10-01, R3-b5)", () => {
  it("rejects anonymous callers with UNAUTHORIZED on every proc", async () => {
    await expect(
      anonCaller.myBeneficiaries({ policyId: POLICY_OWN_USERS })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.upsertBeneficiary({
        policyId: POLICY_OWN_USERS,
        name: "X",
        relationship: "spouse",
        percentage: 10,
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      anonCaller.removeBeneficiary({ policyId: POLICY_OWN_USERS, beneficiaryId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("myBeneficiaries returns the caller's rows with nationalId masked", async () => {
    const result = await caller.myBeneficiaries({ policyId: POLICY_OWN_USERS });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Spouse A");
    expect(Number(result.items[0].percentage)).toBe(60);
    // Masked: last-2 only; the seeded full value NEVER appears.
    expect(result.items[0].nationalId).toBe("***34");
    expect(JSON.stringify(result)).not.toContain(PII_NATIONAL_ID);
  });

  it("myBeneficiaries on a FOREIGN policy → NOT_FOUND (both identity spaces)", async () => {
    await expect(
      caller.myBeneficiaries({ policyId: POLICY_FOREIGN_USERS })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.myBeneficiaries({ policyId: POLICY_FOREIGN_CUST })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      caller.myBeneficiaries({ policyId: 999999 })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("upsertBeneficiary works on BOTH caller identity spaces", async () => {
    const r1 = await caller.upsertBeneficiary({
      policyId: POLICY_OWN_USERS,
      name: "Child One",
      relationship: "child",
      percentage: 40,
      dateOfBirth: "2010-05-01",
      guardianName: "Member A",
    });
    expect(r1.success).toBe(true);
    expect(await beneficiaryCount(POLICY_OWN_USERS)).toBe(2);

    const r2 = await caller.upsertBeneficiary({
      policyId: POLICY_OWN_CUST,
      name: "Parent B",
      relationship: "parent",
      percentage: 100,
    });
    expect(r2.success).toBe(true);
    expect(await beneficiaryCount(POLICY_OWN_CUST)).toBe(1);
  });

  it("upsertBeneficiary on a FOREIGN policy → NOT_FOUND, zero rows changed", async () => {
    const before = await beneficiaryCount(POLICY_FOREIGN_USERS);
    await expect(
      caller.upsertBeneficiary({
        policyId: POLICY_FOREIGN_USERS,
        name: "Intruder",
        relationship: "spouse",
        percentage: 50,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await beneficiaryCount(POLICY_FOREIGN_USERS)).toBe(before);
  });

  it("enforces the minor-requires-guardian rule", async () => {
    await expect(
      caller.upsertBeneficiary({
        policyId: POLICY_OWN_USERS,
        name: "Minor No Guardian",
        relationship: "child",
        percentage: 10,
        isMinor: true,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("enforces the 100% percentage-sum rule on add and allows same-row update", async () => {
    // Existing rows on POLICY_OWN_USERS: 60% + 40% = 100% already.
    await expect(
      caller.upsertBeneficiary({
        policyId: POLICY_OWN_USERS,
        name: "Overflow",
        relationship: "sibling",
        percentage: 1,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    // Update the 40% row in place (excluded from the sum): 60 + 40 = 100 OK.
    const list = await caller.myBeneficiaries({ policyId: POLICY_OWN_USERS });
    const child = list.items.find(b => b.name === "Child One")!;
    const upd = await caller.upsertBeneficiary({
      policyId: POLICY_OWN_USERS,
      beneficiaryId: child.id,
      name: "Child One Renamed",
      relationship: "child",
      percentage: 40,
      dateOfBirth: "2010-05-01",
      guardianName: "Member A",
    });
    expect(upd.success).toBe(true);
    const after = await caller.myBeneficiaries({ policyId: POLICY_OWN_USERS });
    expect(after.items.map(b => b.name).sort()).toEqual([
      "Child One Renamed",
      "Spouse A",
    ]);
  });

  it("removeBeneficiary on a FOREIGN policy → NOT_FOUND with the row intact", async () => {
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const fr = await db.execute(
      sql`SELECT id FROM beneficiaries WHERE "policyId" = ${POLICY_FOREIGN_USERS} LIMIT 1`
    );
    const foreignBenId = Number((fr as any).rows?.[0]?.id ?? (fr as any)[0]?.id);

    await expect(
      caller.removeBeneficiary({
        policyId: POLICY_FOREIGN_USERS,
        beneficiaryId: foreignBenId,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await beneficiaryCount(POLICY_FOREIGN_USERS)).toBe(1);
  });

  it("removeBeneficiary on the caller's own row deletes it and writes an audit row", async () => {
    const list = await caller.myBeneficiaries({ policyId: POLICY_OWN_CUST });
    const target = list.items[0];
    const result = await caller.removeBeneficiary({
      policyId: POLICY_OWN_CUST,
      beneficiaryId: target.id,
    });
    expect(result).toEqual({ success: true });
    expect(await beneficiaryCount(POLICY_OWN_CUST)).toBe(0);

    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = (await getDb())!;
    const audit = await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM audit_log
          WHERE action = 'BENEFICIARY_REMOVED' AND "resourceId" = ${String(POLICY_OWN_CUST)}`
    );
    expect(Number((audit as any).rows?.[0]?.n ?? (audit as any)[0]?.n)).toBe(1);
  });
});
