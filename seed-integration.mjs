/**
 * seed-integration.mjs — Minimal fixtures for integration tests.
 *
 * Creates exactly:
 *   1 tenant, 2 agents, 1 insurance product, 3 customers, 3 policies,
 *   5 transactions, 2 fraud alerts
 *
 * All rows are clearly labeled TEST data (names/emails prefixed "TEST",
 * ids in the 9000-range so they never collide with demo seed data) and use
 * ON CONFLICT DO NOTHING — safe to re-run before every test suite.
 *
 * Usage:
 *   POSTGRES_URL=postgresql://... node seed-integration.mjs
 */
import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;

const POSTGRES_URL =
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL ??
  "postgresql://posadmin:posinsureportal2026@localhost:5432/posinsureportal";

const pool = new Pool({ connectionString: POSTGRES_URL, ssl: false });

const now = () => new Date();
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000);

async function ins(client, table, cols, rows) {
  if (!rows.length) return;
  const colSql = cols.map((c) => `"${c}"`).join(", ");
  const rowSql = rows
    .map((_, i) => `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(",")})`)
    .join(", ");
  await client.query(
    `INSERT INTO "${table}" (${colSql}) VALUES ${rowSql} ON CONFLICT DO NOTHING`,
    rows.flat()
  );
  console.log(`  ✓ ${table}: ${rows.length} row(s)`);
}

// TEST ids (9000-range — never used by demo seed)
const T_TENANT = 9001;
const T_AGENT1 = 9001; // TEST-AGENT-1
const T_AGENT2 = 9002; // TEST-AGENT-2
const T_PRODUCT = 9001;
const T_CUSTOMERS = [9001, 9002, 9003];
const T_POLICIES = [9001, 9002, 9003];

async function seed() {
  const client = await pool.connect();
  try {
    console.log("🧪 Seeding INTEGRATION TEST fixtures (TEST data only)...\n");

    // 1 tenant
    await ins(client, "tenants",
      ["id", "slug", "name", "country", "currency", "status", "planId", "createdAt", "updatedAt"],
      [[T_TENANT, "test-tenant", "TEST Integration Tenant", "NG", "NGN", "active", "test", daysAgo(1), now()]]);

    // 2 agents (+ matching users for auth-dependent tests)
    const pinHash = await bcrypt.hash("9999", 10);
    await ins(client, "agents",
      ["id", "agentId", "name", "phone", "email", "location", "tier", "role", "pinHash", "isActive", "tenantId", "createdAt", "updatedAt"],
      [
        [T_AGENT1, "TEST-AGENT-1", "TEST Agent One", "08000000001", "test-agent-1@test.local", "TEST Lagos", "Gold",   "agent", pinHash, true, T_TENANT, daysAgo(1), now()],
        [T_AGENT2, "TEST-AGENT-2", "TEST Agent Two", "08000000002", "test-agent-2@test.local", "TEST Abuja", "Silver", "agent", pinHash, true, T_TENANT, daysAgo(1), now()],
      ]);
    await ins(client, "users",
      ["id", "keycloakSub", "name", "email", "loginMethod", "role", "tenantId", "createdAt", "updatedAt"],
      [
        [T_AGENT1, "kc-test-agent-1", "TEST Agent One", "test-agent-1@test.local", "keycloak", "user", T_TENANT, daysAgo(1), now()],
        [T_AGENT2, "kc-test-agent-2", "TEST Agent Two", "test-agent-2@test.local", "keycloak", "user", T_TENANT, daysAgo(1), now()],
      ]);

    // 1 product + 3 customers + 3 policies
    await ins(client, "insurance_products",
      ["id", "productCode", "name", "coverageType", "minPremium", "maxCoverageAmount", "policyTermMonths", "isActive", "tenantId", "createdAt", "updatedAt"],
      [[T_PRODUCT, "TEST-MTR-001", "TEST Motor Cover", "motor", "10000.00", "5000000.00", 12, true, T_TENANT, daysAgo(1), now()]]);
    await ins(client, "customers",
      ["id", "externalId", "firstName", "lastName", "email", "phone", "status", "kycLevel", "tenantId", "createdAt", "updatedAt"],
      T_CUSTOMERS.map((id, i) => [
        id, `TEST-CUST-${i + 1}`, "TEST", `Customer ${i + 1}`,
        `test-customer-${i + 1}@test.local`, `0700000000${i + 1}`,
        "active", 2, T_TENANT, daysAgo(1), now(),
      ]));
    await ins(client, "policies",
      ["id", "policyNumber", "productId", "customerId", "agentId", "coverageType", "sumInsured", "annualPremium", "status", "startDate", "endDate", "tenantId", "createdAt", "updatedAt"],
      [
        [T_POLICIES[0], "TEST-POL-001", T_PRODUCT, T_CUSTOMERS[0], T_AGENT1, "motor", "2000000.00", "100000.00", "active",  daysAgo(30), daysFromNow(335), T_TENANT, daysAgo(30), now()],
        [T_POLICIES[1], "TEST-POL-002", T_PRODUCT, T_CUSTOMERS[1], T_AGENT1, "motor", "3000000.00", "150000.00", "active",  daysAgo(20), daysFromNow(345), T_TENANT, daysAgo(20), now()],
        [T_POLICIES[2], "TEST-POL-003", T_PRODUCT, T_CUSTOMERS[2], T_AGENT2, "motor", "1000000.00", "60000.00",  "quoted", daysAgo(1),  daysFromNow(364), T_TENANT, daysAgo(1),  now()],
      ]);

    // 5 transactions
    await ins(client, "transactions",
      ["id", "ref", "agentId", "type", "amount", "fee", "commission", "customerName", "customerPhone", "channel", "status", "currency", "tenantId", "createdAt", "updatedAt"],
      [
        [9001, "TEST-TXN-001", T_AGENT1, "Cash In",  "10000.00", "50.00",  "20.00", "TEST Customer 1", "07000000001", "Cash", "success",  "NGN", T_TENANT, daysAgo(1), now()],
        [9002, "TEST-TXN-002", T_AGENT1, "Cash Out", "25000.00", "125.00", "50.00", "TEST Customer 2", "07000000002", "App",  "success",  "NGN", T_TENANT, daysAgo(1), now()],
        [9003, "TEST-TXN-003", T_AGENT2, "Transfer", "50000.00", "250.00", "100.00","TEST Customer 3", "07000000003", "USSD", "success",  "NGN", T_TENANT, daysAgo(1), now()],
        [9004, "TEST-TXN-004", T_AGENT2, "Cash Out", "99000.00", "495.00", "198.00","TEST Customer 1", "07000000001", "App",  "failed",   "NGN", T_TENANT, daysAgo(1), now()],
        [9005, "TEST-TXN-005", T_AGENT1, "Insurance","100000.00","500.00", "200.00","TEST Customer 1", "07000000001", "App",  "success",  "NGN", T_TENANT, daysAgo(1), now()],
      ]);

    // 2 fraud alerts
    await ins(client, "fraud_alerts",
      ["id", "agentId", "transactionId", "severity", "type", "customerName", "amount", "reason", "fraudScore", "status", "tenantId", "createdAt", "updatedAt"],
      [
        [9001, T_AGENT1, 9002, "high",     "velocity_breach", "TEST Customer 2", "25000.00", "TEST alert: rapid repeat cash-outs", "75.00", "open",         T_TENANT, daysAgo(1), now()],
        [9002, T_AGENT2, 9004, "critical", "amount_spike",    "TEST Customer 1", "99000.00", "TEST alert: amount 5x agent average", "91.00", "investigating", T_TENANT, daysAgo(1), now()],
      ]);

    console.log("\n✅ Integration test fixtures ready: 1 tenant, 2 agents, 3 policies, 5 transactions, 2 fraud alerts.");
    console.log("   TEST agent logins — agentId: TEST-AGENT-1 / TEST-AGENT-2, PIN: 9999");
  } catch (err) {
    console.error("❌ Integration seed error:", err.message);
    if (err.message?.includes("does not exist")) {
      console.error("\n💡 Run 'pnpm db:push' first to create the database schema.");
    }
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
