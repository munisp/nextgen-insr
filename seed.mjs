/**
 * seed.mjs — InsurePortal Platform Master Seed Script
 *
 * Coverage: 161 of the 167 pgTables defined in drizzle/schema.ts, plus all
 * 19 pgTables from drizzle/schema.additions.ts — 180 tables total.
 * The 6 tables deliberately left unseeded are runtime/internal state tables:
 *   dapr_workflow_state, fluvio_event_log, tigerbeetle_sync_log,
 *   permify_relationship_cache, encrypted_fields, load_test_runs.
 * (storefront_ads is no longer seeded — it is not defined in drizzle/schema.ts
 *  or any migration.)
 *
 * Usage:
 *   POSTGRES_URL=postgresql://... node seed.mjs
 *   # Or with default local connection:
 *   node seed.mjs
 *
 * Safe to re-run — every row uses a deterministic primary key plus
 * ON CONFLICT DO NOTHING, so re-running is a no-op.
 *
 * All data below is clearly-labeled, internally consistent DEMO data
 * (Nigerian agent-banking / insurance context). It is fabricated for
 * development and demo purposes only.
 */
import pg from "pg";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const { Pool } = pg;

const POSTGRES_URL =
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL ??
  "postgresql://posadmin:posinsureportal2026@localhost:5432/posinsureportal";

const pool = new Pool({ connectionString: POSTGRES_URL, ssl: false });

// ── Helpers ───────────────────────────────────────────────────────────────────
const now = () => new Date();
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
const hoursAgo = (n) => new Date(Date.now() - n * 3_600_000);
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000);
const J = (o) => JSON.stringify(o);

const seededTables = [];
const sequencesToReset = new Set();

/**
 * Insert rows into `table`. `cols` are exact DB column names (quoted
 * automatically, so camelCase is safe). Every row must include `id` —
 * deterministic ids + ON CONFLICT DO NOTHING make the seed idempotent.
 */
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
  if (!seededTables.includes(table)) seededTables.push(table);
  if (cols.includes("id")) sequencesToReset.add(table);
  console.log(`  ✓ ${table}: ${rows.length} row(s)`);
}

// ── Core demo identities (deterministic ids referenced across tables) ────────
const TENANT_ID = 1;      // InsurePortal Demo Tenant
const TENANT2_ID = 2;     // Acme Insurance Brokers (multi-tenant demo)

// Agent ids 1..15 = AGT001..AGT015, 16 = ADMIN1, 17 = SUP001
const AGENTS = [
  { id: 1,  code: "AGT001", name: "Emeka Obi",       phone: "08012345678", pin: "1234", tier: "Gold",     location: "Lagos Island, Lagos",    float: "850000.00",   commission: "24500.00", loyalty: 18750, streak: 12, rank: 3,   role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: 3 },
  { id: 2,  code: "AGT002", name: "Fatima Yusuf",     phone: "08023456789", pin: "2345", tier: "Silver",   location: "Kano Central, Kano",     float: "420000.00",   commission: "8900.00",  loyalty: 7200,  streak: 5,  rank: 18,  role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: null },
  { id: 3,  code: "AGT003", name: "Chidi Nwosu",      phone: "08034567890", pin: "3456", tier: "Platinum", location: "Onitsha, Anambra",       float: "1500000.00",  commission: "67800.00", loyalty: 62400, streak: 30, rank: 1,   role: "agent",      hierarchyRole: "master_agent", hierarchyLevel: 2, parent: 12 },
  { id: 4,  code: "AGT004", name: "Amaka Eze",        phone: "08045678901", pin: "4567", tier: "Bronze",   location: "Enugu North, Enugu",     float: "120000.00",   commission: "2100.00",  loyalty: 1850,  streak: 2,  rank: 87,  role: "agent",      hierarchyRole: "sub_agent",    hierarchyLevel: 4, parent: 1 },
  { id: 5,  code: "AGT005", name: "Tunde Adeyemi",    phone: "08056789012", pin: "5678", tier: "Silver",   location: "Ibadan Central, Oyo",    float: "380000.00",   commission: "11200.00", loyalty: 9400,  streak: 8,  rank: 12,  role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: null },
  { id: 6,  code: "AGT006", name: "Ngozi Okafor",     phone: "08067890123", pin: "6789", tier: "Gold",     location: "Port Harcourt, Rivers",  float: "720000.00",   commission: "31500.00", loyalty: 24100, streak: 15, rank: 5,   role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: null },
  { id: 7,  code: "AGT007", name: "Bello Usman",      phone: "08078901234", pin: "7890", tier: "Silver",   location: "Maiduguri, Borno",       float: "310000.00",   commission: "7400.00",  loyalty: 5600,  streak: 4,  rank: 25,  role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: null },
  { id: 8,  code: "AGT008", name: "Chioma Eze",       phone: "08089012345", pin: "8901", tier: "Bronze",   location: "Owerri, Imo",            float: "95000.00",    commission: "1800.00",  loyalty: 1200,  streak: 1,  rank: 102, role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: null },
  { id: 9,  code: "AGT009", name: "Yusuf Abubakar",   phone: "08090123456", pin: "9012", tier: "Gold",     location: "Abuja Central, FCT",     float: "980000.00",   commission: "42300.00", loyalty: 31500, streak: 20, rank: 2,   role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: 12 },
  { id: 10, code: "AGT010", name: "Adaeze Nwosu",     phone: "08001234567", pin: "0123", tier: "Silver",   location: "Asaba, Delta",           float: "450000.00",   commission: "13600.00", loyalty: 10800, streak: 9,  rank: 10,  role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: null },
  { id: 11, code: "AGT011", name: "Musa Garba",       phone: "08011234567", pin: "1122", tier: "Bronze",   location: "Kaduna South, Kaduna",   float: "180000.00",   commission: "3200.00",  loyalty: 2400,  streak: 3,  rank: 65,  role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: null },
  { id: 12, code: "AGT012", name: "Ifeoma Chukwu",    phone: "08022345678", pin: "2233", tier: "Platinum", location: "Calabar, Cross River",   float: "2100000.00",  commission: "89500.00", loyalty: 78200, streak: 45, rank: 1,   role: "agent",      hierarchyRole: "super_agent",  hierarchyLevel: 1, parent: null },
  { id: 13, code: "AGT013", name: "Suleiman Bello",   phone: "08033456789", pin: "3344", tier: "Gold",     location: "Sokoto, Sokoto",         float: "640000.00",   commission: "27800.00", loyalty: 21300, streak: 18, rank: 6,   role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: null },
  { id: 14, code: "AGT014", name: "Kemi Balogun",     phone: "08044567890", pin: "4455", tier: "Silver",   location: "Abeokuta, Ogun",         float: "290000.00",   commission: "6100.00",  loyalty: 4700,  streak: 6,  rank: 30,  role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: null },
  { id: 15, code: "AGT015", name: "Obinna Okonkwo",   phone: "08055678901", pin: "5566", tier: "Bronze",   location: "Umuahia, Abia",          float: "75000.00",    commission: "1100.00",  loyalty: 800,   streak: 0,  rank: 145, role: "agent",      hierarchyRole: "agent",        hierarchyLevel: 3, parent: null },
  { id: 16, code: "ADMIN1", name: "Admin User",       phone: "08099999999", pin: "0000", tier: "Platinum", location: "Head Office, Lagos",     float: "5000000.00",  commission: "0.00",     loyalty: 0,     streak: 0,  rank: null, role: "admin",      hierarchyRole: "agent",        hierarchyLevel: 0, parent: null },
  { id: 17, code: "SUP001", name: "Supervisor Ade",   phone: "08098765432", pin: "9999", tier: "Gold",     location: "Regional Office, Lagos", float: "0.00",        commission: "0.00",     loyalty: 0,     streak: 0,  rank: null, role: "supervisor", hierarchyRole: "agent",        hierarchyLevel: 0, parent: null },
];

const CUSTOMERS = [
  { id: 1, firstName: "Emeka",   lastName: "Okafor",   phone: "07011111111", email: "emeka.okafor@example.ng",   bvn: "22211111111", kycLevel: 2, status: "active" },
  { id: 2, firstName: "Amina",   lastName: "Hassan",   phone: "07022222222", email: "amina.hassan@example.ng",   bvn: "22222222222", kycLevel: 3, status: "active" },
  { id: 3, firstName: "Tunde",   lastName: "Adesanya", phone: "07033333333", email: "tunde.adesanya@example.ng", bvn: "22233333333", kycLevel: 1, status: "active" },
  { id: 4, firstName: "Chioma",  lastName: "Obi",      phone: "07044444444", email: "chioma.obi@example.ng",     bvn: "22244444444", kycLevel: 2, status: "active" },
  { id: 5, firstName: "Ibrahim", lastName: "Musa",     phone: "07055555555", email: "ibrahim.musa@example.ng",   bvn: "22255555555", kycLevel: 3, status: "pending_kyc" },
];

const MERCHANTS = [
  { id: 1, code: "MER001", businessName: "Sunshine Supermarket", ownerName: "Adewale Johnson", category: "retail", phone: "09011111111", email: "info@sunshinesupermarket.ng" },
  { id: 2, code: "MER002", businessName: "QuickFuel Station",    ownerName: "Ngozi Ibe",       category: "other",  phone: "09022222222", email: "ops@quickfuel.ng" },
];

const TX_TYPES = ["Cash In", "Cash Out", "Transfer", "Airtime", "Bill Payment", "QR Payment"];
const TX_CHANNELS = ["Cash", "Card", "USSD", "QR", "App"];

async function seed() {
  const client = await pool.connect();
  try {
    console.log("🌱 Seeding InsurePortal database (demo data, idempotent)...\n");

    // ── 1. Tenants ────────────────────────────────────────────────────────────
    await ins(client, "tenants",
      ["id", "slug", "name", "country", "currency", "status", "planId", "agentCount", "terminalCount", "monthlyVolume", "contactEmail", "contactPhone", "createdAt", "updatedAt"],
      [
        [TENANT_ID, "insureportal-demo", "InsurePortal Demo Tenant", "NG", "NGN", "active", "enterprise", 15, 3, "42500000.00", "ops@insureportal.ng", "+2348000000001", daysAgo(90), now()],
        [TENANT2_ID, "acme-brokers", "Acme Insurance Brokers", "NG", "NGN", "trial", "starter", 2, 0, "1500000.00", "hello@acmebrokers.ng", "+2348000000002", daysAgo(14), now()],
      ]);

    // ── 2. Users (back-office / SSO identities) ───────────────────────────────
    await ins(client, "users",
      ["id", "keycloakSub", "name", "email", "loginMethod", "role", "tenantId", "createdAt", "updatedAt"],
      AGENTS.map((a) => [
        a.id, `kc-demo-${a.code.toLowerCase()}`, a.name,
        `${a.code.toLowerCase()}@insureportal.ng`, "keycloak",
        a.role === "admin" ? "admin" : a.role === "supervisor" ? "supervisor" : "user",
        TENANT_ID, daysAgo(60), now(),
      ]));

    // ── 3. Agents ─────────────────────────────────────────────────────────────
    const agentRows = [];
    for (const a of AGENTS) {
      agentRows.push([
        a.id, a.code, a.name, a.phone, `${a.code.toLowerCase()}@insureportal.ng`,
        a.location, a.tier, a.role, await bcrypt.hash(a.pin, 10),
        a.float, a.commission, a.loyalty, a.streak, a.rank, true,
        700 + (a.id % 5) * 20, "BBB", a.parent, a.hierarchyRole, a.hierarchyLevel,
        TENANT_ID, daysAgo(90 - a.id), now(),
      ]);
    }
    await ins(client, "agents",
      ["id", "agentId", "name", "phone", "email", "location", "tier", "role", "pinHash",
       "premiumReserve", "commissionBalance", "loyaltyPoints", "streak", "rank", "isActive",
       "creditScore", "creditRating", "parentAgentId", "hierarchyRole", "hierarchyLevel",
       "tenantId", "createdAt", "updatedAt"],
      agentRows);

    // ── 4. Customers ──────────────────────────────────────────────────────────
    await ins(client, "customers",
      ["id", "externalId", "firstName", "lastName", "email", "phone", "bvn", "status", "kycLevel", "preferredAgentId", "tenantId", "createdAt", "updatedAt"],
      CUSTOMERS.map((c) => [
        c.id, `EXT-CUST-${String(c.id).padStart(4, "0")}`, c.firstName, c.lastName, c.email,
        c.phone, c.bvn, c.status, c.kycLevel, 1, TENANT_ID, daysAgo(45), now(),
      ]));

    // ── 5. Merchants ──────────────────────────────────────────────────────────
    await ins(client, "merchants",
      ["id", "merchantCode", "businessName", "ownerName", "email", "phone", "category", "status", "settlementAccountNumber", "settlementBankCode", "settlementBankName", "preferredAgentId", "tenantId", "createdAt", "updatedAt"],
      MERCHANTS.map((m) => [
        m.id, m.code, m.businessName, m.ownerName, m.email, m.phone, m.category, "active",
        `012345678${m.id}`, "058", "GTBank", 1, TENANT_ID, daysAgo(30), now(),
      ]));

    // ── 6. Terminal Groups ────────────────────────────────────────────────────
    await ins(client, "terminal_groups",
      ["id", "name", "description", "createdAt"],
      [[1, "Lagos Cluster", "All POS terminals in Lagos state (demo)", daysAgo(60)]]);

    // ── 7. POS Terminals (schema.additions.ts) ────────────────────────────────
    await ins(client, "pos_terminals",
      ["id", "terminalId", "serialNumber", "agentId", "model", "manufacturer", "firmwareVersion", "status", "lastHeartbeat", "groupId", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "TRM-001-LAGOS", "SN-N910-0001", 1, "Newland N910",   "Newland",  "3.2.1", "active", hoursAgo(1), 1, String(TENANT_ID), daysAgo(20), now()],
        [2, "TRM-002-KANO",  "SN-A920-0002", 2, "PAX A920",       "PAX",      "3.2.1", "active", hoursAgo(2), 1, String(TENANT_ID), daysAgo(20), now()],
        [3, "TRM-003-ANMB",  "SN-VX520-003", 3, "Verifone VX520", "Verifone", "3.1.9", "active", hoursAgo(3), 1, String(TENANT_ID), daysAgo(20), now()],
      ]);

    // ── 8. Devices (MDM-enrolled) ─────────────────────────────────────────────
    await ins(client, "devices",
      ["id", "serialNumber", "model", "agentId", "status", "firmwareVersion", "appVersion", "osVersion", "enrolledAt", "complianceStatus", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "DEV-AGT001-A54", "Samsung Galaxy A54", 1, "active", "3.2.1", "3.2.1", "Android 13", daysAgo(20), "compliant", TENANT_ID, daysAgo(20), now()],
        [2, "DEV-AGT002-SP10", "Tecno Spark 10",    2, "active", "3.2.1", "3.2.1", "Android 12", daysAgo(17), "compliant", TENANT_ID, daysAgo(17), now()],
        [3, "DEV-AGT003-H30", "Infinix Hot 30",     3, "active", "3.2.0", "3.2.0", "Android 13", daysAgo(14), "non_compliant", TENANT_ID, daysAgo(14), now()],
      ]);

    // ── 9. Field Agent Devices ────────────────────────────────────────────────
    await ins(client, "field_agent_devices",
      ["id", "serialNumber", "model", "agentId", "status", "firmwareVersion", "appVersion", "groupId", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "FAD-AGT009-001", "PAX A920",   9,  "active", "3.2.1", "3.2.1", 1, TENANT_ID, daysAgo(15), now()],
        [2, "FAD-AGT012-001", "PAX A920",   12, "active", "3.2.1", "3.2.1", 1, TENANT_ID, daysAgo(15), now()],
      ]);

    // ── 10. Transactions (ids 1..35 — referenced by fraud/refund/billing rows) ─
    const txRows = [
      // id, ref, agentId, type, amount, fee, commission, customerName, customerPhone, channel, status, failureReason, createdAt
      [1, "TXN-SEED-0001", 1, "Cash In",   "50000.00",    "250.00",  "100.00", "Biodun Adeyemi",  "07011111111", "Cash", "success",  null,                    daysAgo(1)],
      [2, "TXN-SEED-0002", 2, "Cash Out",  "280000.00",   "1400.00", "560.00", "Musa Ibrahim",    "07022222222", "App",  "success",  null,                    daysAgo(2)],
      [3, "TXN-SEED-0003", 1, "Cash Out",  "5000.00",     "25.00",   "10.00",  "Adaeze Nwosu",    "07033333333", "Cash", "reversed", null,                    daysAgo(3)],
      [4, "TXN-SEED-0004", 4, "Transfer",  "95000.00",    "475.00",  "190.00", "Suleiman Bello",  "07044444444", "App",  "failed",   "Insufficient float",    daysAgo(2)],
      [5, "TXN-SEED-0005", 3, "Cash In",   "1200000.00",  "6000.00", "2400.00","Chioma Obi",      "07055555555", "Card", "success",  null,                    daysAgo(5)],
    ];
    let txId = 5;
    for (const a of AGENTS.filter((x) => x.role === "agent")) {
      for (let k = 0; k < 2; k++) {
        txId++;
        const amount = (2000 + a.id * 1377 + k * 911).toFixed(2);
        const fee = (parseFloat(amount) * 0.005).toFixed(2);
        txRows.push([
          txId, `TXN-SEED-${String(txId).padStart(4, "0")}`, a.id,
          TX_TYPES[(a.id + k) % TX_TYPES.length], amount, fee,
          (parseFloat(fee) * 0.4).toFixed(2),
          CUSTOMERS[(a.id + k) % CUSTOMERS.length].firstName + " " + CUSTOMERS[(a.id + k) % CUSTOMERS.length].lastName,
          CUSTOMERS[(a.id + k) % CUSTOMERS.length].phone,
          TX_CHANNELS[(a.id + k) % TX_CHANNELS.length], "success", null,
          daysAgo((a.id * 2 + k) % 28),
        ]);
      }
    }
    await ins(client, "transactions",
      ["id", "ref", "agentId", "type", "amount", "fee", "commission", "customerName", "customerPhone", "channel", "status", "failureReason", "currency", "tenantId", "createdAt", "updatedAt"],
      txRows.map((r) => [...r.slice(0, 12), "NGN", TENANT_ID, r[12], r[12]]));

    // ── 11. Fraud Rules ───────────────────────────────────────────────────────
    await ins(client, "fraud_rules",
      ["id", "name", "category", "description", "threshold", "windowSeconds", "maxCount", "enabled", "hitCount", "createdBy", "createdAt", "updatedAt"],
      [
        [1, "Velocity Check",     "velocity",        "Flag >10 transactions in 10 minutes",        "10.0000", 600,  10,    true, 14, "ADMIN1", daysAgo(90), now()],
        [2, "Amount Threshold",   "amount_anomaly",  "Flag transactions just below ₦50,000",       "49000.0000", 3600, 1,  true, 6,  "ADMIN1", daysAgo(90), now()],
        [3, "Location Anomaly",   "geofence",        "Flag transactions from 3+ states in 1 hour", "3.0000",  3600, 3,    true, 2,  "ADMIN1", daysAgo(90), now()],
        [4, "Device Fingerprint", "device_fingerprint", "Flag transactions from unregistered devices", "1.0000", 60, 1,    true, 4,  "ADMIN1", daysAgo(90), now()],
      ]);

    // ── 12. Fraud Alerts (reference transactions 1..5) ────────────────────────
    await ins(client, "fraud_alerts",
      ["id", "agentId", "transactionId", "severity", "type", "customerName", "amount", "reason", "fraudScore", "status", "assignedTo", "resolvedAt", "tenantId", "createdAt", "updatedAt"],
      [
        [1, 1, 1, "high",     "velocity_breach",  "Biodun Adeyemi",  "450000.00",   "5 transactions in 3 minutes exceeding ₦90,000 each",            "82.50", "investigating", "SUP001", null,       TENANT_ID, daysAgo(1), now()],
        [2, 2, 2, "critical", "geo_anomaly",      "Musa Ibrahim",    "280000.00",   "Transaction location 800km from registered agent location",     "94.10", "open",          null,     null,       TENANT_ID, daysAgo(2), now()],
        [3, 3, 5, "medium",   "amount_spike",     "Chioma Obi",      "1200000.00",  "Single transaction 340% above agent 30-day average",            "61.75", "resolved",      "SUP001", daysAgo(1), TENANT_ID, daysAgo(5), now()],
        [4, 4, 4, "high",     "device_mismatch",  "Suleiman Bello",  "95000.00",    "Transaction from unregistered device fingerprint",              "77.30", "open",          null,     null,       TENANT_ID, daysAgo(2), now()],
        [5, 5, 3, "medium",   "duplicate_tx",     "Adaeze Nwosu",    "50000.00",    "Identical transaction repeated within 60 seconds",              "55.20", "investigating", "SUP001", null,       TENANT_ID, daysAgo(3), now()],
        [6, 6, null, "low",   "pin_retry",        "Yemi Adesanya",   "25000.00",    "3 failed PIN attempts before successful transaction",           "31.40", "resolved",      "SUP001", daysAgo(4), TENANT_ID, daysAgo(6), now()],
      ]);

    // ── 13. Fraud ML Scores ───────────────────────────────────────────────────
    await ins(client, "fraud_ml_scores",
      ["id", "transaction_id", "agent_id", "risk_score", "model_version", "prediction", "confidence", "features", "false_positive", "reviewed_by", "reviewed_at", "created_at"],
      [
        [1, 1, 1, "82.50", "fraudnet-v2.3.1", "fraud",   "0.9120", J({ velocity: 0.9, geoDistanceKm: 12, amountRatio: 2.1 }), false, 17, daysAgo(1), daysAgo(1)],
        [2, 2, 2, "94.10", "fraudnet-v2.3.1", "fraud",   "0.9650", J({ velocity: 0.4, geoDistanceKm: 800, amountRatio: 1.3 }), false, 17, daysAgo(2), daysAgo(2)],
        [3, 5, 3, "61.75", "fraudnet-v2.3.1", "review",  "0.7330", J({ velocity: 0.2, geoDistanceKm: 3, amountRatio: 3.4 }),  true,  17, daysAgo(1), daysAgo(5)],
        [4, 4, 4, "77.30", "fraudnet-v2.3.1", "fraud",   "0.8810", J({ velocity: 0.1, deviceKnown: 0, amountRatio: 1.1 }),     false, null, null,      daysAgo(2)],
        [5, 3, 1, "12.05", "fraudnet-v2.3.1", "legit",   "0.9880", J({ velocity: 0.1, geoDistanceKm: 0, amountRatio: 1.0 }),  false, null, null,      daysAgo(3)],
      ]);

    // ── 14. Transaction Monitoring Alerts ─────────────────────────────────────
    await ins(client, "tx_monitoring_alerts",
      ["id", "transaction_id", "alert_type", "severity", "description", "risk_score", "agent_id", "resolved", "resolved_by", "resolved_at", "metadata", "created_at"],
      [
        [1, 2, "ctr_threshold", "high",   "Cash transaction above ₦250,000 CTR reporting threshold", "88.00", 2, true,  17, daysAgo(1), J({ rule: "CTR-NG-250k" }), daysAgo(2)],
        [2, 5, "structuring",   "medium", "Possible structuring: repeated sub-threshold deposits",   "64.50", 3, false, null, null,       J({ rule: "STRUCT-7d" }), daysAgo(5)],
      ]);

    // ── 15. Realtime Transaction Alerts ───────────────────────────────────────
    await ins(client, "realtime_tx_alerts",
      ["id", "transaction_id", "alert_type", "severity", "message", "acknowledged", "acknowledged_by", "acknowledged_at", "metadata", "created_at"],
      [
        [1, "TXN-SEED-0002", "large_cash_out", "critical", "Large cash-out ₦280,000 at Kano Central", true,  "SUP001", daysAgo(1), J({ channel: "websocket" }), daysAgo(2)],
        [2, "TXN-SEED-0004", "failed_transfer", "warning", "Transfer failed: insufficient float",     false, null,     null,        J({ channel: "websocket" }), daysAgo(2)],
      ]);

    // ── 16. Disputes (+ messages + evidence) ──────────────────────────────────
    await ins(client, "disputes",
      ["id", "ref", "transactionId", "transactionRef", "agentId", "type", "status", "priority", "reason", "description", "amount", "createdBy", "assignedTo", "slaDeadlineAt", "resolution", "resolvedBy", "resolvedAt", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "DSP-2026-0001", 3, "TXN-SEED-0003", 1, "cash_not_dispensed", "open",     "high",   "Customer claims cash was not dispensed", "Customer says she did not receive the ₦5,000 cash out.", "5000.00", "AGT001", "SUP001", daysFromNow(2), null, null, null, TENANT_ID, daysAgo(3), now()],
        [2, "DSP-2026-0002", 4, "TXN-SEED-0004", 4, "failed_transfer",    "resolved", "medium", "Customer debited but transfer failed",   "₦95,000 transfer failed after customer debit; auto-reversal confirmed.", "95000.00", "AGT004", "SUP001", daysAgo(1), "Auto-reversal posted; customer refunded in full.", "SUP001", daysAgo(1), TENANT_ID, daysAgo(2), now()],
      ]);
    await ins(client, "dispute_messages",
      ["id", "disputeId", "authorId", "authorName", "authorRole", "message", "createdAt"],
      [
        [1, 1, 1,  "Emeka Obi",      "agent",   "Customer says she did not receive the ₦5,000 cash out.", daysAgo(3)],
        [2, 1, 17, "Supervisor Ade", "support", "Thank you — we are reviewing the terminal journal now.", daysAgo(3)],
        [3, 2, 17, "Supervisor Ade", "support", "Auto-reversal confirmed on the switch. Closing this dispute.", daysAgo(1)],
      ]);
    await ins(client, "dispute_evidence",
      ["id", "dispute_id", "file_name", "file_url", "file_key", "uploaded_by", "mime_type", "file_size", "created_at"],
      [
        [1, 1, "terminal-journal-0003.pdf", "https://cdn.insureportal.ng/demo/evidence/terminal-journal-0003.pdf", "demo/evidence/terminal-journal-0003.pdf", "AGT001", "application/pdf", 84213, daysAgo(3)],
        [2, 2, "switch-reversal-log.txt",   "https://cdn.insureportal.ng/demo/evidence/switch-reversal-log.txt",   "demo/evidence/switch-reversal-log.txt",   "SUP001", "text/plain",       12044, daysAgo(1)],
      ]);

    // ── 17. Refunds ───────────────────────────────────────────────────────────
    await ins(client, "refunds",
      ["id", "ref", "disputeId", "transactionId", "transactionRef", "agentId", "customerId", "customerName", "customerPhone", "originalAmount", "refundAmount", "currency", "reason", "category", "status", "method", "approvedBy", "approvedAt", "processedAt", "notes", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "RFD-2026-0001", 2,    4, "TXN-SEED-0004", 4, 3, "Tunde Adesanya", "07033333333", 95000, 95000, "NGN", "Customer debited but transfer failed", "failed_transaction", "processed", "wallet",  "SUP001", daysAgo(1), daysAgo(1), "Auto-reversal confirmed by switch.", TENANT_ID, daysAgo(2), now()],
        [2, "RFD-2026-0002", null, 3, "TXN-SEED-0003", 1, 1, "Emeka Okafor",   "07011111111", 5000,  5000,  "NGN", "Cash not dispensed at terminal",        "agent_error",        "pending",   "cash",    null,     null,       null,          "Awaiting supervisor approval.",     TENANT_ID, daysAgo(1), now()],
      ]);

    // ── 18. Reversal Requests ─────────────────────────────────────────────────
    await ins(client, "reversal_requests",
      ["id", "transactionId", "agentId", "reason", "amount", "currency", "status", "reviewedBy", "reviewedAt", "reviewNote", "createdAt", "updatedAt"],
      [
        [1, "TXN-SEED-0003", 1, "Wrong amount entered by agent", "5000.00",  "NGN", "approved", 17, daysAgo(2), "Verified — cash not dispensed.", daysAgo(3), now()],
        [2, "TXN-SEED-0004", 4, "Transfer failed after debit",   "95000.00", "NGN", "processed", 17, daysAgo(1), "Switch reversal confirmed.",      daysAgo(2), now()],
        [3, "TXN-SEED-0006", 2, "Duplicate customer charge",     "4717.00",  "NGN", "pending",   null, null,      null,                            daysAgo(1), now()],
      ]);

    // ── 19. Loyalty History ───────────────────────────────────────────────────
    const loyaltyRows = [];
    let loyaltyId = 0;
    for (const a of AGENTS.filter((x) => x.role === "agent")) {
      const events = [
        ["earned",   500,  "Cash In transaction bonus (demo)"],
        ["bonus",    1000, "Daily streak bonus — 7 days (demo)"],
        ["redeemed", -250, "Redeemed for airtime voucher (demo)"],
        ["earned",   750,  "Tier upgrade bonus (demo)"],
      ];
      let balance = a.loyalty;
      for (const [type, points, description] of events) {
        loyaltyId++;
        balance += points;
        loyaltyRows.push([loyaltyId, a.id, null, type, points, description, balance, daysAgo((a.id + loyaltyId) % 14)]);
      }
    }
    await ins(client, "loyalty_history",
      ["id", "agentId", "transactionId", "type", "points", "description", "balanceAfter", "createdAt"],
      loyaltyRows);

    // ── 20. Float Top-Up Requests ─────────────────────────────────────────────
    await ins(client, "float_topup_requests",
      ["id", "agentId", "requestedAmount", "status", "approvedBy", "notes", "supervisorApprovalRequired", "supervisorApprovedBy", "supervisorApprovedAt", "tenantId", "createdAt", "updatedAt"],
      [
        [1, 1, "500000.00", "approved", "ADMIN1", "Monthly float replenishment (demo)",        false, null,     null,       TENANT_ID, daysAgo(10), now()],
        [2, 2, "200000.00", "pending",  null,     "Urgent — running low on float (demo)",      true,  null,     null,       TENANT_ID, daysAgo(1),  now()],
        [3, 4, "100000.00", "rejected", "ADMIN1", "Request for additional float (demo)",       false, null,     null,       TENANT_ID, daysAgo(6),  now()],
        [4, 5, "300000.00", "pending",  null,     "Pre-weekend float top-up (demo)",           true,  null,     null,       TENANT_ID, daysAgo(2),  now()],
        [5, 6, "400000.00", "approved", "ADMIN1", "Q2 float increase request (demo)",          true,  "SUP001", daysAgo(4), TENANT_ID, daysAgo(5),  now()],
      ]);

    // ── 21. Float Reconciliations ─────────────────────────────────────────────
    await ins(client, "float_reconciliations",
      ["id", "agent_id", "date", "expected_balance", "actual_balance", "discrepancy", "status", "resolved_by", "resolved_at", "notes", "created_at"],
      [
        [1, 1, daysAgo(1), "850000.00", "850000.00", "0.00",    "matched",    null, null,       "Daily float reconciliation (demo)", daysAgo(1)],
        [2, 4, daysAgo(2), "120000.00", "118500.00", "-1500.00","discrepancy", 17,   daysAgo(1), "₦1,500 shortfall traced to unrecorded cash-out fee (demo)", daysAgo(2)],
      ]);

    // ── 22. KYC Sessions (agents + customers) ─────────────────────────────────
    await ins(client, "kyc_sessions",
      ["id", "agentId", "customerId", "type", "status", "bvn", "nin", "idDocType", "idDocNumber", "livenessScore", "livenessPassed", "matchScore", "reviewedBy", "reviewedAt", "tenantId", "createdAt", "updatedAt"],
      [
        [1, 1, null, "agent_onboarding", "approved", null, "10000000001", "national_id", "NIN100000001", "0.97", true,  "0.95", "SUP001", daysAgo(28), TENANT_ID, daysAgo(30), now()],
        [2, 2, null, "agent_onboarding", "approved", null, "10000000002", "national_id", "NIN100000002", "0.93", true,  "0.91", "SUP001", daysAgo(25), TENANT_ID, daysAgo(27), now()],
        [3, 4, null, "agent_onboarding", "rejected", null, "10000000004", "national_id", "NIN100000004", "0.41", false, "0.38", "SUP001", daysAgo(20), TENANT_ID, daysAgo(22), now()],
        [4, null, 1, "customer_kyc",     "approved", "22211111111", null, "nin_slip",   "22211111111",    "0.99", true,  "0.98", null,     null,        TENANT_ID, daysAgo(15), now()],
        [5, null, 5, "customer_kyc",     "pending",  "22255555555", null, "nin_slip",   "22255555555",    null,   null,  null,   null,     null,        TENANT_ID, daysAgo(1),  now()],
      ]);

    // ── 23. KYC Documents ─────────────────────────────────────────────────────
    await ins(client, "kyc_documents",
      ["id", "agent_id", "doc_type", "doc_number", "doc_url", "status", "verified_by", "verified_at", "rejection_reason", "created_at", "updated_at"],
      [
        [1, 1, "national_id",   "NIN100000001", "https://cdn.insureportal.ng/demo/kyc/agt001-nin.pdf",   "verified", 17, daysAgo(28), null,                       daysAgo(30), now()],
        [2, 1, "proof_of_address", "UTIL-2026-01", "https://cdn.insureportal.ng/demo/kyc/agt001-utility.pdf", "verified", 17, daysAgo(28), null,                  daysAgo(30), now()],
        [3, 2, "national_id",   "NIN100000002", "https://cdn.insureportal.ng/demo/kyc/agt002-nin.pdf",   "verified", 17, daysAgo(25), null,                       daysAgo(27), now()],
        [4, 4, "national_id",   "NIN100000004", "https://cdn.insureportal.ng/demo/kyc/agt004-nin.pdf",   "rejected", 17, daysAgo(20), "Document blurry — resubmit", daysAgo(22), now()],
      ]);

    // ── 24. KYC Verifications (customer-level, schema.additions.ts) ───────────
    await ins(client, "kyc_verifications",
      ["id", "customerId", "verificationType", "documentNumber", "bvn", "status", "verificationScore", "verifiedAt", "createdAt", "updatedAt"],
      [
        [1, 1, "bvn", "22211111111", "22211111111", "verified", "0.98", daysAgo(15), daysAgo(15), now()],
        [2, 2, "bvn", "22222222222", "22222222222", "verified", "0.96", daysAgo(15), daysAgo(15), now()],
        [3, 5, "bvn", "22255555555", "22255555555", "pending",  null,    null,        daysAgo(1),  now()],
      ]);

    // ── 25. Agent Bank Accounts ───────────────────────────────────────────────
    await ins(client, "agent_bank_accounts",
      ["id", "agent_id", "bank_name", "bank_code", "account_number", "account_name", "is_default", "verified", "created_at", "updated_at"],
      [
        [1, 1,  "GTBank",        "058", "0123456001", "Emeka Obi",     true,  true, daysAgo(60), now()],
        [2, 2,  "Access Bank",   "044", "0123456002", "Fatima Yusuf",  true,  true, daysAgo(60), now()],
        [3, 3,  "Zenith Bank",   "057", "0123456003", "Chidi Nwosu",   true,  true, daysAgo(60), now()],
        [4, 12, "First Bank",    "011", "0123456012", "Ifeoma Chukwu", true,  true, daysAgo(60), now()],
      ]);

    // ── 26. Agent Loans ───────────────────────────────────────────────────────
    await ins(client, "agent_loans",
      ["id", "agent_id", "loan_type", "principal_amount", "interest_rate", "tenor_days", "total_repayable", "amount_repaid", "status", "disbursed_at", "due_date", "approved_by", "credit_score", "created_at", "updated_at"],
      [
        [1, 1, "float_advance", "200000.00", "3.50", 30, "207000.00", "207000.00", "completed", daysAgo(45), daysAgo(15), 16, 780, daysAgo(46), now()],
        [2, 3, "device_finance", "350000.00", "4.00", 90, "363000.00", "121000.00", "repaying", daysAgo(30), daysFromNow(60), 16, 820, daysAgo(31), now()],
        [3, 8, "float_advance", "50000.00",  "3.50", 14, "51750.00",  "0.00",      "pending",  null,        null,            null, 610, daysAgo(1),  now()],
      ]);

    // ── 27. Agent Onboarding Progress ─────────────────────────────────────────
    await ins(client, "agent_onboarding_progress",
      ["id", "agent_code", "current_step", "profile_complete", "kyc_complete", "float_funded", "terminal_assigned", "training_complete", "activated_at", "notes", "created_at", "updated_at"],
      [
        [1, "AGT001", "activated", true, true, true,  true,  true,  daysAgo(28), "Fully onboarded (demo)", daysAgo(35), now()],
        [2, "AGT015", "kyc",       true, false, false, false, false, null,        "Awaiting KYC documents (demo)", daysAgo(3), now()],
      ]);

    // ── 28. Agent Performance Scores ──────────────────────────────────────────
    await ins(client, "agent_performance_scores",
      ["id", "agent_id", "period", "tx_volume", "tx_count", "commission_earned", "customer_count", "dispute_rate", "uptime_percent", "overall_score", "rank", "created_at"],
      [
        [1, 3,  "2026-06", "18400000.00", 1240, "67800.00", 310, "0.0020", "99.80", "94.50", 1,  daysAgo(13)],
        [2, 12, "2026-06", "26800000.00", 1710, "89500.00", 402, "0.0010", "99.95", "96.20", 1,  daysAgo(13)],
        [3, 1,  "2026-06", "9200000.00",  680,  "24500.00", 190, "0.0040", "99.10", "88.30", 3,  daysAgo(13)],
        [4, 9,  "2026-06", "11400000.00", 745,  "42300.00", 220, "0.0030", "99.40", "90.10", 2,  daysAgo(13)],
      ]);

    // ── 29. Agent Suspension Log ──────────────────────────────────────────────
    await ins(client, "agent_suspension_log",
      ["id", "agent_id", "action", "reason", "performed_by", "previous_status", "new_status", "created_at"],
      [
        [1, 8, "suspend", "Repeated float discrepancies (demo)", 16, "active",    "suspended", daysAgo(12)],
        [2, 8, "reinstate", "Discrepancy resolved — warning issued (demo)", 16, "suspended", "active", daysAgo(9)],
      ]);

    // ── 30. Agent Badges & Achievements ───────────────────────────────────────
    await ins(client, "agent_badges",
      ["id", "name", "icon", "category", "requirement", "description", "points_value", "is_active", "created_at"],
      [
        [1, "Volume Crusher", "trophy",      "volume",   "Process ₦10m+ in a month",       "Awarded for exceptional monthly volume (demo)", 500,  true, daysAgo(90)],
        [2, "Streak Master",  "flame",       "streak",   "Maintain a 30-day streak",       "Awarded for consistency (demo)",                300,  true, daysAgo(90)],
        [3, "Zero Disputes",  "shield",      "quality",  "Full quarter with no disputes",  "Awarded for clean operations (demo)",           400,  true, daysAgo(90)],
      ]);
    await ins(client, "agent_achievements",
      ["id", "agent_id", "achievement_type", "title", "description", "badge_icon", "points", "level", "unlocked_at", "metadata"],
      [
        [1, 3,  "badge", "Volume Crusher", "Processed ₦18.4m in June 2026 (demo)", "trophy", 500, 3, daysAgo(13), J({ badgeId: 1 })],
        [2, 12, "badge", "Streak Master",  "45-day transaction streak (demo)",     "flame",  300, 3, daysAgo(10), J({ badgeId: 2 })],
        [3, 9,  "badge", "Zero Disputes",  "Q2 2026 with zero disputes (demo)",    "shield", 400, 2, daysAgo(20), J({ badgeId: 3 })],
      ]);

    // ── 31. Supervisor Agents ─────────────────────────────────────────────────
    await ins(client, "supervisor_agents",
      ["id", "agentId", "supervisorId", "assignedAt"],
      [
        [1, 1, 17, daysAgo(45)],
        [2, 4, 17, daysAgo(45)],
        [3, 8, 17, daysAgo(45)],
      ]);

    // ── 32. Referrals ─────────────────────────────────────────────────────────
    await ins(client, "referrals",
      ["id", "referrer_agent_id", "referrer_code", "referral_code", "referee_agent_id", "referee_code", "status", "bonus_points", "bonus_cash", "activated_at", "rewarded_at", "expires_at", "created_at"],
      [
        [1, 1, "AGT001", "REF-AGT001-DEMO", 4,  "AGT004", "rewarded",  200, "5000.00", daysAgo(40), daysAgo(38), daysFromNow(300), daysAgo(45)],
        [2, 3, "AGT003", "REF-AGT003-DEMO", 15, "AGT015", "activated", 200, "0.00",  daysAgo(5),  null,        daysFromNow(300), daysAgo(10)],
      ]);

    // ── 33. Invite Codes ──────────────────────────────────────────────────────
    await ins(client, "invite_codes",
      ["id", "code", "type", "status", "maxUses", "usedCount", "createdBy", "assignedTenantId", "partnerName", "notes", "expiresAt", "createdAt", "updatedAt"],
      [
        [1, "DEMO-PARTNER-2026", "multi_use", "active", 50, 3, 16, null,        "Demo Partner Program", "Demo invite code for partner onboarding", daysFromNow(90), daysAgo(60), now()],
        [2, "ACME-TENANT-2026",  "one_time",  "used",   1,  1, 16, TENANT2_ID,  "Acme Insurance Brokers", "Tenant provisioning invite (demo)",      daysAgo(20),     daysAgo(30), now()],
      ]);

    // ── 34. Agent Push Subscriptions ──────────────────────────────────────────
    await ins(client, "agent_push_subscriptions",
      ["id", "agentId", "endpoint", "p256dhKey", "authKey", "userAgent", "createdAt", "updatedAt"],
      [
        [1, "AGT001", "https://fcm.googleapis.com/fcm/send/demo-endpoint-1", "BNcR8mNit7RChsnfhB4n3T8OvXJtV4id-WhYSA9-YP5UB2yku9jd5sB6GHs4", "tBHItJI5svbpez7KI4CCXg", "Mozilla/5.0 (Android 13; Demo)", daysAgo(5), now()],
        [2, "AGT003", "https://fcm.googleapis.com/fcm/send/demo-endpoint-2", "BKxN2mQp9sT4vXyZ1aB3cD5eF7gH9iJ1kL3mN5oP7qR9sT1uV3wX5yZ7", "uCHJtJK6twcqfa8LJ5DDYh", "Mozilla/5.0 (Android 13; Demo)", daysAgo(4), now()],
      ]);

    // ── 35. OTP Tokens (expired demo token) ───────────────────────────────────
    await ins(client, "otp_tokens",
      ["id", "agentId", "hashedOtp", "purpose", "expiresAt", "used", "usedAt", "createdAt"],
      [[1, 1, await bcrypt.hash("123456", 10), "login", daysAgo(1), true, daysAgo(1), daysAgo(1)]]);

    // ── 36. FIDO2 Credentials & Challenges ────────────────────────────────────
    await ins(client, "fido2_credentials",
      ["id", "userId", "agentId", "credentialId", "publicKey", "counter", "deviceType", "status", "createdAt"],
      [[1, 1, 1, `cred-demo-${"0".repeat(32)}`, `pk-demo-${"0".repeat(64)}`, 0, "platform", "active", daysAgo(10)]]);
    await ins(client, "fido2_challenges",
      ["id", "userId", "agentId", "challenge", "type", "expiresAt", "usedAt", "createdAt"],
      [[1, 1, 1, randomUUID().replace(/-/g, ""), "authentication", daysAgo(0), now(), hoursAgo(2)]]);

    // ── 37. API Keys & Usage ──────────────────────────────────────────────────
    await ins(client, "api_keys",
      ["id", "keyHash", "keyPrefix", "name", "userId", "description", "tenantId", "status", "scopes", "createdAt"],
      [
        [1, `sha256:${randomUUID().replace(/-/g, "")}`, "ipk_demo1", "Partner API Key (demo)", 1, "Read-only demo integration key", TENANT_ID, "active", J(["transactions:read", "float:read"]), daysAgo(20)],
        [2, `sha256:${randomUUID().replace(/-/g, "")}`, "ipk_demo2", "Reporting API Key (demo)", 16, "Admin reporting integration (demo)", TENANT_ID, "active", J(["reports:read"]), daysAgo(17)],
      ]);
    await ins(client, "api_key_usage",
      ["id", "apiKeyId", "endpoint", "method", "statusCode", "responseMs", "ipAddress", "createdAt"],
      [
        [1, 1, "/api/trpc/transactions.list", "GET", 200, 142, "41.58.12.34", daysAgo(1)],
        [2, 1, "/api/trpc/float.balance",     "GET", 200, 98,  "41.58.12.34", hoursAgo(5)],
        [3, 2, "/api/trpc/reports.daily",     "GET", 200, 233, "197.210.54.2", daysAgo(1)],
      ]);

    // ── 38. Webhooks (secrets, endpoints, deliveries) ─────────────────────────
    await ins(client, "webhook_secrets",
      ["id", "integrationName", "secret", "algorithm", "isActive", "lastRotatedAt", "createdAt"],
      [[1, "demo-partner-webhook", `whsec_demo_${randomUUID().replace(/-/g, "")}`, "sha256", true, daysAgo(30), daysAgo(60)]]);
    await ins(client, "webhook_endpoints",
      ["id", "name", "url", "secret", "events", "is_active", "tenant_id", "created_by", "failure_count", "last_delivery_at", "last_status_code", "created_at", "updated_at"],
      [[1, "Demo Partner Webhook", "https://webhook.site/insureportal-demo", `whsec_demo_${randomUUID().replace(/-/g, "")}`, ["transaction.completed", "transaction.failed"], true, TENANT_ID, 16, 0, daysAgo(1), 200, daysAgo(30), now()]]);
    await ins(client, "webhook_deliveries",
      ["id", "endpoint_id", "event_type", "payload", "status", "status_code", "response_time", "attempt_count", "delivered_at", "created_at", "updated_at"],
      [
        [1, 1, "transaction.completed", J({ ref: "TXN-SEED-0001", amount: "50000.00" }), "delivered", 200, 180, 1, daysAgo(1), daysAgo(1), now()],
        [2, 1, "transaction.failed",    J({ ref: "TXN-SEED-0004", reason: "Insufficient float" }), "delivered", 200, 210, 1, daysAgo(2), daysAgo(2), now()],
      ]);

    // ══════════════════════ INSURANCE CORE DOMAIN ════════════════════════════

    // ── 39. Insurance Product Types & Categories (schema.additions.ts) ────────
    await ins(client, "insurance_product_types",
      ["id", "code", "name", "description", "isActive", "createdAt", "updatedAt"],
      [
        [1, "MOTOR",    "Motor Insurance",    "Comprehensive and third-party motor cover (demo)", true, daysAgo(90), now()],
        [2, "HEALTH",   "Health Insurance",   "Individual and family HMO plans (demo)",           true, daysAgo(90), now()],
        [3, "LIFE",     "Life Insurance",     "Term life and endowment plans (demo)",             true, daysAgo(90), now()],
        [4, "PROPERTY", "Property Insurance", "Fire and burglary cover for SMEs (demo)",          true, daysAgo(90), now()],
      ]);
    await ins(client, "insurance_categories",
      ["id", "name", "slug", "description", "isActive", "sortOrder", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "Motor",    "motor",    "Motor insurance products (demo)",    true, 1, TENANT_ID, daysAgo(90), now()],
        [2, "Health",   "health",   "Health insurance products (demo)",   true, 2, TENANT_ID, daysAgo(90), now()],
        [3, "Life",     "life",     "Life insurance products (demo)",     true, 3, TENANT_ID, daysAgo(90), now()],
        [4, "Property", "property", "Property insurance products (demo)", true, 4, TENANT_ID, daysAgo(90), now()],
      ]);

    // ── 40. Insurance Products ────────────────────────────────────────────────
    await ins(client, "insurance_products",
      ["id", "productCode", "name", "coverageType", "description", "minPremium", "maxCoverageAmount", "minAge", "maxAge", "waitingPeriodDays", "policyTermMonths", "isActive", "naicomProductCode", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "MTR-COMP-001",  "Comprehensive Motor Cover", "motor",    "Full comprehensive motor insurance (demo)", "25000.00", "50000000.00", 18, 70, 0,  12, true, "NAICOM-MTR-001", TENANT_ID, daysAgo(90), now()],
        [2, "HLT-FAM-001",   "Family Health Plan",        "health",   "Family HMO plan, up to 6 members (demo)",   "15000.00", "10000000.00", 0,  65, 14, 12, true, "NAICOM-HLT-002", TENANT_ID, daysAgo(90), now()],
        [3, "LFE-TERM-001",  "Term Life Protector",       "life",     "10-year term life cover (demo)",            "10000.00", "100000000.00",18, 60, 0,  12, true, "NAICOM-LFE-003", TENANT_ID, daysAgo(90), now()],
        [4, "PRP-SME-001",   "SME Property Shield",       "property", "Fire and burglary for small shops (demo)",  "20000.00", "25000000.00", 18, 99, 7,  12, true, "NAICOM-PRP-004", TENANT_ID, daysAgo(90), now()],
      ]);

    // ── 41. Brokers & Stakeholder Profiles ────────────────────────────────────
    await ins(client, "brokers",
      ["id", "brokerCode", "companyName", "licenseNumber", "naicomRegNumber", "commissionRate", "contactEmail", "contactPhone", "isActive", "tenantId", "createdAt", "updatedAt"],
      [[1, "BRK001", "Acme Insurance Brokers", "NAICOM-BRK-0042", "RC-1042", "7.50", "hello@acmebrokers.ng", "+2348000000002", true, TENANT_ID, daysAgo(60), now()]]);
    await ins(client, "stakeholder_profiles",
      ["id", "userId", "role", "licenseNumber", "maxClaimAuthority", "isActive", "tenantId", "createdAt", "updatedAt"],
      [
        [1, 16, "admin",            null,              null,        true, TENANT_ID, daysAgo(90), now()],
        [2, 17, "supervisor",       null,              "500000.00", true, TENANT_ID, daysAgo(90), now()],
        [3, 3,  "agent",            "AGT-NAICOM-003",  null,        true, TENANT_ID, daysAgo(90), now()],
        [4, 1,  "policyholder",     null,              null,        true, TENANT_ID, daysAgo(45), now()],
      ]);

    // ── 42. Policies ──────────────────────────────────────────────────────────
    await ins(client, "policies",
      ["id", "policyNumber", "productId", "customerId", "agentId", "brokerId", "coverageType", "sumInsured", "annualPremium", "status", "startDate", "endDate", "renewalDate", "certificateNumber", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "POL-2026-0001", 1, 1, 1,  null, "motor",    "8000000.00",  "400000.00", "active",  daysAgo(120), daysFromNow(245), daysFromNow(245), "CERT-2026-0001", TENANT_ID, daysAgo(120), now()],
        [2, "POL-2026-0002", 2, 2, 3,  null, "health",   "5000000.00",  "180000.00", "active",  daysAgo(90),  daysFromNow(275), daysFromNow(275), "CERT-2026-0002", TENANT_ID, daysAgo(90),  now()],
        [3, "POL-2026-0003", 3, 3, 9,  1,     "life",     "25000000.00", "750000.00", "active",  daysAgo(200), daysFromNow(165), daysFromNow(165), "CERT-2026-0003", TENANT_ID, daysAgo(200), now()],
        [4, "POL-2026-0004", 1, 4, 1,  null, "motor",    "5000000.00",  "275000.00", "active",  daysAgo(45),  daysFromNow(320), daysFromNow(320), "CERT-2026-0004", TENANT_ID, daysAgo(45),  now()],
        [5, "POL-2026-0005", 4, 5, 6,  null, "property", "15000000.00", "320000.00", "bound",   daysAgo(5),   daysFromNow(360), daysFromNow(360), "CERT-2026-0005", TENANT_ID, daysAgo(5),   now()],
        [6, "POL-2025-0006", 2, 1, 3,  null, "health",   "3000000.00",  "120000.00", "lapsed",  daysAgo(400), daysAgo(35),      null,             "CERT-2025-0006", TENANT_ID, daysAgo(400), now()],
      ]);

    // ── 43. Beneficiaries & Coverage Items ────────────────────────────────────
    await ins(client, "beneficiaries",
      ["id", "policyId", "name", "relationship", "percentage", "phone", "isMinor", "createdAt", "updatedAt"],
      [
        [1, 3, "Ngozi Adesanya", "spouse",   "60.00", "07066666666", false, daysAgo(200), now()],
        [2, 3, "Chinedu Adesanya", "child",  "40.00", null,          true,  daysAgo(200), now()],
        [3, 1, "Amara Okafor",   "spouse",  "100.00", "07077777777", false, daysAgo(120), now()],
      ]);
    await ins(client, "coverage_items",
      ["id", "policyId", "coverageType", "coverageName", "sumInsured", "premium", "deductible", "isExcluded", "startDate", "endDate", "createdAt"],
      [
        [1, 1, "motor",    "Own Damage",           "8000000.00",  "320000.00", "50000.00",  false, daysAgo(120), daysFromNow(245), daysAgo(120)],
        [2, 1, "motor",    "Third-Party Liability", "3000000.00", "80000.00",  "0.00",      false, daysAgo(120), daysFromNow(245), daysAgo(120)],
        [3, 2, "health",   "Inpatient Care",       "5000000.00",  "180000.00", "0.00",      false, daysAgo(90),  daysFromNow(275), daysAgo(90)],
        [4, 3, "life",     "Death Benefit",        "25000000.00", "750000.00", "0.00",      false, daysAgo(200), daysFromNow(165), daysAgo(200)],
        [5, 5, "property", "Fire & Burglary",      "15000000.00", "320000.00", "100000.00", false, daysAgo(5),   daysFromNow(360), daysAgo(5)],
      ]);

    // ── 44. Premium Payments (schema.ts) & Premiums (additions) ──────────────
    await ins(client, "premium_payments",
      ["id", "policyId", "paymentReference", "amount", "currency", "paymentDate", "dueDate", "paymentMethod", "channel", "status", "receiptNumber", "isInstallment", "installmentNumber", "totalInstallments", "createdAt", "updatedAt"],
      [
        [1, 1, "PMT-2026-0001", "400000.00", "NGN", daysAgo(120), daysAgo(120), "transfer", "App",  "paid",   "RCP-2026-0001", false, 1, 1, daysAgo(120), now()],
        [2, 2, "PMT-2026-0002", "180000.00", "NGN", daysAgo(90),  daysAgo(90),  "card",     "App",  "paid",   "RCP-2026-0002", false, 1, 1, daysAgo(90),  now()],
        [3, 3, "PMT-2026-0003", "187500.00", "NGN", daysAgo(30),  daysAgo(30),  "transfer", "USSD", "paid",   "RCP-2026-0003", true,  2, 4, daysAgo(30),  now()],
        [4, 3, "PMT-2026-0004", "187500.00", "NGN", daysAgo(5),   daysFromNow(30), null,    null,   "pending", null,          true,  3, 4, daysAgo(5),   now()],
      ]);
    await ins(client, "premiums",
      ["id", "policyId", "customerId", "agentId", "premiumRef", "amount", "currency", "dueDate", "paidDate", "status", "paymentMethod", "paymentRef", "tenantId", "createdAt", "updatedAt"],
      [
        [1, 1, 1, 1, "PRM-2026-0001", "400000.00", "NGN", daysAgo(120), daysAgo(120), "paid",    "transfer", "PMT-2026-0001", String(TENANT_ID), daysAgo(120), now()],
        [2, 3, 3, 9, "PRM-2026-0003", "187500.00", "NGN", daysFromNow(30), null,        "pending", null,       null,           String(TENANT_ID), daysAgo(5),   now()],
      ]);

    // ── 45. Claims (+ documents, workflow events, payments) ───────────────────
    await ins(client, "claims",
      ["id", "claimNumber", "policyId", "claimantId", "assignedAdjusterId", "status", "claimType", "incidentDate", "reportedDate", "claimedAmount", "approvedAmount", "paidAmount", "incidentDescription", "investigationNotes", "settlementDate", "isFraudSuspected", "fraudScore", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "CLM-2026-0001", 1, 1, 17, "under_review", "accident",  daysAgo(10), daysAgo(9),  "1500000.00", null,         null,         "Rear-end collision at Lekki toll; bumper and axle damage (demo).", null,                              null,        false, "0.1200", TENANT_ID, daysAgo(9),  now()],
        [2, "CLM-2026-0002", 2, 2, 17, "approved",     "hospitalization", daysAgo(30), daysAgo(28), "450000.00", "420000.00", "420000.00", "Appendectomy at Lagoon Hospital, 3-day admission (demo).",       "Documents verified against HMO records.", daysAgo(20), false, "0.0500", TENANT_ID, daysAgo(28), now()],
        [3, "CLM-2026-0003", 4, 4, 17, "investigation", "theft",     daysAgo(6),  daysAgo(5),  "5000000.00", null,         null,         "Vehicle reported stolen from premises in Enugu (demo).",           "Police report inconsistent with GPS data.", null,        true,  "0.8100", TENANT_ID, daysAgo(5),  now()],
      ]);
    await ins(client, "claim_documents",
      ["id", "claimId", "documentType", "fileName", "fileUrl", "fileSize", "mimeType", "uploadedBy", "isVerified", "verifiedBy", "verifiedAt", "createdAt"],
      [
        [1, 1, "police_report",   "police-report-clm0001.pdf", "https://cdn.insureportal.ng/demo/claims/police-report-clm0001.pdf", 152344, "application/pdf", 1, true, 17, daysAgo(8), daysAgo(9)],
        [2, 1, "damage_photo",    "damage-photo-clm0001.jpg",  "https://cdn.insureportal.ng/demo/claims/damage-photo-clm0001.jpg",  842133, "image/jpeg",      1, true, 17, daysAgo(8), daysAgo(9)],
        [3, 2, "hospital_bill",   "hospital-bill-clm0002.pdf", "https://cdn.insureportal.ng/demo/claims/hospital-bill-clm0002.pdf", 98211,  "application/pdf", 2, true, 17, daysAgo(25), daysAgo(28)],
        [4, 3, "police_report",   "police-report-clm0003.pdf", "https://cdn.insureportal.ng/demo/claims/police-report-clm0003.pdf", 160021, "application/pdf", 4, false, null, null,        daysAgo(5)],
      ]);
    await ins(client, "claim_workflow_events",
      ["id", "claimId", "eventType", "fromStatus", "toStatus", "triggeredBy", "triggeredByRole", "notes", "createdAt"],
      [
        [1, 1, "submitted",    null,          "submitted",    1, "policyholder", "Claim submitted via customer portal (demo)", daysAgo(9)],
        [2, 1, "assigned",     "submitted",   "under_review", 17, "supervisor",   "Assigned to adjuster (demo)",                daysAgo(8)],
        [3, 2, "approved",     "under_review", "approved",    17, "supervisor",   "All documents verified (demo)",              daysAgo(22)],
        [4, 3, "escalated",    "under_review", "investigation", 17, "supervisor",   "Fraud indicators — escalating (demo)",       daysAgo(4)],
      ]);
    await ins(client, "claims_payments",
      ["id", "claimId", "paymentRef", "amount", "currency", "paymentMethod", "beneficiaryName", "beneficiaryAccount", "beneficiaryBank", "status", "processedAt", "approvedBy", "tenantId", "createdAt", "updatedAt"],
      [[1, 2, "CPAY-2026-0001", "420000.00", "NGN", "transfer", "Amina Hassan", "0123456702", "Access Bank", "completed", daysAgo(20), 16, String(TENANT_ID), daysAgo(21), now()]]);

    // ── 46. Policy Workflow Events & Renewals & Endorsements ──────────────────
    await ins(client, "policy_workflow_events",
      ["id", "policyId", "eventType", "fromStatus", "toStatus", "triggeredBy", "triggeredByRole", "notes", "createdAt"],
      [
        [1, 1, "bound",       "quoted", "active", 1, "agent",      "Premium paid — policy bound (demo)",     daysAgo(120)],
        [2, 5, "bound",       "quoted", "bound",  6, "agent",      "Awaiting first premium (demo)",          daysAgo(5)],
        [3, 6, "lapsed",      "active", "lapsed", 16, "admin",      "Renewal premium not received (demo)",    daysAgo(35)],
      ]);
    await ins(client, "policy_renewals",
      ["id", "originalPolicyId", "renewedPolicyId", "renewalDueDate", "renewalNoticeDate", "renewalPremium", "isAutoRenewal", "status", "notificationSent", "notificationSentAt", "createdAt", "updatedAt"],
      [
        [1, 6, null, daysAgo(35),     daysAgo(65), "126000.00", false, "lapsed",  true,  daysAgo(65), daysAgo(65), now()],
        [2, 3, null, daysFromNow(165), daysFromNow(135), "780000.00", true,  "pending",  false, null,       daysAgo(5),  now()],
      ]);
    await ins(client, "endorsements",
      ["id", "endorsementNumber", "policyId", "type", "effectiveDate", "description", "premiumAdjustment", "sumInsuredAdjustment", "approvedBy", "approvedAt", "createdAt", "updatedAt"],
      [
        [1, "END-2026-0001", 1, "addition", daysAgo(60), "Added tracker discount endorsement (demo)", "-20000.00", "0.00",       17, daysAgo(60), daysAgo(60), now()],
        [2, "END-2026-0002", 4, "extension", daysAgo(10), "Extended cover to include flood (demo)",     "15000.00",  "1000000.00", 17, daysAgo(10), daysAgo(10), now()],
      ]);

    // ── 47. Underwriting ──────────────────────────────────────────────────────
    await ins(client, "underwriting_assessments",
      ["id", "policyId", "underwriterId", "decision", "riskScore", "riskCategory", "premiumLoading", "notes", "decisionDate", "createdAt", "updatedAt"],
      [
        [1, 1, 17, "approved",                 "22.50", "low",    "0.0000", "Clean claims history (demo)",            daysAgo(121), daysAgo(121), now()],
        [2, 3, 17, "approved_with_conditions", "45.00", "medium", "5.0000", "Loading applied for occupation (demo)",  daysAgo(201), daysAgo(201), now()],
        [3, 5, 17, "approved",                 "38.00", "medium", "0.0000", "Standard SME property risk (demo)",      daysAgo(6),   daysAgo(6),   now()],
      ]);
    await ins(client, "underwriting_applications",
      ["id", "applicationRef", "customerId", "agentId", "productId", "status", "riskScore", "riskCategory", "sumInsured", "proposedPremium", "finalPremium", "decisionAt", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "UWA-2026-0001", 1, 1, 1, "approved", "22.50", "low",    "8000000.00",  "400000.00", "400000.00", daysAgo(121), String(TENANT_ID), daysAgo(125), now()],
        [2, "UWA-2026-0002", 5, 6, 4, "approved", "38.00", "medium", "15000000.00", "320000.00", "320000.00", daysAgo(6),   String(TENANT_ID), daysAgo(8),   now()],
        [3, "UWA-2026-0003", 3, 9, 3, "referred", "61.00", "high",   "40000000.00", "980000.00", null,        null,         String(TENANT_ID), daysAgo(2),   now()],
      ]);

    // ── 48. Risk Assessments ──────────────────────────────────────────────────
    await ins(client, "risk_assessments",
      ["id", "assessmentType", "policyId", "customerId", "overallRiskScore", "riskCategory", "factors", "recommendations", "assessedBy", "assessedAt", "validUntil", "createdAt"],
      [
        [1, "policy_underwriting", 1, 1, "22.50", "low",    J({ driverAge: 34, claimsHistory: "none", vehicleAge: 3 }), J(["eligible_for_ncb"]), 17, daysAgo(121), daysFromNow(244), daysAgo(121)],
        [2, "fraud_review",        4, 4, "71.00", "high",   J({ gpsMismatch: true, policeReport: "inconsistent" }),      J(["site_inspection"]), 17, daysAgo(4),   daysFromNow(90),  daysAgo(4)],
      ]);

    // ── 49. Actuarial (reserves, tables, IFRS 17 groups) ─────────────────────
    await ins(client, "actuarial_reserves",
      ["id", "productId", "reserveType", "calculationDate", "grossReserve", "netReserve", "coverageType", "unearnedPremiumReserve", "claimsReserve", "methodology", "calculatedBy", "reportingPeriod", "createdAt"],
      [
        [1, 1, "UPR",  daysAgo(13), "12400000.00", "11200000.00", "motor",  "9800000.00",  "2600000.00", "365ths method (demo)",        16, "2026-06", daysAgo(13)],
        [2, 3, "IBNR", daysAgo(13), "5800000.00",  "4900000.00",  "life",   "0.00",        "5800000.00", "Chain-ladder estimate (demo)", 16, "2026-06", daysAgo(13)],
      ]);
    await ins(client, "actuarial_tables",
      ["id", "tableCode", "tableName", "tableType", "gender", "validFrom", "data", "source", "approvedBy", "createdAt"],
      [
        [1, "NGM-2012", "Nigerian Mortality 2012 (demo)", "mortality", "all", daysAgo(900), J({ base: 2012, qx: { "30": 0.0012, "40": 0.0021, "50": 0.0048 } }), "NAICOM demo dataset", 16, daysAgo(300)],
      ]);
    await ins(client, "ifrs17_measurement_groups",
      ["id", "groupCode", "productId", "measurementModel", "coverageType", "reportingPeriod", "csm", "ra", "lrc", "lrc_remaining", "calculatedAt", "calculatedBy", "createdAt"],
      [
        [1, "GMM-MTR-2026H1", 1, "GMM", "motor",  "2026-H1", "1850000.00", "240000.00", "9600000.00",  "4100000.00", daysAgo(13), 16, daysAgo(13)],
        [2, "PAA-HLT-2026H1", 2, "PAA", "health", "2026-H1", "0.00",       "180000.00", "5200000.00",  "2600000.00", daysAgo(13), 16, daysAgo(13)],
      ]);

    // ── 50. Reinsurance ───────────────────────────────────────────────────────
    await ins(client, "reinsurance_treaties",
      ["id", "treatyNumber", "reinsurerName", "type", "coverageType", "retentionLimit", "cessionLimit", "cessionPercentage", "premiumRate", "startDate", "endDate", "isActive", "createdAt", "updatedAt"],
      [[1, "RTY-2026-001", "Continental Reinsurance (demo)", "quota_share", "motor", "20000000.00", "80000000.00", "40.00", "2.50", daysAgo(195), daysFromNow(170), true, daysAgo(200), now()]]);
    await ins(client, "reinsurance_cessions",
      ["id", "treatyId", "policyId", "cededPremium", "cededSumInsured", "retainedPremium", "retainedSumInsured", "cessionDate", "status", "createdAt"],
      [
        [1, 1, 1, "160000.00", "3200000.00",  "240000.00", "4800000.00",  daysAgo(119), "settled", daysAgo(119)],
        [2, 1, 4, "110000.00", "2000000.00",  "165000.00", "3000000.00",  daysAgo(44),  "settled", daysAgo(44)],
      ]);

    // ── 51. NAICOM Regulatory Reports ─────────────────────────────────────────
    await ins(client, "naicom_reports",
      ["id", "reportType", "reportingPeriod", "submissionDate", "status", "reportData", "submittedBy", "naicomAcknowledgement", "dueDate", "createdAt", "updatedAt"],
      [
        [1, "monthly_returns", "2026-06", daysAgo(6), "submitted", J({ grossPremium: "1520000.00", claims: "420000.00", policies: 5 }), 16, "ACK-NAICOM-2026-0601", daysAgo(13), daysAgo(7), now()],
        [2, "quarterly_returns", "2026-Q1", daysAgo(96), "acknowledged", J({ grossPremium: "4210000.00", claims: "980000.00", policies: 12 }), 16, "ACK-NAICOM-2026-Q1-01", daysAgo(90), daysAgo(100), now()],
      ]);

    // ── 52. Marketplace storefront (policy_quotes, carts, orders) ────────────
    await ins(client, "policy_quotes",
      ["id", "customerId", "agentId", "productId", "productName", "productType", "sumInsured", "premiumAmount", "stampDuty", "totalPayable", "durationMonths", "coverageType", "status", "validUntil", "createdAt", "updatedAt"],
      [
        [1, 3, 9, 3, "Term Life Protector", "LIFE", "40000000.00", "980000.00", "7350.00", "987350.00", 12, "life",  "pending", daysFromNow(14), daysAgo(2), now()],
        [2, 5, 6, 4, "SME Property Shield", "PROPERTY", "15000000.00", "320000.00", "2400.00", "322400.00", 12, "property", "accepted", daysAgo(6), daysAgo(8), now()],
      ]);
    await ins(client, "insurance_carts",
      ["id", "customerId", "agentId", "status", "totalAmount", "currency", "tenantId", "expiresAt", "createdAt", "updatedAt"],
      [[1, 3, 9, "converted", "987350.00", "NGN", TENANT_ID, daysFromNow(7), daysAgo(2), now()]]);
    await ins(client, "insurance_cart_items",
      ["id", "cartId", "productId", "unitPrice", "totalPrice", "quantity", "coveragePeriodMonths", "addedAt"],
      [[1, 1, 3, "987350.00", "987350.00", 1, 12, daysAgo(2)]]);
    await ins(client, "policy_orders",
      ["id", "orderRef", "customerId", "agentId", "cartId", "status", "totalAmount", "currency", "paymentMethod", "paymentRef", "paymentStatus", "tenantId", "createdAt", "updatedAt"],
      [[1, "ORD-2026-0001", 3, 9, 1, "completed", "987350.00", "NGN", "transfer", "PMT-2026-0003", "paid", TENANT_ID, daysAgo(2), now()]]);
    await ins(client, "insurance_order_items",
      ["id", "orderId", "productId", "unitPrice", "totalPrice", "policyId", "quantity", "coveragePeriodMonths", "createdAt"],
      [[1, 1, 3, "987350.00", "987350.00", 3, 1, 12, daysAgo(2)]]);
    await ins(client, "insurance_inventory",
      ["id", "productId", "sku", "quantityAvailable", "quantityReserved", "reorderPoint", "tenantId", "updatedAt"],
      [
        [1, 1, "SKU-MTR-COMP-001", 500, 12, 50, TENANT_ID, now()],
        [2, 2, "SKU-HLT-FAM-001",  300, 5,  30, TENANT_ID, now()],
      ]);

    // ══════════════════════ COMMISSIONS / FEES / LIMITS ══════════════════════

    // ── 53. Commission Rules, Tiers & Splits (reference data) ─────────────────
    await ins(client, "commission_rules",
      ["id", "name", "txType", "ruleType", "value", "minAmount", "maxAmount", "agentTier", "isActive", "effectiveFrom", "createdAt", "updatedAt"],
      [
        [1, "Cash In Standard",   "Cash In",      "percentage", "0.5000", "100.00", "5000.00",  null,      true, daysAgo(90), daysAgo(90), now()],
        [2, "Cash Out Standard",  "Cash Out",     "percentage", "1.0000", "200.00", "10000.00", null,      true, daysAgo(90), daysAgo(90), now()],
        [3, "Bill Payment Flat",  "Bill Payment", "flat",       "100.0000", "50.00", "3000.00", null,      true, daysAgo(90), daysAgo(90), now()],
        [4, "Transfer Platinum",  "Transfer",     "percentage", "0.8000", "100.00", "8000.00",  "Platinum", true, daysAgo(90), daysAgo(90), now()],
      ]);
    await ins(client, "commission_tiers",
      ["id", "tier_id", "name", "transaction_type", "min_volume", "max_volume", "rate", "flat_fee", "bonus_rate", "agent_role", "is_active", "effective_from", "created_at", "updated_at"],
      [
        [1, "CT-01", "Bronze Standard",   "Cash In", "0.00",        "5000000.00",  "0.4000", "0.00",  "0.0000", "agent",        true, daysAgo(90), daysAgo(90), now()],
        [2, "CT-02", "Silver Standard",   "Cash In", "5000000.00",  "20000000.00", "0.5000", "0.00",  "0.0500", "agent",        true, daysAgo(90), daysAgo(90), now()],
        [3, "CT-03", "Gold Standard",     "Cash In", "20000000.00", "999999999.00", "0.6000", "0.00",  "0.1000", "agent",        true, daysAgo(90), daysAgo(90), now()],
        [4, "CT-04", "Master Agent Override", "Cash In", "0.00",    "999999999.00", "0.1000", "0.00",  "0.0000", "master_agent", true, daysAgo(90), daysAgo(90), now()],
      ]);
    await ins(client, "commission_splits",
      ["id", "split_id", "transaction_type", "super_agent_share", "master_agent_share", "agent_share", "sub_agent_share", "platform_share", "is_active", "effective_from", "created_at", "updated_at"],
      [
        [1, "SPL-DEF", "default",  "10.00", "5.00", "60.00", "5.00", "20.00", true, daysAgo(90), daysAgo(90), now()],
        [2, "SPL-INS", "Insurance", "8.00", "4.00", "63.00", "5.00", "20.00", true, daysAgo(90), daysAgo(90), now()],
      ]);

    // ── 54. Commissions (earned) & Cascade History & Payouts & Clawbacks ──────
    await ins(client, "commissions",
      ["id", "agentId", "transactionId", "commissionType", "grossAmount", "taxAmount", "netAmount", "currency", "status", "periodStart", "periodEnd", "tenantId", "createdAt", "updatedAt"],
      [
        [1, 1, 1, "transaction", "100.00",  "7.50",  "92.50",   "NGN", "paid",    daysAgo(30), daysAgo(1), String(TENANT_ID), daysAgo(1), now()],
        [2, 2, 2, "transaction", "560.00",  "42.00", "518.00",  "NGN", "paid",    daysAgo(30), daysAgo(1), String(TENANT_ID), daysAgo(2), now()],
        [3, 3, 5, "transaction", "2400.00", "180.00","2220.00", "NGN", "pending", daysAgo(7),  now(),       String(TENANT_ID), daysAgo(5), now()],
        [4, 9, null, "policy_referral", "73500.00", "5512.50", "67987.50", "NGN", "pending", daysAgo(7), now(), String(TENANT_ID), daysAgo(2), now()],
      ]);
    await ins(client, "commission_cascade_history",
      ["id", "transactionId", "transactionRef", "transactionType", "transactionAmount", "totalCommission", "originAgentId", "originAgentCode", "recipientAgentId", "recipientAgentCode", "recipientHierarchyRole", "recipientHierarchyLevel", "splitPercentage", "commissionAmount", "status", "creditedAt", "tenantId", "createdAt"],
      [
        [1, 1, "TXN-SEED-0001", "Cash In", "50000.00", "250.00", 1, "AGT001", 1,  1, "agent",        3, "60.00", "150.00", "credited", daysAgo(1), TENANT_ID, daysAgo(1)],
        [2, 1, "TXN-SEED-0001", "Cash In", "50000.00", "250.00", 1, "AGT001", 3,  "AGT003", "master_agent", 2, "5.00",  "12.50",  "credited", daysAgo(1), TENANT_ID, daysAgo(1)],
        [3, 1, "TXN-SEED-0001", "Cash In", "50000.00", "250.00", 1, "AGT001", 12, "AGT012", "super_agent",  1, "10.00", "25.00",  "credited", daysAgo(1), TENANT_ID, daysAgo(1)],
      ]);
    await ins(client, "commission_payouts",
      ["id", "agent_code", "amount", "currency", "status", "requested_by", "approved_by", "bank_code", "account_number", "account_name", "nuban_ref", "processed_at", "created_at", "updated_at"],
      [
        [1, "AGT001", "20000.00", "NGN", "completed", 1, 16, "058", "0123456001", "Emeka Obi",   "NUBAN-DEMO-0001", daysAgo(7), daysAgo(8), now()],
        [2, "AGT003", "50000.00", "NGN", "pending",   3, null, null, null,          null,          null,              null,       daysAgo(1), now()],
      ]);
    await ins(client, "commission_clawbacks",
      ["id", "reversal_request_id", "agent_id", "original_commission", "clawback_amount", "cascade_level", "status", "applied_at", "created_at"],
      [
        [1, 1, 1, "25.00", "25.00", "agent",        "applied", daysAgo(2), daysAgo(3)],
        [2, 1, 3, "1.25",  "1.25",  "master_agent", "applied", daysAgo(2), daysAgo(3)],
      ]);
    await ins(client, "commission_audit_trail",
      ["id", "entity_type", "entity_id", "action", "previous_value", "new_value", "performed_by", "reason", "ip_address", "created_at"],
      [
        [1, "commission_rule", "1", "update", J({ value: "0.4500" }), J({ value: "0.5000" }), "ADMIN1", "Rate review Q2 (demo)", "197.210.54.2", daysAgo(30)],
        [2, "commission_payout", "1", "approve", J({ status: "pending" }), J({ status: "approved" }), "ADMIN1", "Monthly payout run (demo)", "197.210.54.2", daysAgo(7)],
      ]);

    // ── 55. Fee Rules & Fee Audit Trail ───────────────────────────────────────
    await ins(client, "fee_rules",
      ["id", "name", "tx_type", "fee_type", "fee_value", "agent_tier", "min_amount", "max_amount", "min_fee", "max_fee", "is_active", "priority", "created_by", "created_at", "updated_at"],
      [
        [1, "Standard Cash In Fee",  "Cash In",  "percentage", "0.5000", null,   "100.00",   "5000000.00", "50.00", "10000.00", true, 1, 16, daysAgo(90), now()],
        [2, "Standard Cash Out Fee", "Cash Out", "percentage", "1.0000", null,   "200.00",   "5000000.00", "100.00","25000.00", true, 1, 16, daysAgo(90), now()],
        [3, "Platinum Transfer Fee", "Transfer", "flat",       "50.0000","Platinum", null,   null,         "0.00",  "50.00",    true, 2, 16, daysAgo(90), now()],
      ]);
    await ins(client, "fee_audit_trail",
      ["id", "transaction_id", "fee_rule_id", "tx_amount", "calculated_fee", "applied_fee", "waiver_applied", "waiver_reason", "created_at"],
      [
        [1, 1, 1, "50000.00",   "250.00",  "250.00",  false, null, daysAgo(1)],
        [2, 2, 2, "280000.00",  "1400.00", "1400.00", false, null, daysAgo(2)],
        [3, 5, 1, "1200000.00", "6000.00", "6000.00", false, null, daysAgo(5)],
      ]);

    // ── 56. Velocity & Transaction Limits (reference data) ────────────────────
    await ins(client, "velocity_limits",
      ["id", "tier", "maxTxPerHour", "maxSingleTxAmount", "maxDailyVolume", "updatedAt"],
      [
        [1, "Bronze",   10, "50000.00",   "300000.00",   now()],
        [2, "Silver",   20, "200000.00",  "1000000.00",  now()],
        [3, "Gold",     30, "1000000.00", "5000000.00",  now()],
        [4, "Platinum", 50, "5000000.00", "20000000.00", now()],
      ]);
    await ins(client, "transaction_limits",
      ["id", "agent_tier", "tx_type", "daily_limit", "monthly_limit", "per_tx_limit", "is_active", "created_at", "updated_at"],
      [
        [1, "Bronze",   "Cash Out", "300000.00",   "3000000.00",  "50000.00",   true, daysAgo(90), now()],
        [2, "Silver",   "Cash Out", "1000000.00",  "15000000.00", "200000.00",  true, daysAgo(90), now()],
        [3, "Gold",     "Cash Out", "5000000.00",  "50000000.00", "1000000.00", true, daysAgo(90), now()],
        [4, "Platinum", "Cash Out", "20000000.00", "200000000.00","5000000.00", true, daysAgo(90), now()],
      ]);

    // ── 57. Premium Fee Schedules ─────────────────────────────────────────────
    await ins(client, "premium_fee_schedules",
      ["id", "tenantId", "productType", "feeType", "feeValue", "minFee", "maxFee", "description", "isActive", "createdAt", "updatedAt"],
      [
        [1, TENANT_ID, "motor",    "percentage", "2.5000", "500.00", "100000.00", "Motor policy admin fee (demo)",    true, daysAgo(90), now()],
        [2, TENANT_ID, "health",   "flat",       "1000.0000", "500.00", "5000.00", "Health plan enrolment fee (demo)", true, daysAgo(90), now()],
        [3, TENANT_ID, "life",     "percentage", "1.5000", "500.00", "50000.00",  "Life policy admin fee (demo)",     true, daysAgo(90), now()],
      ]);

    // ══════════════════════ PLATFORM BILLING / REVENUE ═══════════════════════

    // ── 58. Platform Billing Ledger (platform revenue per transaction) ────────
    await ins(client, "platform_billing_ledger",
      ["id", "transaction_id", "transaction_ref", "transaction_type", "agent_id", "gross_amount", "gross_fee", "agent_commission", "switch_fee", "aggregator_fee", "platform_net_fee", "client_revenue", "platform_revenue", "billing_model", "currency", "region", "processed_at", "created_at"],
      [
        [1, 1, "TXN-SEED-0001", "Cash In",  1, "50000.00",   "250.00",  "100.00", "25.00", "12.50", "112.50", "137.50", "112.50", "revenue_share", "NGN", "Lagos", daysAgo(1), daysAgo(1)],
        [2, 2, "TXN-SEED-0002", "Cash Out", 2, "280000.00",  "1400.00", "560.00", "140.00","70.00",  "630.00", "770.00", "630.00", "revenue_share", "NGN", "Kano",  daysAgo(2), daysAgo(2)],
        [3, 5, "TXN-SEED-0005", "Cash In",  3, "1200000.00", "6000.00", "2400.00","600.00","300.00", "2700.00", "3300.00","2700.00","revenue_share", "NGN", "Anambra", daysAgo(5), daysAgo(5)],
      ]);

    // ── 59. Billing Revenue Periods & Reconciliation Reports ──────────────────
    await ins(client, "billing_revenue_periods",
      ["id", "period_type", "period_start", "period_end", "transaction_count", "gross_volume", "total_fees", "total_client_revenue", "total_platform_revenue", "total_agent_commissions", "active_agents", "billing_model", "currency", "computed_at"],
      [
        [1, "monthly", daysAgo(43), daysAgo(13), 21450, "182000000.00", "910000.00", "500500.00", "318500.00", "364000.00", 847, "revenue_share", "NGN", daysAgo(12)],
        [2, "weekly",  daysAgo(13), daysAgo(6),  5120,  "43500000.00",  "217500.00", "119625.00", "76125.00",  "87000.00",  812, "revenue_share", "NGN", daysAgo(5)],
      ]);
    await ins(client, "billing_reconciliation_reports",
      ["id", "report_period", "period_start", "period_end", "billing_model", "status", "projected_transactions", "projected_platform_revenue", "actual_transactions", "actual_platform_revenue", "revenue_variance_pct", "generated_by", "created_at"],
      [
        [1, "2026-06", daysAgo(43), daysAgo(13), "revenue_share", "resolved", 21000, "310000.00", 21450, "318500.00", "2.74", "ADMIN1", daysAgo(12)],
      ]);

    // ── 60. Tenant Billing Config & Provisioning ─────────────────────────────
    await ins(client, "tenant_billing_config",
      ["id", "tenant_id", "billing_model", "revenue_share_config", "currency", "effective_date", "auto_renew", "provisioned_at", "provisioned_by", "status", "last_modified_at", "last_modified_by"],
      [
        [1, TENANT_ID,  "revenue_share", J({ platformPct: 35, clientPct: 65 }), "NGN", daysAgo(90), true, daysAgo(90), 16, "active", now(), 16],
        [2, TENANT2_ID, "subscription",  J({ monthlyFeeNgn: 25000 }),           "NGN", daysAgo(14), true, daysAgo(14), 16, "active", now(), 16],
      ]);
    await ins(client, "billing_provisioning_history",
      ["id", "tenant_id", "step", "status", "details", "started_at", "completed_at"],
      [
        [1, TENANT2_ID, "create_tigerbeetle_accounts", "completed", J({ accounts: 3 }), daysAgo(14), daysAgo(14)],
        [2, TENANT2_ID, "seed_billing_config",         "completed", J({ model: "subscription" }), daysAgo(14), daysAgo(14)],
      ]);
    await ins(client, "billing_role_assignments",
      ["id", "user_id", "tenant_id", "billing_role", "granted_by", "permissions", "granted_at", "is_active"],
      [
        [1, 16, TENANT_ID, "platform_admin", 16, J(["view_ledger", "record_split", "run_reconciliation"]), daysAgo(90), true],
        [2, 17, TENANT_ID, "billing_analyst", 16, J(["view_ledger", "view_dashboard"]), daysAgo(60), true],
      ]);
    await ins(client, "billing_audit_log",
      ["id", "tenant_id", "user_id", "user_name", "action", "resource_type", "resource_id", "after_state", "ip_address", "notification_sent", "created_at"],
      [
        [1, TENANT_ID, 16, "Admin User", "config_created", "tenant_billing_config", "1", J({ billing_model: "revenue_share" }), "197.210.54.2", true, daysAgo(90)],
        [2, TENANT_ID, 16, "Admin User", "reconciliation_run", "billing_reconciliation_report", "1", J({ report: "2026-06" }), "197.210.54.2", true, daysAgo(12)],
      ]);

    // ══════════════════════ FINANCE / GL / SETTLEMENTS ═══════════════════════

    // ── 61. Chart of Accounts & Journal ───────────────────────────────────────
    await ins(client, "gl_accounts",
      ["id", "account_code", "account_name", "account_type", "currency", "balance", "is_active", "description", "created_at", "updated_at"],
      [
        [1, "1000", "Cash & Float",          "asset",     "NGN", "42500000.00", true, "Agent float and vault cash (demo)",      daysAgo(90), now()],
        [2, "2000", "Customer Wallet Liab.", "liability", "NGN", "31800000.00", true, "Customer wallet balances (demo)",        daysAgo(90), now()],
        [3, "4000", "Fee Income",            "revenue",   "NGN", "910000.00",   true, "Transaction fee income (demo)",          daysAgo(90), now()],
        [4, "4100", "Premium Income",        "revenue",   "NGN", "1520000.00",  true, "Insurance premium income (demo)",        daysAgo(90), now()],
        [5, "5000", "Commission Expense",    "expense",   "NGN", "364000.00",   true, "Agent commission expense (demo)",        daysAgo(90), now()],
      ]);
    await ins(client, "gl_journal_entries",
      ["id", "entry_number", "description", "debit_account_id", "credit_account_id", "amount", "currency", "reference_type", "reference_id", "posted_by", "status", "posted_at", "created_at"],
      [
        [1, "JE-2026-0001", "Fee income — TXN-SEED-0001 (demo)", 1, 3, 25000,   "NGN", "transaction", "TXN-SEED-0001", "system", "posted", daysAgo(1), daysAgo(1)],
        [2, "JE-2026-0002", "Premium income — POL-2026-0002 (demo)", 1, 4, 18000000, "NGN", "premium_payment", "PMT-2026-0002", "system", "posted", daysAgo(90), daysAgo(90)],
        [3, "JE-2026-0003", "Commission payout — AGT001 (demo)", 5, 1, 2000000, "NGN", "commission_payout", "1", "system", "posted", daysAgo(7), daysAgo(7)],
      ]);
    await ins(client, "gl_entries",
      ["id", "account_code", "account_name", "entry_type", "amount", "reference", "period_date", "currency", "description", "posted_by", "is_reversed", "created_at"],
      [
        [1, "4000", "Fee Income",         "credit", "250.00",    "TXN-SEED-0001", daysAgo(1),  "NGN", "Transaction fee (demo)",      16, false, daysAgo(1)],
        [2, "1000", "Cash & Float",       "debit",  "250.00",    "TXN-SEED-0001", daysAgo(1),  "NGN", "Fee settlement (demo)",       16, false, daysAgo(1)],
        [3, "5000", "Commission Expense", "debit",  "20000.00",  "PAYOUT-AGT001", daysAgo(7),  "NGN", "Commission payout (demo)",    16, false, daysAgo(7)],
      ]);

    // ── 62. P&L Reports ───────────────────────────────────────────────────────
    await ins(client, "pnl_reports",
      ["id", "period", "period_type", "agent_id", "region_code", "total_revenue", "total_commission", "total_fees", "operating_costs", "net_margin", "tx_count", "tx_volume", "created_at"],
      [
        [1, "2026-06", "monthly", null, "LAGOS",  "546000.00", "218400.00", "910000.00", "150000.00", "177600.00", 12870, "109200000.00", daysAgo(12)],
        [2, "2026-06", "monthly", null, "KANO",   "119625.00", "47850.00",  "217500.00", "45000.00",  "26775.00",  5120,  "43500000.00",  daysAgo(12)],
      ]);

    // ── 63. VAT Records ───────────────────────────────────────────────────────
    await ins(client, "vat_records",
      ["id", "transactionId", "agentId", "taxableAmount", "vatAmount", "vatRate", "rateType", "period", "tinNumber", "remittedAt", "createdAt"],
      [
        [1, "TXN-SEED-0001", 1, "250.00",  "18.75",  "7.5", "standard", "2026-07", "TIN-DEMO-001", null,        daysAgo(1)],
        [2, "TXN-SEED-0002", 2, "1400.00", "105.00", "7.5", "standard", "2026-07", "TIN-DEMO-001", null,        daysAgo(2)],
        [3, "TXN-SEED-0005", 3, "6000.00", "450.00", "7.5", "standard", "2026-06", "TIN-DEMO-001", daysAgo(6),  daysAgo(5)],
      ]);

    // ── 64. Merchant Settlements, Payouts & KYC ──────────────────────────────
    await ins(client, "merchant_settlements",
      ["id", "merchantId", "period", "grossAmount", "feeAmount", "netAmount", "currency", "status", "settledAt", "bankRef", "createdAt"],
      [
        [1, 1, "2026-06-W2", "250000.00", "3750.00", "246250.00", "NGN", "completed", daysAgo(6), "SET-DEMO-0001", daysAgo(7)],
        [2, 2, "2026-06-W2", "180000.00", "2700.00", "177300.00", "NGN", "completed", daysAgo(6), "SET-DEMO-0002", daysAgo(7)],
      ]);
    await ins(client, "merchant_payouts",
      ["id", "merchant_id", "amount", "currency", "bank_code", "account_number", "account_name", "reference", "period_start", "period_end", "status", "processed_at", "tx_count", "created_at"],
      [
        [1, 1, "246250.00", "NGN", "058", "0123456781", "Sunshine Supermarket", "PAY-MER-0001", daysAgo(13), daysAgo(6), "completed", daysAgo(6), 42, daysAgo(6)],
        [2, 2, "177300.00", "NGN", "058", "0123456782", "QuickFuel Station",    "PAY-MER-0002", daysAgo(13), daysAgo(6), "completed", daysAgo(6), 31, daysAgo(6)],
      ]);
    await ins(client, "merchant_kyc_docs",
      ["id", "merchant_id", "doc_type", "doc_url", "status", "verified_by", "verified_at", "expires_at", "created_at"],
      [
        [1, 1, "cac_certificate", "https://cdn.insureportal.ng/demo/merchant-kyc/mer001-cac.pdf", "verified", 16, daysAgo(28), null,              daysAgo(30)],
        [2, 1, "tin_letter",      "https://cdn.insureportal.ng/demo/merchant-kyc/mer001-tin.pdf", "verified", 16, daysAgo(28), null,              daysAgo(30)],
        [3, 2, "cac_certificate", "https://cdn.insureportal.ng/demo/merchant-kyc/mer002-cac.pdf", "pending",  null, null,       daysFromNow(365), daysAgo(10)],
      ]);

    // ── 65. Settlement & File Reconciliation ─────────────────────────────────
    await ins(client, "settlement_reconciliation",
      ["id", "settlement_date", "agent_id", "agent_code", "expected_amount", "actual_amount", "discrepancy", "status", "resolved_by", "resolution_note", "resolved_at", "created_at"],
      [
        [1, "2026-08-11", 1, "AGT001", "850000.00", "850000.00", "0.00",     "matched",    null, null,                               null,       daysAgo(1)],
        [2, "2026-08-10", 4, "AGT004", "118500.00", "120000.00", "1500.00",  "discrepancy", 17,   "Timing diff on evening batch (demo)", daysAgo(1), daysAgo(2)],
      ]);
    await ins(client, "reconciliation_batches",
      ["id", "batch_reference", "source_type", "file_name", "total_records", "matched_count", "unmatched_count", "discrepancy_count", "total_amount", "status", "processed_by", "processed_at", "created_at"],
      [
        [1, "BATCH-2026-0701", "switch_file", "switch-settlement-20260701.csv", 412, 408, 4, 2, "38400000.00", "completed", 16, daysAgo(11), daysAgo(11)],
      ]);
    await ins(client, "reconciliation_items",
      ["id", "batch_id", "external_ref", "external_amount", "match_status", "internal_ref", "internal_amount", "discrepancy", "resolution", "resolved_by", "resolved_at", "created_at"],
      [
        [1, 1, "SW-88412", "50000.00", "matched",     "TXN-SEED-0001", "50000.00", "0.00",   null,                              null, null,       daysAgo(11)],
        [2, 1, "SW-88420", "5000.00",  "discrepancy", "TXN-SEED-0003", "5000.00",  "25.00",  "Fee not netted at switch (demo)", 17,   daysAgo(10), daysAgo(11)],
      ]);

    // ══════════════════════ COMMS / NOTIFICATIONS ════════════════════════════

    // ── 66. Email Queue & Delivery Log ────────────────────────────────────────
    await ins(client, "email_queue",
      ["id", "toAddress", "toName", "subject", "templateName", "templateData", "status", "sentAt", "tenantId", "createdAt"],
      [
        [1, "agt001@insureportal.ng",   "Emeka Obi",     "Transaction Receipt",            "tx_receipt",     J({ ref: "TXN-SEED-0001" }), "sent",   daysAgo(1), TENANT_ID, daysAgo(1)],
        [2, "agt002@insureportal.ng",   "Fatima Yusuf",  "Float Top-Up Approved",          "float_topup",    J({ amount: "200000" }),    "sent",   daysAgo(2), TENANT_ID, daysAgo(2)],
        [3, "admin@insureportal.ng",    "Admin User",    "Fraud Alert: High Risk Transaction", "fraud_alert", J({ alertId: 2 }),          "queued", null,       TENANT_ID, hoursAgo(3)],
      ]);
    await ins(client, "email_delivery_log",
      ["id", "email_queue_id", "provider", "to_address", "subject", "provider_message_id", "status", "opened_at", "created_at"],
      [
        [1, 1, "sendgrid", "agt001@insureportal.ng", "Transaction Receipt",            "sg-demo-0001", "delivered", daysAgo(1), daysAgo(1)],
        [2, 2, "sendgrid", "agt002@insureportal.ng", "Float Top-Up Approved",          "sg-demo-0002", "delivered", null,       daysAgo(2)],
        [3, 3, "sendgrid", "admin@insureportal.ng",  "Fraud Alert: High Risk Transaction", null,         "queued",     null,       hoursAgo(3)],
      ]);

    // ── 67. Notification Channels, Logs & Dispatch Log ────────────────────────
    await ins(client, "notification_channels",
      ["id", "name", "channel_type", "config", "is_active", "priority", "created_at", "updated_at"],
      [
        [1, "SendGrid Email",   "email", J({ provider: "sendgrid", from: "no-reply@insureportal.ng" }), true, 1, daysAgo(90), now()],
        [2, "Termii SMS",       "sms",   J({ senderId: "InsurePortal" }),                                  true, 2, daysAgo(90), now()],
        [3, "FCM Push",         "push",  J({ fcmKey: "demo-fcm-key" }),                                   true, 3, daysAgo(90), now()],
      ]);
    await ins(client, "notification_logs",
      ["id", "channel_id", "recipient_id", "recipient_type", "subject", "body", "status", "sent_at", "delivered_at", "created_at"],
      [
        [1, 2, 1, "agent", "Float Approved", "Your float top-up of ₦500,000 was approved. (demo)", "delivered", daysAgo(9), daysAgo(9), daysAgo(9)],
        [2, 3, "AGT002", "agent", "Fraud Alert",    "Unusual activity detected on your account. (demo)",  "delivered", daysAgo(2), daysAgo(2), daysAgo(2)],
      ]);
    await ins(client, "notification_dispatch_log",
      ["id", "recipient_type", "recipient_id", "channel", "template_id", "subject", "body", "status", "external_id", "retry_count", "delivered_at", "created_at"],
      [
        [1, "agent",    1, "sms",   "float_topup", "Float Approved", "Your float top-up of ₦500,000 was approved. (demo)", "delivered", "termii-demo-001", 0, daysAgo(9), daysAgo(9)],
        [2, "agent",    2, "push",  "fraud_alert", "Fraud Alert",    "Unusual activity detected on your account. (demo)",  "delivered", "fcm-demo-002",    0, daysAgo(2), daysAgo(2)],
        [3, "customer", 1, "email", "policy_welcome", "Welcome to InsurePortal", "Your motor policy POL-2026-0001 is active. (demo)", "delivered", "sg-demo-003", 0, daysAgo(119), daysAgo(119)],
      ]);

    // ── 68. In-App Notifications (schema.additions.ts) ────────────────────────
    await ins(client, "notifications",
      ["id", "userId", "type", "title", "message", "channel", "status", "sentAt", "createdAt"],
      [
        [1, 1,  "float",  "Float Approved",       "Your float top-up of ₦500,000 was approved. (demo)",            "inapp", "read",   daysAgo(9), daysAgo(9)],
        [2, 2,  "fraud",  "Fraud Alert",          "Unusual activity detected on your account. (demo)",             "inapp", "unread", daysAgo(2), daysAgo(2)],
        [3, 16, "system", "Daily Settlement Done","Settlement batch BATCH-2026-0701 completed. (demo)",            "inapp", "read",   daysAgo(11), daysAgo(11)],
      ]);

    // ══════════════════════ PLATFORM CONFIG / TENANCY ════════════════════════

    // ── 69. Platform Settings & System Config ─────────────────────────────────
    await ins(client, "platform_settings",
      ["id", "key", "value", "description", "updatedBy", "updatedAt"],
      [
        [1, "maintenance_mode",       "false",                      "Enable/disable maintenance mode",          "ADMIN1", now()],
        [2, "max_daily_transactions", "1000",                       "Max transactions per agent per day",       "ADMIN1", now()],
        [3, "support_phone",          "+234-800-54LINK",            "Customer support phone number",            "ADMIN1", now()],
        [4, "support_email",          "support@insureportal.ng",    "Customer support email",                   "ADMIN1", now()],
        [5, "app_version_min",        "3.0.0",                      "Minimum required app version",             "ADMIN1", now()],
      ]);
    await ins(client, "system_config",
      ["id", "key", "value", "description", "updatedBy", "createdAt", "updatedAt"],
      [
        [1, "feature_flags", J({ biometricAuth: true, virtualCards: true, recurringPayments: true, fxRateLock: true, creditScoring: true }), "Global feature flags (demo)", "ADMIN1", daysAgo(90), now()],
        [2, "settlement_schedule", J({ frequency: "daily", cutoffTime: "22:00", timezone: "Africa/Lagos" }), "Settlement schedule (demo)", "ADMIN1", daysAgo(90), now()],
      ]);

    // ── 70. Tenant Users, Branding & Feature Toggles ──────────────────────────
    await ins(client, "tenant_users",
      ["id", "tenantId", "userId", "email", "name", "role", "isActive", "invitedBy", "invitedAt", "acceptedAt", "createdAt", "updatedAt"],
      [
        [1, TENANT_ID, 16, "admin1@insureportal.ng", "Admin User",     "tenant_admin",    true, null, daysAgo(90), daysAgo(90), daysAgo(90), now()],
        [2, TENANT_ID, 17, "sup001@insureportal.ng", "Supervisor Ade", "tenant_operator", true, 16, daysAgo(60), daysAgo(60), daysAgo(60), now()],
        [3, TENANT2_ID, null, "hello@acmebrokers.ng", "Acme Admin",    "tenant_admin",    true, 16, daysAgo(14), daysAgo(14), daysAgo(14), now()],
      ]);
    await ins(client, "tenant_branding",
      ["id", "tenantId", "brandName", "tagline", "primaryColor", "secondaryColor", "supportEmail", "supportPhone", "isLive", "createdAt", "updatedAt"],
      [
        [1, TENANT_ID,  "InsurePortal", "Insurance at every corner", "#0B5FFF", "#00B894", "support@insureportal.ng", "+234-800-54LINK", true, daysAgo(90), now()],
        [2, TENANT2_ID, "Acme Brokers", "Broking made simple",       "#6C2BD9", "#F59E0B", "hello@acmebrokers.ng",    "+2348000000002",  false, daysAgo(14), now()],
      ]);
    await ins(client, "tenant_feature_toggles",
      ["id", "tenant_id", "feature_key", "enabled", "config", "enabled_by", "enabled_at", "created_at"],
      [
        [1, TENANT_ID,  "insurance_marketplace", true,  J({ maxProducts: 20 }),  16, daysAgo(90), daysAgo(90)],
        [2, TENANT_ID,  "nano_loans",            true,  J({ maxPrincipal: 500000 }), 16, daysAgo(60), daysAgo(60)],
        [3, TENANT2_ID, "insurance_marketplace", true,  J({}),                   16, daysAgo(14), daysAgo(14)],
        [4, TENANT2_ID, "nano_loans",            false, null,                    null,     null,         daysAgo(14)],
      ]);

    // ── 71. Audit Log ─────────────────────────────────────────────────────────
    await ins(client, "audit_log",
      ["id", "agentId", "action", "resource", "resourceId", "ipAddress", "status", "metadata", "tenantId", "createdAt"],
      [
        [1, "AGT001", "login",              "agent_session", null,    "41.58.12.34",  "success", J({ source: "seed-demo" }), TENANT_ID, hoursAgo(6)],
        [2, "AGT001", "transaction_create", "transactions",  "1",     "41.58.12.34",  "success", J({ source: "seed-demo" }), TENANT_ID, daysAgo(1)],
        [3, "ADMIN1", "float_approve",      "float_topup",   "1",     "197.210.54.2", "success", J({ source: "seed-demo" }), TENANT_ID, daysAgo(10)],
        [4, "AGT002", "pin_reset",          "agent_auth",    null,    "105.112.8.91", "success", J({ source: "seed-demo" }), TENANT_ID, daysAgo(4)],
        [5, "ADMIN1", "agent_suspend",      "agents",        "8",     "197.210.54.2", "warning", J({ source: "seed-demo" }), TENANT_ID, daysAgo(12)],
        [6, "ADMIN1", "settlement_run",     "settlement",    "1",     "197.210.54.2", "success", J({ source: "seed-demo" }), TENANT_ID, daysAgo(11)],
      ]);

    // ── 72. Chat Sessions & Messages ──────────────────────────────────────────
    await ins(client, "chat_sessions",
      ["id", "sessionRef", "agentId", "category", "subject", "status", "supportAgentName", "rating", "resolvedAt", "createdAt", "updatedAt"],
      [
        [1, "CHAT-DEMO-001", 1, "float",   "Float balance discrepancy",    "resolved", "Support Chika", 5, daysAgo(2), daysAgo(3), now()],
        [2, "CHAT-DEMO-002", 2, "reversal","Transaction reversal request", "open",     "Support Chika", null, null,      hoursAgo(5), now()],
        [3, "CHAT-DEMO-003", 4, "auth",    "PIN reset assistance",         "resolved", "Support Musa",  4, daysAgo(6), daysAgo(7), now()],
      ]);
    await ins(client, "chat_messages",
      ["id", "sessionId", "senderType", "senderName", "content", "isRead", "createdAt"],
      [
        [1, 1, "agent",   "Emeka Obi",      "Hello, I need help with: Float balance discrepancy", true, daysAgo(3)],
        [2, 1, "support", "Support Chika",  "Thank you for reaching out. I'll help you resolve this right away.", true, daysAgo(3)],
        [3, 1, "support", "Support Chika",  "This issue has been resolved. Anything else?", true, daysAgo(2)],
        [4, 2, "agent",   "Fatima Yusuf",   "Please reverse TXN-SEED-0006 — duplicate charge.", false, hoursAgo(5)],
        [5, 3, "agent",   "Amaka Eze",      "I forgot my PIN and I'm locked out.", true, daysAgo(7)],
      ]);

    // ══════════════════════ CUSTOMER / GROWTH ════════════════════════════════

    // ── 73. QR Codes & Shareable Links ────────────────────────────────────────
    await ins(client, "qr_codes",
      ["id", "code", "type", "status", "agentId", "amount", "currency", "description", "expiresAt", "createdAt"],
      [
        [1, "QR-DEMO-AGT001-RECEIVE", "payment", "active", 1, null,       "NGN", "Agent receive-money QR (demo)", daysFromNow(30), daysAgo(10)],
        [2, "QR-DEMO-MER001-COLLECT", "collection", "active", null, "25000.00", "NGN", "Sunshine Supermarket checkout QR (demo)", daysFromNow(30), daysAgo(9)],
      ]);
    await ins(client, "shareable_links",
      ["id", "slug", "type", "status", "agentId", "amount", "currency", "description", "clickCount", "conversionCount", "expiresAt", "createdAt", "updatedAt"],
      [
        [1, "pay-agt001-demo", "payment",  "active", 1, null,       "NGN", "Pay Emeka Obi (demo)",              12, 3, daysFromNow(30), daysAgo(5), now()],
        [2, "quote-hlt-demo",  "invoice",  "active", 3, "180000.00","NGN", "Family Health Plan quote (demo)",   4,  1, daysFromNow(14), daysAgo(3), now()],
      ]);

    // ── 74. Rate Alerts (FX) ──────────────────────────────────────────────────
    await ins(client, "rate_alerts",
      ["id", "agent_id", "base_currency", "target_currency", "target_rate", "direction", "status", "current_rate", "note", "expires_at", "created_at", "updated_at"],
      [
        [1, 1, "NGN", "USD", "1550.00000000", "below", "active",    "1572.40000000", "Alert when naira strengthens below ₦1,550/$ (demo)", daysFromNow(30), daysAgo(6), now()],
        [2, 9, "NGN", "GBP", "2000.00000000", "above", "triggered", "2012.75000000", "Triggered 2 days ago (demo)",                        daysFromNow(30), daysAgo(9), now()],
      ]);

    // ── 75. Credit Scoring & Applications ─────────────────────────────────────
    await ins(client, "credit_score_history",
      ["id", "agentId", "score", "rating", "factors", "computedAt"],
      AGENTS.filter((a) => a.role === "agent").slice(0, 6).map((a, i) => [
        i + 1, a.id, 620 + a.id * 25, ["CCC", "B", "BB", "BBB", "A", "AA"][i],
        J({ transactionVolume: "high", defaultHistory: "none", accountAge: "2 years", demo: true }),
        daysAgo(30 - i * 4),
      ]));
    await ins(client, "credit_applications",
      ["id", "agentId", "requestedAmount", "approvedAmount", "interestRate", "termDays", "status", "scoreAtApplication", "reviewedBy", "reviewNote", "reviewedAt", "createdAt", "updatedAt"],
      [
        [1, 1, "200000.00", "200000.00", "3.5000", 30, "repaid",       720, "ADMIN1", "Good history (demo)",        daysAgo(46), daysAgo(47), now()],
        [2, 8, "50000.00",  null,        null,       14,  "pending",      610, null,     null,                        null,        daysAgo(1),  now()],
        [3, 3, "350000.00", "350000.00", "4.0000", 90, "disbursed",    820, "ADMIN1", "Device finance (demo)",       daysAgo(31), daysAgo(32), now()],
      ]);

    // ── 76. Customer Feedback & Journeys ──────────────────────────────────────
    await ins(client, "customer_feedback_nps",
      ["id", "customerId", "score", "feedback", "channel", "policyId", "claimId", "createdAt"],
      [
        [1, 1, 9,  "Claims process was fast and clear (demo)", "app",         1, 1, daysAgo(8)],
        [2, 2, 10, "Agent was very helpful (demo)",            "ussd_survey", 2, 2, daysAgo(20)],
        [3, 4, 4,  "My claim is taking too long (demo)",       "app",         4, 3, daysAgo(2)],
      ]);
    await ins(client, "customer_journey_steps",
      ["id", "customer_id", "step_type", "status", "completed_at", "metadata", "created_at"],
      [
        [1, 1, "registration", "completed", daysAgo(45), null, daysAgo(45)],
        [2, 1, "kyc",          "completed", daysAgo(15), J({ level: 2 }), daysAgo(16)],
        [3, 1, "first_policy", "completed", daysAgo(120), J({ policyId: 1 }), daysAgo(120)],
        [4, 5, "kyc",          "in_progress", null, null, daysAgo(1)],
      ]);
    await ins(client, "customer_journey_events",
      ["id", "customer_id", "event_type", "event_source", "event_data", "session_id", "device_type", "channel", "created_at"],
      [
        [1, "1", "policy_viewed",    "web_portal", J({ productId: 1 }), "sess-demo-01", "mobile", "app", daysAgo(121)],
        [2, "1", "quote_requested",  "web_portal", J({ productId: 1 }), "sess-demo-01", "mobile", "app", daysAgo(121)],
        [3, "3", "quote_requested",  "agent_app",  J({ productId: 3 }), "sess-demo-02", "pos",    "agent", daysAgo(2)],
      ]);

    // ── 77. Data Rights, Consent & Export Jobs ────────────────────────────────
    await ins(client, "data_rights_requests",
      ["id", "requestType", "requesterId", "requesterType", "requesterEmail", "status", "exportFileUrl", "processedBy", "processedAt", "notes", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "access",       1, "customer", "emeka.okafor@example.ng", "completed", "https://cdn.insureportal.ng/demo/exports/cust1-access.zip", "ADMIN1", daysAgo(10), "NDPR access request (demo)", TENANT_ID, daysAgo(12), now()],
        [2, "portability",  2, "customer", "amina.hassan@example.ng", "pending",   null, null, null, "NDPR portability request (demo)", TENANT_ID, daysAgo(2), now()],
      ]);
    await ins(client, "data_consent_records",
      ["id", "entity_type", "entity_id", "consent_type", "granted", "granted_at", "version", "ip_address", "created_at"],
      [
        [1, "customer", 1, "marketing",    true,  daysAgo(45), 2, "41.58.12.34", daysAgo(45)],
        [2, "customer", 1, "data_sharing", true,  daysAgo(45), 2, "41.58.12.34", daysAgo(45)],
        [3, "customer", 4, "marketing",    false, null,          2, null,          daysAgo(20)],
      ]);
    await ins(client, "data_export_jobs",
      ["id", "name", "export_type", "requested_by", "format", "status", "file_url", "record_count", "started_at", "completed_at", "expires_at", "created_at"],
      [
        [1, "June transactions export (demo)", "transactions", "ADMIN1", "csv", "completed", "https://cdn.insureportal.ng/demo/exports/tx-2026-06.csv", 21450, daysAgo(12), daysAgo(12), daysFromNow(7), daysAgo(12)],
      ]);

    // ── 78. Training (courses & enrollments) ──────────────────────────────────
    await ins(client, "training_courses",
      ["id", "title", "category", "content_type", "description", "content_url", "duration_minutes", "passing_score", "is_mandatory", "is_active", "version", "created_by", "created_at"],
      [
        [1, "AML/CFT Basics for Agents",     "compliance", "video",    "Anti-money-laundering fundamentals (demo)", "https://cdn.insureportal.ng/demo/training/aml-basics.mp4", 45, 80, true,  true, 2, 16, daysAgo(90)],
        [2, "Selling Motor Insurance",       "sales",      "document", "Motor product playbook (demo)",            "https://cdn.insureportal.ng/demo/training/motor-playbook.pdf", 30, 70, false, true, 1, 16, daysAgo(90)],
      ]);
    await ins(client, "training_enrollments",
      ["id", "course_id", "agent_id", "status", "progress", "score", "started_at", "completed_at", "certificate_url", "created_at"],
      [
        [1, 1, 1,  "completed",   100, 92, daysAgo(28), daysAgo(28), "https://cdn.insureportal.ng/demo/certs/agt001-aml.pdf", daysAgo(29)],
        [2, 1, 15, "in_progress", 40,  null, daysAgo(3), null, null, daysAgo(3)],
        [3, 2, 9,  "completed",   100, 85, daysAgo(20), daysAgo(19), "https://cdn.insureportal.ng/demo/certs/agt009-motor.pdf", daysAgo(21)],
      ]);

    // ── 79. Workflow Definitions & Instances ──────────────────────────────────
    await ins(client, "workflow_definitions",
      ["id", "name", "category", "description", "steps", "sla_hours", "is_active", "version", "created_by", "created_at"],
      [
        [1, "Claim Review",      "claims", "Standard claim review workflow (demo)",  J(["submit", "assign", "review", "approve", "pay"]), 72, true, 2, 16, daysAgo(90)],
        [2, "Agent Onboarding",  "agents", "KYC-to-activation pipeline (demo)",      J(["profile", "kyc", "float", "terminal", "training", "activate"]), 168, true, 1, 16, daysAgo(90)],
      ]);
    await ins(client, "workflow_instances",
      ["id", "definition_id", "entity_type", "entity_id", "current_step", "status", "assigned_to", "started_at", "sla_deadline", "created_at"],
      [
        [1, 1, "claim", 1, 3, "in_progress", 17, daysAgo(8), daysFromNow(1), daysAgo(9)],
        [2, 2, "agent", 15, 2, "in_progress", 17, daysAgo(3), daysFromNow(4), daysAgo(3)],
        [3, 1, "claim", 2, 5, "completed",   17, daysAgo(28), daysAgo(21),  daysAgo(28)],
      ]);

    // ══════════════════════ ANALYTICS / OPS / OBSERVABILITY ══════════════════

    // ── 80. Analytics Metrics & Dashboards & BI Reports ───────────────────────
    const metricRows = [
      [1, "daily_transaction_volume", "4250000.0000", "NGN",     hoursAgo(1)],
      [2, "active_agents_today",      "847.0000",     "count",   hoursAgo(1)],
      [3, "avg_transaction_value",    "8500.0000",    "NGN",     hoursAgo(1)],
      [4, "fraud_detection_rate",     "99.2000",      "percent", hoursAgo(1)],
      [5, "uptime_percentage",        "99.9500",      "percent", hoursAgo(1)],
    ];
    await ins(client, "analytics_metrics",
      ["id", "metricName", "value", "bucketMinute", "tags", "createdAt"],
      metricRows.map((r) => [r[0], r[1], r[2], r[4], J({ unit: r[3], demo: true }), r[4]]));
    await ins(client, "analytics_dashboards",
      ["id", "name", "owner_id", "description", "is_public", "layout", "refresh_interval", "created_at", "updated_at"],
      [
        [1, "Ops Overview (demo)",      16, "Platform-wide operational KPIs", true,  J({ widgets: ["tx_volume", "active_agents", "fraud"] }), 300, daysAgo(60), now()],
        [2, "Insurance Sales (demo)",   16, "Policy and premium analytics",   false, J({ widgets: ["premium_income", "claims_ratio"] }),       600, daysAgo(45), now()],
      ]);
    await ins(client, "bi_report_definitions",
      ["id", "name", "report_type", "data_source", "description", "query", "schedule", "recipients", "is_active", "created_by", "created_at"],
      [
        [1, "Daily Transaction Summary", "scheduled", "transactions", "Daily tx volume by type/region (demo)", "SELECT date_trunc('day', \"createdAt\") d, count(*) FROM transactions GROUP BY 1", "0 6 * * *", J(["ops@insureportal.ng"]), true, 16, daysAgo(60)],
        [2, "Monthly Claims Ratio",      "scheduled", "claims",       "Claims paid vs premiums (demo)",        "SELECT 1", "0 8 1 * *", J(["actuary@insureportal.ng"]), true, 16, daysAgo(60)],
      ]);

    // ── 81. Platform Health, Incidents & Observability ────────────────────────
    await ins(client, "platform_health_checks",
      ["id", "service_name", "check_type", "status", "response_time", "status_code", "message", "checked_at"],
      [
        [1, "postgres",      "liveness",  "healthy",  4,   200, "Connection pool OK (demo)",       hoursAgo(1)],
        [2, "redis",         "liveness",  "healthy",  2,   200, "PING/PONG OK (demo)",             hoursAgo(1)],
        [3, "payment_switch","readiness", "degraded", 890, 200, "Elevated latency on switch (demo)", hoursAgo(2)],
      ]);
    await ins(client, "platform_incidents",
      ["id", "title", "description", "severity", "status", "affected_services", "root_cause", "resolution", "reported_by", "started_at", "resolved_at", "created_at", "updated_at"],
      [
        [1, "Elevated switch latency (demo)", "Payment switch latency above 800ms for 40 minutes.", "major", "resolved", J(["payment_switch", "transactions"]), "Upstream NIBSS maintenance window", "Latency normalised after maintenance ended.", "ADMIN1", daysAgo(2), daysAgo(2), daysAgo(2), now()],
      ]);
    await ins(client, "observability_alerts",
      ["id", "alert_name", "service", "severity", "metric", "threshold", "current_value", "status", "acknowledged_by", "acknowledged_at", "resolved_at", "created_at"],
      [
        [1, "High API latency",    "api-server", "warning",  "p95_latency_ms", "500.00",  "620.00", "resolved",     16, daysAgo(2), daysAgo(2), daysAgo(2)],
        [2, "DLQ depth growing",   "worker",     "critical", "dlq_messages",   "100.00",  "132.00", "acknowledged", 16, daysAgo(1), null,       daysAgo(1)],
      ]);

    // ── 82. Backup Snapshots ──────────────────────────────────────────────────
    await ins(client, "backup_snapshots",
      ["id", "snapshot_type", "triggered_by", "status", "size_bytes", "storage_url", "tables_included", "rows_backed_up", "duration_ms", "completed_at", "expires_at", "created_at"],
      [
        [1, "full",     "schedule", "completed", 2411724800, "s3://insureportal-backups/demo/full-20260701.snap", 186, 1840200, 480000, daysAgo(11), daysFromNow(19), daysAgo(11)],
        [2, "incremental", "schedule", "completed", 184963072, "s3://insureportal-backups/demo/incr-20260711.snap", 186, 41200,   62000,  daysAgo(1),  daysFromNow(6),  daysAgo(1)],
      ]);

    // ── 83. SLA Definitions & Breaches ────────────────────────────────────────
    await ins(client, "sla_definitions",
      ["id", "name", "service_type", "metric_type", "target_value", "warning_threshold", "critical_threshold", "measurement_window", "is_active", "created_at", "updated_at"],
      [
        [1, "API p95 latency",        "api",        "latency_ms",       500,  400, 800, "5m", true, daysAgo(90), now()],
        [2, "Dispute first response", "support",    "response_minutes", 60,   45,  120, "1d", true, daysAgo(90), now()],
      ]);
    await ins(client, "sla_breaches",
      ["id", "sla_definition_id", "breach_type", "actual_value", "target_value", "duration", "impact_level", "resolved_at", "resolution", "created_at"],
      [
        [1, 1, "latency", 620, 500, 2400, "minor", daysAgo(2), "Switch maintenance ended; latency normalised (demo)", daysAgo(2)],
        [2, 2, "response_time", 95, 60, null, "moderate", null, "Weekend staffing gap (demo)", daysAgo(3)],
      ]);

    // ── 84. DLQ Messages ──────────────────────────────────────────────────────
    await ins(client, "dlq_messages",
      ["id", "topic", "partition", "offset", "errorMessage", "retryCount", "payload", "status", "createdAt"],
      [
        [1, "transactions.completed", 0, 88123, "Connection timeout after 3 retries", 3, J({ ref: "TXN-SEED-0004", demo: true }), "pending", daysAgo(2)],
        [2, "notifications.push",     1, 44102, "FCM 503 Service Unavailable",        2, J({ notificationId: 2, demo: true }),  "pending", daysAgo(1)],
      ]);

    // ── 85. ERP & MQTT Integrations ───────────────────────────────────────────
    await ins(client, "erp_config",
      ["id", "erpType", "name", "baseUrl", "syncEnabled", "syncIntervalMinutes", "syncTransactions", "syncAgents", "lastSyncAt", "lastSyncStatus", "createdAt", "updatedAt"],
      [[1, "custom", "Demo ERPNext", "http://erpnext:8000", true, 15, true, true, daysAgo(1), "success", daysAgo(60), now()]]);
    await ins(client, "erp_sync_log",
      ["id", "entityType", "entityId", "erpDocType", "erpDocName", "status", "syncedAt", "retryCount", "createdAt"],
      [
        [1, "transaction", "TXN-SEED-0001", "Sales Invoice", "SINV-DEMO-0001", "synced", daysAgo(1), 0, daysAgo(1)],
        [2, "agent",       "AGT001",        "Employee",      "EMP-DEMO-0001",  "synced", daysAgo(20), 0, daysAgo(20)],
      ]);
    await ins(client, "mqtt_bridge_config",
      ["id", "name", "brokerUrl", "port", "useTls", "clientId", "topicMappings", "qos", "enabled", "lastTestAt", "lastTestStatus", "createdAt", "updatedAt"],
      [[1, "POS Shell Bridge (demo)", "mqtt://mqtt-broker", 1883, false, "pos-shell-bridge", J({ "pos/transactions": "transactions", "pos/alerts": "alerts" }), "1", true, daysAgo(1), "success", daysAgo(30), now()]]);

    // ── 86. Rate Limit Rules & Receipt Templates (reference data) ─────────────
    await ins(client, "rate_limit_rules",
      ["id", "endpoint", "method", "max_requests", "window_seconds", "burst_limit", "scope", "is_active", "created_at"],
      [
        [1, "/api/trpc/transactions.create", "POST", 10,  60,   5,  "agent", true, daysAgo(90)],
        [2, "/api/trpc/auth.login",          "POST", 5,   300,  2,  "ip",    true, daysAgo(90)],
        [3, "/api/trpc/*",                   "ALL",  100, 60,   20, "agent", true, daysAgo(90)],
      ]);
    await ins(client, "receipt_templates",
      ["id", "name", "channel", "headerTemplate", "bodyTemplate", "footerTemplate", "isDefault", "createdAt", "updatedAt"],
      [
        [1, "Standard POS Receipt (demo)", "pos", "InsurePortal DEMO", "Ref: {{ref}}\nAmount: ₦{{amount}}\nFee: ₦{{fee}}\nAgent: {{agentCode}}", "Thank you — demo receipt", true, daysAgo(90), now()],
        [2, "SMS Receipt (demo)",          "sms", null,                "InsurePortal: {{type}} ₦{{amount}} ref {{ref}}. Bal: ₦{{balance}}", null, true, daysAgo(90), now()],
      ]);

    // ── 87. Geo Fences (region-level reference data) ──────────────────────────
    await ins(client, "geo_fences",
      ["id", "name", "region_code", "center_lat", "center_lng", "radius_km", "is_active", "created_at"],
      [
        [1, "Lagos Metro",  "NG-LA", "6.5244000",  "3.3792000", "25.00", true, daysAgo(90)],
        [2, "Abuja FCT",    "NG-FC", "9.0579000",  "7.4951000", "30.00", true, daysAgo(90)],
        [3, "Kano Metro",   "NG-KN", "12.0022000", "8.5920000", "20.00", true, daysAgo(90)],
      ]);

    // ── 88. Guide Feedback ────────────────────────────────────────────────────
    await ins(client, "guide_feedback",
      ["id", "guideId", "subsection", "userId", "rating", "comment", "createdAt"],
      [
        [1, "agent-onboarding", "kyc",     1,  5, "Very clear steps (demo)", daysAgo(20)],
        [2, "claims-filing",    "upload",  4,  3, "Upload failed twice (demo)", daysAgo(5)],
      ]);

    // ── 89. Face Enrollments & Biometric Audit ────────────────────────────────
    await ins(client, "face_enrollments",
      ["id", "userId", "enrollmentType", "embeddingVector", "embeddingVersion", "qualityScore", "livenessScore", "antiSpoofScore", "sourceImageHash", "deviceFingerprint", "isActive", "tenantId", "createdAt", "updatedAt"],
      [
        [1, 1, "login",   "demo-embedding-0001-redacted", "facenet-v2", "0.94", "0.98", "0.99", "sha256:demo0001", "DEV-AGT001-A54", true,  TENANT_ID, daysAgo(15), now()],
        [2, 3, "login",   "demo-embedding-0003-redacted", "facenet-v2", "0.91", "0.96", "0.97", "sha256:demo0003", "DEV-AGT003-H30", true,  TENANT_ID, daysAgo(12), now()],
      ]);
    await ins(client, "biometric_audit_events",
      ["id", "sessionId", "userId", "eventType", "outcome", "confidenceScore", "livenessMethod", "matchScore", "processingTimeMs", "deviceInfo", "tenantId", "createdAt"],
      [
        [1, "bio-sess-demo-001", 1, "face_match",   "success", "0.96", "active", "0.95", 420, J({ device: "DEV-AGT001-A54" }), TENANT_ID, daysAgo(2)],
        [2, "bio-sess-demo-002", 8, "liveness",     "failure", "0.22", "active", null,    390, J({ device: "unknown" }),       TENANT_ID, daysAgo(12)],
      ]);

    // ── 90. Compliance Checks, Filings & Reports ──────────────────────────────
    await ins(client, "compliance_checks",
      ["id", "agent_id", "transaction_id", "check_type", "rule_code", "result", "details", "flagged_amount", "reported_to_regulator", "reported_at", "created_at"],
      [
        [1, 2, 2, "ctr", "CTR-NG-250k", "flagged", "Cash out above ₦250,000 threshold (demo)", "280000.00", true,  daysAgo(2), daysAgo(2)],
        [2, 1, 1, "sanctions", "SAN-SCREEN", "clear", "No sanctions list match (demo)", null, false, null, daysAgo(1)],
        [3, 5, 3, "pep", "PEP-SCREEN", "clear", "No PEP match (demo)", null, false, null, daysAgo(3)],
      ]);
    await ins(client, "compliance_filings",
      ["id", "filing_type", "reference_number", "status", "reporting_period", "submitted_to", "submitted_at", "acknowledged_at", "total_transactions", "total_amount", "flagged_count", "prepared_by", "reviewed_by", "created_at"],
      [
        [1, "ctr", "CTR-2026-06-001", "acknowledged", "2026-06", "NFIU", daysAgo(12), daysAgo(10), 412, "38400000.00", 3, 16, 17, daysAgo(13)],
        [2, "str", "STR-2026-07-001", "submitted",    "2026-07", "NFIU", daysAgo(2),  null,         2,  "1520000.00",  2, 16, null, daysAgo(3)],
      ]);
    await ins(client, "compliance_reports",
      ["id", "reportType", "period", "totalAlerts", "highAlerts", "mediumAlerts", "lowAlerts", "resolvedAlerts", "status", "generatedBy", "fileUrl", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "aml_monthly", "2026-06", 14, 3, 6, 5, 11, "submitted", "ADMIN1", "https://cdn.insureportal.ng/demo/reports/aml-2026-06.pdf", TENANT_ID, daysAgo(12), now()],
        [2, "cbn_daily",   "2026-07-10", 2, 0, 1, 1, 2, "submitted", "ADMIN1", "https://cdn.insureportal.ng/demo/reports/cbn-2026-07-10.pdf", TENANT_ID, daysAgo(2), now()],
      ]);

    // ── 91. Service Nodes & Marketplace Ads (schema.additions.ts) ────────────
    await ins(client, "service_nodes",
      ["id", "serviceName", "serviceId", "host", "port", "protocol", "status", "version", "region", "registeredAt", "updatedAt"],
      [
        [1, "api-server", "api-01", "10.0.0.11", 3000, "http", "healthy", "3.2.1", "lagos-dc1", daysAgo(30), now()],
        [2, "temporal-worker", "worker-01", "10.0.0.12", 7233, "grpc", "healthy", "3.2.1", "lagos-dc1", daysAgo(30), now()],
      ]);
    await ins(client, "marketplace_ads",
      ["id", "adRef", "title", "description", "advertiserName", "adType", "placement", "status", "startDate", "endDate", "impressions", "clicks", "budget", "spent", "tenantId", "createdAt", "updatedAt"],
      [
        [1, "AD-2026-001", "Send Money to 50+ Countries", "Best rates guaranteed. No hidden fees. (demo)",      "InsurePortal", "banner",  "app_home",     "active", daysAgo(7), daysFromNow(23), 4210, 312, "150000.00", "42500.00", String(TENANT_ID), daysAgo(7), now()],
        [2, "AD-2026-002", "Earn More with InsurePortal Gold", "Upgrade your tier and earn 2x commission. (demo)", "InsurePortal", "promo",   "agent_portal", "active", daysAgo(7), daysFromNow(23), 1870, 240, "80000.00",  "21500.00", String(TENANT_ID), daysAgo(7), now()],
        [3, "AD-2026-003", "Family Health Plans from ₦15k/mo", "New HMO plans for families. (demo)",             "InsurePortal", "listing", "marketplace",  "active", daysAgo(3), daysFromNow(27), 940,  88,  "200000.00", "18900.00", String(TENANT_ID), daysAgo(3), now()],
      ]);

    // ── 91b. Portal Ads & Regulatory Filing DLQ ───────────────────────────────
    await ins(client, "insurance_portal_ads",
      ["id", "title", "imageUrl", "targetUrl", "placement", "isActive", "startDate", "endDate", "createdAt", "updatedAt"],
      [
        [1, "Motor Insurance Sale — 20% Off (demo)", "/images/ads/motor-sale.jpg",  "/products/motor",  "portal_home", true, daysAgo(7), daysFromNow(23), daysAgo(7), now()],
        [2, "Health Cover Launch (demo)",            "/images/ads/health-launch.jpg", "/products/health", "portal_home", true, daysAgo(3), daysFromNow(57), daysAgo(3), now()],
      ]);
    await ins(client, "sar_dead_letter_queue",
      ["id", "original_filing_id", "reference_number", "filing_type", "status", "last_error", "total_retries", "routed_at", "created_at", "updated_at"],
      [[1, 2, "STR-2026-07-001", "str", "pending", "NFIU gateway timeout (demo)", 2, daysAgo(2), daysAgo(2), now()]]);

    // ══════════════════════ DEVICE / MDM / SIM / OTA ═════════════════════════

    // ── 92. Device Locations ──────────────────────────────────────────────────
    await ins(client, "device_locations",
      ["id", "deviceId", "agentId", "lat", "lng", "accuracy", "source", "reportedAt", "createdAt"],
      [
        [1, 1, 1, 6.5244, 3.3792, 10.5, "gps", daysAgo(1), daysAgo(1)],
        [2, 2, 2, 12.0022, 8.5920, 12.0, "gps", daysAgo(2), daysAgo(2)],
        [3, 3, 3, 6.2088, 6.6959, 8.2,  "gps", daysAgo(3), daysAgo(3)],
      ]);

    // ── 93. Device Compliance Policies & Violations ───────────────────────────
    await ins(client, "device_compliance_policies",
      ["id", "name", "description", "rules", "severity", "enabled", "enforcementAction", "createdBy", "createdAt", "updatedAt"],
      [[1, "Standard POS Policy", "Baseline MDM policy for POS devices (demo)", J({ minOsVersion: "Android 10", requireScreenLock: true, requireEncryption: true, maxInactivityDays: 7 }), "high", true, "block_terminal", "ADMIN1", daysAgo(60), now()]]);
    await ins(client, "device_compliance_violations",
      ["id", "deviceId", "policyId", "serialNumber", "violationType", "severity", "agentId", "details", "status", "detectedAt", "createdAt"],
      [[1, 3, 1, "DEV-AGT003-H30", "os_version_outdated", "medium", 3, J({ current: "Android 9", required: "Android 10", demo: true }), "open", daysAgo(5), daysAgo(5)]]);

    // ── 94. Device Commands ───────────────────────────────────────────────────
    await ins(client, "device_commands",
      ["id", "deviceId", "command", "payload", "status", "issuedBy", "createdAt"],
      [
        [1, 1, "lock",          J({ reason: "Scheduled maintenance (demo)" }), "delivered", "ADMIN1", daysAgo(2)],
        [2, 2, "update_config", J({ apn: "internet.mtn.ng", demo: true }),     "delivered", "ADMIN1", daysAgo(4)],
        [3, 3, "wipe",          J({ reason: "Compliance violation (demo)" }),  "pending",   "ADMIN1", daysAgo(1)],
      ]);

    // ── 95. Geofence Zones & Assignments & Violations ─────────────────────────
    await ins(client, "geofence_zones",
      ["id", "name", "description", "type", "latitude", "longitude", "radiusMeters", "isActive", "createdBy", "createdAt", "updatedAt"],
      [
        [1, "Lagos Mainland", "Lagos mainland operating zone (demo)", "circle", 6.5244, 3.3792, 25000, true, 16, daysAgo(60), now()],
        [2, "Abuja FCT",      "Abuja FCT operating zone (demo)",      "circle", 9.0579, 7.4951, 30000, true, 16, daysAgo(60), now()],
      ]);
    await ins(client, "agent_geofence_zones",
      ["id", "agentId", "zoneId", "assignedAt", "assignedBy"],
      [
        [1, 1, 1, daysAgo(30), "ADMIN1"],
        [2, 9, 2, daysAgo(30), "ADMIN1"],
      ]);
    await ins(client, "mdm_geofence_violations",
      ["id", "deviceId", "serialNumber", "violationType", "agentId", "zoneId", "zoneName", "status", "detectedAt", "createdAt"],
      [[1, 1, "DEV-AGT001-A54", "exit", 1, 1, "Lagos Mainland", "resolved", daysAgo(2), daysAgo(2)]]);

    // ── 96. Connectivity Log ──────────────────────────────────────────────────
    await ins(client, "connectivity_log",
      ["id", "agentId", "quality", "latencyMs", "recordedAt"],
      [
        [1, "AGT001", "Excellent", 42,  hoursAgo(2)],
        [2, "AGT002", "Good",      88,  hoursAgo(3)],
        [3, "AGT003", "Excellent", 35,  hoursAgo(1)],
        [4, "AGT008", "Poor",      940, hoursAgo(5)],
        [5, "AGT011", "Offline",   null, hoursAgo(6)],
      ]);

    // ── 97. Multi-SIM Profiles, Probe & Failover Logs, Orchestrator ───────────
    await ins(client, "multi_sim_profiles",
      ["id", "terminalId", "simSlot", "iccid", "carrier", "status", "failoverPriority", "createdAt", "updatedAt"],
      [
        [1, 1, 1, "8923410000000000001", "MTN",    "active",  1, daysAgo(30), now()],
        [2, 1, 2, "8923410000000000002", "Airtel", "standby", 2, daysAgo(30), now()],
      ]);
    await ins(client, "sim_probe_log",
      ["id", "agentId", "terminalId", "slot", "carrier", "mccMnc", "rssi", "regStatus", "latencyMs", "packetLossX10", "score", "probedAt", "createdAt"],
      [
        [1, "AGT001", "TRM-001-LAGOS", "1", "MTN",    62130, -68, 1, 55,  5,  92, hoursAgo(1), hoursAgo(1)],
        [2, "AGT001", "TRM-001-LAGOS", "2", "Airtel", 62120, -74, 1, 70,  8,  85, hoursAgo(1), hoursAgo(1)],
        [3, "AGT002", "TRM-002-KANO",  "1", "MTN",    62130, -81, 1, 120, 15, 74, hoursAgo(2), hoursAgo(2)],
      ]);
    await ins(client, "sim_failover_log",
      ["id", "terminalId", "agentId", "fromSlot", "toSlot", "reason", "latencyMs", "lossX10", "switchedAt", "createdAt"],
      [[1, "TRM-001-LAGOS", "AGT001", 1, 2, "Signal loss > 30 seconds (demo)", 5000, 100, daysAgo(5), daysAgo(5)]]);
    await ins(client, "sim_orchestrator_config",
      ["id", "terminalId", "probeIntervalMs", "relayEndpoint", "enabled", "createdAt", "updatedAt"],
      [[1, "TRM-001-LAGOS", 30000, "https://relay.insureportal.ng/sim", true, daysAgo(30), now()]]);

    // ── 98. OTA Releases & Update Log & Software Updates ──────────────────────
    await ins(client, "ota_releases",
      ["id", "version", "s3Key", "downloadUrl", "checksum", "fileSize", "releaseNotes", "rolloutPercent", "status", "publishedAt", "createdAt", "updatedAt"],
      [
        [1, "3.2.1",      "firmware/3.2.1.bin",      "https://cdn.insureportal.ng/firmware/3.2.1.bin",      `sha256:${randomUUID().replace(/-/g, "")}`, 18422100, "Bug fixes and performance improvements (demo)", 100, "published", daysAgo(30), daysAgo(30), now()],
        [2, "3.3.0-beta", "firmware/3.3.0-beta.bin", "https://cdn.insureportal.ng/firmware/3.3.0-beta.bin", `sha256:${randomUUID().replace(/-/g, "")}`, 19011200, "FX rate lock, biometric improvements (demo)",      10,  "rolling_out", daysAgo(5), daysAgo(5), now()],
      ]);
    await ins(client, "ota_update_log",
      ["id", "deviceId", "releaseId", "fromVersion", "toVersion", "status", "startedAt", "completedAt", "createdAt"],
      [
        [1, 1, 1, "3.2.0", "3.2.1", "success", daysAgo(5), daysAgo(5), daysAgo(5)],
        [2, 2, 1, "3.2.0", "3.2.1", "success", daysAgo(5), daysAgo(5), daysAgo(5)],
        [3, 3, 1, "3.1.9", "3.2.0", "failed",  daysAgo(6), daysAgo(6), daysAgo(6)],
      ]);
    await ins(client, "software_updates",
      ["id", "version", "downloadUrl", "releaseNotes", "checksum", "isForced", "createdAt"],
      [[1, "3.2.1", "https://cdn.insureportal.ng/firmware/3.2.1.bin", "Security patch and performance improvements (demo)", `sha256:${randomUUID().replace(/-/g, "")}`, false, daysAgo(30)]]);

    // ── 99. Service Records ───────────────────────────────────────────────────
    await ins(client, "service_records",
      ["id", "terminalId", "issueDescription", "technicianName", "resolution", "serviceDate", "nextServiceDate", "createdAt"],
      [[1, 1, "Printer jam (demo)", "Tech001", "Replaced paper roll and cleaned mechanism", daysAgo(15), daysFromNow(75), daysAgo(15)]]);

    // ── 100. Inventory Items ──────────────────────────────────────────────────
    await ins(client, "inventory_items",
      ["id", "sku", "name", "category", "quantityOnHand", "reorderPoint", "unitCost", "status", "warehouseLocation", "createdAt", "updatedAt"],
      [
        [1, "PPR-58-001",   "POS Paper Roll (58mm)",      "consumable", 500, 100, "150.00",   "in_stock",  "Lagos WH-1", daysAgo(60), now()],
        [2, "RBN-001",      "POS Thermal Printer Ribbon", "consumable", 200, 50,  "300.00",   "in_stock",  "Lagos WH-1", daysAgo(60), now()],
        [3, "TRM-PAX-A920", "PAX A920 Terminal",          "hardware",   50,  10,  "45000.00", "in_stock",  "Lagos WH-1", daysAgo(60), now()],
      ]);

    // ── Sequence fix-up (we inserted explicit ids into serial columns) ────────
    for (const table of sequencesToReset) {
      try {
        await client.query(
          `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 1))`
        );
      } catch (e) {
        console.warn(`  ⚠ sequence reset skipped for ${table}: ${e.message}`);
      }
    }

    console.log(`\n✅ Seed complete — ${seededTables.length} tables seeded (idempotent; re-run is a no-op).`);
    console.log("   Skipped by design (runtime/internal state): dapr_workflow_state,");
    console.log("   fluvio_event_log, tigerbeetle_sync_log, permify_relationship_cache,");
    console.log("   encrypted_fields, load_test_runs.");
    console.log("\n🔑 Demo credentials (DEMO DATA ONLY):");
    console.log("   Agent Code: AGT001  PIN: 1234  (Gold tier, ₦850,000 float)");
    console.log("   Agent Code: AGT003  PIN: 3456  (Platinum tier, ₦1,500,000 float)");
    console.log("   Agent Code: ADMIN1  PIN: 0000  (Admin — access /admin panel)");
    console.log("\n📱 Customer phones: 07011111111 – 07055555555");
    console.log("🏪 Merchants: Sunshine Supermarket (MER001), QuickFuel Station (MER002)");
    console.log("📄 Policies: POL-2026-0001..0005 active/bound; Claims: CLM-2026-0001..0003");

  } catch (err) {
    console.error("❌ Seed error:", err.message);
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
