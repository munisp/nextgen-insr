#!/usr/bin/env node
/**
 * seed-production-final.mjs — Reference-data seeder for the production-final
 * stack (Sprint 62 F12 / item A9).
 *
 * Seeds REAL rows into the PostgreSQL database used by
 * docker-compose.production-final.yml:
 *   1 tenant, 3 agents (with bcrypt PIN hashes), 6 transactions across the
 *   tx_type enum, 2 disputes, and 2 KYC sessions.
 *
 * Idempotent: every INSERT uses ON CONFLICT DO NOTHING and every row carries
 * a deterministic natural key (slug / agentId / ref / sessionRef), so the
 * script can be re-run safely after every deploy. Nothing is fabricated —
 * each batch reports the driver-reported rowCount, and the script exits
 * non-zero if the database is unreachable or any statement fails.
 *
 * Usage:
 *   DATABASE_URL=postgresql://posadmin:****@localhost:5432/posinsureportal \
 *     node scripts/seed-production-final.mjs
 *
 * Env:
 *   DATABASE_URL | POSTGRES_URL   target database (required)
 *   SEED_AGENT_PIN                initial PIN for seeded agents (default "4321";
 *                                 stored only as a bcrypt hash)
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;

const CONNECTION =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? null;
if (!CONNECTION) {
  console.error(
    "ERROR: DATABASE_URL (or POSTGRES_URL) is required — refusing to seed a default database."
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: CONNECTION });
const now = () => new Date();
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);

/** Batch insert with ON CONFLICT DO NOTHING; returns rows actually inserted. */
async function ins(client, table, cols, rows) {
  if (!rows.length) return 0;
  const colSql = cols.map((c) => `"${c}"`).join(", ");
  const rowSql = rows
    .map((_, i) => `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(",")})`)
    .join(", ");
  const res = await client.query(
    `INSERT INTO "${table}" (${colSql}) VALUES ${rowSql} ON CONFLICT DO NOTHING`,
    rows.flat()
  );
  return res.rowCount;
}

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("Seeding production-final reference data (idempotent)...\n");

    // ── Tenant ────────────────────────────────────────────────────────────────
    let n = await ins(
      client,
      "tenants",
      ["slug", "name", "country", "currency", "status", "planId", "contactEmail", "createdAt", "updatedAt"],
      [["default", "InsurePortal Default Tenant", "NGA", "NGN", "active", "enterprise", "ops@insureportal.ng", now(), now()]]
    );
    console.log(`  tenants: ${n} inserted (0 = already seeded)`);
    const tenantId = (
      await client.query(`SELECT id FROM "tenants" WHERE slug = 'default'`)
    ).rows[0].id;

    // ── Agents (bcrypt PIN hashes, deterministic agentId keys) ───────────────
    const pinHash = bcrypt.hashSync(process.env.SEED_AGENT_PIN ?? "4321", 10);
    const agents = [
      ["SEED-AGT-001", "Seed Agent One", "+2348010000001", "seed.agent1@insureportal.ng", "Lagos Island", "Gold"],
      ["SEED-AGT-002", "Seed Agent Two", "+2348010000002", "seed.agent2@insureportal.ng", "Abuja Wuse", "Silver"],
      ["SEED-AGT-003", "Seed Agent Three", "+2348010000003", "seed.agent3@insureportal.ng", "Kano Nassarawa", "Bronze"],
    ];
    n = await ins(
      client,
      "agents",
      ["agentId", "name", "phone", "email", "location", "tier", "role", "pinHash", "tenantId", "createdAt", "updatedAt"],
      agents.map(([agentId, name, phone, email, location, tier]) => [
        agentId, name, phone, email, location, tier, "agent", pinHash, tenantId, now(), now(),
      ])
    );
    console.log(`  agents: ${n} inserted`);
    const agentRows = (
      await client.query(
        `SELECT id, "agentId" FROM "agents" WHERE "agentId" LIKE 'SEED-AGT-%' ORDER BY "agentId"`
      )
    ).rows;
    const agentPk = Object.fromEntries(agentRows.map((r) => [r.agentId, r.id]));

    // ── Transactions (enum-valid types/channels/statuses) ────────────────────
    const txs = [
      ["SEED-TXN-001", "SEED-AGT-001", "Cash In", "25000.00", "250.00", "375.00", "Cash", "success", 2],
      ["SEED-TXN-002", "SEED-AGT-001", "Cash Out", "10000.00", "100.00", "150.00", "Cash", "success", 1],
      ["SEED-TXN-003", "SEED-AGT-002", "Transfer", "50000.00", "500.00", "750.00", "App", "success", 1],
      ["SEED-TXN-004", "SEED-AGT-002", "Bill Payment", "7500.00", "75.00", "112.50", "USSD", "pending", 0],
      ["SEED-TXN-005", "SEED-AGT-003", "Airtime", "1000.00", "10.00", "20.00", "USSD", "success", 0],
      ["SEED-TXN-006", "SEED-AGT-003", "QR Payment", "15000.00", "150.00", "225.00", "QR", "failed", 3],
    ];
    n = await ins(
      client,
      "transactions",
      ["ref", "idempotencyKey", "agentId", "type", "amount", "fee", "commission", "currency", "channel", "status", "failureReason", "tenantId", "createdAt", "updatedAt"],
      txs.map(([ref, agentKey, type, amount, fee, commission, channel, status, ageDays]) => [
        ref, `idem-${ref}`, agentPk[agentKey], type, amount, fee, commission, "NGN", channel, status,
        status === "failed" ? "Destination bank timeout" : null,
        tenantId, daysAgo(ageDays), now(),
      ])
    );
    console.log(`  transactions: ${n} inserted`);

    // ── Disputes (linked to seeded transactions) ──────────────────────────────
    const txnPk = Object.fromEntries(
      (await client.query(`SELECT id, ref FROM "transactions" WHERE ref LIKE 'SEED-TXN-%'`)).rows.map(
        (r) => [r.ref, r.id]
      )
    );
    const disputes = [
      ["SEED-DSP-001", "SEED-TXN-004", "SEED-AGT-002", "failed_credit", "open", "high", "Customer debited but beneficiary not credited (SEED-TXN-004).", "7500.00"],
      ["SEED-DSP-002", "SEED-TXN-006", "SEED-AGT-003", "duplicate_charge", "investigating", "medium", "Possible duplicate QR charge; awaiting rail confirmation.", "15000.00"],
    ];
    n = await ins(
      client,
      "disputes",
      ["ref", "transactionId", "transactionRef", "agentId", "type", "status", "priority", "description", "amount", "tenantId", "createdAt", "updatedAt"],
      disputes.map(([ref, txRef, agentKey, type, status, priority, description, amount]) => [
        ref, txnPk[txRef], txRef, agentPk[agentKey], type, status, priority, description, amount, tenantId, now(), now(),
      ])
    );
    console.log(`  disputes: ${n} inserted`);

    // ── KYC sessions for the seeded agents ────────────────────────────────────
    const kyc = [
      ["SEED-KYC-001", "SEED-AGT-001", "approved", "92.50", true],
      ["SEED-KYC-002", "SEED-AGT-002", "pending", null, null],
    ];
    n = await ins(
      client,
      "kyc_sessions",
      ["sessionRef", "agentId", "type", "status", "livenessScore", "livenessPassed", "idDocType", "tenantId", "createdAt", "updatedAt"],
      kyc.map(([sessionRef, agentKey, status, livenessScore, livenessPassed]) => [
        sessionRef, agentPk[agentKey], "agent_onboarding", status, livenessScore, livenessPassed, "nin", tenantId, now(), now(),
      ])
    );
    console.log(`  kyc_sessions: ${n} inserted`);

    await client.query("COMMIT");
    console.log("\nSeed complete (committed). Re-running is safe: natural keys make every batch idempotent.");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(`\nSEED FAILED (rolled back): ${err.message}`);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
