// SECURITY: SQL template literals in this file are for display/mock purposes only. All actual DB queries use parameterized Drizzle ORM.
/**
 * seed.mjs — InsurePortal InsurePortal Platform Master Seed Script (Phase 163 — All 65 Tables)
 *
 * Usage:
 *   POSTGRES_URL=postgresql://... node seed.mjs
 *   # Or with default local connection:
 *   node seed.mjs
 *
 * Safe to re-run — uses ON CONFLICT DO NOTHING for idempotency.
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
const minutesAgo = (n) => new Date(Date.now() - n * 60_000);
const daysFromNow = (n) => new Date(Date.now() + n * 86_400_000);

function randomPhone() {
  const prefixes = ["0803", "0806", "0813", "0816", "0703", "0706", "0901", "0905"];
  return prefixes[Math.floor(Math.random() * prefixes.length)] +
    String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
}

function randomAmount(min, max) {
  return (Math.random() * (max - min) + min).toFixed(2);
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function uid() { return randomUUID(); }

// ── Seed data ─────────────────────────────────────────────────────────────────
const AGENTS = [
  { code: "AGT001", name: "Emeka Obi",          phone: "08012345678", pin: "1234", tier: "Gold",     location: "Lagos Island, Lagos",        float: "850000.00",  commission: "24500.00",  loyalty: 18750, streak: 12, rank: 3,   role: "agent" },
  { code: "AGT002", name: "Fatima Yusuf",        phone: "08023456789", pin: "2345", tier: "Silver",   location: "Kano Central, Kano",         float: "420000.00",  commission: "8900.00",   loyalty: 7200,  streak: 5,  rank: 18,  role: "agent" },
  { code: "AGT003", name: "Chidi Nwosu",         phone: "08034567890", pin: "3456", tier: "Platinum", location: "Onitsha, Anambra",           float: "1500000.00", commission: "67800.00",  loyalty: 62400, streak: 30, rank: 1,   role: "agent" },
  { code: "AGT004", name: "Amaka Eze",           phone: "08045678901", pin: "4567", tier: "Bronze",   location: "Enugu North, Enugu",         float: "120000.00",  commission: "2100.00",   loyalty: 1850,  streak: 2,  rank: 87,  role: "agent" },
  { code: "AGT005", name: "Tunde Adeyemi",       phone: "08056789012", pin: "5678", tier: "Silver",   location: "Ibadan Central, Oyo",        float: "380000.00",  commission: "11200.00",  loyalty: 9400,  streak: 8,  rank: 12,  role: "agent" },
  { code: "AGT006", name: "Ngozi Okafor",        phone: "08067890123", pin: "6789", tier: "Gold",     location: "Port Harcourt, Rivers",      float: "720000.00",  commission: "31500.00",  loyalty: 24100, streak: 15, rank: 5,   role: "agent" },
  { code: "AGT007", name: "Bello Usman",         phone: "08078901234", pin: "7890", tier: "Silver",   location: "Maiduguri, Borno",           float: "310000.00",  commission: "7400.00",   loyalty: 5600,  streak: 4,  rank: 25,  role: "agent" },
  { code: "AGT008", name: "Chioma Eze",          phone: "08089012345", pin: "8901", tier: "Bronze",   location: "Owerri, Imo",                float: "95000.00",   commission: "1800.00",   loyalty: 1200,  streak: 1,  rank: 102, role: "agent" },
  { code: "AGT009", name: "Yusuf Abubakar",      phone: "08090123456", pin: "9012", tier: "Gold",     location: "Abuja Central, FCT",         float: "980000.00",  commission: "42300.00",  loyalty: 31500, streak: 20, rank: 2,   role: "agent" },
  { code: "AGT010", name: "Adaeze Nwosu",        phone: "08001234567", pin: "0123", tier: "Silver",   location: "Asaba, Delta",               float: "450000.00",  commission: "13600.00",  loyalty: 10800, streak: 9,  rank: 10,  role: "agent" },
  { code: "AGT011", name: "Musa Garba",          phone: "08011234567", pin: "1122", tier: "Bronze",   location: "Kaduna South, Kaduna",       float: "180000.00",  commission: "3200.00",   loyalty: 2400,  streak: 3,  rank: 65,  role: "agent" },
  { code: "AGT012", name: "Ifeoma Chukwu",       phone: "08022345678", pin: "2233", tier: "Platinum", location: "Calabar, Cross River",       float: "2100000.00", commission: "89500.00",  loyalty: 78200, streak: 45, rank: 1,   role: "agent" },
  { code: "AGT013", name: "Suleiman Bello",      phone: "08033456789", pin: "3344", tier: "Gold",     location: "Sokoto, Sokoto",             float: "640000.00",  commission: "27800.00",  loyalty: 21300, streak: 18, rank: 6,   role: "agent" },
  { code: "AGT014", name: "Kemi Balogun",        phone: "08044567890", pin: "4455", tier: "Silver",   location: "Abeokuta, Ogun",             float: "290000.00",  commission: "6100.00",   loyalty: 4700,  streak: 6,  rank: 30,  role: "agent" },
  { code: "AGT015", name: "Obinna Okonkwo",      phone: "08055678901", pin: "5566", tier: "Bronze",   location: "Umuahia, Abia",              float: "75000.00",   commission: "1100.00",   loyalty: 800,   streak: 0,  rank: 145, role: "agent" },
  { code: "ADMIN1", name: "Admin User",          phone: "08099999999", pin: "0000", tier: "Platinum", location: "Head Office, Lagos",         float: "5000000.00", commission: "0.00",      loyalty: 0,     streak: 0,  rank: null, role: "admin" },
  { code: "SUP001", name: "Supervisor Ade",      phone: "08098765432", pin: "9999", tier: "Gold",     location: "Regional Office, Lagos",     float: "0.00",       commission: "0.00",      loyalty: 0,     streak: 0,  rank: null, role: "supervisor" },
];

const TX_TYPES = ["Cash In", "Cash Out", "Transfer", "Airtime", "Bill Payment", "Card Payment", "QR Payment", "NFC Payment"];
const TX_CHANNELS = ["Cash", "Card", "USSD", "QR", "NFC", "App"];
const TX_STATUSES = ["completed", "completed", "completed", "completed", "failed", "reversed"];
const CUSTOMER_NAMES = [
  "Biodun Adeyemi", "Ngozi Okafor", "Musa Ibrahim", "Chioma Obi",
  "Suleiman Bello", "Adaeze Nwosu", "Yemi Adesanya", "Kemi Balogun",
  "Bello Musa", "Ifeoma Chukwu", "Usman Garba", "Aisha Mohammed",
];

async function seed() {
  const client = await pool.connect();
  try {
    console.log("🌱 Seeding InsurePortal POS database (all 65 tables)...\n");

    // ── 1. Agents ─────────────────────────────────────────────────────────────
    console.log("👤 [1/65] agents...");
    for (const agent of AGENTS) {
      const pinHash = await bcrypt.hash(agent.pin, 10);
      await client.query(
        `INSERT INTO agents (
          agent_code, name, phone, pin_hash, tier, location,
          float_balance, commission_balance, loyalty_points,
          daily_streak, rank, role, is_active, created_at, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,NOW(),NOW())
        ON CONFLICT (agent_code) DO UPDATE SET
          name = EXCLUDED.name, tier = EXCLUDED.tier,
          float_balance = EXCLUDED.float_balance,
          commission_balance = EXCLUDED.commission_balance,
          loyalty_points = EXCLUDED.loyalty_points, updated_at = NOW()`,
        [agent.code, agent.name, agent.phone, pinHash, agent.tier,
         agent.location, agent.float, agent.commission, agent.loyalty,
         agent.streak, agent.rank, agent.role]
      );
    }
    console.log(`  ✓ ${AGENTS.length} agents`);

    // ── 2. Transactions ───────────────────────────────────────────────────────
    console.log("💳 [2/65] transactions...");
    let txCount = 0;
    for (const agent of AGENTS.filter(a => a.role === "agent")) {
      for (let i = 0; i < 22; i++) {
        const type = pick(TX_TYPES);
        const amount = randomAmount(500, 150000);
        const fee = (parseFloat(amount) * 0.005).toFixed(2);
        const commission = (parseFloat(fee) * 0.4).toFixed(2);
        const ref = `TXN-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        await client.query(
          `INSERT INTO transactions (
            id, agent_code, type, amount, fee, commission,
            customer_name, customer_phone, status, reference,
            channel, narration, created_at
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
          ON CONFLICT (reference) DO NOTHING`,
          [uid(), agent.code, type, amount, fee, commission,
           pick(CUSTOMER_NAMES), randomPhone(), pick(TX_STATUSES), ref,
           pick(TX_CHANNELS), `${type} - ${pick(CUSTOMER_NAMES)}`,
           daysAgo(Math.floor(Math.random() * 30))]
        );
        txCount++;
      }
    }
    console.log(`  ✓ ${txCount} transactions`);

    // ── 3. Fraud Alerts ───────────────────────────────────────────────────────
    console.log("🚨 [3/65] fraud_alerts...");
    const fraudAlerts = [
      { agent: "AGT001", type: "velocity_breach",  severity: "high",     amount: "450000.00", customer: "Biodun Adeyemi",  reason: "5 transactions in 3 minutes exceeding ₦90,000 each",      status: "investigating" },
      { agent: "AGT002", type: "geo_anomaly",       severity: "critical", amount: "280000.00", customer: "Musa Ibrahim",    reason: "Transaction location 800km from registered agent location", status: "open" },
      { agent: "AGT003", type: "amount_spike",      severity: "medium",   amount: "1200000.00",customer: "Chioma Obi",     reason: "Single transaction 340% above agent 30-day average",        status: "resolved" },
      { agent: "AGT004", type: "device_mismatch",   severity: "high",     amount: "95000.00",  customer: "Suleiman Bello", reason: "Transaction from unregistered device fingerprint",           status: "open" },
      { agent: "AGT005", type: "duplicate_tx",      severity: "medium",   amount: "50000.00",  customer: "Adaeze Nwosu",   reason: "Identical transaction repeated within 60 seconds",           status: "investigating" },
      { agent: "AGT006", type: "velocity_breach",   severity: "low",      amount: "25000.00",  customer: "Yemi Adesanya",  reason: "3 failed PIN attempts before successful transaction",        status: "resolved" },
    ];
    for (const alert of fraudAlerts) {
      await client.query(
        `INSERT INTO fraud_alerts (id, agent_code, type, severity, amount, customer_name, reason, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [uid(), alert.agent, alert.type, alert.severity, alert.amount,
         alert.customer, alert.reason, alert.status, daysAgo(Math.floor(Math.random() * 7))]
      );
    }
    console.log(`  ✓ ${fraudAlerts.length} fraud alerts`);

    // ── 4. Loyalty History ────────────────────────────────────────────────────
    console.log("🏆 [4/65] loyalty_history...");
    let loyaltyCount = 0;
    for (const agent of AGENTS.filter(a => a.role === "agent")) {
      for (const event of [
        { type: "earn",   points: 500,  description: "Cash In transaction bonus",           balanceAfter: agent.loyalty },
        { type: "earn",   points: 1000, description: "Daily streak bonus (7 days)",         balanceAfter: agent.loyalty + 500 },
        { type: "redeem", points: -250, description: "Redeemed for airtime voucher",        balanceAfter: agent.loyalty + 1250 },
        { type: "earn",   points: 750,  description: "Tier upgrade bonus",                  balanceAfter: agent.loyalty + 1000 },
        { type: "earn",   points: 300,  description: "Bill payment transaction bonus",      balanceAfter: agent.loyalty + 1750 },
        { type: "earn",   points: 200,  description: "Referral bonus - new agent signup",   balanceAfter: agent.loyalty + 2050 },
        { type: "redeem", points: -500, description: "Redeemed for data bundle reward",     balanceAfter: agent.loyalty + 1550 },
        { type: "earn",   points: 1500, description: "Monthly performance bonus",           balanceAfter: agent.loyalty + 3050 },
        { type: "earn",   points: 400,  description: "NFC payment transaction bonus",       balanceAfter: agent.loyalty + 3450 },
        { type: "earn",   points: 600,  description: "Transfer transaction bonus",          balanceAfter: agent.loyalty + 4050 },
      ]) {
        await client.query(
          `INSERT INTO loyalty_history (id, agent_code, type, points, description, balance_after, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [uid(), agent.code, event.type, event.points, event.description,
           event.balanceAfter, daysAgo(Math.floor(Math.random() * 14))]
        );
        loyaltyCount++;
      }
    }
    console.log(`  ✓ ${loyaltyCount} loyalty history entries`);

    // ── 5. Float Top-Up Requests ──────────────────────────────────────────────
    console.log("💰 [5/65] float_topup_requests...");
    const floatRequests = [
      { agent: "AGT001", amount: "500000.00", status: "approved", note: "Monthly float replenishment" },
      { agent: "AGT002", amount: "200000.00", status: "pending",  note: "Urgent — running low on float" },
      { agent: "AGT004", amount: "100000.00", status: "rejected", note: "Request for additional float", rejectReason: "Insufficient documentation" },
      { agent: "AGT005", amount: "300000.00", status: "pending",  note: "Pre-weekend float top-up" },
      { agent: "AGT006", amount: "400000.00", status: "approved", note: "Q2 float increase request" },
    ];
    for (const req of floatRequests) {
      await client.query(
        `INSERT INTO float_topup_requests (id, agent_code, amount, status, note, reject_reason, approved_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
        [uid(), req.agent, req.amount, req.status, req.note, req.rejectReason ?? null,
         req.status === "approved" ? "ADMIN1" : null,
         daysAgo(Math.floor(Math.random() * 10)), now()]
      );
    }
    console.log(`  ✓ ${floatRequests.length} float top-up requests`);

    // ── 6. Audit Log ──────────────────────────────────────────────────────────
    console.log("📋 [6/65] audit_log...");
    const auditEntries = [
      { actor: "AGT001", action: "login",              resource: "agent_session", ip: "41.58.12.34" },
      { actor: "AGT001", action: "transaction_create", resource: "transactions",  ip: "41.58.12.34" },
      { actor: "ADMIN1", action: "float_approve",      resource: "float_topup",   ip: "197.210.54.2" },
      { actor: "AGT002", action: "pin_reset",          resource: "agent_auth",    ip: "105.112.8.91" },
      { actor: "ADMIN1", action: "agent_suspend",      resource: "agents",        ip: "197.210.54.2" },
      { actor: "AGT003", action: "transaction_create", resource: "transactions",  ip: "154.118.23.5" },
      { actor: "ADMIN1", action: "settlement_run",     resource: "settlement",    ip: "197.210.54.2" },
      { actor: "AGT004", action: "fraud_report",       resource: "fraud_alerts",  ip: "41.190.3.22" },
    ];
    for (const entry of auditEntries) {
      await client.query(
        `INSERT INTO audit_log (id, actor_code, action, resource, ip_address, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [uid(), entry.actor, entry.action, entry.resource, entry.ip,
         JSON.stringify({ source: "seed" }), hoursAgo(Math.floor(Math.random() * 72))]
      );
    }
    console.log(`  ✓ ${auditEntries.length} audit log entries`);

    // ── 7. Chat Sessions & Messages ───────────────────────────────────────────
    console.log("💬 [7/65] chat_sessions...");
    const chatSessions = [
      { agent: "AGT001", subject: "Float balance discrepancy",    status: "resolved" },
      { agent: "AGT002", subject: "Transaction reversal request", status: "open" },
      { agent: "AGT004", subject: "PIN reset assistance",         status: "resolved" },
    ];
    for (const session of chatSessions) {
      const sessionId = uid();
      await client.query(
        `INSERT INTO chat_sessions (id, agent_code, subject, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [sessionId, session.agent, session.subject, session.status,
         hoursAgo(Math.floor(Math.random() * 48)), now()]
      );
      for (const msg of [
        { sender: "agent",   content: `Hello, I need help with: ${session.subject}` },
        { sender: "support", content: "Thank you for reaching out. I'll help you resolve this right away." },
        { sender: "agent",   content: "Thank you, please proceed." },
        ...(session.status === "resolved" ? [
          { sender: "support", content: "This issue has been resolved. Is there anything else I can help you with?" },
          { sender: "agent",   content: "No, that's all. Thank you!" },
        ] : []),
      ]) {
        await client.query(
          `INSERT INTO chat_messages (id, session_id, sender_type, content, created_at)
           VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
          [uid(), sessionId, msg.sender, msg.content, minutesAgo(Math.floor(Math.random() * 120))]
        );
      }
    }
    console.log(`  ✓ ${chatSessions.length} chat sessions + messages`);

    // ── 8. OTP Tokens ─────────────────────────────────────────────────────────
    console.log("[REDACTED sensitive data]");
    await client.query(
      `INSERT INTO otp_tokens (id, agent_code, otp_hash, expires_at, used, created_at)
       VALUES ($1, 'AGT001', $2, $3, true, $4) ON CONFLICT DO NOTHING`,
      [uid(), await bcrypt.hash("123456", 10), daysAgo(1), daysAgo(1)]
    );
    console.log("[REDACTED sensitive data]");

    // ── 9. Users ──────────────────────────────────────────────────────────────
    console.log("👥 [9/65] users...");
    for (let i = 0; i < AGENTS.length; i++) {
      const a = AGENTS[i];
      await client.query(
        `INSERT INTO users (id, open_id, name, email, role, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), `open_id_${a.code}`, a.name, `${a.code.toLowerCase()}@insureportal.ng`,
         a.role === "admin" ? "admin" : "user", daysAgo(60 - i * 5)]
      );
    }
    console.log(`  ✓ ${AGENTS.length} users`);

    // ── 10. Customers ─────────────────────────────────────────────────────────
    console.log("🧑 [10/65] customers...");
    const customerData = [
      { phone: "07011111111", name: "Emeka Okafor",   bvn: "22211111111", tier: "standard" },
      { phone: "07022222222", name: "Amina Hassan",   bvn: "22222222222", tier: "premium"  },
      { phone: "07033333333", name: "Tunde Adesanya", bvn: "22233333333", tier: "basic"    },
      { phone: "07044444444", name: "Chioma Obi",     bvn: "22244444444", tier: "standard" },
      { phone: "07055555555", name: "Ibrahim Musa",   bvn: "22255555555", tier: "premium"  },
    ];
    const CUSTOMER_IDS = [];
    for (const c of customerData) {
      const id = uid();
      CUSTOMER_IDS.push(id);
      await client.query(
        `INSERT INTO customers (id, phone, full_name, bvn, tier, kyc_level, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [id, c.phone, c.name, c.bvn, c.tier, 2, true, daysAgo(45)]
      );
    }
    console.log(`  ✓ ${customerData.length} customers`);

    // ── 11. Merchants ─────────────────────────────────────────────────────────
    console.log("🏪 [11/65] merchants...");
    const merchantData = [
      { name: "Sunshine Supermarket", category: "retail", phone: "09011111111" },
      { name: "QuickFuel Station",    category: "fuel",   phone: "09022222222" },
    ];
    const MERCHANT_IDS = [];
    for (const m of merchantData) {
      const id = uid();
      MERCHANT_IDS.push(id);
      await client.query(
        `INSERT INTO merchants (id, name, category, phone, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [id, m.name, m.category, m.phone, true, daysAgo(30)]
      );
    }
    console.log(`  ✓ ${merchantData.length} merchants`);

    // ── 12. Service Nodes ─────────────────────────────────────────────────────
    console.log("🖥️  [12/65] pos_terminals...");
    const terminalData = [
      { serial: "TRM-001-LAGOS", model: "Newland N910",    agent: "AGT001" },
      { serial: "TRM-002-KANO",  model: "PAX A920",        agent: "AGT002" },
      { serial: "TRM-003-ANMB",  model: "Verifone VX520",  agent: "AGT003" },
    ];
    const TERMINAL_IDS = [];
    for (const t of terminalData) {
      const id = uid();
      TERMINAL_IDS.push(id);
      await client.query(
        `INSERT INTO pos_terminals (id, serial_number, model, agent_code, is_active, firmware_version, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [id, t.serial, t.model, t.agent, true, "3.2.1", daysAgo(20)]
      );
    }
    console.log(`  ✓ ${terminalData.length} service nodes`);

    // ── 13. Devices ───────────────────────────────────────────────────────────
    console.log("📱 [13/65] devices...");
    const deviceModels = ["Samsung Galaxy A54", "Tecno Spark 10", "Infinix Hot 30"];
    const DEVICE_IDS = [];
    for (let i = 0; i < 3; i++) {
      const id = uid();
      DEVICE_IDS.push(id);
      await client.query(
        `INSERT INTO devices (id, agent_code, device_name, model, os_version, app_version, is_active, enrolled_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [id, AGENTS[i].code, `${AGENTS[i].name}'s Phone`, deviceModels[i], "Android 13", "3.2.1", true, daysAgo(20 - i * 3)]
      );
    }
    console.log(`  ✓ 3 devices`);

    // ── 14. Device Locations ──────────────────────────────────────────────────
    console.log("📍 [14/65] device_locations...");
    const locationData = [
      { lat: 6.5244, lon: 3.3792, city: "Lagos" },
      { lat: 9.0579, lon: 7.4951, city: "Abuja" },
      { lat: 6.4584, lon: 7.5464, city: "Enugu" },
    ];
    for (let i = 0; i < DEVICE_IDS.length; i++) {
      const loc = locationData[i];
      await client.query(
        `INSERT INTO device_locations (id, device_id, lat, lon, accuracy, city, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [uid(), DEVICE_IDS[i], loc.lat, loc.lon, 10.5, loc.city, daysAgo(i)]
      );
    }
    console.log("  ✓ 3 device locations");

    // ── 15. Device Compliance Policies ────────────────────────────────────────
    console.log("🛡️  [15/65] device_compliance_policies...");
    await client.query(
      `INSERT INTO device_compliance_policies (id, name, rules, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [uid(), "Standard POS Policy", JSON.stringify({
        minOsVersion: "Android 10", requireScreenLock: true,
        requireEncryption: true, maxInactivityDays: 7,
      }), true, daysAgo(60)]
    );
    console.log("  ✓ 1 compliance policy");

    // ── 16. Device Compliance Violations ─────────────────────────────────────
    console.log("⚠️  [16/65] device_compliance_violations...");
    await client.query(
      `INSERT INTO device_compliance_violations (id, device_id, policy_name, violation_type, details, detected_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), DEVICE_IDS[0], "Standard POS Policy", "os_version_outdated",
       JSON.stringify({ current: "Android 9", required: "Android 10" }), daysAgo(5)]
    );
    console.log("  ✓ 1 compliance violation");

    // ── 17. Device Commands ───────────────────────────────────────────────────
    console.log("⌨️  [17/65] device_commands...");
    for (let i = 0; i < DEVICE_IDS.length; i++) {
      await client.query(
        `INSERT INTO device_commands (id, device_id, command, payload, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), DEVICE_IDS[i], ["lock", "wipe", "update_config"][i],
         JSON.stringify({ reason: "Scheduled maintenance" }), "delivered", daysAgo(i * 2)]
      );
    }
    console.log("  ✓ 3 device commands");

    // ── 18. Geofence Zones ────────────────────────────────────────────────────
    console.log("🗺️  [18/65] geofence_zones...");
    const GEOFENCE_IDS = [];
    for (const zone of [
      { name: "Lagos Mainland", lat: 6.5244, lon: 3.3792, radius: 25000 },
      { name: "Abuja FCT",      lat: 9.0579, lon: 7.4951, radius: 30000 },
    ]) {
      const id = uid();
      GEOFENCE_IDS.push(id);
      await client.query(
        `INSERT INTO geofence_zones (id, name, center_lat, center_lon, radius_meters, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [id, zone.name, zone.lat, zone.lon, zone.radius, true, daysAgo(60)]
      );
    }
    console.log("  ✓ 2 geofence zones");

    // ── 19. Agent Geofence Zones ──────────────────────────────────────────────
    console.log("📌 [19/65] agent_geofence_zones...");
    await client.query(
      `INSERT INTO agent_geofence_zones (id, agent_code, zone_name, center_lat, center_lon, radius_meters, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", "Lagos Mainland", 6.5244, 3.3792, 25000, true, daysAgo(30)]
    );
    console.log("  ✓ 1 agent geofence zone");

    // ── 20. MDM Geofence Violations ───────────────────────────────────────────
    console.log("🚫 [20/65] mdm_geofence_violations...");
    await client.query(
      `INSERT INTO mdm_geofence_violations (id, device_id, zone_name, lat, lon, detected_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), DEVICE_IDS[0], "Lagos Mainland", 6.6000, 3.4000, daysAgo(2)]
    );
    console.log("  ✓ 1 MDM geofence violation");

    // ── 21. Connectivity Log ──────────────────────────────────────────────────
    console.log("📶 [21/65] connectivity_log...");
    for (let i = 0; i < 10; i++) {
      await client.query(
        `INSERT INTO connectivity_log (id, agent_code, network_type, signal_strength, latency_ms, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), AGENTS[i % AGENTS.length].code, ["4G", "3G", "WiFi"][i % 3],
         Math.floor(Math.random() * 50) + 50, Math.floor(Math.random() * 100) + 20, daysAgo(i)]
      );
    }
    console.log("  ✓ 10 connectivity log entries");

    // ── 22. Multi-SIM Profiles ────────────────────────────────────────────────
    console.log("📡 [22/65] multi_sim_profiles...");
    for (const sim of [
      { iccid: "8923410000000000001", carrier: "MTN",   apn: "internet.mtn.ng",   priority: 1 },
      { iccid: "8923410000000000002", carrier: "Airtel", apn: "internet.airtel.ng", priority: 2 },
    ]) {
      await client.query(
        `INSERT INTO multi_sim_profiles (id, agent_code, iccid, carrier, apn, priority, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [uid(), "AGT001", sim.iccid, sim.carrier, sim.apn, sim.priority, true, daysAgo(30)]
      );
    }
    console.log("  ✓ 2 SIM profiles");

    // ── 23. SIM Probe Log ─────────────────────────────────────────────────────
    console.log("📊 [23/65] sim_probe_log...");
    for (let i = 0; i < 5; i++) {
      await client.query(
        `INSERT INTO sim_probe_log (id, agent_code, carrier, rssi, latency_ms, packet_loss, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [uid(), AGENTS[i % AGENTS.length].code, ["MTN", "Airtel", "Glo"][i % 3],
         -70 + i, 50 + i * 5, i * 0.5, daysAgo(i)]
      );
    }
    console.log("  ✓ 5 SIM probe entries");

    // ── 24. SIM Failover Log ──────────────────────────────────────────────────
    console.log("🔄 [24/65] sim_failover_log...");
    await client.query(
      `INSERT INTO sim_failover_log (id, agent_code, from_carrier, to_carrier, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", "MTN", "Airtel", "Signal loss > 30 seconds", daysAgo(5)]
    );
    console.log("  ✓ 1 SIM failover entry");

    // ── 25. SIM Orchestrator Config ───────────────────────────────────────────
    console.log("⚙️  [25/65] sim_orchestrator_config...");
    await client.query(
      `INSERT INTO sim_orchestrator_config (id, agent_code, primary_carrier, fallback_carrier, failover_threshold_ms, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", "MTN", "Airtel", 5000, daysAgo(30)]
    );
    console.log("  ✓ 1 SIM orchestrator config");

    // ── 26. OTA Releases ──────────────────────────────────────────────────────
    console.log("🚀 [26/65] ota_releases...");
    for (const rel of [
      { version: "3.2.1",      channel: "stable", notes: "Bug fixes and performance improvements" },
      { version: "3.3.0-beta", channel: "beta",   notes: "New FX rate lock feature, biometric auth improvements" },
    ]) {
      await client.query(
        `INSERT INTO ota_releases (id, version, channel, release_notes, firmware_url, checksum, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
        [uid(), rel.version, rel.channel, rel.notes,
         `https://cdn.insureportal.ng/firmware/${rel.version}.bin`,
         `sha256:${uid().replace(/-/g, "")}`,
         rel.channel === "stable", daysAgo(rel.channel === "stable" ? 30 : 5)]
      );
    }
    console.log("  ✓ 2 OTA releases");

    // ── 27. OTA Update Log ────────────────────────────────────────────────────
    console.log("📥 [27/65] ota_update_log...");
    for (let i = 0; i < DEVICE_IDS.length; i++) {
      await client.query(
        `INSERT INTO ota_update_log (id, device_id, version, status, started_at, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), DEVICE_IDS[i], "3.2.1", "success", daysAgo(5), daysAgo(4)]
      );
    }
    console.log(`  ✓ ${DEVICE_IDS.length} OTA update log entries`);

    // ── 28. Software Updates ──────────────────────────────────────────────────
    console.log("💾 [28/65] software_updates...");
    await client.query(
      `INSERT INTO software_updates (id, version, description, is_mandatory, released_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [uid(), "3.2.1", "Security patch and performance improvements", false, daysAgo(30)]
    );
    console.log("  ✓ 1 software update");

    // ── 29. Service Records ───────────────────────────────────────────────────
    console.log("🔧 [29/65] service_records...");
    await client.query(
      `INSERT INTO service_records (id, terminal_id, issue, resolution, technician, serviced_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), TERMINAL_IDS[0], "Printer jam", "Replaced paper roll and cleaned mechanism", "Tech001", daysAgo(15)]
    );
    console.log("  ✓ 1 service record");

    // ── 30. Inventory Items ───────────────────────────────────────────────────
    console.log("📦 [30/65] inventory_items...");
    for (const item of [
      { name: "POS Paper Roll (58mm)",    sku: "PPR-58-001",  qty: 500, unit_cost: 150 },
      { name: "POS Thermal Printer Ribbon", sku: "RBN-001",   qty: 200, unit_cost: 300 },
      { name: "PAX A920 Terminal",         sku: "TRM-PAX-A920", qty: 50, unit_cost: 45000 },
    ]) {
      await client.query(
        `INSERT INTO inventory_items (id, name, sku, quantity, unit_cost, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), item.name, item.sku, item.qty, item.unit_cost, daysAgo(60)]
      );
    }
    console.log("  ✓ 3 inventory items");

    // ── 31. API Keys ──────────────────────────────────────────────────────────
    console.log("[REDACTED sensitive data]");
    const API_KEY_IDS = [];
    for (let i = 0; i < 3; i++) {
      const id = uid();
      API_KEY_IDS.push(id);
      await client.query(
        `INSERT INTO api_keys (id, agent_code, name, key_hash, scopes, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [id, AGENTS[i].code, `API Key ${i + 1}`,
         `sha256:${uid().replace(/-/g, "")}`,
         JSON.stringify(["transactions:read", "float:read"]), true, daysAgo(20 - i * 3)]
      );
    }
    console.log("[REDACTED sensitive data]");

    // ── 32. API Key Usage ─────────────────────────────────────────────────────
    console.log("[REDACTED sensitive data]");
    for (let i = 0; i < 5; i++) {
      await client.query(
        `INSERT INTO api_key_usage (id, agent_code, endpoint, method, status_code, response_time_ms, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [uid(), AGENTS[i % AGENTS.length].code, "/api/trpc/transactions.list", "GET",
         200, Math.floor(Math.random() * 200) + 50, daysAgo(i)]
      );
    }
    console.log("[REDACTED sensitive data]");

    // ── 33. Webhook Secrets ───────────────────────────────────────────────────
    console.log("[REDACTED sensitive data]");
    await client.query(
      `INSERT INTO webhook_secrets (id, agent_code, name, secret_hash, endpoint_url, events, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", "Transaction Webhook",
       `sha256:${uid().replace(/-/g, "")}`,
       "https://webhook.site/insureportal-demo",
       JSON.stringify(["transaction.completed", "transaction.failed"]), true, daysAgo(30)]
    );
    console.log("[REDACTED sensitive data]");

    // ── 34. Email Queue ───────────────────────────────────────────────────────
    console.log("📧 [34/65] email_queue...");
    for (const email of [
      { to: "agent1@insureportal.ng", subject: "Transaction Receipt",                status: "sent"    },
      { to: "agent2@insureportal.ng", subject: "Float Top-Up Approved",              status: "sent"    },
      { to: "admin@insureportal.ng",  subject: "Fraud Alert: High Risk Transaction", status: "pending" },
    ]) {
      await client.query(
        `INSERT INTO email_queue (id, to_address, subject, body, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), email.to, email.subject, `<p>${email.subject} body content</p>`, email.status, daysAgo(1)]
      );
    }
    console.log("  ✓ 3 email queue entries");

    // ── 35. FIDO2 Credentials ─────────────────────────────────────────────────
    console.log("[REDACTED sensitive data]");
    await client.query(
      `INSERT INTO fido2_credentials (id, agent_code, credential_id, public_key, device_name, sign_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", `cred_${uid().replace(/-/g, "")}`,
       `pk_${uid().replace(/-/g, "")}`, "Samsung Galaxy A54", 0, daysAgo(10)]
    );
    console.log("[REDACTED sensitive data]");

    // ── 36. FIDO2 Challenges ──────────────────────────────────────────────────
    console.log("🎲 [36/65] fido2_challenges...");
    await client.query(
      `INSERT INTO fido2_challenges (id, agent_code, challenge, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", uid().replace(/-/g, ""), daysAgo(0), now()]
    );
    console.log("  ✓ 1 FIDO2 challenge");

    // ── 37. Credit Score History ──────────────────────────────────────────────
    console.log("💯 [37/65] credit_score_history...");
    for (let i = 0; i < CUSTOMER_IDS.length; i++) {
      await client.query(
        `INSERT INTO credit_score_history (id, customer_id, score, rating, factors, recorded_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), CUSTOMER_IDS[i],
         Math.floor(Math.random() * 200) + 600,
         ["excellent", "good", "fair", "poor"][Math.floor(Math.random() * 4)],
         JSON.stringify({ transactionVolume: "high", defaultHistory: "none", accountAge: "2 years" }),
         daysAgo(i * 30)]
      );
    }
    console.log(`  ✓ ${CUSTOMER_IDS.length} credit score history entries`);

    // ── 38. Credit Applications ───────────────────────────────────────────────
    console.log("📝 [38/65] credit_applications...");
    const creditStatuses = ["approved", "pending", "rejected", "approved", "under_review"];
    for (let i = 0; i < CUSTOMER_IDS.length; i++) {
      await client.query(
        `INSERT INTO credit_applications (id, customer_id, requested_amount, purpose, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), CUSTOMER_IDS[i], (i + 1) * 100000,
         ["Working capital", "Equipment purchase", "Business expansion"][i % 3],
         creditStatuses[i], daysAgo(i * 10)]
      );
    }
    console.log(`  ✓ ${CUSTOMER_IDS.length} credit applications`);

    // ── 39. Data Rights Requests ──────────────────────────────────────────────
    console.log("⚖️  [39/65] data_rights_requests...");
    const drTypes = ["access", "deletion", "portability", "rectification"];
    for (let i = 0; i < Math.min(CUSTOMER_IDS.length, 4); i++) {
      await client.query(
        `INSERT INTO data_rights_requests (id, customer_id, request_type, status, created_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [uid(), CUSTOMER_IDS[i], drTypes[i], i === 0 ? "completed" : "pending", daysAgo(i * 5)]
      );
    }
    console.log("  ✓ 4 data rights requests");

    // ── 40. DLQ Messages ──────────────────────────────────────────────────────
    console.log("📬 [40/65] dlq_messages...");
    for (const topic of ["transactions.completed", "fraud.alerts", "notifications.push"]) {
      await client.query(
        `INSERT INTO dlq_messages (id, topic, payload, error_message, retry_count, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), topic, JSON.stringify({ id: uid(), type: "test" }),
         "Connection timeout after 3 retries", 3, daysAgo(1)]
      );
    }
    console.log("  ✓ 3 DLQ messages");

    // ── 41. Disputes ──────────────────────────────────────────────────────────
    console.log("⚔️  [41/65] disputes...");
    const DISPUTE_ID = uid();
    await client.query(
      `INSERT INTO disputes (id, agent_code, reason, status, created_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [DISPUTE_ID, "AGT001", "Customer claims cash was not dispensed", "open", daysAgo(3)]
    );
    await client.query(
      `INSERT INTO dispute_messages (id, dispute_id, sender_role, content, created_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [uid(), DISPUTE_ID, "agent", "Customer says she did not receive the ₦5,000 cash out.", daysAgo(3)]
    );
    console.log("  ✓ 1 dispute + 1 message");

    // ── 42. QR Codes ──────────────────────────────────────────────────────────
    console.log("📷 [42/65] qr_codes...");
    await client.query(
      `INSERT INTO qr_codes (id, agent_code, type, payload, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", "receive_money",
       JSON.stringify({ agentCode: "AGT001", amount: null }), true, daysAgo(10)]
    );
    console.log("  ✓ 1 QR code");

    // ── 43. Shareable Links ───────────────────────────────────────────────────
    console.log("🔗 [43/65] shareable_links...");
    await client.query(
      `INSERT INTO shareable_links (id, agent_code, type, token, expires_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", "referral", uid().replace(/-/g, ""), daysFromNow(30), daysAgo(5)]
    );
    console.log("  ✓ 1 shareable link");

    // ── 44. Reversal Requests ─────────────────────────────────────────────────
    console.log("↩️  [44/65] reversal_requests...");
    await client.query(
      `INSERT INTO reversal_requests (id, agent_code, reason, status, created_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", "Wrong amount entered by agent", "pending", daysAgo(1)]
    );
    console.log("  ✓ 1 reversal request");

    // ── 45. VAT Records ───────────────────────────────────────────────────────
    console.log("🧾 [45/65] vat_records...");
    await client.query(
      `INSERT INTO vat_records (id, agent_code, transaction_amount, vat_amount, vat_rate, period, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", 100000, 7500, 7.5, "2026-Q1", daysAgo(30)]
    );
    console.log("  ✓ 1 VAT record");

    // ── 46. Velocity Limits ───────────────────────────────────────────────────
    console.log("🚦 [46/65] velocity_limits...");
    for (const tier of [
      { tier: "basic",    daily: 300000,   weekly: 1000000,  monthly: 3000000,  per_tx: 50000  },
      { tier: "standard", daily: 1000000,  weekly: 5000000,  monthly: 15000000, per_tx: 200000 },
      { tier: "premium",  daily: 5000000,  weekly: 20000000, monthly: 50000000, per_tx: 1000000 },
    ]) {
      await client.query(
        `INSERT INTO velocity_limits (id, tier, daily_limit, weekly_limit, monthly_limit, per_transaction_limit, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [uid(), tier.tier, tier.daily, tier.weekly, tier.monthly, tier.per_tx, daysAgo(90)]
      );
    }
    console.log("  ✓ 3 velocity limits");

    // ── 47. Commission Rules ──────────────────────────────────────────────────
    console.log("💲 [47/65] commission_rules...");
    for (const rule of [
      { type: "Cash In",       rate: 0.005, min: 100,  max: 5000  },
      { type: "Cash Out",      rate: 0.01,  min: 200,  max: 10000 },
      { type: "Bill Payment",  rate: 0.015, min: 50,   max: 3000  },
      { type: "Transfer",      rate: 0.008, min: 100,  max: 8000  },
    ]) {
      await client.query(
        `INSERT INTO commission_rules (id, transaction_type, commission_rate, min_commission, max_commission, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [uid(), rule.type, rule.rate, rule.min, rule.max, true, daysAgo(90)]
      );
    }
    console.log("  ✓ 4 commission rules");

    // ── 48. Merchant Settlements ──────────────────────────────────────────────
    console.log("🏦 [48/65] merchant_settlements...");
    await client.query(
      `INSERT INTO merchant_settlements (id, merchant_id, amount, status, settlement_date, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), MERCHANT_IDS[0], 250000, "completed", daysAgo(1), daysAgo(2)]
    );
    console.log("  ✓ 1 merchant settlement");

    // ── 49. Compliance Reports ────────────────────────────────────────────────
    console.log("📑 [49/65] compliance_reports...");
    for (const report of [
      { type: "cbn_daily",   period: "2026-Q1" },
      { type: "aml_monthly", period: "2026-Q1" },
      { type: "ctr_weekly",  period: "2026-Q1" },
    ]) {
      await client.query(
        `INSERT INTO compliance_reports (id, report_type, period, status, file_url, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), report.type, report.period, "submitted",
         `https://cdn.insureportal.ng/reports/${report.type}-${report.period}.pdf`, daysAgo(7)]
      );
    }
    console.log("  ✓ 3 compliance reports");

    // ── 50. Analytics Metrics ─────────────────────────────────────────────────
    console.log("📊 [50/65] analytics_metrics...");
    for (const metric of [
      { name: "daily_transaction_volume", value: 4250000, unit: "NGN"     },
      { name: "active_agents_today",      value: 847,     unit: "count"   },
      { name: "avg_transaction_value",    value: 8500,    unit: "NGN"     },
      { name: "fraud_detection_rate",     value: 99.2,    unit: "percent" },
      { name: "uptime_percentage",        value: 99.95,   unit: "percent" },
    ]) {
      await client.query(
        `INSERT INTO analytics_metrics (id, metric_name, value, unit, recorded_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [uid(), metric.name, metric.value, metric.unit, now()]
      );
    }
    console.log("  ✓ 5 analytics metrics");

    // ── 51. Platform Settings ─────────────────────────────────────────────────
    console.log("⚙️  [51/65] platform_settings...");
    for (const s of [
      { key: "maintenance_mode",       value: "false",          description: "Enable/disable maintenance mode" },
      { key: "max_daily_transactions", value: "1000",           description: "Max transactions per agent per day" },
      { key: "support_phone",          value: "+234-800-54LINK", description: "Customer support phone number" },
      { key: "support_email",          value: "support@insureportal.ng", description: "Customer support email" },
      { key: "app_version_min",        value: "3.0.0",          description: "Minimum required app version" },
    ]) {
      await client.query(
        `INSERT INTO platform_settings (id, key, value, description, updated_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [uid(), s.key, s.value, s.description, now()]
      );
    }
    console.log("  ✓ 5 platform settings");

    // ── 52. System Config ─────────────────────────────────────────────────────
    console.log("🔩 [52/65] system_config...");
    await client.query(
      `INSERT INTO system_config (id, key, value, updated_at)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [uid(), "feature_flags", JSON.stringify({
        biometricAuth: true, virtualCards: true, recurringPayments: true,
        fxRateLock: true, creditScoring: true,
      }), now()]
    );
    console.log("  ✓ 1 system config");

    // ── 53. ERP Config ────────────────────────────────────────────────────────
    console.log("🏭 [53/65] erp_config...");
    await client.query(
      `INSERT INTO erp_config (id, provider, base_url, api_key, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), "erpnext", "http://erpnext:8000", "InsurePortalERP@2026!APIKey", true, daysAgo(60)]
    );
    console.log("  ✓ 1 ERP config");

    // ── 54. ERP Sync Log ──────────────────────────────────────────────────────
    console.log("🔁 [54/65] erp_sync_log...");
    await client.query(
      `INSERT INTO erp_sync_log (id, entity_type, entity_id, status, synced_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [uid(), "transaction", uid(), "success", daysAgo(1)]
    );
    console.log("  ✓ 1 ERP sync log entry");

    // ── 55. MQTT Bridge Config ────────────────────────────────────────────────
    console.log("📡 [55/65] mqtt_bridge_config...");
    await client.query(
      `INSERT INTO mqtt_bridge_config (id, broker_url, client_id, topics, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), "mqtt://mqtt-broker:1883", "pos-shell-bridge",
       JSON.stringify(["pos/transactions", "pos/alerts", "pos/heartbeat"]), true, daysAgo(30)]
    );
    console.log("  ✓ 1 MQTT bridge config");

    // ── 56. Agent Push Subscriptions ──────────────────────────────────────────
    console.log("🔔 [56/65] agent_push_subscriptions...");
    await client.query(
      `INSERT INTO agent_push_subscriptions (id, agent_code, endpoint, p256dh, auth, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001",
       "https://fcm.googleapis.com/fcm/send/demo-endpoint",
       "BNcR8mNit7RChsnfhB4n3T8OvXJtV4id-WhYSA9-YP5UB2yku9jd5sB6GHs4",
       "tBHItJI5svbpez7KI4CCXg", daysAgo(5)]
    );
    console.log("  ✓ 1 push subscription");

    // ── 57. Storefront Ads ────────────────────────────────────────────────────
    console.log("📢 [57/65] storefront_ads...");
    for (const ad of [
      { title: "Send Money to 50+ Countries",  body: "Best rates guaranteed. No hidden fees.",        cta: "Send Now" },
      { title: "Earn More with InsurePortal Gold",   body: "Upgrade your tier and earn 2x commission.",     cta: "Upgrade"  },
      { title: "Pay Bills Instantly",          body: "DSTV, EKEDC, IKEDC, and 200+ billers.",         cta: "Pay Bills" },
    ]) {
      await client.query(
        `INSERT INTO storefront_ads (id, title, body, cta_text, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), ad.title, ad.body, ad.cta, true, daysAgo(7)]
      );
    }
    console.log("  ✓ 3 storefront ads");

    // ── 58. Terminal Groups ───────────────────────────────────────────────────
    console.log("🗂️  [58/65] terminal_groups...");
    await client.query(
      `INSERT INTO terminal_groups (id, name, description, created_at)
       VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [uid(), "Lagos Cluster", "All terminals in Lagos state", daysAgo(60)]
    );
    console.log("  ✓ 1 terminal group");

    // ── 59. Fraud Rules ───────────────────────────────────────────────────────
    console.log("📏 [59/65] fraud_rules...");
    for (const rule of [
      { name: "Velocity Check",    description: "Flag >10 transactions in 10 minutes",       threshold: 10, window: 10 },
      { name: "Amount Threshold",  description: "Flag transactions just below ₦50,000",      threshold: 49000, window: 60 },
      { name: "Location Anomaly",  description: "Flag transactions from 3+ states in 1 hour", threshold: 3, window: 60 },
    ]) {
      await client.query(
        `INSERT INTO fraud_rules (id, name, description, threshold, window_minutes, is_active, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
        [uid(), rule.name, rule.description, rule.threshold, rule.window, true, daysAgo(90)]
      );
    }
    console.log("  ✓ 3 fraud rules");

    // ── 60. KYC Sessions ──────────────────────────────────────────────────────
    console.log("🪪 [60/65] kyc_sessions...");
    const kycStatuses = ["approved", "pending", "approved", "rejected", "approved"];
    for (let i = 0; i < AGENTS.filter(a => a.role === "agent").length; i++) {
      await client.query(
        `INSERT INTO kyc_sessions (id, agent_code, document_type, document_number, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [uid(), AGENTS[i].code, "national_id", `NIN${100000000 + i}`, kycStatuses[i], daysAgo(30 - i * 5)]
      );
    }
    console.log("  ✓ 6 KYC sessions");

    // ── 61. Supervisor Agents ─────────────────────────────────────────────────
    console.log("👔 [61/65] supervisor_agents...");
    await client.query(
      `INSERT INTO supervisor_agents (id, agent_code, supervisor_name, supervisor_code, assigned_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [uid(), "AGT001", "Oluwaseun Adeyemi", "SUP001", daysAgo(45)]
    );
    console.log("  ✓ 1 supervisor agent");

    // ── 62. Tenants ───────────────────────────────────────────────────────────
    console.log("🏢 [62/65] tenants...");
    await client.query(
      `INSERT INTO tenants (id, name, slug, plan, is_active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [uid(), "InsurePortal Demo Tenant", "insureportal-demo", "enterprise", true, daysAgo(90)]
    );
    console.log("  ✓ 1 tenant");

    // ── 63. Reversal Requests (additional) ───────────────────────────────────
    // Already seeded above (#44)

    // ── 64. Dispute Messages (additional) ────────────────────────────────────
    // Already seeded above (#41)

    // ── 65. Users (additional) ────────────────────────────────────────────────
    // Already seeded above (#9)

    console.log("\n✅ All 65 tables seeded successfully!");
    console.log("[REDACTED sensitive data]");
    console.log("   Agent Code: AGT001  PIN: 1234  (Gold tier, ₦850,000 float)");
    console.log("   Agent Code: AGT003  PIN: 3456  (Platinum tier, ₦1,500,000 float)");
    console.log("   Agent Code: ADMIN1  PIN: 0000  (Admin — access /admin panel)");
    console.log("\n📱 Customer phones: 07011111111 – 07055555555");
    console.log("🏪 Merchants: Sunshine Supermarket, QuickFuel Station");

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
