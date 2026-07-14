import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { pgTable, serial, varchar, text, timestamp, pgEnum, numeric } from "drizzle-orm/pg-core";

// Define schemas inline for seed script
const roleEnum = pgEnum('role', ['user', 'admin']);
const policyTypeEnum = pgEnum('policy_type', ['Health', 'Auto', 'Property', 'Life']);
const policyStatusEnum = pgEnum('policy_status', ['Active', 'Expired', 'Cancelled']);
const claimStatusEnum = pgEnum('claim_status', ['Submitted', 'Under Review', 'Approved', 'Rejected', 'Paid']);
const paymentStatusEnum = pgEnum('payment_status', ['Pending', 'Completed', 'Failed']);

const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: roleEnum("role").default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

const policies = pgTable("policies", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  policyNumber: varchar("policyNumber", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  type: policyTypeEnum("type").notNull(),
  premium: numeric("premium", { precision: 10, scale: 2 }).notNull(),
  status: policyStatusEnum("status").default("Active").notNull(),
  startDate: timestamp("startDate").notNull(),
  expiryDate: timestamp("expiryDate").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

const claims = pgTable("claims", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  policyId: serial("policyId").notNull(),
  claimNumber: varchar("claimNumber", { length: 50 }).notNull().unique(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: claimStatusEnum("status").default("Submitted").notNull(),
  incidentDate: timestamp("incidentDate").notNull(),
  description: text("description").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  policyId: serial("policyId").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: paymentStatusEnum("status").default("Pending").notNull(),
  dueDate: timestamp("dueDate").notNull(),
  paidDate: timestamp("paidDate"),
  paymentMethod: varchar("paymentMethod", { length: 50 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

async function seed() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const client = postgres(connectionString);
  const db = drizzle(client);

  console.log("🌱 Seeding database...");

  try {
    // Create test user
    const testUser = await db.insert(users).values({
      openId: "test-user-123",
      name: "John Doe",
      email: "john.doe@example.com",
      role: "user",
    }).returning();
    
    const userId = testUser[0].id;
    console.log(`✅ Created user: ${testUser[0].name} (ID: ${userId})`);

    // Create policies
    const now = new Date();
    const oneYearFromNow = new Date(now);
    oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

    const policiesData = [
      {
        userId,
        policyNumber: "POL-2024-001",
        name: "Comprehensive Health Insurance",
        type: "Health",
        premium: "15000.00",
        status: "Active",
        startDate: now,
        expiryDate: oneYearFromNow,
      },
      {
        userId,
        policyNumber: "POL-2024-002",
        name: "Auto Insurance - Toyota Camry",
        type: "Auto",
        premium: "8500.00",
        status: "Active",
        startDate: now,
        expiryDate: oneYearFromNow,
      },
      {
        userId,
        policyNumber: "POL-2024-003",
        name: "Home Insurance - Lagos Property",
        type: "Property",
        premium: "25000.00",
        status: "Active",
        startDate: now,
        expiryDate: oneYearFromNow,
      },
    ];

    const createdPolicies = await db.insert(policies).values(policiesData).returning();
    console.log(`✅ Created ${createdPolicies.length} policies`);

    // Create claims
    const claimsData = [
      {
        userId,
        policyId: createdPolicies[0].id,
        claimNumber: "CLM-2024-001",
        amount: "5000.00",
        status: "Approved",
        incidentDate: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        description: "Medical treatment for minor surgery",
      },
      {
        userId,
        policyId: createdPolicies[1].id,
        claimNumber: "CLM-2024-002",
        amount: "12000.00",
        status: "Under Review",
        incidentDate: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
        description: "Vehicle accident repair - front bumper and headlight damage",
      },
    ];

    const createdClaims = await db.insert(claims).values(claimsData).returning();
    console.log(`✅ Created ${createdClaims.length} claims`);

    // Create payments
    const paymentsData = [
      {
        userId,
        policyId: createdPolicies[0].id,
        amount: "15000.00",
        status: "Completed",
        dueDate: new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000), // 60 days ago
        paidDate: new Date(now.getTime() - 58 * 24 * 60 * 60 * 1000), // 58 days ago
        paymentMethod: "Credit Card",
      },
      {
        userId,
        policyId: createdPolicies[1].id,
        amount: "8500.00",
        status: "Pending",
        dueDate: new Date(now.getTime() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
        paidDate: null,
        paymentMethod: null,
      },
      {
        userId,
        policyId: createdPolicies[2].id,
        amount: "25000.00",
        status: "Completed",
        dueDate: new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
        paidDate: new Date(now.getTime() - 43 * 24 * 60 * 60 * 1000), // 43 days ago
        paymentMethod: "Bank Transfer",
      },
    ];

    const createdPayments = await db.insert(payments).values(paymentsData).returning();
    console.log(`✅ Created ${createdPayments.length} payments`);

    console.log("\n🎉 Seeding completed successfully!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

seed();
