/**
 * productCreationA2.test.ts — 2026-10-02 (A2)
 *
 * Real-behavior PGlite tests for insurance product creation governance:
 *   - insuranceWorkflows.createProduct:
 *       · member (role "user") → FORBIDDEN
 *       · anonymous → UNAUTHORIZED
 *       · admin → creates product in DRAFT lifecycle state (isActive=false),
 *         response exposes the NAICOM class for the coverage type
 *       · supervisor → allowed (elevated pair per lifecycleWorkflows.ts)
 *       · caller-supplied isActive=true → stripped by zod, still draft
 *       · unknown coverageType → rejected (BAD_REQUEST, fail-closed)
 *       · malformed productCode → rejected (format contract enforced)
 *   - insuranceProducts (systemConfig) router:
 *       · member → FORBIDDEN on createProduct AND updateProduct
 *       · admin → creates with status "draft" (never "active");
 *         caller-supplied status "active" is stripped by zod
 *       · updateProduct enforces draft → active → suspended/discontinued;
 *         illegal transition (active → active on draft, discontinued → active)
 *         → FORBIDDEN
 *
 * Harness pattern copied from memberQuotes.test.ts (PGlite child + minimal
 * faithful table projections).
 */
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  makeAuthenticatedCtx,
  makeUnauthenticatedCtx,
} from "../../lib/__tests__/testHelpers";

let PG_PORT = 0;
let pgliteChild: ChildProcess | null = null;

process.env.PERMIFY_FAIL_OPEN = "true";

type WorkflowsCaller = ReturnType<
  (typeof import("../insuranceWorkflows"))["insuranceWorkflowsRouter"]["createCaller"]
>;
type ProductsCaller = ReturnType<
  (typeof import("../insuranceProducts"))["insuranceProductsRouter"]["createCaller"]
>;

let adminWf: WorkflowsCaller;
let supervisorWf: WorkflowsCaller;
let memberWf: WorkflowsCaller;
let anonWf: WorkflowsCaller;
let adminLegacy: ProductsCaller;
let memberLegacy: ProductsCaller;

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

async function startPglite(): Promise<void> {
  PG_PORT = await probeFreePort();
  const url = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
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
  process.env.POSTGRES_URL = url;
}

async function createTables() {
  const { getDb } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");

  await db.execute(sql`
    CREATE TYPE coverage_type AS ENUM
      ('life', 'health', 'motor', 'property', 'liability', 'marine',
       'aviation', 'agriculture', 'credit', 'travel', 'micro', 'group_life',
       'annuity', 'pension')`);
  await db.execute(sql`
    CREATE TYPE audit_status AS ENUM ('success', 'failure', 'warning')`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS insurance_products (
      id serial PRIMARY KEY,
      "productCode" varchar(32) NOT NULL UNIQUE,
      name varchar(256) NOT NULL,
      description text,
      "coverageType" coverage_type NOT NULL,
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
    )`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS audit_log (
      id bigserial PRIMARY KEY,
      "agentId" integer,
      action varchar(128) NOT NULL,
      resource varchar(64),
      "resourceId" varchar(64),
      "ipAddress" varchar(45),
      "userAgent" varchar(256),
      status audit_status DEFAULT 'success',
      metadata json,
      "tenantId" integer,
      "prevHash" varchar(64),
      "entryHash" varchar(64),
      "redactedAt" timestamp,
      "createdAt" timestamp DEFAULT now()
    )`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS system_config (
      id serial PRIMARY KEY,
      key varchar(128) NOT NULL UNIQUE,
      value text NOT NULL,
      description text,
      "updatedBy" varchar(64),
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
}

const ADMIN_CTX = makeAuthenticatedCtx();
const SUPERVISOR_CTX = makeAuthenticatedCtx({
  user: { id: 3, username: "sup", role: "supervisor" } as any,
});
const MEMBER_CTX = makeAuthenticatedCtx({
  user: { id: 2, username: "member", role: "user" } as any,
});

const VALID_INPUT = {
  productCode: "A2-LIFE-001",
  name: "A2 Family Life",
  coverageType: "life" as const,
  minPremium: 5000,
  policyTermMonths: 12,
};

beforeAll(async () => {
  await startPglite();
  await createTables();
  const { insuranceWorkflowsRouter } = await import("../insuranceWorkflows");
  const { insuranceProductsRouter } = await import("../insuranceProducts");
  adminWf = insuranceWorkflowsRouter.createCaller(ADMIN_CTX);
  supervisorWf = insuranceWorkflowsRouter.createCaller(SUPERVISOR_CTX);
  memberWf = insuranceWorkflowsRouter.createCaller(MEMBER_CTX);
  anonWf = insuranceWorkflowsRouter.createCaller(makeUnauthenticatedCtx());
  adminLegacy = insuranceProductsRouter.createCaller(ADMIN_CTX);
  memberLegacy = insuranceProductsRouter.createCaller(MEMBER_CTX);
}, 60_000);

afterAll(async () => {
  pgliteChild?.kill("SIGTERM");
  await new Promise(r => setTimeout(r, 300));
});

describe("insuranceWorkflows.createProduct — role gate", () => {
  it("member role → FORBIDDEN, nothing inserted", async () => {
    await expect(
      memberWf.createProduct({ ...VALID_INPUT, productCode: "A2-LIFE-MBR" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    const rows = await db!.execute(
      sql`SELECT * FROM insurance_products WHERE "productCode" = 'A2-LIFE-MBR'`
    );
    expect((rows as any).rows?.length ?? (rows as any).length ?? 0).toBe(0);
  });

  it("anonymous → UNAUTHORIZED", async () => {
    await expect(
      anonWf.createProduct({ ...VALID_INPUT, productCode: "A2-LIFE-ANN" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("admin → creates product in draft state with NAICOM class", async () => {
    const res = await adminWf.createProduct(VALID_INPUT);
    expect(res.product).toBeDefined();
    expect(res.product.isActive).toBe(false); // draft lifecycle
    expect(res.naicomClass).toBe("Life Assurance");
  });

  it("supervisor → allowed (elevated pair)", async () => {
    const res = await supervisorWf.createProduct({
      ...VALID_INPUT,
      productCode: "A2-MOTOR-001",
      coverageType: "motor",
      name: "A2 Motor",
    });
    expect(res.product.isActive).toBe(false);
    expect(res.naicomClass).toBe("Motor Insurance");
  });
});

describe("insuranceWorkflows.createProduct — input contract", () => {
  it("caller-supplied isActive=true is stripped; product stays draft", async () => {
    const res = await adminWf.createProduct({
      ...VALID_INPUT,
      productCode: "A2-LIFE-002",
      isActive: true,
      status: "active",
    } as any);
    expect(res.product.isActive).toBe(false);
  });

  it("unknown coverageType → rejected (fail-closed)", async () => {
    await expect(
      adminWf.createProduct({
        ...VALID_INPUT,
        productCode: "A2-BOGUS-001",
        coverageType: "spaceship",
      } as any)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("malformed productCode → rejected", async () => {
    await expect(
      adminWf.createProduct({ ...VALID_INPUT, productCode: "lowercase bad!" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      adminWf.createProduct({ ...VALID_INPUT, productCode: "AB" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // 2026-10-02 (A2, W1): 3-char code rejected — contract minimum is 4.
    await expect(
      adminWf.createProduct({ ...VALID_INPUT, productCode: "ABC" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

describe("insuranceProducts (legacy systemConfig) router — governance", () => {
  const LEGACY_INPUT = {
    name: "Legacy Crop Plan",
    category: "crop" as const,
    premium: 100,
    coverageAmount: 5000,
    description: "crop cover",
    tenure: 12,
  };

  it("member → FORBIDDEN on createProduct and updateProduct", async () => {
    await expect(memberLegacy.createProduct(LEGACY_INPUT)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      memberLegacy.updateProduct({ productId: "X", status: "active" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admin → creates with status draft; caller-supplied 'active' stripped", async () => {
    const res = await adminLegacy.createProduct({
      ...LEGACY_INPUT,
      status: "active",
    } as any);
    expect(res.success).toBe(true);
    const { getDb } = await import("../../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    const rows: any = await db!.execute(
      sql`SELECT value FROM system_config WHERE key = ${"insurance_product_" + res.productId}`
    );
    const row = (rows.rows ?? rows)[0];
    expect(JSON.parse(row.value).status).toBe("draft");
  });

  it("updateProduct enforces lifecycle transitions", async () => {
    const res = await adminLegacy.createProduct(LEGACY_INPUT);
    const id = res.productId;
    // draft → suspended is illegal
    await expect(
      adminLegacy.updateProduct({ productId: id, status: "suspended" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // draft → active is legal
    await expect(
      adminLegacy.updateProduct({ productId: id, status: "active" })
    ).resolves.toMatchObject({ success: true });
    // active → discontinued is legal
    await expect(
      adminLegacy.updateProduct({ productId: id, status: "discontinued" })
    ).resolves.toMatchObject({ success: true });
    // discontinued → active is illegal (terminal)
    await expect(
      adminLegacy.updateProduct({ productId: id, status: "active" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
