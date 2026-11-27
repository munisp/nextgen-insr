/**
 * actuaryMigration.integration.test.ts — W34-D (2026-11-28) REAL-DB (PGlite)
 * acceptance test for drizzle/0049_actuary_engine.sql.
 *
 * Harness mirrors ./w30SavingsPension.integration.test.ts (W30, itself the
 * K-wave pattern): spawned PGlite wire server
 * (tests/integration/setup/pgliteServer.mjs, repo root), allocFreePort,
 * DATABASE_URL set before importing server/db, raw-SQL via drizzle
 * db.execute. No mocks anywhere — the migration SQL is executed verbatim
 * from the checked-in file.
 *
 * Asserts:
 *   1. APPLY: the migration creates all 12 actuary tables (information_schema
 *      check) and they accept a real insert + read-back (act_product_lines
 *      row round-trip with the enum type).
 *   2. IDEMPOTENT DOUBLE-APPLY: applying the same SQL a second time exits
 *      clean (DO-block enums + IF NOT EXISTS), rows survive.
 *   3. ROLLBACK: the documented rollback (DROP TABLE … CASCADE + DROP TYPE,
 *      transcribed from the migration file's trailer comment) removes every
 *      table, and a clean re-apply succeeds afterwards.
 */
import { describe, it, beforeAll, afterAll, expect } from "vitest";
import { spawn, type ChildProcess } from "child_process";
import net from "net";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const MIGRATION = path.resolve(
  __dirname,
  "../../drizzle/0049_actuary_engine.sql"
);

async function allocFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error("no port"))));
    });
  });
}
const PGLITE_PORT = await allocFreePort();
const DB_URL = `postgres://postgres:postgres@127.0.0.1:${PGLITE_PORT}/postgres`;

let child: ChildProcess;
let getDb: typeof import("../../server/db").getDb;
let getPool: typeof import("../../server/db").getPool;

function waitReady(proc: ChildProcess, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("PGlite not ready")), timeoutMs);
    let stderr = "";
    proc.stderr?.on("data", c => (stderr += String(c)));
    proc.stdout?.on("data", c => {
      if (String(c).includes("PGLITE_READY")) {
        clearTimeout(t);
        resolve();
      }
    });
    proc.on("exit", code => {
      clearTimeout(t);
      reject(new Error(`PGlite exited early (${code})\n${stderr}`));
    });
  });
}

const EXPECTED_TABLES = [
  "act_product_lines",
  "act_rate_versions",
  "act_rating_tables",
  "act_assumption_sets",
  "act_reserve_runs",
  "act_capital_runs",
  "act_referrals",
  "act_referral_rules",
  "act_exposure_limits",
  "act_accumulation_cells",
  "act_adequacy_alerts",
  "act_model_registry",
];

const ROLLBACK_SQL = `
DROP TABLE IF EXISTS "act_model_registry", "act_adequacy_alerts",
  "act_accumulation_cells", "act_exposure_limits", "act_referral_rules",
  "act_referrals", "act_capital_runs", "act_reserve_runs",
  "act_assumption_sets", "act_rating_tables", "act_rate_versions",
  "act_product_lines" CASCADE;
DROP TYPE IF EXISTS "act_alert_severity", "act_referral_status",
  "act_referral_action", "act_model_status", "act_model_type",
  "act_capital_model", "act_run_status", "act_reserve_method",
  "act_assumption_scope", "act_rating_table_type",
  "act_rate_version_status", "act_rating_style", "act_product_line";
`;

async function exec(sql: string) {
  const db = (await getDb())!;
  return db.execute(sql as never);
}

async function existingTables(): Promise<string[]> {
  const res = (await exec(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'act\\_%'`
  )) as unknown as { rows?: Array<{ table_name: string }> };
  const rows = Array.isArray(res) ? res : (res.rows ?? []);
  return (rows as Array<{ table_name: string }>).map(r => r.table_name).sort();
}

beforeAll(async () => {
  child = spawn(
    process.execPath,
    [path.join(REPO_ROOT, "tests/integration/setup/pgliteServer.mjs")],
    {
      env: { ...process.env, PGLITE_PORT: String(PGLITE_PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  await waitReady(child);
  process.env.POSTGRES_URL = DB_URL;
  process.env.DATABASE_URL = DB_URL;
  const dbMod = await import("../../server/db");
  getDb = dbMod.getDb;
  getPool = dbMod.getPool;
});

afterAll(async () => {
  try {
    const pool = await getPool?.();
    if (pool) await pool.end();
  } catch {
    /* ignore */
  }
  if (child) child.kill("SIGTERM");
});

describe("W34-D: 0049_actuary_engine.sql apply + idempotency + rollback (PGlite)", () => {
  it("applies cleanly and creates all 12 actuary tables", async () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    await exec(sql);
    const tables = await existingTables();
    for (const t of EXPECTED_TABLES) {
      expect(tables, `missing table ${t}`).toContain(t);
    }
  });

  it("accepts a real insert + read-back (enum + FK chain round-trip)", async () => {
    await exec(
      `INSERT INTO "act_product_lines" ("code","name","ratingStyle") VALUES ('motor','Motor Insurance','frequency_severity');`
    );
    const res = (await exec(
      `SELECT id, code, name, "ratingStyle" FROM "act_product_lines" WHERE code = 'motor'`
    )) as unknown as { rows?: Array<Record<string, unknown>> };
    const rows = Array.isArray(res) ? res : (res.rows ?? []);
    expect(rows.length).toBe(1);
    expect(rows[0].code).toBe("motor");
    expect(rows[0].ratingStyle).toBe("frequency_severity");
    // FK chain: a rate version referencing the seeded line.
    await exec(
      `INSERT INTO "act_rate_versions" ("productLineId","version","status") VALUES ((SELECT id FROM "act_product_lines" WHERE code='motor'),'2026.09','draft');`
    );
    const vr = (await exec(
      `SELECT "status", "version" FROM "act_rate_versions" WHERE "version"='2026.09'`
    )) as unknown as { rows?: Array<Record<string, unknown>> };
    const vrows = Array.isArray(vr) ? vr : (vr.rows ?? []);
    expect(vrows[0].status).toBe("draft");
  });

  it("is idempotent — a second apply exits clean and rows survive (double-apply safe)", async () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    // A rejection here fails the test — the double-apply must exit clean.
    await exec(sql);
    const res = (await exec(
      `SELECT count(*)::int AS n FROM "act_product_lines" WHERE code='motor'`
    )) as unknown as { rows?: Array<{ n: number }> };
    const rows = Array.isArray(res) ? res : (res.rows ?? []);
    expect(rows[0].n).toBe(1);
  });

  it("rolls back (documented DROPs) and re-applies cleanly", async () => {
    await exec(ROLLBACK_SQL);
    const tables = await existingTables();
    expect(tables.length).toBe(0);
    const sql = fs.readFileSync(MIGRATION, "utf8");
    await exec(sql);
    const reapplied = await existingTables();
    for (const t of EXPECTED_TABLES) {
      expect(reapplied, `missing table ${t} after re-apply`).toContain(t);
    }
  });
});
