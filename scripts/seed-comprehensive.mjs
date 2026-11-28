/**
 * InsurePortal Comprehensive Seed Data Script
 * Populates all tables with realistic Nigerian insurance market data.
 * 
 * Usage: node server/seed-comprehensive.mjs
 * Requires: DATABASE_URL environment variable
 */

import pg from "pg";
const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function seed() {
  console.log("🌱 Starting InsurePortal seed...");

  // --- Insurance Products ---
  const products = [
    { code: "NIC/MOT/2026/001", name: "Motor Comprehensive", category: "motor", min_premium: 25000, max_sum_insured: 50000000 },
    { code: "NIC/MOT/2026/002", name: "Motor Third Party", category: "motor", min_premium: 5000, max_sum_insured: 5000000 },
    { code: "NIC/LIF/2026/001", name: "Term Life Assurance", category: "life", min_premium: 50000, max_sum_insured: 500000000 },
    { code: "NIC/LIF/2026/002", name: "Whole Life Policy", category: "life", min_premium: 100000, max_sum_insured: 1000000000 },
    { code: "NIC/HLT/2026/001", name: "Health Individual", category: "health", min_premium: 75000, max_sum_insured: 20000000 },
    { code: "NIC/HLT/2026/002", name: "Health Family Plan", category: "health", min_premium: 150000, max_sum_insured: 50000000 },
    { code: "NIC/FIR/2026/001", name: "Fire & Burglary", category: "fire", min_premium: 30000, max_sum_insured: 100000000 },
    { code: "NIC/MAR/2026/001", name: "Marine Cargo", category: "marine", min_premium: 100000, max_sum_insured: 500000000 },
    { code: "NIC/LIA/2026/001", name: "Professional Indemnity", category: "liability", min_premium: 50000, max_sum_insured: 200000000 },
    { code: "NIC/LIA/2026/002", name: "Public Liability", category: "liability", min_premium: 40000, max_sum_insured: 100000000 },
    { code: "NIC/MIC/2026/001", name: "Micro Motor", category: "micro", min_premium: 1000, max_sum_insured: 1000000 },
    { code: "NIC/MIC/2026/002", name: "Micro Crop", category: "micro", min_premium: 500, max_sum_insured: 500000 },
  ];

  // --- Risk Tables ---
  const riskZones = [
    { state: "Lagos", zone: "high", loading: 1.25 },
    { state: "Abuja", zone: "medium", loading: 1.10 },
    { state: "Rivers", zone: "high", loading: 1.30 },
    { state: "Kano", zone: "medium", loading: 1.15 },
    { state: "Ogun", zone: "medium", loading: 1.10 },
    { state: "Kaduna", zone: "high", loading: 1.20 },
    { state: "Enugu", zone: "low", loading: 1.00 },
    { state: "Oyo", zone: "low", loading: 1.00 },
    { state: "Borno", zone: "very_high", loading: 1.50 },
    { state: "Delta", zone: "medium", loading: 1.15 },
  ];

  // --- Agent Network ---
  const agents = [
    { code: "AG-LAG-001", name: "Adebayo Insurance Brokers", state: "Lagos", tier: "platinum", monthly_premium: 85000000 },
    { code: "AG-ABJ-001", name: "Capital Risk Advisors", state: "Abuja", tier: "gold", monthly_premium: 45000000 },
    { code: "AG-KAN-001", name: "Northern Shield Agency", state: "Kano", tier: "silver", monthly_premium: 12000000 },
    { code: "AG-RIV-001", name: "Delta Marine Brokers", state: "Rivers", tier: "gold", monthly_premium: 35000000 },
    { code: "AG-OGU-001", name: "Gateway Insurance Services", state: "Ogun", tier: "silver", monthly_premium: 8000000 },
    { code: "AG-ENU-001", name: "Eastern Star Assurance", state: "Enugu", tier: "bronze", monthly_premium: 3000000 },
    { code: "AG-OYO-001", name: "Ibadan Insurance Hub", state: "Oyo", tier: "silver", monthly_premium: 10000000 },
    { code: "AG-KAD-001", name: "Zaria Risk Partners", state: "Kaduna", tier: "bronze", monthly_premium: 4500000 },
  ];

  // --- Compliance Thresholds ---
  const complianceRules = [
    { rule_id: "NAICOM-CAP-001", description: "Minimum paid-up capital (General)", threshold: 10000000000, unit: "NGN" },
    { rule_id: "NAICOM-CAP-002", description: "Minimum paid-up capital (Life)", threshold: 8000000000, unit: "NGN" },
    { rule_id: "NAICOM-CAP-003", description: "Minimum paid-up capital (Micro)", threshold: 600000000, unit: "NGN" },
    { rule_id: "NAICOM-SOL-001", description: "Minimum solvency ratio", threshold: 15, unit: "percent" },
    { rule_id: "CBN-AML-001", description: "Single transaction reporting threshold", threshold: 5000000, unit: "NGN" },
    { rule_id: "CBN-AML-002", description: "Cumulative reporting threshold (24h)", threshold: 10000000, unit: "NGN" },
    { rule_id: "NAICOM-RES-001", description: "Claims reserve minimum", threshold: 40, unit: "percent" },
    { rule_id: "NAICOM-INV-001", description: "Investment in real estate max", threshold: 25, unit: "percent" },
  ];

  // --- Demo Users ---
  const users = [
    { email: "admin@insureportal.ng", role: "admin", name: "System Administrator" },
    { email: "underwriter@insureportal.ng", role: "underwriter", name: "Sarah Okafor" },
    { email: "claims@insureportal.ng", role: "claims_officer", name: "Michael Adeyemi" },
    { email: "compliance@insureportal.ng", role: "compliance_officer", name: "Fatima Ibrahim" },
    { email: "agent@insureportal.ng", role: "agent", name: "Chidinma Eze" },
    { email: "actuarial@insureportal.ng", role: "actuary", name: "Oluwaseun Bakare" },
  ];

  console.log(`  📦 ${products.length} insurance products`);
  console.log(`  🗺️  ${riskZones.length} risk zones`);
  console.log(`  👥 ${agents.length} agents`);
  console.log(`  📋 ${complianceRules.length} compliance rules`);
  console.log(`  🔑 ${users.length} demo users`);

  // Execute inserts (safe with ON CONFLICT DO NOTHING)
  try {
    await pool.query("BEGIN");

    for (const p of products) {
      await pool.query(
        `INSERT INTO products (code, name, category, min_premium, max_sum_insured) 
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING`,
        [p.code, p.name, p.category, p.min_premium, p.max_sum_insured]
      );
    }

    for (const z of riskZones) {
      await pool.query(
        `INSERT INTO risk_zones (state, zone, loading_factor) 
         VALUES ($1, $2, $3) ON CONFLICT (state) DO NOTHING`,
        [z.state, z.zone, z.loading]
      );
    }

    for (const a of agents) {
      await pool.query(
        `INSERT INTO agents (code, name, state, tier, monthly_premium) 
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (code) DO NOTHING`,
        [a.code, a.name, a.state, a.tier, a.monthly_premium]
      );
    }

    for (const c of complianceRules) {
      await pool.query(
        `INSERT INTO compliance_rules (rule_id, description, threshold, unit) 
         VALUES ($1, $2, $3, $4) ON CONFLICT (rule_id) DO NOTHING`,
        [c.rule_id, c.description, c.threshold, c.unit]
      );
    }

    for (const u of users) {
      await pool.query(
        `INSERT INTO users (email, role, name) 
         VALUES ($1, $2, $3) ON CONFLICT (email) DO NOTHING`,
        [u.email, u.role, u.name]
      );
    }

    await pool.query("COMMIT");
    console.log("\n✅ Seed completed successfully!");
  } catch (err) {
    await pool.query("ROLLBACK");
    console.error("❌ Seed failed:", err.message);
    console.log("Note: Tables may not exist yet. Run db:push first.");
  } finally {
    await pool.end();
  }
}

seed();
