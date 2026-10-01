/**
 * ratingEngine.test.ts — Actuarial Wave stage A1 (2026-10-01, A1)
 *
 * Real-behavior PGlite tests for server/lib/ratingEngine.ts (harness copied
 * from memberIdentity.test.ts — real embedded PostgreSQL, ephemeral
 * probeFreePort, minimal faithful projections of rating_tables /
 * rating_factors):
 *   - base rate + ordered multiplicative factors, exact values
 *   - factor clamps (minClamp/maxClamp) and min premium floor
 *   - 0.5% stamp duty on top of the floored premium
 *   - FAIL-CLOSED: no active table / no base rate → RatingUnavailableError
 *   - productCode match preferred over coverageClass match
 *   - latest-effective selection among multiple active tables
 *   - telematics_cap clamps an externally supplied factor only
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

async function db() {
  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) throw new Error("PGlite DB not reachable");
  return d;
}

async function createTablesAndSeed() {
  const { sql } = await import("drizzle-orm");
  const d = await db();

  // Faithful minimal projections of drizzle/schema.ts rating_tables /
  // rating_factors (A1) — same columns, no FK (users table not projected).
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS rating_tables (
      id serial PRIMARY KEY,
      "productCode" text,
      "coverageClass" text,
      "effectiveFrom" timestamp NOT NULL,
      "effectiveTo" timestamp,
      status varchar(16) NOT NULL DEFAULT 'draft',
      version integer NOT NULL,
      "filedBy" integer,
      "approvedBy" integer,
      "naicomFilingRef" text,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await d.execute(sql`
    CREATE TABLE IF NOT EXISTS rating_factors (
      id serial PRIMARY KEY,
      "tableId" integer NOT NULL,
      "factorType" varchar(32) NOT NULL,
      "factorKey" text NOT NULL,
      value numeric(18,6) NOT NULL,
      "minClamp" numeric(18,6),
      "maxClamp" numeric(18,6),
      "sortOrder" integer NOT NULL,
      "tenantId" integer,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);

  // Table 1: product MOTOR-FULL — base rate 2.5%, age band 40-49 ×1.1,
  // claims loading 1+ ×1.25, ncd ×0.8, location lagos ×1.2, min premium
  // 10000, telematics cap clamps external factor into [0.7, 1.0].
  // Tables 2/3: scope-precedence fixtures (class 'motor' vs product
  // 'MOTOR-COMP' v1+v2 — v2 latest-effective wins).
  // Table 4: retired (never resolves). Table 5: active but NO base rate.
  await d.execute(sql`
    INSERT INTO rating_tables
      (id, "productCode", "coverageClass", "effectiveFrom", status, version)
    VALUES
      (1, 'MOTOR-FULL', NULL, '2026-01-01', 'active', 1),
      (2, NULL, 'motor', '2026-01-01', 'active', 1),
      (3, 'MOTOR-COMP', NULL, '2026-06-01', 'active', 2),
      (4, 'RETIRED-PROD', NULL, '2026-01-01', 'retired', 1),
      (5, 'NOBASE', NULL, '2026-01-01', 'active', 1)`);
  await d.execute(sql`
    INSERT INTO rating_factors
      ("tableId", "factorType", "factorKey", value, "minClamp", "maxClamp", "sortOrder")
    VALUES
      (1, 'base', 'rate', 0.025, NULL, NULL, 0),
      (1, 'age_band', '40-49', 1.1, NULL, NULL, 10),
      (1, 'claims_loading', '1+', 1.25, NULL, NULL, 20),
      (1, 'ncd', 'default', 0.8, NULL, NULL, 30),
      (1, 'location', 'lagos', 1.2, NULL, NULL, 40),
      (1, 'telematics_cap', 'cap', 1.0, 0.7, 1.0, 50),
      (1, 'base', 'min_premium', 10000, NULL, NULL, 99),
      (2, 'base', 'rate', 0.03, NULL, NULL, 0),
      (3, 'base', 'rate', 0.02, NULL, NULL, 0),
      (4, 'base', 'rate', 0.05, NULL, NULL, 0),
      (5, 'age_band', '40-49', 1.1, NULL, NULL, 10)`);
}

beforeAll(async () => {
  await startPglite();
  await createTablesAndSeed();
}, 60_000);

afterAll(() => {
  pgliteChild?.kill();
});

describe("ratingEngine.resolveRating (2026-10-01, A1)", () => {
  it("applies base + ordered multiplicative factors + floor + stamp duty exactly", async () => {
    const { resolveRating } = await import("../../lib/ratingEngine");
    const r = await resolveRating(await db(), {
      productCode: "MOTOR-FULL",
      sumInsured: 1_000_000,
      age: 45,
      claimsCount: 2,
      ncdEligible: true,
      location: "lagos",
      telematicsFactor: 0.9,
    });
    // 1,000,000*0.025 = 25,000 → ×1.1 age = 27,500 → ×1.25 claims = 34,375
    // → ×0.8 ncd = 27,500 → ×1.2 lagos = 33,000 → ×0.9 telematics = 29,700
    // floor 10,000 not hit; stamp = 148.5; total = 29,848.5.
    expect(r.tableId).toBe(1);
    expect(r.basePremium).toBeCloseTo(25_000);
    expect(r.appliedFactors.map(f => f.factorType)).toEqual([
      "age_band",
      "claims_loading",
      "ncd",
      "location",
      "telematics_cap",
    ]);
    expect(r.premiumBeforeFloor).toBeCloseTo(29_700);
    expect(r.minPremium).toBe(10_000);
    expect(r.premiumAfterFloor).toBeCloseTo(29_700);
    expect(r.stampDuty).toBeCloseTo(148.5);
    expect(r.totalPayable).toBeCloseTo(29_848.5);
  });

  it("enforces the min premium floor", async () => {
    const { resolveRating } = await import("../../lib/ratingEngine");
    const r = await resolveRating(await db(), {
      productCode: "MOTOR-FULL",
      sumInsured: 100_000,
    });
    // 100,000*0.025 = 2,500 → floored to 10,000; stamp 50; total 10,050.
    expect(r.premiumBeforeFloor).toBeCloseTo(2_500);
    expect(r.premiumAfterFloor).toBeCloseTo(10_000);
    expect(r.totalPayable).toBeCloseTo(10_050);
  });

  it("telematics_cap clamps the external factor into [minClamp, maxClamp]", async () => {
    const { resolveRating } = await import("../../lib/ratingEngine");
    const low = await resolveRating(await db(), {
      productCode: "MOTOR-FULL",
      sumInsured: 1_000_000,
      telematicsFactor: 0.5, // clamped UP to 0.7
    });
    // 25,000 × 0.7 = 17,500; stamp 87.5.
    expect(low.appliedFactors[0]).toMatchObject({
      factorType: "telematics_cap",
      value: 0.7,
    });
    expect(low.totalPayable).toBeCloseTo(17_587.5);
    const high = await resolveRating(await db(), {
      productCode: "MOTOR-FULL",
      sumInsured: 1_000_000,
      telematicsFactor: 1.5, // clamped DOWN to 1.0
    });
    expect(high.appliedFactors[0]).toMatchObject({
      factorType: "telematics_cap",
      value: 1.0,
    });
    expect(high.totalPayable).toBeCloseTo(25_125);
  });

  it("age band misses fall back to 'default' or fail closed when defined but unmatched", async () => {
    const { resolveRating, RatingUnavailableError } = await import(
      "../../lib/ratingEngine"
    );
    // age 30: table 1 defines only band 40-49 and NO default → fail closed.
    await expect(
      resolveRating(await db(), {
        productCode: "MOTOR-FULL",
        sumInsured: 1_000_000,
        age: 30,
      })
    ).rejects.toBeInstanceOf(RatingUnavailableError);
    // age omitted: age_band rows simply do not apply.
    const r = await resolveRating(await db(), {
      productCode: "MOTOR-FULL",
      sumInsured: 1_000_000,
    });
    expect(r.appliedFactors).toHaveLength(0);
    expect(r.premiumBeforeFloor).toBeCloseTo(25_000);
  });

  it("ncd discount applies only when ncdEligible is true", async () => {
    const { resolveRating } = await import("../../lib/ratingEngine");
    const withNcd = await resolveRating(await db(), {
      productCode: "MOTOR-FULL",
      sumInsured: 1_000_000,
      ncdEligible: true,
    });
    expect(withNcd.premiumBeforeFloor).toBeCloseTo(20_000); // 25,000 × 0.8
    const withoutNcd = await resolveRating(await db(), {
      productCode: "MOTOR-FULL",
      sumInsured: 1_000_000,
      ncdEligible: false,
    });
    expect(withoutNcd.premiumBeforeFloor).toBeCloseTo(25_000);
  });

  it("fails closed with RatingUnavailableError when no active table covers the scope", async () => {
    const { resolveRating, RatingUnavailableError } = await import(
      "../../lib/ratingEngine"
    );
    await expect(
      resolveRating(await db(), { productCode: "NOPE", sumInsured: 1000 })
    ).rejects.toBeInstanceOf(RatingUnavailableError);
    // A retired table never resolves.
    await expect(
      resolveRating(await db(), { productCode: "RETIRED-PROD", sumInsured: 1000 })
    ).rejects.toBeInstanceOf(RatingUnavailableError);
    // Neither scope key supplied → fail closed.
    await expect(
      resolveRating(await db(), { sumInsured: 1000 })
    ).rejects.toBeInstanceOf(RatingUnavailableError);
  });

  it("fails closed when the active table has no base rate factor", async () => {
    const { resolveRating, RatingUnavailableError } = await import(
      "../../lib/ratingEngine"
    );
    await expect(
      resolveRating(await db(), { productCode: "NOBASE", sumInsured: 1000, age: 45 })
    ).rejects.toBeInstanceOf(RatingUnavailableError);
  });

  it("prefers a productCode match over a coverageClass match, latest effectiveFrom among equals", async () => {
    const { resolveRating } = await import("../../lib/ratingEngine");
    const r = await resolveRating(await db(), {
      productCode: "MOTOR-COMP",
      coverageClass: "motor",
      sumInsured: 100_000,
    });
    // product match (t3, 0.02, effective 2026-06-01) beats class match (t2).
    expect(r.tableId).toBe(3);
    expect(r.version).toBe(2);
    expect(r.basePremium).toBeCloseTo(2_000);
    // Class-only resolution hits table 2.
    const rc = await resolveRating(await db(), {
      coverageClass: "motor",
      sumInsured: 100_000,
    });
    expect(rc.tableId).toBe(2);
    expect(rc.basePremium).toBeCloseTo(3_000);
  });
});
