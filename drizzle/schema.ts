/**
 * InsurePortal Database Schema
 *
 * SOC 2 / PCI-DSS DATA CLASSIFICATION:
 *
 * CONFIDENTIAL (PII/Sensitive):
 *   - customers: name, email, phone, address, date_of_birth, bvn, nin
 *   - kyc_verifications: document_number, face_image_url, biometric_data
 *   - agents: bank_account_number, bvn
 *   - policies: beneficiary details
 *
 * RESTRICTED (Financial):
 *   - transactions: amount, account_id, reference
 *   - claims_payments: payout_amount, bank_details
 *   - commissions: amount, agent_id
 *   - platform_billing_ledger: amount, tenant_id
 *
 * INTERNAL (Operational):
 *   - audit_log: all entries
 *   - fraud_alerts: risk scores
 *   - workflow_instances: execution state
 *
 * PUBLIC:
 *   - insurance_product_types: product names, descriptions
 *   - service_nodes: health status
 *
 * PAN/CVV/Card data: NEVER stored in this database.
 * All payment card data is tokenized via paymentTokenVault before storage.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  json,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

// ─── Enums ────────────────────────────────────────────────────────────────────
export const roleEnum = pgEnum("role", ["user", "admin", "supervisor"]);
export const agentTierEnum = pgEnum("agent_tier", [
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
]);
export const txTypeEnum = pgEnum("tx_type", [
  "Cash In",
  "Cash Out",
  "Transfer",
  "Card Payment",
  "QR Payment",
  "NFC Payment",
  "Airtime",
  "Bill Payment",
  "Reversal",
  "Nano Loan",
  "Insurance",
  // F-01: agent-to-agent float movement legs (debit / credit)
  "Float Transfer",
  "Float Transfer Received",
]);
export const txChannelEnum = pgEnum("tx_channel", [
  "Cash",
  "Card",
  "USSD",
  "QR",
  "NFC",
  "App",
  // F-01: internal ledger movements (no external rail)
  "Internal",
]);
export const txStatusEnum = pgEnum("tx_status", [
  "success",
  "pending",
  "failed",
  "reversed",
  "pending_reversal_approval",
]);
export const fraudSeverityEnum = pgEnum("fraud_severity", [
  "critical",
  "high",
  "medium",
  "low",
]);
export const fraudStatusEnum = pgEnum("fraud_status", [
  "open",
  "investigating",
  "escalated",
  "dismissed",
  "resolved",
]);
export const loyaltyTypeEnum = pgEnum("loyalty_type", [
  "earned",
  "redeemed",
  "bonus",
  "penalty",
  "challenge",
]);
export const chatStatusEnum = pgEnum("chat_status", [
  "open",
  "assigned",
  "resolved",
  "escalated",
]);
export const senderTypeEnum = pgEnum("sender_type", [
  "agent",
  "support",
  "system",
]);
export const auditStatusEnum = pgEnum("audit_status", [
  "success",
  "failure",
  "warning",
]);
export const topupStatusEnum = pgEnum("topup_status", [
  "pending",
  "approved",
  "rejected",
]);
export const commissionRuleTypeEnum = pgEnum("commission_rule_type", [
  "percentage",
  "flat",
  "tiered",
]);
export const qrCodeTypeEnum = pgEnum("qr_code_type", [
  "payment",
  "profile",
  "collection",
  "agent_id",
  "product",
  "event",
  "loyalty",
]); // expanded for router compatibility
export const qrCodeStatusEnum = pgEnum("qr_code_status", [
  "active",
  "used",
  "expired",
  "revoked",
]);
export const inventoryStatusEnum = pgEnum("inventory_status", [
  "in_stock",
  "low_stock",
  "out_of_stock",
  "discontinued",
]);
export const simStatusEnum = pgEnum("sim_status", [
  "active",
  "inactive",
  "suspended",
  "standby",
  "failed",
  "disabled",
]); // expanded
export const reversalStatusEnum = pgEnum("reversal_status", [
  "pending",
  "approved",
  "rejected",
  "processed",
  "completed",
  "failed",
]); // expanded
export const linkTypeEnum = pgEnum("link_type", [
  "payment",
  "collection",
  "profile",
  "invoice",
  "subscription",
  "donation",
]); // expanded
export const linkStatusEnum = pgEnum("link_status", [
  "active",
  "expired",
  "paused",
  "deleted",
  "used",
  "revoked",
]); // expanded
export const customerStatusEnum = pgEnum("customer_status", [
  "pending_kyc",
  "active",
  "suspended",
  "blacklisted",
]);
export const tenantStatusEnum = pgEnum("tenant_status", [
  "trial",
  "active",
  "suspended",
  "churned",
]);
export const erpSyncStatusEnum = pgEnum("erp_sync_status", [
  "pending",
  "synced",
  "failed",
  "skipped",
]);
export const adStatusEnum = pgEnum("ad_status", [
  "draft",
  "active",
  "paused",
  "completed",
  "expired",
  "rejected",
]); // expanded
export const vatRateTypeEnum = pgEnum("vat_rate_type", [
  "standard",
  "zero",
  "exempt",
]);
export const erpTypeEnum = pgEnum("erp_type", [
  "odoo",
  "sap",
  "netsuite",
  "quickbooks",
  "sage",
  "dynamics365",
  "custom",
]);
export const mqttQosEnum = pgEnum("mqtt_qos", ["0", "1", "2"]);
// P3-A: Merchant portal
export const merchantStatusEnum = pgEnum("merchant_status", [
  "pending",
  "active",
  "suspended",
  "closed",
]);
export const merchantCategoryEnum = pgEnum("merchant_category", [
  "retail",
  "food_beverage",
  "health",
  "education",
  "transport",
  "utilities",
  "government",
  "other",
]);
// P3-C: Developer API
export const apiKeyStatusEnum = pgEnum("api_key_status", [
  "active",
  "revoked",
  "expired",
]);
// P3-D: FIDO2
export const fido2StatusEnum = pgEnum("fido2_status", ["active", "revoked"]);
// P1-C: Email notifications
export const emailStatusEnum = pgEnum("email_status", [
  "queued",
  "sent",
  "failed",
  "bounced",
]);
// P3-B: Credit scoring
export const creditRatingEnum = pgEnum("credit_rating", [
  "AAA",
  "AA",
  "A",
  "BBB",
  "BB",
  "B",
  "CCC",
  "D",
  "N/A",
]);
export const creditApplicationStatusEnum = pgEnum("credit_application_status", [
  "pending",
  "approved",
  "rejected",
  "disbursed",
  "repaid",
  "defaulted",
]);

// ─── Users (Keycloak OIDC) ───────────────────────────────────────────────────
export const users = pgTable(
  "users",
  {
    id: serial("id").primaryKey(),
    keycloakSub: varchar("keycloakSub", { length: 128 }).notNull().unique(),
    name: text("name"),
    email: varchar("email", { length: 320 }),
    loginMethod: varchar("loginMethod", { length: 64 }),
    role: roleEnum("role").default("user").notNull(),
    // P0-C: MFA
    mfaEnabled: boolean("mfaEnabled").default(false).notNull(),
    mfaEnforcedAt: timestamp("mfaEnforcedAt"),
    // P0-B: Tenant isolation
    tenantId: integer("tenantId"),
    // Stripe integration
    stripeCustomerId: varchar("stripeCustomerId", { length: 255 }),
    stripeSubscriptionId: varchar("stripeSubscriptionId", { length: 255 }),
    stripePlanId: varchar("stripePlanId", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
  },
  t => ({
    keycloakSubIdx: uniqueIndex("users_keycloakSub_idx").on(t.keycloakSub),
    tenantIdIdx: index("users_tenantId_idx").on(t.tenantId),
    roleIdx: index("users_role_idx").on(t.role),
  })
);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

// ─── Agents ──────────────────────────────────────────────────────────────────
export const agents = pgTable(
  "agents",
  {
    id: serial("id").primaryKey(),
    agentId: varchar("agentId", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 128 }).notNull(),
    phone: varchar("phone", { length: 20 }).notNull(),
    email: varchar("email", { length: 320 }),
    location: varchar("location", { length: 128 }),
    terminalModel: varchar("terminalModel", { length: 64 }).default(
      "PAX A920 MAX"
    ),
    terminalSerial: varchar("terminalSerial", { length: 64 }),
    tier: agentTierEnum("tier").default("Bronze").notNull(),
    role: varchar("role", { length: 32 }).default("agent").notNull(),
    pinHash: varchar("pinHash", { length: 128 }).notNull(),
    premiumReserve: numeric("premiumReserve", { precision: 15, scale: 2 })
      .default("0.00")
      .notNull(),
    floatLimit: numeric("floatLimit", { precision: 15, scale: 2 })
      .default("1000000.00")
      .notNull(),
    commissionBalance: numeric("commissionBalance", { precision: 15, scale: 2 })
      .default("0.00")
      .notNull(),
    loyaltyPoints: integer("loyaltyPoints").default(0).notNull(),
    streak: integer("streak").default(0).notNull(),
    rank: integer("rank").default(0),
    isActive: boolean("isActive").default(true).notNull(),
    floatLocked: boolean("floatLocked").default(false).notNull(),
    terminalEnabled: boolean("terminalEnabled").default(true).notNull(),
    terminalDisabledReason: text("terminalDisabledReason"),
    lastLoginAt: timestamp("lastLoginAt"),
    // P0-B: Soft delete
    deletedAt: timestamp("deletedAt"),
    // P0-B: Tenant isolation
    tenantId: integer("tenantId"),
    // P3-B: Credit scoring
    creditScore: integer("creditScore").default(0),
    creditLimit: numeric("creditLimit", { precision: 15, scale: 2 }).default(
      "0.00"
    ),
    creditRating: creditRatingEnum("creditRating").default("N/A"),
    // Sprint 48: Hierarchical agent structure
    parentAgentId: integer("parentAgentId"),
    hierarchyRole: varchar("hierarchyRole", { length: 32 }).default("agent"), // super_agent, master_agent, agent, sub_agent
    hierarchyLevel: integer("hierarchyLevel").default(3), // 0=platform, 1=super, 2=master, 3=agent, 4=sub
    commissionSplitOverride: numeric("commissionSplitOverride", {
      precision: 5,
      scale: 2,
    }), // override default split %
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdIdx: uniqueIndex("agents_agentId_idx").on(t.agentId),
    isActiveIdx: index("agents_isActive_idx").on(t.isActive),
    deletedAtIdx: index("agents_deletedAt_idx").on(t.deletedAt),
    tenantIdIdx: index("agents_tenantId_idx").on(t.tenantId),
    tierIdx: index("agents_tier_idx").on(t.tier),
    parentAgentIdx: index("agents_parentAgentId_idx").on(t.parentAgentId),
    hierarchyRoleIdx: index("agents_hierarchyRole_idx").on(t.hierarchyRole),
  })
);

export type Agent = typeof agents.$inferSelect;
export type InsertAgent = typeof agents.$inferInsert;

// ─── Transactions ─────────────────────────────────────────────────────────────
export const transactions = pgTable(
  "transactions",
  {
    id: serial("id").primaryKey(),
    ref: varchar("ref", { length: 32 }).notNull().unique(),
    // P0-A: Idempotency key prevents double-spend on network retry
    idempotencyKey: varchar("idempotencyKey", { length: 64 }).unique(),
    agentId: integer("agentId").notNull(),
    type: txTypeEnum("type").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    fee: numeric("fee", { precision: 10, scale: 2 }).default("0.00"),
    commission: numeric("commission", { precision: 10, scale: 2 }).default(
      "0.00"
    ),
    // P3-E: Multi-currency
    currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
    customerName: varchar("customerName", { length: 128 }),
    customerPhone: varchar("customerPhone", { length: 20 }),
    customerAccount: varchar("customerAccount", { length: 20 }),
    destinationBank: varchar("destinationBank", { length: 64 }),
    destinationAccount: varchar("destinationAccount", { length: 20 }),
    channel: txChannelEnum("channel").default("Cash"),
    status: txStatusEnum("status").default("pending").notNull(),
    failureReason: text("failureReason"),
    receiptPrinted: boolean("receiptPrinted").default(false),
    smsSent: boolean("smsSent").default(false),
    fraudScore: numeric("fraudScore", { precision: 5, scale: 2 }).default(
      "0.00"
    ),
    velocityBreached: boolean("velocityBreached").default(false),
    velocityReason: text("velocityReason"),
    approvalRequired: boolean("approvalRequired").default(false),
    approvedBy: varchar("approvedBy", { length: 64 }),
    approvedAt: timestamp("approvedAt"),
    deviceToken: varchar("deviceToken", { length: 64 }),
    metadata: json("metadata"),
    // P0-B: Soft delete + tenant isolation
    deletedAt: timestamp("deletedAt"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdCreatedAtIdx: index("tx_agentId_createdAt_idx").on(
      t.agentId,
      t.createdAt
    ),
    statusCreatedAtIdx: index("tx_status_createdAt_idx").on(
      t.status,
      t.createdAt
    ),
    refIdx: uniqueIndex("tx_ref_idx").on(t.ref),
    idempotencyKeyIdx: uniqueIndex("tx_idempotencyKey_idx").on(
      t.idempotencyKey
    ),
    deletedAtIdx: index("tx_deletedAt_idx").on(t.deletedAt),
    tenantIdIdx: index("tx_tenantId_idx").on(t.tenantId),
    typeCreatedAtIdx: index("tx_type_createdAt_idx").on(t.type, t.createdAt),
  })
);

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;

// ─── Fraud Alerts ─────────────────────────────────────────────────────────────
export const fraudAlerts = pgTable(
  "fraud_alerts",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agentId"),
    transactionId: integer("transactionId"),
    severity: fraudSeverityEnum("severity").notNull(),
    type: varchar("type", { length: 128 }).notNull(),
    customerName: varchar("customerName", { length: 128 }),
    amount: numeric("amount", { precision: 15, scale: 2 }),
    reason: text("reason").notNull(),
    aiExplanation: json("aiExplanation"),
    fraudScore: numeric("fraudScore", { precision: 5, scale: 2 }),
    status: fraudStatusEnum("status").default("open").notNull(),
    assignedTo: varchar("assignedTo", { length: 64 }),
    resolvedAt: timestamp("resolvedAt"),
    snoozedUntil: timestamp("snoozedUntil"),
    escalatedAt: timestamp("escalatedAt"),
    escalatedTo: varchar("escalatedTo", { length: 64 }),
    // P0-B: Soft delete + tenant isolation
    deletedAt: timestamp("deletedAt"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdIdx: index("fraud_agentId_idx").on(t.agentId),
    statusCreatedAtIdx: index("fraud_status_createdAt_idx").on(
      t.status,
      t.createdAt
    ),
    severityIdx: index("fraud_severity_idx").on(t.severity),
    tenantIdIdx: index("fraud_tenantId_idx").on(t.tenantId),
  })
);

export type FraudAlert = typeof fraudAlerts.$inferSelect;
export type InsertFraudAlert = typeof fraudAlerts.$inferInsert;

// ─── Loyalty Points History ───────────────────────────────────────────────────
export const loyaltyHistory = pgTable(
  "loyalty_history",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agentId").notNull(),
    transactionId: integer("transactionId"),
    type: loyaltyTypeEnum("type").notNull(),
    points: integer("points").notNull(),
    description: varchar("description", { length: 256 }),
    balanceAfter: integer("balanceAfter").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    agentIdIdx: index("loyalty_agentId_idx").on(t.agentId),
  })
);

export type LoyaltyHistory = typeof loyaltyHistory.$inferSelect;

// ─── Chat Sessions ────────────────────────────────────────────────────────────
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: serial("id").primaryKey(),
    sessionRef: varchar("sessionRef", { length: 32 }).notNull().unique(),
    agentId: integer("agentId").notNull(),
    category: varchar("category", { length: 64 }),
    subject: varchar("subject", { length: 256 }),
    status: chatStatusEnum("status").default("open").notNull(),
    supportAgentName: varchar("supportAgentName", { length: 128 }),
    rating: integer("rating"),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdStatusIdx: index("chat_agentId_status_idx").on(t.agentId, t.status),
  })
);

export type ChatSession = typeof chatSessions.$inferSelect;

// ─── Chat Messages ────────────────────────────────────────────────────────────
export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("sessionId").notNull(),
    senderType: senderTypeEnum("senderType").notNull(),
    senderName: varchar("senderName", { length: 128 }),
    content: text("content").notNull(),
    isRead: boolean("isRead").default(false),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    sessionIdIdx: index("chat_msg_sessionId_idx").on(t.sessionId),
  })
);

export type ChatMessage = typeof chatMessages.$inferSelect;

// ─── Audit Log ────────────────────────────────────────────────────────────────
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: integer("agentId"),
    action: varchar("action", { length: 128 }).notNull(),
    resource: varchar("resource", { length: 64 }),
    resourceId: varchar("resourceId", { length: 64 }),
    ipAddress: varchar("ipAddress", { length: 45 }),
    userAgent: varchar("userAgent", { length: 256 }),
    status: auditStatusEnum("status").default("success"),
    metadata: json("metadata"),
    // P0-B: Tenant isolation
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    agentIdCreatedAtIdx: index("audit_agentId_createdAt_idx").on(
      t.agentId,
      t.createdAt
    ),
    actionIdx: index("audit_action_idx").on(t.action),
    tenantIdIdx: index("audit_tenantId_idx").on(t.tenantId),
  })
);

export type AuditLog = typeof auditLog.$inferSelect;

// ─── Float Top-Up Requests ────────────────────────────────────────────────────
export const premiumTopUpRequests = pgTable(
  "float_topup_requests",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agentId").notNull(),
    requestedAmount: numeric("requestedAmount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    status: topupStatusEnum("status").default("pending").notNull(),
    approvedBy: varchar("approvedBy", { length: 64 }),
    notes: text("notes"),
    supervisorApprovalRequired: boolean("supervisorApprovalRequired")
      .default(false)
      .notNull(),
    supervisorApprovedBy: varchar("supervisorApprovedBy", { length: 64 }),
    supervisorApprovedAt: timestamp("supervisorApprovedAt"),
    // P0-B: Tenant isolation
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdStatusIdx: index("topup_agentId_status_idx").on(t.agentId, t.status),
    tenantIdIdx: index("topup_tenantId_idx").on(t.tenantId),
  })
);

export type FloatTopUpRequest = typeof premiumTopUpRequests.$inferSelect;

// ─── OTP Tokens (PIN Reset) ───────────────────────────────────────────────────
export const otpTokens = pgTable(
  "otp_tokens",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agentId").notNull(),
    hashedOtp: varchar("hashedOtp", { length: 128 }).notNull(),
    purpose: varchar("purpose", { length: 32 }).default("pin_reset").notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    // SECURITY (THREAT_MODEL.md §7.6): failed-verification counter. The code
    // locks after MAX_OTP_ATTEMPTS wrong guesses (see server/routers/pinReset.ts)
    // so a 6-digit OTP cannot be brute-forced online.
    attempts: integer("attempts").default(0).notNull(),
    // Legacy field used by routers
    used: boolean("used").default(false).notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    agentIdIdx: index("otp_agentId_idx").on(t.agentId),
    expiresAtIdx: index("otp_expiresAt_idx").on(t.expiresAt),
  })
);

export type OtpToken = typeof otpTokens.$inferSelect;

// ─── Devices ─────────────────────────────────────────────────────────────────
export const devices = pgTable(
  "devices",
  {
    id: serial("id").primaryKey(),
    serialNumber: varchar("serialNumber", { length: 64 }).notNull().unique(),
    model: varchar("model", { length: 64 }).default("PAX A920 MAX"),
    agentId: integer("agentId"),
    status: varchar("status", { length: 32 }).default("active").notNull(),
    firmwareVersion: varchar("firmwareVersion", { length: 32 }),
    appVersion: varchar("appVersion", { length: 32 }),
    osVersion: varchar("osVersion", { length: 32 }),
    imei: varchar("imei", { length: 20 }),
    simIccid: varchar("simIccid", { length: 22 }),
    lastSeenAt: timestamp("lastSeenAt"),
    lastLocation: json("lastLocation"),
    configJson: json("configJson"),
    // Legacy MDM fields used by routers
    ipAddress: varchar("ipAddress", { length: 45 }),
    location: varchar("location", { length: 128 }),
    enrolledAt: timestamp("enrolledAt").defaultNow(),
    enrollmentToken: varchar("enrollmentToken", { length: 128 }),
    enrollmentExpiresAt: timestamp("enrollmentExpiresAt"),
    deviceToken: varchar("deviceToken", { length: 64 }),
    // ── Telemetry: battery + WiFi ────────────────────────────────────────────────────────────
    batteryLevel: integer("batteryLevel"),
    batteryCharging: boolean("batteryCharging").default(false),
    wifiSsid: varchar("wifiSsid", { length: 64 }),
    wifiRssi: integer("wifiRssi"),
    wifiIpAddress: varchar("wifiIpAddress", { length: 45 }),
    networkType: varchar("networkType", { length: 16 }),
    // ── Screenshot ─────────────────────────────────────────────────────────────────────
    screenshotUrl: text("screenshotUrl"),
    lastScreenshotAt: timestamp("lastScreenshotAt"),
    // ── Compliance ─────────────────────────────────────────────────────────────────────
    complianceStatus: varchar("complianceStatus", { length: 32 }).default(
      "unknown"
    ),
    lastComplianceCheckAt: timestamp("lastComplianceCheckAt"),
    // P0-B: Soft delete + tenant isolation
    deletedAt: timestamp("deletedAt"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    serialNumberIdx: uniqueIndex("devices_serialNumber_idx").on(t.serialNumber),
    agentIdIdx: index("devices_agentId_idx").on(t.agentId),
    statusIdx: index("devices_status_idx").on(t.status),
    tenantIdIdx: index("devices_tenantId_idx").on(t.tenantId),
  })
);

export type Device = typeof devices.$inferSelect;

// ─── Device Commands ──────────────────────────────────────────────────────────
export const deviceCommands = pgTable(
  "device_commands",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("deviceId").notNull(),
    command: varchar("command", { length: 64 }).notNull(),
    payload: json("payload"),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    // Legacy fields used by routers
    issuedBy: varchar("issuedBy", { length: 64 }),
    issuedAt: timestamp("issuedAt").defaultNow(),
    acknowledgedAt: timestamp("acknowledgedAt"),
    completedAt: timestamp("completedAt"),
    errorMessage: text("errorMessage"),
    executedAt: timestamp("executedAt"),
    result: json("result"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    deviceIdStatusIdx: index("cmd_deviceId_status_idx").on(
      t.deviceId,
      t.status
    ),
  })
);

export type DeviceCommand = typeof deviceCommands.$inferSelect;

// ─── Supervisor-Agent Assignments ─────────────────────────────────────────────
export const supervisorAgents = pgTable(
  "supervisor_agents",
  {
    id: serial("id").primaryKey(),
    supervisorId: integer("supervisorId"),
    // Legacy field used by routers
    supervisorUserId: integer("supervisorUserId"),
    agentId: integer("agentId").notNull(),
    assignedAt: timestamp("assignedAt").defaultNow().notNull(),
    removedAt: timestamp("removedAt"),
  },
  t => ({
    supervisorIdIdx: index("supv_supervisorId_idx").on(t.supervisorId),
    agentIdIdx: index("supv_agentId_idx").on(t.agentId),
  })
);

export type SupervisorAgent = typeof supervisorAgents.$inferSelect;

// ─── Disputes ─────────────────────────────────────────────────────────────────
export const disputes = pgTable(
  "disputes",
  {
    id: serial("id").primaryKey(),
    ref: varchar("ref", { length: 32 }).notNull().unique(),
    transactionId: integer("transactionId"),
    transactionRef: varchar("transactionRef", { length: 32 }),
    agentId: integer("agentId").notNull(),
    // Legacy fields used by routers
    reason: varchar("reason", { length: 256 }),
    evidence: text("evidence"),
    resolvedBy: varchar("resolvedBy", { length: 64 }),
    slaDeadlineAt: timestamp("slaDeadlineAt"),
    type: varchar("type", { length: 64 }).default("general"),
    status: varchar("status", { length: 32 }).default("open").notNull(),
    priority: varchar("priority", { length: 16 }).default("medium").notNull(),
    description: text("description").default(""),
    resolution: text("resolution"),
    assignedTo: varchar("assignedTo", { length: 64 }),
    resolvedAt: timestamp("resolvedAt"),
    amount: numeric("amount", { precision: 15, scale: 2 }).default("0"),
    createdBy: varchar("createdBy", { length: 64 }),
    // P0-B: Soft delete + tenant isolation
    deletedAt: timestamp("deletedAt"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdStatusIdx: index("dispute_agentId_status_idx").on(
      t.agentId,
      t.status
    ),
    tenantIdIdx: index("dispute_tenantId_idx").on(t.tenantId),
  })
);

export type Dispute = typeof disputes.$inferSelect;

// ─── Dispute Messages ─────────────────────────────────────────────────────────
export const disputeMessages = pgTable(
  "dispute_messages",
  {
    id: serial("id").primaryKey(),
    disputeId: integer("disputeId").notNull(),
    authorId: integer("authorId"),
    authorName: varchar("authorName", { length: 128 }),
    authorRole: varchar("authorRole", { length: 32 }),
    // 'message' is the legacy field name; 'content' is the canonical name
    message: text("message"),
    senderType: varchar("senderType", { length: 32 }),
    senderName: varchar("senderName", { length: 128 }),
    content: text("content"),
    attachmentUrl: text("attachmentUrl"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    disputeIdIdx: index("dispute_msg_disputeId_idx").on(t.disputeId),
  })
);

export type DisputeMessage = typeof disputeMessages.$inferSelect;

// ─── Refunds ─────────────────────────────────────────────────────────────────
export const refunds = pgTable(
  "refunds",
  {
    id: serial("id").primaryKey(),
    ref: varchar("ref", { length: 32 }).notNull().unique(),
    // F-01: idempotency — client-supplied key binds one durable refund to one
    // logical request; payloadHash detects key reuse with a different payload.
    idempotencyKey: varchar("idempotencyKey", { length: 64 }),
    payloadHash: varchar("payloadHash", { length: 64 }),
    disputeId: integer("disputeId"),
    transactionId: integer("transactionId"),
    transactionRef: varchar("transactionRef", { length: 32 }),
    agentId: integer("agentId").notNull(),
    customerId: integer("customerId"),
    customerName: varchar("customerName", { length: 128 }),
    customerPhone: varchar("customerPhone", { length: 20 }),
    originalAmount: integer("originalAmount").notNull(),
    refundAmount: integer("refundAmount").notNull(),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    reason: varchar("reason", { length: 256 }).notNull(),
    category: varchar("category", { length: 64 }).default("general").notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    method: varchar("method", { length: 32 })
      .default("original_method")
      .notNull(),
    approvedBy: varchar("approvedBy", { length: 128 }),
    approvedAt: timestamp("approvedAt"),
    processedAt: timestamp("processedAt"),
    rejectedBy: varchar("rejectedBy", { length: 128 }),
    rejectedAt: timestamp("rejectedAt"),
    rejectionReason: text("rejectionReason"),
    notes: text("notes"),
    metadata: text("metadata"),
    tenantId: integer("tenantId"),
    deletedAt: timestamp("deletedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdIdx: index("refund_agentId_idx").on(t.agentId),
    statusIdx: index("refund_status_idx").on(t.status),
    disputeIdIdx: index("refund_disputeId_idx").on(t.disputeId),
    transactionRefIdx: index("refund_transactionRef_idx").on(t.transactionRef),
    // F-01: unique constraint is the durable single-effect guarantee under
    // concurrent retries (DB enforces it even if app-level checks race).
    idempotencyKeyIdx: uniqueIndex("refund_idempotencyKey_idx").on(
      t.idempotencyKey
    ),
  })
);

export type Refund = typeof refunds.$inferSelect;

// ─── Platform Settings ────────────────────────────────────────────────────────
export const platformSettings = pgTable(
  "platform_settings",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 128 }).notNull().unique(),
    value: text("value"),
    description: text("description"),
    updatedBy: varchar("updatedBy", { length: 64 }),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    ps_key_idx: index("ps_key_idx").on(t.key),
  })
);

export type PlatformSetting = typeof platformSettings.$inferSelect;

// ─── Velocity Limits ──────────────────────────────────────────────────────────
export const velocityLimits = pgTable(
  "velocity_limits",
  {
    id: serial("id").primaryKey(),
    tier: agentTierEnum("tier").notNull().unique(),
    // Legacy aliases kept for router compatibility
    maxTxPerHour: integer("maxTxPerHour").default(20).notNull(),
    maxSingleTxAmount: numeric("maxSingleTxAmount", { precision: 15, scale: 2 })
      .default("50000.00")
      .notNull(),
    maxDailyVolume: numeric("maxDailyVolume", { precision: 15, scale: 2 })
      .default("500000.00")
      .notNull(),
    // Canonical names
    dailyTxLimit: numeric("dailyTxLimit", { precision: 15, scale: 2 })
      .default("500000.00")
      .notNull(),
    singleTxLimit: numeric("singleTxLimit", { precision: 15, scale: 2 })
      .default("100000.00")
      .notNull(),
    hourlyTxCount: integer("hourlyTxCount").default(50).notNull(),
    dailyTxCount: integer("dailyTxCount").default(200).notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    vl_tier_idx: index("vl_tier_idx").on(t.tier),
  })
);

export type VelocityLimit = typeof velocityLimits.$inferSelect;

// ─── Compliance Reports ───────────────────────────────────────────────────────
export const complianceReports = pgTable(
  "compliance_reports",
  {
    id: serial("id").primaryKey(),
    reportType: varchar("reportType", { length: 64 }).default("compliance"),
    period: varchar("period", { length: 32 }).default(""),
    // Legacy date range fields used by routers
    periodStart: timestamp("periodStart"),
    periodEnd: timestamp("periodEnd"),
    // Alert summary counters
    totalAlerts: integer("totalAlerts").default(0).notNull(),
    highAlerts: integer("highAlerts").default(0).notNull(),
    mediumAlerts: integer("mediumAlerts").default(0).notNull(),
    lowAlerts: integer("lowAlerts").default(0).notNull(),
    escalatedAlerts: integer("escalatedAlerts").default(0).notNull(),
    resolvedAlerts: integer("resolvedAlerts").default(0).notNull(),
    topOffendersJson: json("topOffendersJson"),
    pdfUrl: text("pdfUrl"),
    pdfKey: varchar("pdfKey", { length: 256 }),
    status: varchar("status", { length: 32 }).default("draft").notNull(),
    generatedBy: varchar("generatedBy", { length: 64 }),
    fileUrl: text("fileUrl"),
    summary: json("summary"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    tenantIdPeriodIdx: index("compliance_tenantId_period_idx").on(
      t.tenantId,
      t.period
    ),
  })
);

export type ComplianceReport = typeof complianceReports.$inferSelect;

// ─── Geofence Zones ───────────────────────────────────────────────────────────
export const geofenceZones = pgTable(
  "geofence_zones",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    description: text("description"),
    type: varchar("type", { length: 32 }).default("circle").notNull(),
    // Legacy column names used by routers
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    radiusMetres: integer("radiusMetres").default(500),
    createdBy: varchar("createdBy", { length: 64 }),
    // Canonical names
    centerLat: numeric("centerLat", { precision: 10, scale: 7 }),
    centerLng: numeric("centerLng", { precision: 10, scale: 7 }),
    radiusMeters: integer("radiusMeters"),
    polygonJson: json("polygonJson"),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    gz_isActive_idx: index("gz_isActive_idx").on(t.isActive),
    gz_type_idx: index("gz_type_idx").on(t.type),
  })
);

export type GeofenceZone = typeof geofenceZones.$inferSelect;

// ─── Agent Geofence Zones ─────────────────────────────────────────────────────
export const agentGeofenceZones = pgTable(
  "agent_geofence_zones",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agentId").notNull(),
    zoneId: integer("zoneId").notNull(),
    assignedAt: timestamp("assignedAt").defaultNow().notNull(),
    assignedBy: varchar("assignedBy", { length: 64 }),
  },
  t => ({
    agentIdIdx: index("agz_agentId_idx").on(t.agentId),
  })
);

export type AgentGeofenceZone = typeof agentGeofenceZones.$inferSelect;

// ─── Device Locations ─────────────────────────────────────────────────────────
export const deviceLocations = pgTable(
  "device_locations",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("deviceId").notNull(),
    // Legacy column names used by routers
    agentId: integer("agentId"),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    withinZone: boolean("withinZone").default(true),
    reportedAt: timestamp("reportedAt").defaultNow(),
    // Canonical names
    lat: numeric("lat", { precision: 10, scale: 7 }),
    lng: numeric("lng", { precision: 10, scale: 7 }),
    accuracy: numeric("accuracy", { precision: 8, scale: 2 }),
    altitude: numeric("altitude", { precision: 8, scale: 2 }),
    speed: numeric("speed", { precision: 6, scale: 2 }),
    heading: numeric("heading", { precision: 6, scale: 2 }),
    source: varchar("source", { length: 32 }).default("gps"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    deviceIdCreatedAtIdx: index("dloc_deviceId_createdAt_idx").on(
      t.deviceId,
      t.createdAt
    ),
  })
);

export type DeviceLocation = typeof deviceLocations.$inferSelect;

// ─── KYC Sessions ─────────────────────────────────────────────────────────────
export const kycSessions = pgTable(
  "kyc_sessions",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agentId"),
    customerId: integer("customerId"),
    sessionRef: varchar("sessionRef", { length: 64 })
      .notNull()
      .unique()
      .default(sql`gen_random_uuid()`),
    type: varchar("type", { length: 32 }).default("agent_onboarding").notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    bvn: varchar("bvn", { length: 11 }),
    nin: varchar("nin", { length: 11 }),
    selfieUrl: text("selfieUrl"),
    idDocUrl: text("idDocUrl"),
    idDocType: varchar("idDocType", { length: 32 }),
    idDocNumber: varchar("idDocNumber", { length: 64 }),
    livenessScore: numeric("livenessScore", { precision: 5, scale: 2 }),
    livenessPassed: boolean("livenessPassed"),
    matchScore: numeric("matchScore", { precision: 5, scale: 2 }),
    // Legacy KYC fields used by routers
    livenessMethod: varchar("livenessMethod", { length: 64 }),
    livenessChallenge: varchar("livenessChallenge", { length: 128 }),
    livenessRaw: json("livenessRaw"),
    ocrRaw: json("ocrRaw"),
    docType: varchar("docType", { length: 32 }),
    docExtractedName: varchar("docExtractedName", { length: 256 }),
    docExtractedDob: varchar("docExtractedDob", { length: 32 }),
    docExtractedIdNumber: varchar("docExtractedIdNumber", { length: 64 }),
    docConfidence: numeric("docConfidence", { precision: 5, scale: 4 }),
    docFraudIndicators: json("docFraudIndicators").$type<string[]>(),
    complianceRecordId: varchar("complianceRecordId", { length: 64 }),
    rejectionReason: text("rejectionReason"),
    reviewedBy: varchar("reviewedBy", { length: 64 }),
    reviewNote: text("reviewNote"),
    reviewedAt: timestamp("reviewedAt"),
    expiresAt: timestamp("expiresAt"),
    // P0-B: Soft delete + tenant isolation
    deletedAt: timestamp("deletedAt"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdStatusIdx: index("kyc_agentId_status_idx").on(t.agentId, t.status),
    customerIdIdx: index("kyc_customerId_idx").on(t.customerId),
    tenantIdIdx: index("kyc_tenantId_idx").on(t.tenantId),
  })
);

export type KycSession = typeof kycSessions.$inferSelect;

// ─── Field Agent Devices ──────────────────────────────────────────────────────
export const fieldAgentDevices = pgTable(
  "field_agent_devices",
  {
    id: serial("id").primaryKey(),
    serialNumber: varchar("serialNumber", { length: 64 }).notNull().unique(),
    model: varchar("model", { length: 64 }).default("Standard Tablet"),
    agentId: integer("agentId"),
    status: varchar("status", { length: 32 }).default("unassigned").notNull(),
    firmwareVersion: varchar("firmwareVersion", { length: 32 }),
    appVersion: varchar("appVersion", { length: 32 }),
    osVersion: varchar("osVersion", { length: 32 }),
    imei: varchar("imei", { length: 20 }),
    simIccid: varchar("simIccid", { length: 22 }),
    lastSeenAt: timestamp("lastSeenAt"),
    lastLocation: json("lastLocation"),
    configJson: json("configJson"),
    groupId: integer("groupId"),
    lastCommand: varchar("lastCommand", { length: 64 }),
    lastCommandAt: timestamp("lastCommandAt"),
    deletedAt: timestamp("deletedAt"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    serialNumberIdx: uniqueIndex("device_serialNumber_idx").on(t.serialNumber),
    agentIdIdx: index("device_agentId_idx").on(t.agentId),
    statusIdx: index("device_status_idx").on(t.status),
    tenantIdIdx: index("device_tenantId_idx").on(t.tenantId),
  })
);

export type FieldAgentDevice = typeof fieldAgentDevices.$inferSelect;

// ─── Terminal Groups ──────────────────────────────────────────────────────────
export const terminalGroups = pgTable(
  "terminal_groups",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    description: text("description"),
    configJson: json("configJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    tg_name_idx: index("tg_name_idx").on(t.name),
  })
);

export type TerminalGroup = typeof terminalGroups.$inferSelect;

// ─── Service Records ──────────────────────────────────────────────────────────
export const serviceRecords = pgTable(
  "service_records",
  {
    id: serial("id").primaryKey(),
    terminalId: integer("terminalId")
      .references(() => fieldAgentDevices.id)
      .notNull(),
    technicianName: varchar("technicianName", { length: 128 }),
    issueDescription: text("issueDescription").notNull(),
    resolution: text("resolution"),
    partsReplaced: json("partsReplaced").$type<string[]>(),
    serviceDate: timestamp("serviceDate").defaultNow().notNull(),
    nextServiceDate: timestamp("nextServiceDate"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    terminalIdIdx: index("svc_terminalId_idx").on(t.terminalId),
  })
);

export type ServiceRecord = typeof serviceRecords.$inferSelect;

// ─── Software Updates ─────────────────────────────────────────────────────────
export const softwareUpdates = pgTable(
  "software_updates",
  {
    id: serial("id").primaryKey(),
    version: varchar("version", { length: 32 }).notNull(),
    releaseNotes: text("releaseNotes"),
    downloadUrl: text("downloadUrl").notNull(),
    checksum: varchar("checksum", { length: 128 }),
    isForced: boolean("isForced").default(false).notNull(),
    targetModels: json("targetModels").$type<string[]>(),
    appliedCount: integer("appliedCount").default(0).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    su_version_idx: index("su_version_idx").on(t.version),
    su_createdAt_idx: index("su_createdAt_idx").on(t.createdAt),
  })
);

export type SoftwareUpdate = typeof softwareUpdates.$inferSelect;

// ─── Commission Rules ─────────────────────────────────────────────────────────
export const commissionRules = pgTable(
  "commission_rules",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    txType: txTypeEnum("txType").notNull(),
    ruleType: commissionRuleTypeEnum("ruleType")
      .default("percentage")
      .notNull(),
    value: numeric("value", { precision: 10, scale: 4 }).notNull(),
    minAmount: numeric("minAmount", { precision: 15, scale: 2 }),
    maxAmount: numeric("maxAmount", { precision: 15, scale: 2 }),
    tieredJson: json("tieredJson"),
    agentTier: agentTierEnum("agentTier"),
    isActive: boolean("isActive").default(true).notNull(),
    effectiveFrom: timestamp("effectiveFrom").defaultNow().notNull(),
    effectiveTo: timestamp("effectiveTo"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    cr_txType_idx: index("cr_txType_idx").on(t.txType),
    cr_isActive_idx: index("cr_isActive_idx").on(t.isActive),
    cr_agentTier_idx: index("cr_agentTier_idx").on(t.agentTier),
  })
);

export type CommissionRule = typeof commissionRules.$inferSelect;

// ─── QR Codes ─────────────────────────────────────────────────────────────────
export const qrCodes = pgTable(
  "qr_codes",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 256 }).notNull().unique(),
    type: qrCodeTypeEnum("type").default("payment").notNull(),
    status: qrCodeStatusEnum("status").default("active").notNull(),
    agentId: integer("agentId").references(() => agents.id),
    amount: numeric("amount", { precision: 15, scale: 2 }),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    description: text("description"),
    metadata: json("metadata"),
    expiresAt: timestamp("expiresAt"),
    usedAt: timestamp("usedAt"),
    usedByCustomerId: integer("usedByCustomerId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    agentIdStatusIdx: index("qr_agentId_status_idx").on(t.agentId, t.status),
    expiresAtIdx: index("qr_expiresAt_idx").on(t.expiresAt),
  })
);

export type QrCode = typeof qrCodes.$inferSelect;

// ─── Inventory Items ──────────────────────────────────────────────────────────
export const inventoryItems = pgTable(
  "inventory_items",
  {
    id: serial("id").primaryKey(),
    sku: varchar("sku", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 128 }).notNull(),
    category: varchar("category", { length: 64 }),
    description: text("description"),
    quantityOnHand: integer("quantityOnHand").default(0).notNull(),
    quantityReserved: integer("quantityReserved").default(0).notNull(),
    reorderPoint: integer("reorderPoint").default(10).notNull(),
    unitCost: numeric("unitCost", { precision: 15, scale: 2 }),
    status: inventoryStatusEnum("status").default("in_stock").notNull(),
    warehouseLocation: varchar("warehouseLocation", { length: 64 }),
    supplierId: varchar("supplierId", { length: 64 }),
    lastRestockedAt: timestamp("lastRestockedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    inv_status_idx: index("inv_status_idx").on(t.status),
    inv_category_idx: index("inv_category_idx").on(t.category),
  })
);

export type InventoryItem = typeof inventoryItems.$inferSelect;

// ─── Multi-SIM Profiles ───────────────────────────────────────────────────────
export const multiSimProfiles = pgTable(
  "multi_sim_profiles",
  {
    id: serial("id").primaryKey(),
    terminalId: integer("terminalId")
      .references(() => fieldAgentDevices.id)
      .notNull(),
    simSlot: integer("simSlot").default(1).notNull(),
    carrier: varchar("carrier", { length: 64 }).notNull(),
    iccid: varchar("iccid", { length: 22 }),
    phoneNumber: varchar("phoneNumber", { length: 20 }),
    status: simStatusEnum("status").default("active").notNull(),
    signalStrength: integer("signalStrength"),
    dataUsageMb: numeric("dataUsageMb", { precision: 12, scale: 2 }).default(
      "0"
    ),
    failoverPriority: integer("failoverPriority").default(1).notNull(),
    lastCheckedAt: timestamp("lastCheckedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    msp_terminalId_idx: index("msp_terminalId_idx").on(t.terminalId),
    msp_status_idx: index("msp_status_idx").on(t.status),
  })
);

export type MultiSimProfile = typeof multiSimProfiles.$inferSelect;

// ─── Reversal Requests ────────────────────────────────────────────────────────
export const reversalRequests = pgTable(
  "reversal_requests",
  {
    id: serial("id").primaryKey(),
    transactionId: varchar("transactionId", { length: 64 }).notNull(),
    agentId: integer("agentId")
      .references(() => agents.id)
      .notNull(),
    reason: text("reason").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    status: reversalStatusEnum("status").default("pending").notNull(),
    reviewedBy: integer("reviewedBy").references(() => users.id),
    reviewedAt: timestamp("reviewedAt"),
    reviewNote: text("reviewNote"),
    tbReversalId: varchar("tbReversalId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdStatusIdx: index("reversal_agentId_status_idx").on(
      t.agentId,
      t.status
    ),
  })
);

export type ReversalRequest = typeof reversalRequests.$inferSelect;

// ─── Shareable Payment Links ──────────────────────────────────────────────────
export const shareableLinks = pgTable(
  "shareable_links",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    type: linkTypeEnum("type").default("payment").notNull(),
    status: linkStatusEnum("status").default("active").notNull(),
    agentId: integer("agentId")
      .references(() => agents.id)
      .notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    description: text("description"),
    metadata: json("metadata"),
    clickCount: integer("clickCount").default(0).notNull(),
    conversionCount: integer("conversionCount").default(0).notNull(),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdIdx: index("links_agentId_idx").on(t.agentId),
    slugIdx: uniqueIndex("links_slug_idx").on(t.slug),
  })
);

export type ShareableLink = typeof shareableLinks.$inferSelect;

// ─── Customers ────────────────────────────────────────────────────────────────
export const customers = pgTable(
  "customers",
  {
    id: serial("id").primaryKey(),
    externalId: varchar("externalId", { length: 128 }).unique(),
    firstName: varchar("firstName", { length: 64 }).notNull(),
    lastName: varchar("lastName", { length: 64 }).notNull(),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 20 }).notNull().unique(),
    bvn: varchar("bvn", { length: 11 }),
    nin: varchar("nin", { length: 11 }),
    dateOfBirth: varchar("dateOfBirth", { length: 10 }),
    address: text("address"),
    status: customerStatusEnum("status").default("pending_kyc").notNull(),
    kycLevel: integer("kycLevel").default(0).notNull(),
    walletBalance: numeric("walletBalance", { precision: 15, scale: 2 })
      .default("0.00")
      .notNull(),
    dailyLimit: numeric("dailyLimit", { precision: 15, scale: 2 })
      .default("50000.00")
      .notNull(),
    monthlyLimit: numeric("monthlyLimit", { precision: 15, scale: 2 })
      .default("300000.00")
      .notNull(),
    preferredAgentId: integer("preferredAgentId").references(() => agents.id),
    keycloakSub: varchar("keycloakSub", { length: 128 }).unique(),
    passwordHash: varchar("passwordHash", { length: 256 }),
    refreshToken: text("refreshToken"),
    lastLoginAt: timestamp("lastLoginAt"),
    // P0-B: Soft delete + tenant isolation
    deletedAt: timestamp("deletedAt"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    phoneIdx: uniqueIndex("customers_phone_idx").on(t.phone),
    statusIdx: index("customers_status_idx").on(t.status),
    tenantIdIdx: index("customers_tenantId_idx").on(t.tenantId),
    deletedAtIdx: index("customers_deletedAt_idx").on(t.deletedAt),
  })
);

export type Customer = typeof customers.$inferSelect;
export type InsertCustomer = typeof customers.$inferInsert;

// ─── Tenants (Super Admin multi-tenancy) ──────────────────────────────────────
export const tenants = pgTable(
  "tenants",
  {
    id: serial("id").primaryKey(),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    name: varchar("name", { length: 128 }).notNull(),
    country: varchar("country", { length: 3 }).default("NGA").notNull(),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    status: tenantStatusEnum("status").default("trial").notNull(),
    planId: varchar("planId", { length: 64 }),
    agentCount: integer("agentCount").default(0).notNull(),
    terminalCount: integer("terminalCount").default(0).notNull(),
    monthlyVolume: numeric("monthlyVolume", { precision: 20, scale: 2 })
      .default("0.00")
      .notNull(),
    contactEmail: varchar("contactEmail", { length: 320 }),
    contactPhone: varchar("contactPhone", { length: 20 }),
    configJson: json("configJson"),
    keycloakRealmId: varchar("keycloakRealmId", { length: 128 }),
    // P1-A: Webhook HMAC secret per tenant
    webhookSecret: varchar("webhookSecret", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    slugIdx: uniqueIndex("tenants_slug_idx").on(t.slug),
    statusIdx: index("tenants_status_idx").on(t.status),
  })
);

export type Tenant = typeof tenants.$inferSelect;
export type InsertTenant = typeof tenants.$inferInsert;

// ─── ERP Sync Log ─────────────────────────────────────────────────────────────
export const erpSyncLog = pgTable(
  "erp_sync_log",
  {
    id: serial("id").primaryKey(),
    entityType: varchar("entityType", { length: 64 }).notNull(),
    entityId: varchar("entityId", { length: 64 }).notNull(),
    erpDocType: varchar("erpDocType", { length: 64 }),
    erpDocName: varchar("erpDocName", { length: 128 }),
    status: erpSyncStatusEnum("status").default("pending").notNull(),
    errorMessage: text("errorMessage"),
    payload: json("payload"),
    syncedAt: timestamp("syncedAt"),
    retryCount: integer("retryCount").default(0).notNull(),
    maxRetries: integer("maxRetries").default(5).notNull(),
    nextRetryAt: timestamp("nextRetryAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    statusNextRetryIdx: index("erp_status_nextRetry_idx").on(
      t.status,
      t.nextRetryAt
    ),
    entityTypeIdx: index("erp_entityType_idx").on(t.entityType),
  })
);

export type ErpSyncLog = typeof erpSyncLog.$inferSelect;


// ─── VAT Records ──────────────────────────────────────────────────────────────
export const vatRecords = pgTable(
  "vat_records",
  {
    id: serial("id").primaryKey(),
    transactionId: varchar("transactionId", { length: 64 }).notNull(),
    agentId: integer("agentId")
      .references(() => agents.id)
      .notNull(),
    taxableAmount: numeric("taxableAmount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    vatAmount: numeric("vatAmount", { precision: 15, scale: 2 }).notNull(),
    vatRate: numeric("vatRate", { precision: 5, scale: 4 })
      .default("0.075")
      .notNull(),
    rateType: vatRateTypeEnum("rateType").default("standard").notNull(),
    tinNumber: varchar("tinNumber", { length: 32 }),
    period: varchar("period", { length: 7 }).notNull(),
    remittedAt: timestamp("remittedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    agentIdPeriodIdx: index("vat_agentId_period_idx").on(t.agentId, t.period),
  })
);

export type VatRecord = typeof vatRecords.$inferSelect;

// ─── ERP Configuration ────────────────────────────────────────────────────────
export const erpConfig = pgTable(
  "erp_config",
  {
    id: serial("id").primaryKey(),
    erpType: erpTypeEnum("erpType").default("odoo").notNull(),
    name: varchar("name", { length: 128 }).notNull().default("Default ERP"),
    baseUrl: text("baseUrl").notNull().default(""),
    apiKey: text("apiKey").default(""),
    username: varchar("username", { length: 128 }).default(""),
    database: varchar("database", { length: 128 }).default(""),
    fieldMappings: json("fieldMappings")
      .$type<Record<string, string>>()
      .default({}),
    syncEnabled: boolean("syncEnabled").default(false).notNull(),
    syncIntervalMinutes: integer("syncIntervalMinutes").default(60).notNull(),
    syncTransactions: boolean("syncTransactions").default(true).notNull(),
    syncAgents: boolean("syncAgents").default(false).notNull(),
    syncInventory: boolean("syncInventory").default(false).notNull(),
    lastSyncAt: timestamp("lastSyncAt"),
    lastSyncStatus: varchar("lastSyncStatus", { length: 32 }).default("never"),
    lastSyncError: text("lastSyncError"),
    lastSyncCount: integer("lastSyncCount").default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    ec_erpType_idx2: index("ec_erpType_idx2").on(t.erpType),
    ec_erpType_idx: index("ec_erpType_idx").on(t.erpType),
  })
);

export type ErpConfig = typeof erpConfig.$inferSelect;
export type ErpConfigInsert = typeof erpConfig.$inferInsert;

// ─── MQTT Bridge Configuration ────────────────────────────────────────────────
export const mqttBridgeConfig = pgTable(
  "mqtt_bridge_config",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull().default("POS MQTT Bridge"),
    brokerUrl: text("brokerUrl")
      .notNull()
      .default("mqtt://broker.insureportal.io:1883"),
    port: integer("port").default(1883).notNull(),
    useTls: boolean("useTls").default(false).notNull(),
    username: varchar("username", { length: 128 }).default(""),
    password: text("password").default(""),
    clientId: varchar("clientId", { length: 128 }).default(
      "insureportal-fluvio-bridge"
    ),
    topicMappings: json("topicMappings")
      .$type<
        Array<{
          mqttTopic: string;
          fluvioTopic: string;
          transform?: string;
        }>
      >()
      .default([]),
    qos: mqttQosEnum("qos").default("1").notNull(),
    keepAliveSeconds: integer("keepAliveSeconds").default(60).notNull(),
    reconnectDelayMs: integer("reconnectDelayMs").default(5000).notNull(),
    enabled: boolean("enabled").default(false).notNull(),
    lastTestAt: timestamp("lastTestAt"),
    lastTestStatus: varchar("lastTestStatus", { length: 32 }).default("never"),
    lastTestError: text("lastTestError"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    mbc_enabled_idx: index("mbc_enabled_idx").on(t.enabled),
  })
);

export type MqttBridgeConfig = typeof mqttBridgeConfig.$inferSelect;
export type MqttBridgeConfigInsert = typeof mqttBridgeConfig.$inferInsert;

// ─── Analytics Metrics ────────────────────────────────────────────────────────
export const analyticsMetrics = pgTable(
  "analytics_metrics",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    metricName: varchar("metricName", { length: 128 }).notNull(),
    value: numeric("value", { precision: 20, scale: 4 }).notNull(),
    bucketMinute: timestamp("bucketMinute").notNull(),
    tags: json("tags").$type<Record<string, string>>().default({}),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    metricNameBucketIdx: index("analytics_metricName_bucket_idx").on(
      t.metricName,
      t.bucketMinute
    ),
  })
);

export type AnalyticsMetric = typeof analyticsMetrics.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// P1-A: Webhook Secrets (per-integration HMAC signing keys)
// ═══════════════════════════════════════════════════════════════════════════════
export const webhookSecrets = pgTable(
  "webhook_secrets",
  {
    id: serial("id").primaryKey(),
    integrationName: varchar("integrationName", { length: 64 })
      .notNull()
      .unique(),
    secret: varchar("secret", { length: 256 }).notNull(),
    algorithm: varchar("algorithm", { length: 32 }).default("sha256").notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    lastRotatedAt: timestamp("lastRotatedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    ws_isActive_idx: index("ws_isActive_idx").on(t.isActive),
  })
);

export type WebhookSecret = typeof webhookSecrets.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// P1-C: Email Notification Queue
// ═══════════════════════════════════════════════════════════════════════════════
export const emailQueue = pgTable(
  "email_queue",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    toAddress: varchar("toAddress", { length: 320 }).notNull(),
    toName: varchar("toName", { length: 128 }),
    subject: varchar("subject", { length: 256 }).notNull(),
    templateName: varchar("templateName", { length: 64 }).notNull(),
    templateData: json("templateData")
      .$type<Record<string, unknown>>()
      .default({}),
    status: emailStatusEnum("status").default("queued").notNull(),
    sentAt: timestamp("sentAt"),
    errorMessage: text("errorMessage"),
    retryCount: integer("retryCount").default(0).notNull(),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    statusCreatedAtIdx: index("email_status_createdAt_idx").on(
      t.status,
      t.createdAt
    ),
  })
);

export type EmailQueue = typeof emailQueue.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// P3-A: Merchants
// ═══════════════════════════════════════════════════════════════════════════════
export const merchants = pgTable(
  "merchants",
  {
    id: serial("id").primaryKey(),
    merchantCode: varchar("merchantCode", { length: 32 }).notNull().unique(),
    businessName: varchar("businessName", { length: 128 }).notNull(),
    ownerName: varchar("ownerName", { length: 128 }).notNull(),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 20 }).notNull(),
    address: text("address"),
    category: merchantCategoryEnum("category").default("retail").notNull(),
    status: merchantStatusEnum("status").default("pending").notNull(),
    rcNumber: varchar("rcNumber", { length: 32 }),
    tinNumber: varchar("tinNumber", { length: 32 }),
    settlementAccountNumber: varchar("settlementAccountNumber", { length: 20 }),
    settlementBankCode: varchar("settlementBankCode", { length: 10 }),
    settlementBankName: varchar("settlementBankName", { length: 64 }),
    walletBalance: numeric("walletBalance", { precision: 15, scale: 2 })
      .default("0.00")
      .notNull(),
    totalVolume: numeric("totalVolume", { precision: 20, scale: 2 })
      .default("0.00")
      .notNull(),
    totalTransactions: integer("totalTransactions").default(0).notNull(),
    preferredAgentId: integer("preferredAgentId").references(() => agents.id),
    keycloakSub: varchar("keycloakSub", { length: 128 }).unique(),
    passwordHash: varchar("passwordHash", { length: 256 }),
    // P0-B: Soft delete + tenant isolation
    deletedAt: timestamp("deletedAt"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    merchantCodeIdx: uniqueIndex("merchants_merchantCode_idx").on(
      t.merchantCode
    ),
    statusIdx: index("merchants_status_idx").on(t.status),
    tenantIdIdx: index("merchants_tenantId_idx").on(t.tenantId),
    deletedAtIdx: index("merchants_deletedAt_idx").on(t.deletedAt),
  })
);

export type Merchant = typeof merchants.$inferSelect;
export type InsertMerchant = typeof merchants.$inferInsert;

// ─── Merchant Settlements ─────────────────────────────────────────────────────
export const merchantSettlements = pgTable(
  "merchant_settlements",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchantId")
      .references(() => merchants.id)
      .notNull(),
    period: varchar("period", { length: 10 }).notNull(), // YYYY-MM-DD
    grossAmount: numeric("grossAmount", { precision: 15, scale: 2 }).notNull(),
    feeAmount: numeric("feeAmount", { precision: 15, scale: 2 })
      .default("0.00")
      .notNull(),
    netAmount: numeric("netAmount", { precision: 15, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    settledAt: timestamp("settledAt"),
    bankRef: varchar("bankRef", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    merchantIdPeriodIdx: index("ms_merchantId_period_idx").on(
      t.merchantId,
      t.period
    ),
  })
);

export type MerchantSettlement = typeof merchantSettlements.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// P3-C: Developer API Keys
// ═══════════════════════════════════════════════════════════════════════════════
export const apiKeys = pgTable(
  "api_keys",
  {
    id: serial("id").primaryKey(),
    keyHash: varchar("keyHash", { length: 128 }).notNull().unique(), // SHA-256 of raw key
    keyPrefix: varchar("keyPrefix", { length: 12 }).notNull(), // first 8 chars for display
    name: varchar("name", { length: 128 }).notNull(),
    description: text("description"),
    userId: integer("userId")
      .references(() => users.id)
      .notNull(),
    tenantId: integer("tenantId"),
    status: apiKeyStatusEnum("status").default("active").notNull(),
    scopes: json("scopes").$type<string[]>().default([]),
    rateLimit: integer("rateLimit").default(1000).notNull(), // requests per hour
    lastUsedAt: timestamp("lastUsedAt"),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    revokedAt: timestamp("revokedAt"),
  },
  t => ({
    keyHashIdx: uniqueIndex("apikeys_keyHash_idx").on(t.keyHash),
    userIdIdx: index("apikeys_userId_idx").on(t.userId),
    statusIdx: index("apikeys_status_idx").on(t.status),
  })
);

export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = typeof apiKeys.$inferInsert;

// ─── API Key Usage Log ────────────────────────────────────────────────────────
export const apiKeyUsage = pgTable(
  "api_key_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    apiKeyId: integer("apiKeyId")
      .references(() => apiKeys.id)
      .notNull(),
    endpoint: varchar("endpoint", { length: 256 }).notNull(),
    method: varchar("method", { length: 8 }).notNull(),
    statusCode: integer("statusCode").notNull(),
    responseMs: integer("responseMs"),
    ipAddress: varchar("ipAddress", { length: 45 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    apiKeyIdCreatedAtIdx: index("apiusage_apiKeyId_createdAt_idx").on(
      t.apiKeyId,
      t.createdAt
    ),
  })
);

export type ApiKeyUsage = typeof apiKeyUsage.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// P3-D: FIDO2 / WebAuthn Credentials
// ═══════════════════════════════════════════════════════════════════════════════
export const fido2Credentials = pgTable(
  "fido2_credentials",
  {
    id: serial("id").primaryKey(),
    // Can be linked to either a user (admin/supervisor) or an agent
    userId: integer("userId").references(() => users.id),
    agentId: integer("agentId").references(() => agents.id),
    credentialId: text("credentialId").notNull().unique(), // base64url
    publicKey: text("publicKey").notNull(), // COSE public key, base64url
    counter: integer("counter").default(0).notNull(),
    deviceType: varchar("deviceType", { length: 64 }), // "platform" | "cross-platform"
    transports: json("transports").$type<string[]>().default([]),
    status: fido2StatusEnum("status").default("active").notNull(),
    lastUsedAt: timestamp("lastUsedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    credentialIdIdx: uniqueIndex("fido2_credentialId_idx").on(t.credentialId),
    userIdIdx: index("fido2_userId_idx").on(t.userId),
    agentIdIdx: index("fido2_agentId_idx").on(t.agentId),
  })
);

export type Fido2Credential = typeof fido2Credentials.$inferSelect;
export type InsertFido2Credential = typeof fido2Credentials.$inferInsert;

// ─── FIDO2 Challenges (ephemeral, TTL 5 min) ──────────────────────────────────
export const fido2Challenges = pgTable(
  "fido2_challenges",
  {
    id: serial("id").primaryKey(),
    challenge: varchar("challenge", { length: 128 }).notNull().unique(),
    userId: integer("userId").references(() => users.id),
    agentId: integer("agentId").references(() => agents.id),
    type: varchar("type", { length: 32 }).notNull(), // "registration" | "authentication"
    expiresAt: timestamp("expiresAt").notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    challengeIdx: uniqueIndex("fido2ch_challenge_idx").on(t.challenge),
    expiresAtIdx: index("fido2ch_expiresAt_idx").on(t.expiresAt),
  })
);

export type Fido2Challenge = typeof fido2Challenges.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// P3-B: Credit Scoring
// ═══════════════════════════════════════════════════════════════════════════════
export const creditScoreHistory = pgTable(
  "credit_score_history",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agentId")
      .references(() => agents.id)
      .notNull(),
    score: integer("score").notNull(),
    rating: creditRatingEnum("rating").notNull(),
    factors: json("factors").$type<Record<string, number>>().default({}),
    computedAt: timestamp("computedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdComputedAtIdx: index("credit_agentId_computedAt_idx").on(
      t.agentId,
      t.computedAt
    ),
  })
);

export type CreditScoreHistory = typeof creditScoreHistory.$inferSelect;

export const creditApplications = pgTable(
  "credit_applications",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agentId")
      .references(() => agents.id)
      .notNull(),
    requestedAmount: numeric("requestedAmount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    approvedAmount: numeric("approvedAmount", { precision: 15, scale: 2 }),
    interestRate: numeric("interestRate", { precision: 5, scale: 4 }).default(
      "0.05"
    ),
    termDays: integer("termDays").default(30).notNull(),
    status: creditApplicationStatusEnum("status").default("pending").notNull(),
    scoreAtApplication: integer("scoreAtApplication"),
    reviewedBy: varchar("reviewedBy", { length: 64 }),
    reviewNote: text("reviewNote"),
    reviewedAt: timestamp("reviewedAt"),
    disbursedAt: timestamp("disbursedAt"),
    dueAt: timestamp("dueAt"),
    repaidAt: timestamp("repaidAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentIdStatusIdx: index("credit_app_agentId_status_idx").on(
      t.agentId,
      t.status
    ),
  })
);

export type CreditApplication = typeof creditApplications.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// P2-C: OTA Firmware Releases
// ═══════════════════════════════════════════════════════════════════════════════
export const otaReleases = pgTable(
  "ota_releases",
  {
    id: serial("id").primaryKey(),
    version: varchar("version", { length: 32 }).notNull().unique(),
    releaseNotes: text("releaseNotes"),
    s3Key: text("s3Key").notNull(),
    downloadUrl: text("downloadUrl").notNull(),
    checksum: varchar("checksum", { length: 128 }).notNull(),
    fileSize: integer("fileSize").notNull(), // bytes
    isForced: boolean("isForced").default(false).notNull(),
    rolloutPercent: integer("rolloutPercent").default(100).notNull(),
    targetModels: json("targetModels").$type<string[]>().default([]),
    minCurrentVersion: varchar("minCurrentVersion", { length: 32 }),
    status: varchar("status", { length: 32 }).default("draft").notNull(), // draft|active|deprecated
    publishedAt: timestamp("publishedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    versionIdx: uniqueIndex("ota_version_idx").on(t.version),
    statusIdx: index("ota_status_idx").on(t.status),
  })
);

export type OtaRelease = typeof otaReleases.$inferSelect;

export const otaUpdateLog = pgTable(
  "ota_update_log",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("deviceId")
      .references(() => devices.id)
      .notNull(),
    releaseId: integer("releaseId")
      .references(() => otaReleases.id)
      .notNull(),
    fromVersion: varchar("fromVersion", { length: 32 }),
    toVersion: varchar("toVersion", { length: 32 }).notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    startedAt: timestamp("startedAt"),
    completedAt: timestamp("completedAt"),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    deviceIdIdx: index("ota_log_deviceId_idx").on(t.deviceId),
    releaseIdIdx: index("ota_log_releaseId_idx").on(t.releaseId),
  })
);

export type OtaUpdateLog = typeof otaUpdateLog.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// P2-B: NDPR / GDPR Data Rights Requests
// ═══════════════════════════════════════════════════════════════════════════════
export const dataRightsRequests = pgTable(
  "data_rights_requests",
  {
    id: serial("id").primaryKey(),
    requestType: varchar("requestType", { length: 32 }).notNull(), // "export" | "erasure" | "rectification"
    requesterId: integer("requesterId"), // userId or agentId
    requesterType: varchar("requesterType", { length: 32 }).notNull(), // "user" | "agent" | "customer"
    requesterEmail: varchar("requesterEmail", { length: 320 }).notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    exportFileUrl: text("exportFileUrl"),
    processedBy: varchar("processedBy", { length: 64 }),
    processedAt: timestamp("processedAt"),
    notes: text("notes"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    statusCreatedAtIdx: index("ddr_status_createdAt_idx").on(
      t.status,
      t.createdAt
    ),
  })
);

export type DataRightsRequest = typeof dataRightsRequests.$inferSelect;

// ═══════════════════════════════════════════════════════════════════════════════
// Fraud Detection Rules
// ═══════════════════════════════════════════════════════════════════════════════
export const fraudRuleCategoryEnum = pgEnum("fraud_rule_category", [
  "velocity",
  "geofence",
  "device_fingerprint",
  "amount_anomaly",
  "time_of_day",
  "blacklist",
  "custom",
]);

export const fraudRules = pgTable(
  "fraud_rules",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    category: fraudRuleCategoryEnum("category").notNull(),
    description: text("description"),
    // Thresholds are mixed-unit (counts, Naira amounts) — e.g. velocity rule
    // 10 tx, amount rule 49000.0000 — so numeric(5,4) overflows on real
    // Postgres (PGlite silently accepted it). Widened to match amount columns.
    threshold: numeric("threshold", { precision: 18, scale: 4 })
      .default("0.7000")
      .notNull(),
    windowSeconds: integer("windowSeconds").default(3600),
    maxCount: integer("maxCount").default(5),
    enabled: boolean("enabled").default(true).notNull(),
    hitCount: integer("hitCount").default(0).notNull(),
    lastHitAt: timestamp("lastHitAt"),
    createdBy: varchar("createdBy", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    categoryEnabledIdx: index("fraud_rules_category_enabled_idx").on(
      t.category,
      t.enabled
    ),
  })
);

export type FraudRule = typeof fraudRules.$inferSelect;
export type InsertFraudRule = typeof fraudRules.$inferInsert;

// ── Agent Push Subscriptions (Web Push VAPID) ────────────────────────────────
export const agentPushSubscriptions = pgTable(
  "agent_push_subscriptions",
  {
    id: serial("id").primaryKey(),
    agentId: varchar("agentId", { length: 32 }).notNull(),
    endpoint: text("endpoint").notNull().unique(),
    p256dhKey: text("p256dhKey").notNull(),
    authKey: text("authKey").notNull(),
    userAgent: text("userAgent"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    // Alert throttling: skip re-alert if sent within 30 minutes
    lastAlertedAt: timestamp("lastAlertedAt"),
  },
  t => ({
    agentIdIdx: index("agent_push_subscriptions_agent_code_idx").on(
      t.agentId
    ),
  })
);
export type AgentPushSubscription = typeof agentPushSubscriptions.$inferSelect;
export type InsertAgentPushSubscription =
  typeof agentPushSubscriptions.$inferInsert;

// ── Connectivity Log (24h probe history for sparkline chart) ─────────────────
export const connectivityQualityEnum = pgEnum("connectivity_quality", [
  "Excellent",
  "Good",
  "Poor",
  "Offline",
]);
export const connectivityLog = pgTable(
  "connectivity_log",
  {
    id: serial("id").primaryKey(),
    agentId: varchar("agentId", { length: 32 }).notNull(),
    quality: connectivityQualityEnum("quality").notNull(),
    latencyMs: integer("latencyMs"),
    recordedAt: timestamp("recordedAt").defaultNow().notNull(),
  },
  t => ({
    agentRecordedIdx: index("connectivity_log_agent_recorded_idx").on(
      t.agentId,
      t.recordedAt
    ),
  })
);
export type ConnectivityLog = typeof connectivityLog.$inferSelect;
export type InsertConnectivityLog = typeof connectivityLog.$inferInsert;

// ── System Config (admin-settable key-value store) ────────────────────────────
// Keys are unique strings; values are stored as text (cast by consumers).
// Seeded defaults:
//   dead_letter_auto_retry_threshold = "5"   (max queue size for auto-retry)
//   alert_throttle_window_minutes    = "30"  (min minutes between push alerts)
export const systemConfig = pgTable(
  "system_config",
  {
    id: serial("id").primaryKey(),
    key: varchar("key", { length: 128 }).notNull().unique(),
    value: text("value").notNull(),
    description: text("description"),
    updatedBy: varchar("updatedBy", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    keyIdx: uniqueIndex("system_config_key_idx").on(t.key),
  })
);
export type SystemConfig = typeof systemConfig.$inferSelect;
export type InsertSystemConfig = typeof systemConfig.$inferInsert;

// ── SIM Probe Log (SIM Orchestrator analytics) ────────────────────────────────
// One row per SIM slot per probe cycle. The orchestrator daemon posts a batch
// of 4 readings (one per slot) every probe interval.
// Indexed by agentId + probedAt for time-series queries.
export const simProbeLog = pgTable(
  "sim_probe_log",
  {
    id: serial("id").primaryKey(),
    agentId: varchar("agentId", { length: 32 }).notNull(),
    terminalId: varchar("terminalId", { length: 32 }).notNull(),
    slot: varchar("slot", { length: 8 }).notNull(), // Phys1|Phys2|ESim1|ESim2
    carrier: varchar("carrier", { length: 32 }).notNull(),
    mccMnc: integer("mccMnc").notNull(),
    rssi: integer("rssi").notNull(),
    regStatus: integer("regStatus").notNull(),
    latencyMs: integer("latencyMs").notNull(),
    packetLossX10: integer("packetLossX10").notNull(),
    score: integer("score").notNull(),
    selected: boolean("selected").notNull().default(false),
    latE6: integer("latE6"),
    lonE6: integer("lonE6"),
    fwVersion: varchar("fwVersion", { length: 16 }),
    probedAt: timestamp("probedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    agentProbedIdx: index("sim_probe_log_agent_probed_idx").on(
      t.agentId,
      t.probedAt
    ),
    slotProbedIdx: index("sim_probe_log_slot_probed_idx").on(
      t.slot,
      t.probedAt
    ),
  })
);
export type SimProbeLog = typeof simProbeLog.$inferSelect;
export type InsertSimProbeLog = typeof simProbeLog.$inferInsert;

// ── SIM Orchestrator Config (per-terminal daemon config) ──────────────────────
export const simOrchestratorConfig = pgTable(
  "sim_orchestrator_config",
  {
    id: serial("id").primaryKey(),
    terminalId: varchar("terminalId", { length: 32 }).notNull().unique(),
    probeIntervalMs: integer("probeIntervalMs").notNull().default(30000),
    relayEndpoint: varchar("relayEndpoint", { length: 256 })
      .notNull()
      .default("https://api.insureportal.io/api/trpc/simOrchestrator.ingestProbe"),
    apiKey: varchar("apiKey", { length: 128 })
      .notNull()
      .default("insureportal-sim-orchestrator-default-key"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    terminalIdx: uniqueIndex("sim_orchestrator_config_terminal_idx").on(
      t.terminalId
    ),
  })
);
export type SimOrchestratorConfig = typeof simOrchestratorConfig.$inferSelect;
export type InsertSimOrchestratorConfig =
  typeof simOrchestratorConfig.$inferInsert;

// ── SIM Failover Log (one row per emergency SIM switch triggered by watchdog) ──
// Posted by the Rust daemon immediately after each emergency switch.
// Used for admin panel Failover History tab and VAPID push alerts.
export const simFailoverLog = pgTable(
  "sim_failover_log",
  {
    id: serial("id").primaryKey(),
    terminalId: varchar("terminalId", { length: 32 }).notNull(),
    agentId: varchar("agentId", { length: 32 }).notNull(),
    fromSlot: integer("fromSlot").notNull(), // 0=Phys1, 1=Phys2, 2=ESim1, 3=ESim2
    toSlot: integer("toSlot").notNull(),
    reason: varchar("reason", { length: 32 }).notNull(), // high_latency | high_packet_loss
    latencyMs: integer("latencyMs").notNull(),
    lossX10: integer("lossX10").notNull(), // packet loss × 10 (tenths of percent)
    txRef: varchar("txRef", { length: 64 }), // transaction ref if available
    switchedAt: timestamp("switchedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    terminalSwitchedIdx: index("sim_failover_log_terminal_switched_idx").on(
      t.terminalId,
      t.switchedAt
    ),
    agentSwitchedIdx: index("sim_failover_log_agent_switched_idx").on(
      t.agentId,
      t.switchedAt
    ),
  })
);
export type SimFailoverLog = typeof simFailoverLog.$inferSelect;
export type InsertSimFailoverLog = typeof simFailoverLog.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// MDM Compliance Policies
// ═══════════════════════════════════════════════════════════════════════════════
export const deviceCompliancePolicies = pgTable(
  "device_compliance_policies",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    description: text("description"),
    tenantId: integer("tenantId"),
    // Policy rules stored as JSON: { minAppVersion, minOsVersion, requirePin, maxBatteryThreshold, geofenceRequired, allowedNetworkTypes }
    rules: json("rules").notNull().$type<{
      minAppVersion?: string;
      minOsVersion?: string;
      requirePin?: boolean;
      minBatteryLevel?: number;
      geofenceRequired?: boolean;
      allowedNetworkTypes?: string[];
      maxInactiveHours?: number;
    }>(),
    severity: varchar("severity", { length: 16 }).default("medium").notNull(), // low|medium|high|critical
    enabled: boolean("enabled").default(true).notNull(),
    enforcementAction: varchar("enforcementAction", { length: 32 }).default(
      "notify"
    ), // notify|restrict|wipe
    createdBy: varchar("createdBy", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    tenantIdIdx: index("dcp_tenantId_idx").on(t.tenantId),
    enabledIdx: index("dcp_enabled_idx").on(t.enabled),
  })
);

export type DeviceCompliancePolicy =
  typeof deviceCompliancePolicies.$inferSelect;
export type InsertDeviceCompliancePolicy =
  typeof deviceCompliancePolicies.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// MDM Compliance Violations
// ═══════════════════════════════════════════════════════════════════════════════
export const deviceComplianceViolations = pgTable(
  "device_compliance_violations",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("deviceId").notNull(),
    policyId: integer("policyId").notNull(),
    serialNumber: varchar("serialNumber", { length: 64 }).notNull(),
    agentId: varchar("agentId", { length: 32 }),
    violationType: varchar("violationType", { length: 64 }).notNull(), // low_battery|outdated_app|outdated_os|missing_pin|geofence_breach|inactive|disallowed_network
    severity: varchar("severity", { length: 16 }).notNull(), // low|medium|high|critical
    details: json("details"), // { actual, expected, threshold }
    status: varchar("status", { length: 32 }).default("open").notNull(), // open|acknowledged|resolved|suppressed
    enforcementAction: varchar("enforcementAction", { length: 32 }), // notify|restrict|wipe (what was triggered)
    resolvedAt: timestamp("resolvedAt"),
    resolvedBy: varchar("resolvedBy", { length: 64 }),
    detectedAt: timestamp("detectedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    deviceIdIdx: index("dcv_deviceId_idx").on(t.deviceId),
    policyIdIdx: index("dcv_policyId_idx").on(t.policyId),
    statusIdx: index("dcv_status_idx").on(t.status),
    detectedAtIdx: index("dcv_detectedAt_idx").on(t.detectedAt),
  })
);

export type DeviceComplianceViolation =
  typeof deviceComplianceViolations.$inferSelect;
export type InsertDeviceComplianceViolation =
  typeof deviceComplianceViolations.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// MDM Geofence Violations (from heartbeat location checks)
// ═══════════════════════════════════════════════════════════════════════════════
export const mdmGeofenceViolations = pgTable(
  "mdm_geofence_violations",
  {
    id: serial("id").primaryKey(),
    deviceId: integer("deviceId").notNull(),
    serialNumber: varchar("serialNumber", { length: 64 }).notNull(),
    agentId: varchar("agentId", { length: 32 }),
    zoneId: integer("zoneId"), // geofenceZones.id if matched
    zoneName: varchar("zoneName", { length: 128 }),
    violationType: varchar("violationType", { length: 32 }).notNull(), // outside_zone|inside_exclusion|boundary
    latE6: integer("latE6"), // device lat × 1e6
    lonE6: integer("lonE6"), // device lon × 1e6
    distanceMeters: integer("distanceMeters"), // distance from zone boundary
    status: varchar("status", { length: 32 }).default("open").notNull(),
    notifiedAt: timestamp("notifiedAt"),
    resolvedAt: timestamp("resolvedAt"),
    detectedAt: timestamp("detectedAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    deviceIdIdx: index("mgv_deviceId_idx").on(t.deviceId),
    detectedAtIdx: index("mgv_detectedAt_idx").on(t.detectedAt),
    statusIdx: index("mgv_status_idx").on(t.status),
  })
);

export type MdmGeofenceViolation = typeof mdmGeofenceViolations.$inferSelect;
export type InsertMdmGeofenceViolation =
  typeof mdmGeofenceViolations.$inferInsert;

// ── Kafka Dead-Letter Queue Log ───────────────────────────────────────────────
export const dlqMessages = pgTable(
  "dlq_messages",
  {
    id: serial("id").primaryKey(),
    topic: varchar("topic", { length: 128 }).notNull(),
    partition: integer("partition").notNull().default(0),
    offset: varchar("offset", { length: 32 }).notNull().default("0"),
    errorMessage: text("errorMessage").notNull().default(""),
    retryCount: integer("retryCount").notNull().default(0),
    payload: text("payload").notNull().default("{}"),
    status: varchar("status", { length: 32 })
      .notNull()
      .default("pending_retry"),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    topicIdx: index("dlq_topic_idx").on(t.topic),
    statusIdx: index("dlq_status_idx").on(t.status),
    createdAtIdx: index("dlq_createdAt_idx").on(t.createdAt),
  })
);
export type DlqMessage = typeof dlqMessages.$inferSelect;
export type InsertDlqMessage = typeof dlqMessages.$inferInsert;

// ── Commission Payouts ────────────────────────────────────────────────────────
export const commissionPayoutStatusEnum = pgEnum("commission_payout_status", [
  "pending",
  "approved",
  "processing",
  "completed",
  "failed",
  "rejected",
]);

export const commissionPayouts = pgTable(
  "commission_payouts",
  {
    id: serial("id").primaryKey(),
    agentId: varchar("agent_code", { length: 32 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 3 }).default("NGN").notNull(),
    status: commissionPayoutStatusEnum("status").default("pending").notNull(),
    requestedBy: integer("requested_by"),
    approvedBy: integer("approved_by"),
    rejectedBy: integer("rejected_by"),
    rejectionReason: text("rejection_reason"),
    bankCode: varchar("bank_code", { length: 10 }),
    accountNumber: varchar("account_number", { length: 20 }),
    accountName: varchar("account_name", { length: 100 }),
    nubanRef: varchar("nuban_ref", { length: 64 }),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  t => ({
    cp_agentId_idx: index("cp_agentId_idx").on(t.agentId),
    cp_status_idx: index("cp_status_idx").on(t.status),
    cp_createdAt_idx: index("cp_createdAt_idx").on(t.createdAt),
  })
);

// ── Referral Program ──────────────────────────────────────────────────────────
export const referralStatusEnum = pgEnum("referral_status", [
  "pending",
  "activated",
  "rewarded",
  "expired",
]);

export const referrals = pgTable(
  "referrals",
  {
    id: serial("id").primaryKey(),
    referrerAgentId: integer("referrer_agent_id")
      .notNull()
      .references(() => agents.id),
    referrerCode: varchar("referrer_code", { length: 32 }).notNull(),
    referralCode: varchar("referral_code", { length: 16 }).notNull().unique(),
    refereeAgentId: integer("referee_agent_id").references(() => agents.id),
    refereeCode: varchar("referee_code", { length: 32 }),
    status: referralStatusEnum("status").default("pending").notNull(),
    bonusPoints: integer("bonus_points").default(0).notNull(),
    bonusCash: numeric("bonus_cash", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    activatedAt: timestamp("activated_at"),
    rewardedAt: timestamp("rewarded_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => ({
    ref_referrerAgentId_idx: index("ref_referrerAgentId_idx").on(
      t.referrerAgentId
    ),
    ref_status_idx: index("ref_status_idx").on(t.status),
  })
);

// ── Outbound Webhook Endpoints ────────────────────────────────────────────────
export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    url: text("url").notNull(),
    secret: varchar("secret", { length: 64 }).notNull(),
    events: text("events").array().notNull().default([]),
    isActive: boolean("is_active").default(true).notNull(),
    tenantId: integer("tenant_id"),
    createdBy: integer("created_by"),
    failureCount: integer("failure_count").default(0).notNull(),
    lastDeliveryAt: timestamp("last_delivery_at"),
    lastStatusCode: integer("last_status_code"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  t => ({
    we_tenantId_idx: index("we_tenantId_idx").on(t.tenantId),
    we_isActive_idx: index("we_isActive_idx").on(t.isActive),
  })
);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "pending",
  "delivered",
  "failed",
  "retrying",
]);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: serial("id").primaryKey(),
    endpointId: integer("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id),
    subscriptionId: integer("subscription_id"),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    payload: json("payload").notNull(),
    status: webhookDeliveryStatusEnum("status").default("pending").notNull(),
    statusCode: integer("status_code"),
    responseCode: integer("response_code"),
    responseTime: integer("response_time"),
    responseBody: text("response_body"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    retryCount: integer("retry_count").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(3).notNull(),
    nextRetryAt: timestamp("next_retry_at"),
    deliveredAt: timestamp("delivered_at"),
    updatedAt: timestamp("updated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => ({
    wd_endpointId_idx: index("wd_endpointId_idx").on(t.endpointId),
    wd_status_idx: index("wd_status_idx").on(t.status),
    wd_createdAt_idx: index("wd_createdAt_idx").on(t.createdAt),
  })
);

// ── Agent Onboarding Progress ─────────────────────────────────────────────────
export const onboardingStepEnum = pgEnum("onboarding_step", [
  "profile",
  "kyc",
  "float",
  "terminal",
  "training",
  "activated",
]);

export const agentOnboardingProgress = pgTable(
  "agent_onboarding_progress",
  {
    id: serial("id").primaryKey(),
    agentId: varchar("agent_code", { length: 32 }).notNull(),
    currentStep: onboardingStepEnum("current_step")
      .default("profile")
      .notNull(),
    profileComplete: boolean("profile_complete").default(false).notNull(),
    kycComplete: boolean("kyc_complete").default(false).notNull(),
    floatFunded: boolean("float_funded").default(false).notNull(),
    terminalAssigned: boolean("terminal_assigned").default(false).notNull(),
    trainingComplete: boolean("training_complete").default(false).notNull(),
    activatedAt: timestamp("activated_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  t => ({
    aop_agentId_idx: index("aop_agentId_idx").on(t.agentId),
    aop_currentStep_idx: index("aop_currentStep_idx").on(t.currentStep),
  })
);

// ── Settlement Reconciliation ─────────────────────────────────────────────────
export const reconciliationStatusEnum = pgEnum("reconciliation_status", [
  "pending",
  "matched",
  "discrepancy",
  "resolved",
]);

export const settlementReconciliation = pgTable(
  "settlement_reconciliation",
  {
    id: serial("id").primaryKey(),
    settlementDate: varchar("settlement_date", { length: 10 }).notNull(),
    agentId: integer("agent_id").references(() => agents.id),
    agentId2: varchar("agent_code", { length: 32 }),
    expectedAmount: numeric("expected_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    actualAmount: numeric("actual_amount", {
      precision: 18,
      scale: 2,
    }).notNull(),
    discrepancy: numeric("discrepancy", { precision: 18, scale: 2 })
      .default("0")
      .notNull(),
    status: reconciliationStatusEnum("status").default("pending").notNull(),
    resolvedBy: integer("resolved_by"),
    resolutionNote: text("resolution_note"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => ({
    sr_agentId_idx: index("sr_agentId_idx").on(t.agentId),
    sr_status_idx: index("sr_status_idx").on(t.status),
    sr_settlementDate_idx: index("sr_settlementDate_idx").on(t.settlementDate),
  })
);

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 8: Rate Alert Subscriptions
// ═══════════════════════════════════════════════════════════════════════════════
export const rateAlertDirectionEnum = pgEnum("rate_alert_direction", [
  "above",
  "below",
]);
export const rateAlertStatusEnum = pgEnum("rate_alert_status", [
  "active",
  "paused",
  "triggered",
  "expired",
]);

export const rateAlerts = pgTable(
  "rate_alerts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    agentId: integer("agent_id").notNull(),
    baseCurrency: varchar("base_currency", { length: 3 }).notNull(),
    targetCurrency: varchar("target_currency", { length: 3 }).notNull(),
    targetRate: numeric("target_rate", { precision: 18, scale: 8 }).notNull(),
    direction: rateAlertDirectionEnum("direction").notNull(),
    status: rateAlertStatusEnum("status").default("active").notNull(),
    currentRate: numeric("current_rate", { precision: 18, scale: 8 }),
    triggeredAt: timestamp("triggered_at"),
    notifiedVia: json("notified_via").$type<string[]>().default([]),
    expiresAt: timestamp("expires_at"),
    note: varchar("note", { length: 256 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  t => ({
    agentStatusIdx: index("rate_alert_agent_status_idx").on(
      t.agentId,
      t.status
    ),
    pairIdx: index("rate_alert_pair_idx").on(t.baseCurrency, t.targetCurrency),
  })
);

export type RateAlert = typeof rateAlerts.$inferSelect;
export type NewRateAlert = typeof rateAlerts.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 8: Email Delivery Log (extends email_queue with provider tracking)
// ═══════════════════════════════════════════════════════════════════════════════
export const emailProviderEnum = pgEnum("email_provider", [
  "sendgrid",
  "ses",
  "smtp",
  "console",
]);

export const emailDeliveryLog = pgTable(
  "email_delivery_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    emailQueueId: integer("email_queue_id"),
    provider: emailProviderEnum("provider").notNull(),
    providerMessageId: varchar("provider_message_id", { length: 128 }),
    toAddress: varchar("to_address", { length: 320 }).notNull(),
    subject: varchar("subject", { length: 256 }).notNull(),
    status: varchar("status", { length: 32 }).notNull().default("sent"),
    openedAt: timestamp("opened_at"),
    clickedAt: timestamp("clicked_at"),
    bouncedAt: timestamp("bounced_at"),
    errorMessage: text("error_message"),
    metadata: json("metadata").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => ({
    providerIdx: index("email_delivery_provider_idx").on(
      t.provider,
      t.createdAt
    ),
    queueIdIdx: index("email_delivery_queue_id_idx").on(t.emailQueueId),
  })
);

export type EmailDeliveryLog = typeof emailDeliveryLog.$inferSelect;

// ─── Invite Codes (White-Label Partner Gating) ──────────────────────────────
export const inviteCodeTypeEnum = pgEnum("invite_code_type", [
  "one_time",
  "multi_use",
]);
export const inviteCodeStatusEnum = pgEnum("invite_code_status", [
  "active",
  "used",
  "expired",
  "revoked",
]);

export const inviteCodes = pgTable(
  "invite_codes",
  {
    id: serial("id").primaryKey(),
    code: varchar("code", { length: 32 }).notNull().unique(),
    type: inviteCodeTypeEnum("type").default("one_time").notNull(),
    status: inviteCodeStatusEnum("status").default("active").notNull(),
    maxUses: integer("maxUses").default(1).notNull(),
    usedCount: integer("usedCount").default(0).notNull(),
    createdBy: integer("createdBy"), // admin user ID who generated the code
    assignedTenantId: integer("assignedTenantId"), // tenant created from this code
    partnerName: varchar("partnerName", { length: 128 }),
    partnerEmail: varchar("partnerEmail", { length: 320 }),
    notes: text("notes"),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    codeIdx: uniqueIndex("invite_codes_code_idx").on(t.code),
    statusIdx: index("invite_codes_status_idx").on(t.status),
    createdByIdx: index("invite_codes_createdBy_idx").on(t.createdBy),
  })
);

export type InviteCode = typeof inviteCodes.$inferSelect;
export type InsertInviteCode = typeof inviteCodes.$inferInsert;

// ─── Tenant Branding (White-Label Customization) ────────────────────────────
export const tenantBranding = pgTable(
  "tenant_branding",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId").notNull(),
    logoUrl: text("logoUrl"),
    faviconUrl: text("faviconUrl"),
    primaryColor: varchar("primaryColor", { length: 9 })
      .default("#2563EB")
      .notNull(),
    secondaryColor: varchar("secondaryColor", { length: 9 })
      .default("#1E40AF")
      .notNull(),
    accentColor: varchar("accentColor", { length: 9 })
      .default("#F59E0B")
      .notNull(),
    backgroundColor: varchar("backgroundColor", { length: 9 })
      .default("#0F172A")
      .notNull(),
    textColor: varchar("textColor", { length: 9 }).default("#F8FAFC").notNull(),
    fontFamily: varchar("fontFamily", { length: 64 })
      .default("Inter")
      .notNull(),
    brandName: varchar("brandName", { length: 128 }),
    tagline: varchar("tagline", { length: 256 }),
    customDomain: varchar("customDomain", { length: 256 }),
    supportEmail: varchar("supportEmail", { length: 320 }),
    supportPhone: varchar("supportPhone", { length: 20 }),
    termsUrl: text("termsUrl"),
    privacyUrl: text("privacyUrl"),
    customCss: text("customCss"),
    isLive: boolean("isLive").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    tenantIdIdx: uniqueIndex("tenant_branding_tenantId_idx").on(t.tenantId),
  })
);

export type TenantBranding = typeof tenantBranding.$inferSelect;
export type InsertTenantBranding = typeof tenantBranding.$inferInsert;


// ─── Tenant Sub-Users ───────────────────────────────────────────────────────
export const tenantUserRoleEnum = pgEnum("tenant_user_role", [
  "tenant_admin",
  "tenant_operator",
  "tenant_viewer",
]);

export const tenantUsers = pgTable(
  "tenant_users",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId").notNull(),
    userId: integer("userId"),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 128 }),
    role: tenantUserRoleEnum("role").default("tenant_viewer").notNull(),
    isActive: boolean("isActive").default(true).notNull(),
    invitedBy: integer("invitedBy"),
    invitedAt: timestamp("invitedAt").defaultNow().notNull(),
    acceptedAt: timestamp("acceptedAt"),
    lastActiveAt: timestamp("lastActiveAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    tenantIdIdx: index("tenant_users_tenantId_idx").on(t.tenantId),
    emailIdx: index("tenant_users_email_idx").on(t.email),
    userIdIdx: index("tenant_users_userId_idx").on(t.userId),
  })
);

export type TenantUser = typeof tenantUsers.$inferSelect;
export type InsertTenantUser = typeof tenantUsers.$inferInsert;

// ─── Premium Fee Schedules (Insurance Fee Configuration) ─────────────────────
// Must match the enum created by migration 0028 ('percentage','flat','tiered'),
// otherwise drizzle-kit push and runtime inserts disagree with the real DB.
export const feeTypeEnum = pgEnum("fee_type", ["percentage", "flat", "tiered"]);
export const premiumFeeSchedules = pgTable(
  "premium_fee_schedules",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenantId").notNull(),
    productType: varchar("productType", { length: 64 }).default("motor").notNull(),
    feeType: feeTypeEnum("feeType").default("percentage").notNull(),
    feeValue: numeric("feeValue", { precision: 10, scale: 4 })
      .default("2.5000")
      .notNull(),
    minFee: numeric("minFee", { precision: 20, scale: 2 })
      .default("500.00")
      .notNull(),
    maxFee: numeric("maxFee", { precision: 20, scale: 2 })
      .default("100000.00")
      .notNull(),
    description: text("description"),
    isActive: boolean("isActive").default(true).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    tenantIdIdx: index("pfs_tenantId_idx").on(t.tenantId),
    productTypeIdx: index("pfs_productType_idx").on(t.productType),
  })
);

export type PremiumFeeSchedule = typeof premiumFeeSchedules.$inferSelect;
export type InsertPremiumFeeSchedule = typeof premiumFeeSchedules.$inferInsert;

// ─── Customer Feedback NPS ───────────────────────────────────────────────────
export const customerFeedbackNps = pgTable(
  "customer_feedback_nps",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customerId"),
    score: integer("score").notNull(),
    feedback: text("feedback"),
    channel: varchar("channel", { length: 64 }).default("web").notNull(),
    policyId: integer("policyId"),
    claimId: integer("claimId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    customerIdx: index("cfn_customerId_idx").on(t.customerId),
    scoreIdx: index("cfn_score_idx").on(t.score),
  })
);

export type CustomerFeedbackNps = typeof customerFeedbackNps.$inferSelect;

// ─── Sprint 48: Commission Cascade History ──────────────────────────────────
export const commissionCascadeHistory = pgTable(
  "commission_cascade_history",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transactionId").notNull(),
    transactionRef: varchar("transactionRef", { length: 64 }).notNull(),
    transactionType: varchar("transactionType", { length: 32 }).notNull(),
    transactionAmount: numeric("transactionAmount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    totalCommission: numeric("totalCommission", {
      precision: 15,
      scale: 2,
    }).notNull(),
    // The agent who performed the transaction
    originAgentId: integer("originAgentId").notNull(),
    originAgentCode: varchar("originAgentCode", { length: 32 }).notNull(),
    // The agent receiving this cascade entry
    recipientAgentId: integer("recipientAgentId").notNull(),
    recipientAgentCode: varchar("recipientAgentCode", { length: 32 }).notNull(),
    recipientHierarchyRole: varchar("recipientHierarchyRole", {
      length: 32,
    }).notNull(),
    recipientHierarchyLevel: integer("recipientHierarchyLevel").notNull(),
    // Commission split details
    splitPercentage: numeric("splitPercentage", {
      precision: 5,
      scale: 2,
    }).notNull(),
    commissionAmount: numeric("commissionAmount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    // Status
    status: varchar("status", { length: 16 }).default("credited").notNull(), // credited, pending, failed
    creditedAt: timestamp("creditedAt").defaultNow(),
    // Tenant isolation
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    txRefIdx: index("cch_transactionRef_idx").on(t.transactionRef),
    originAgentIdx: index("cch_originAgentId_idx").on(t.originAgentId),
    recipientAgentIdx: index("cch_recipientAgentId_idx").on(t.recipientAgentId),
    createdAtIdx: index("cch_createdAt_idx").on(t.createdAt),
  })
);
export type CommissionCascadeHistory =
  typeof commissionCascadeHistory.$inferSelect;
export type InsertCommissionCascadeHistory =
  typeof commissionCascadeHistory.$inferInsert;

// ── Sprint 49 Schema Additions ──────────────────────────────────────────────

export const agentBankAccounts = pgTable(
  "agent_bank_accounts",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    bankName: text("bank_name").notNull(),
    bankCode: text("bank_code").notNull(),
    accountNumber: text("account_number").notNull(),
    accountName: text("account_name").notNull(),
    isDefault: boolean("is_default").default(false),
    verified: boolean("verified").default(false),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  t => ({
    aba_agentId_idx: index("aba_agentId_idx").on(t.agentId),
  })
);

export const kycDocuments = pgTable(
  "kyc_documents",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    docType: text("doc_type").notNull(), // BVN, NIN, utility_bill, passport_photo, cac_cert
    docNumber: text("doc_number"),
    docUrl: text("doc_url"),
    status: text("status").default("pending"), // pending, verified, rejected
    verifiedBy: integer("verified_by"),
    verifiedAt: timestamp("verified_at"),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  t => ({
    kd_agentId_idx: index("kd_agentId_idx").on(t.agentId),
    kd_status_idx: index("kd_status_idx").on(t.status),
  })
);

export const floatReconciliations = pgTable(
  "float_reconciliations",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    date: timestamp("date").notNull(),
    expectedBalance: numeric("expected_balance", {
      precision: 15,
      scale: 2,
    }).notNull(),
    actualBalance: numeric("actual_balance", {
      precision: 15,
      scale: 2,
    }).notNull(),
    discrepancy: numeric("discrepancy", { precision: 15, scale: 2 }).notNull(),
    status: text("status").default("pending"), // pending, resolved, escalated
    resolvedBy: integer("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    fr_agentId_idx: index("fr_agentId_idx").on(t.agentId),
    fr_status_idx: index("fr_status_idx").on(t.status),
    fr_date_idx: index("fr_date_idx").on(t.date),
  })
);

export const agentPerformanceScores = pgTable(
  "agent_performance_scores",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    period: text("period").notNull(), // 2026-W16, 2026-04
    txVolume: numeric("tx_volume", { precision: 15, scale: 2 }).default("0"),
    txCount: integer("tx_count").default(0),
    commissionEarned: numeric("commission_earned", {
      precision: 15,
      scale: 2,
    }).default("0"),
    customerCount: integer("customer_count").default(0),
    disputeRate: numeric("dispute_rate", { precision: 5, scale: 4 }).default(
      "0"
    ),
    uptimePercent: numeric("uptime_percent", {
      precision: 5,
      scale: 2,
    }).default("100"),
    overallScore: numeric("overall_score", { precision: 5, scale: 2 }).default(
      "0"
    ),
    rank: integer("rank"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    aps_agentId_idx: index("aps_agentId_idx").on(t.agentId),
    aps_period_idx: index("aps_period_idx").on(t.period),
  })
);

export const commissionClawbacks = pgTable(
  "commission_clawbacks",
  {
    id: serial("id").primaryKey(),
    reversalRequestId: integer("reversal_request_id").notNull(),
    agentId: integer("agent_id").notNull(),
    originalCommission: numeric("original_commission", {
      precision: 15,
      scale: 2,
    }).notNull(),
    clawbackAmount: numeric("clawback_amount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    cascadeLevel: text("cascade_level").notNull(), // agent, master_agent, super_agent, sub_agent, platform
    status: text("status").default("pending"), // pending, applied, failed
    appliedAt: timestamp("applied_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    cc_agentId_idx: index("cc_agentId_idx").on(t.agentId),
    cc_status_idx: index("cc_status_idx").on(t.status),
  })
);

export const pnlReports = pgTable(
  "pnl_reports",
  {
    id: serial("id").primaryKey(),
    period: text("period").notNull(), // daily: 2026-04-21, weekly: 2026-W16
    periodType: text("period_type").notNull(), // daily, weekly, monthly
    agentId: integer("agent_id"),
    regionCode: text("region_code"),
    totalRevenue: numeric("total_revenue", { precision: 15, scale: 2 }).default(
      "0"
    ),
    totalCommission: numeric("total_commission", {
      precision: 15,
      scale: 2,
    }).default("0"),
    totalFees: numeric("total_fees", { precision: 15, scale: 2 }).default("0"),
    operatingCosts: numeric("operating_costs", {
      precision: 15,
      scale: 2,
    }).default("0"),
    netMargin: numeric("net_margin", { precision: 15, scale: 2 }).default("0"),
    txCount: integer("tx_count").default(0),
    txVolume: numeric("tx_volume", { precision: 15, scale: 2 }).default("0"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    pnl_period_idx: index("pnl_period_idx").on(t.period),
    pnl_agentId_idx: index("pnl_agentId_idx").on(t.agentId),
    pnl_periodType_idx: index("pnl_periodType_idx").on(t.periodType),
  })
);

export const geoFences = pgTable(
  "geo_fences",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    regionCode: text("region_code").notNull(),
    centerLat: numeric("center_lat", { precision: 10, scale: 7 }).notNull(),
    centerLng: numeric("center_lng", { precision: 10, scale: 7 }).notNull(),
    radiusKm: numeric("radius_km", { precision: 8, scale: 2 }).notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    gf_regionCode_idx: index("gf_regionCode_idx").on(t.regionCode),
    gf_isActive_idx: index("gf_isActive_idx").on(t.isActive),
  })
);

export const transactionLimits = pgTable(
  "transaction_limits",
  {
    id: serial("id").primaryKey(),
    agentTier: text("agent_tier").notNull(), // bronze, silver, gold, platinum, diamond
    txType: text("tx_type").notNull(), // cash_in, cash_out, transfer, bills, airtime
    dailyLimit: numeric("daily_limit", { precision: 15, scale: 2 }).notNull(),
    monthlyLimit: numeric("monthly_limit", {
      precision: 15,
      scale: 2,
    }).notNull(),
    perTxLimit: numeric("per_tx_limit", { precision: 15, scale: 2 }).notNull(),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  t => ({
    tl_agentTier_txType_idx: index("tl_agentTier_txType_idx").on(
      t.agentTier,
      t.txType
    ),
    tl_isActive_idx: index("tl_isActive_idx").on(t.isActive),
  })
);

export const complianceChecks = pgTable(
  "compliance_checks",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id"),
    transactionId: integer("transaction_id"),
    checkType: text("check_type").notNull(), // AML, CTR, STR, KYC, PEP
    ruleCode: text("rule_code").notNull(),
    result: text("result").notNull(), // pass, fail, flag
    details: text("details"),
    flaggedAmount: numeric("flagged_amount", { precision: 15, scale: 2 }),
    reportedToRegulator: boolean("reported_to_regulator").default(false),
    reportedAt: timestamp("reported_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    cck_agentId_idx: index("cck_agentId_idx").on(t.agentId),
    cck_checkType_idx: index("cck_checkType_idx").on(t.checkType),
    cck_createdAt_idx: index("cck_createdAt_idx").on(t.createdAt),
  })
);

export const agentSuspensionLog = pgTable(
  "agent_suspension_log",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    action: text("action").notNull(), // suspend, reactivate
    reason: text("reason").notNull(),
    performedBy: integer("performed_by").notNull(),
    previousStatus: text("previous_status"),
    newStatus: text("new_status"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    asl_agentId_idx: index("asl_agentId_idx").on(t.agentId),
    asl_createdAt_idx: index("asl_createdAt_idx").on(t.createdAt),
  })
);

// ==================== Sprint 50: 20 Production Features Schema ====================

// F01: Real-Time Transaction Monitoring
export const txMonitoringAlerts = pgTable(
  "tx_monitoring_alerts",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id"),
    alertType: text("alert_type").notNull(),
    severity: text("severity").notNull(),
    description: text("description").notNull(),
    riskScore: numeric("risk_score", { precision: 5, scale: 2 }),
    agentId: integer("agent_id"),
    resolved: boolean("resolved").default(false),
    resolvedBy: integer("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    tma_agentId_idx: index("tma_agentId_idx").on(t.agentId),
    tma_severity_idx: index("tma_severity_idx").on(t.severity),
    tma_createdAt_idx: index("tma_createdAt_idx").on(t.createdAt),
  })
);

// F02: Fraud ML Scoring
export const fraudMlScores = pgTable(
  "fraud_ml_scores",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id"),
    agentId: integer("agent_id"),
    riskScore: numeric("risk_score", { precision: 5, scale: 2 }).notNull(),
    modelVersion: text("model_version").notNull(),
    features: text("features"),
    prediction: text("prediction").notNull(),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    falsePositive: boolean("false_positive").default(false),
    reviewedBy: integer("reviewed_by"),
    reviewedAt: timestamp("reviewed_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    fms_transactionId_idx: index("fms_transactionId_idx").on(t.transactionId),
    fms_agentId_idx: index("fms_agentId_idx").on(t.agentId),
    fms_createdAt_idx: index("fms_createdAt_idx").on(t.createdAt),
  })
);

// F03: Notification Dispatch Log
export const notificationDispatchLog = pgTable(
  "notification_dispatch_log",
  {
    id: serial("id").primaryKey(),
    recipientId: integer("recipient_id"),
    recipientType: text("recipient_type").notNull(),
    channel: text("channel").notNull(),
    templateId: text("template_id"),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status").notNull().default("queued"),
    externalId: text("external_id"),
    retryCount: integer("retry_count").default(0),
    maxRetries: integer("max_retries").default(3),
    nextRetryAt: timestamp("next_retry_at"),
    deliveredAt: timestamp("delivered_at"),
    failureReason: text("failure_reason"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    ndl_recipientId_idx: index("ndl_recipientId_idx").on(t.recipientId),
    ndl_status_idx: index("ndl_status_idx").on(t.status),
    ndl_createdAt_idx: index("ndl_createdAt_idx").on(t.createdAt),
  })
);

// F04: Agent Loans
export const loanStatusEnum = pgEnum("loan_status", [
  "pending",
  "approved",
  "disbursed",
  "repaying",
  "completed",
  "defaulted",
  "rejected",
]);
export const agentLoans = pgTable(
  "agent_loans",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    loanType: text("loan_type").notNull(),
    principalAmount: numeric("principal_amount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    interestRate: numeric("interest_rate", {
      precision: 5,
      scale: 2,
    }).notNull(),
    tenorDays: integer("tenor_days").notNull(),
    totalRepayable: numeric("total_repayable", {
      precision: 15,
      scale: 2,
    }).notNull(),
    amountRepaid: numeric("amount_repaid", { precision: 15, scale: 2 }).default(
      "0"
    ),
    status: loanStatusEnum("status").notNull().default("pending"),
    disbursedAt: timestamp("disbursed_at"),
    dueDate: timestamp("due_date"),
    approvedBy: integer("approved_by"),
    creditScore: integer("credit_score"),
    collateralType: text("collateral_type"),
    collateralValue: numeric("collateral_value", { precision: 15, scale: 2 }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  t => ({
    al_agentId_idx: index("al_agentId_idx").on(t.agentId),
    al_status_idx: index("al_status_idx").on(t.status),
    al_createdAt_idx: index("al_createdAt_idx").on(t.createdAt),
  })
);

// F05: Dynamic Fee Engine
export const feeRules = pgTable(
  "fee_rules",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    txType: text("tx_type").notNull(),
    agentTier: text("agent_tier"),
    minAmount: numeric("min_amount", { precision: 15, scale: 2 }).default("0"),
    maxAmount: numeric("max_amount", { precision: 15, scale: 2 }),
    feeType: text("fee_type").notNull(),
    feeValue: numeric("fee_value", { precision: 10, scale: 4 }).notNull(),
    minFee: numeric("min_fee", { precision: 15, scale: 2 }),
    maxFee: numeric("max_fee", { precision: 15, scale: 2 }),
    isPromotional: boolean("is_promotional").default(false),
    promoStartDate: timestamp("promo_start_date"),
    promoEndDate: timestamp("promo_end_date"),
    isActive: boolean("is_active").default(true),
    priority: integer("priority").default(0),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  t => ({
    fer_txType_idx: index("fer_txType_idx").on(t.txType),
    fer_isActive_idx: index("fer_isActive_idx").on(t.isActive),
  })
);

export const feeAuditTrail = pgTable(
  "fee_audit_trail",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id"),
    feeRuleId: integer("fee_rule_id"),
    txAmount: numeric("tx_amount", { precision: 15, scale: 2 }).notNull(),
    calculatedFee: numeric("calculated_fee", {
      precision: 15,
      scale: 2,
    }).notNull(),
    appliedFee: numeric("applied_fee", { precision: 15, scale: 2 }).notNull(),
    waiverApplied: boolean("waiver_applied").default(false),
    waiverReason: text("waiver_reason"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    fat_transactionId_idx: index("fat_transactionId_idx").on(t.transactionId),
    fat_createdAt_idx: index("fat_createdAt_idx").on(t.createdAt),
  })
);

// F06: Merchant KYC & Payouts
export const merchantKycDocs = pgTable(
  "merchant_kyc_docs",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull(),
    docType: text("doc_type").notNull(),
    docUrl: text("doc_url").notNull(),
    status: text("status").notNull().default("pending"),
    verifiedBy: integer("verified_by"),
    verifiedAt: timestamp("verified_at"),
    rejectionReason: text("rejection_reason"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    mkd_merchantId_idx: index("mkd_merchantId_idx").on(t.merchantId),
    mkd_status_idx: index("mkd_status_idx").on(t.status),
  })
);

export const merchantPayouts = pgTable(
  "merchant_payouts",
  {
    id: serial("id").primaryKey(),
    merchantId: integer("merchant_id").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("NGN"),
    bankCode: text("bank_code").notNull(),
    accountNumber: text("account_number").notNull(),
    accountName: text("account_name").notNull(),
    reference: text("reference").notNull(),
    status: text("status").notNull().default("pending"),
    processedAt: timestamp("processed_at"),
    failureReason: text("failure_reason"),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    txCount: integer("tx_count").default(0),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    mp_merchantId_idx: index("mp_merchantId_idx").on(t.merchantId),
    mp_status_idx: index("mp_status_idx").on(t.status),
    mp_createdAt_idx: index("mp_createdAt_idx").on(t.createdAt),
  })
);

// F07: Compliance Filings
export const complianceFilings = pgTable(
  "compliance_filings",
  {
    id: serial("id").primaryKey(),
    filingType: text("filing_type").notNull(),
    referenceNumber: text("reference_number").notNull(),
    status: text("status").notNull().default("draft"),
    reportingPeriod: text("reporting_period"),
    submittedTo: text("submitted_to"),
    submittedAt: timestamp("submitted_at"),
    acknowledgedAt: timestamp("acknowledged_at"),
    totalTransactions: integer("total_transactions").default(0),
    totalAmount: numeric("total_amount", { precision: 15, scale: 2 }),
    flaggedCount: integer("flagged_count").default(0),
    filingData: text("filing_data"),
    preparedBy: integer("prepared_by"),
    reviewedBy: integer("reviewed_by"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    cf_status_idx: index("cf_status_idx").on(t.status),
    cf_filingType_idx: index("cf_filingType_idx").on(t.filingType),
    cf_createdAt_idx: index("cf_createdAt_idx").on(t.createdAt),
  })
);

// F08: Agent Achievements & Badges
export const agentAchievements = pgTable(
  "agent_achievements",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agent_id").notNull(),
    achievementType: text("achievement_type").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    badgeIcon: text("badge_icon"),
    points: integer("points").default(0),
    level: integer("level").default(1),
    unlockedAt: timestamp("unlocked_at").defaultNow(),
    metadata: text("metadata"),
  },
  t => ({
    aa_agentId_idx: index("aa_agentId_idx").on(t.agentId),
    aa_achievementType_idx: index("aa_achievementType_idx").on(
      t.achievementType
    ),
  })
);

export const agentBadges = pgTable(
  "agent_badges",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    icon: text("icon").notNull(),
    category: text("category").notNull(),
    requirement: text("requirement").notNull(),
    pointsValue: integer("points_value").default(0),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    ab_category_idx: index("ab_category_idx").on(t.category),
    ab_isActive_idx: index("ab_isActive_idx").on(t.isActive),
  })
);

// F09: Tenant Feature Toggles
export const tenantFeatureToggles = pgTable(
  "tenant_feature_toggles",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull(),
    featureKey: text("feature_key").notNull(),
    enabled: boolean("enabled").default(false),
    config: text("config"),
    enabledBy: integer("enabled_by"),
    enabledAt: timestamp("enabled_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    tft_tenantId_idx: index("tft_tenantId_idx").on(t.tenantId),
    tft_featureKey_idx: index("tft_featureKey_idx").on(t.featureKey),
  })
);

// F10: Batch Reconciliation
export const reconciliationBatches = pgTable(
  "reconciliation_batches",
  {
    id: serial("id").primaryKey(),
    batchReference: text("batch_reference").notNull(),
    sourceType: text("source_type").notNull(),
    fileName: text("file_name"),
    fileUrl: text("file_url"),
    totalRecords: integer("total_records").default(0),
    matchedCount: integer("matched_count").default(0),
    unmatchedCount: integer("unmatched_count").default(0),
    discrepancyCount: integer("discrepancy_count").default(0),
    totalAmount: numeric("total_amount", { precision: 15, scale: 2 }),
    status: text("status").notNull().default("pending"),
    processedBy: integer("processed_by"),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    rb_status_idx: index("rb_status_idx").on(t.status),
    rb_createdAt_idx: index("rb_createdAt_idx").on(t.createdAt),
  })
);

export const reconciliationItems = pgTable(
  "reconciliation_items",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull(),
    externalRef: text("external_ref").notNull(),
    internalRef: text("internal_ref"),
    externalAmount: numeric("external_amount", {
      precision: 15,
      scale: 2,
    }).notNull(),
    internalAmount: numeric("internal_amount", { precision: 15, scale: 2 }),
    discrepancy: numeric("discrepancy", { precision: 15, scale: 2 }),
    matchStatus: text("match_status").notNull(),
    resolution: text("resolution"),
    resolvedBy: integer("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    ri_batchId_idx: index("ri_batchId_idx").on(t.batchId),
    ri_matchStatus_idx: index("ri_matchStatus_idx").on(t.matchStatus),
  })
);

// F11: Analytics Dashboards
export const analyticsDashboards = pgTable(
  "analytics_dashboards",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    ownerId: integer("owner_id").notNull(),
    isPublic: boolean("is_public").default(false),
    layout: text("layout"),
    filters: text("filters"),
    refreshInterval: integer("refresh_interval").default(300),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  t => ({
    ad_ownerId_idx: index("ad_ownerId_idx").on(t.ownerId),
  })
);

// F12: Customer Journey
export const customerJourneySteps = pgTable(
  "customer_journey_steps",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customer_id").notNull(),
    stepType: text("step_type").notNull(),
    status: text("status").notNull().default("pending"),
    completedAt: timestamp("completed_at"),
    metadata: text("metadata"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    cjs_customerId_idx: index("cjs_customerId_idx").on(t.customerId),
    cjs_status_idx: index("cjs_status_idx").on(t.status),
  })
);

// F13: Rate Limit Rules
export const rateLimitRules = pgTable(
  "rate_limit_rules",
  {
    id: serial("id").primaryKey(),
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull().default("*"),
    maxRequests: integer("max_requests").notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    burstLimit: integer("burst_limit"),
    scope: text("scope").notNull().default("global"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    rlr_endpoint_idx: index("rlr_endpoint_idx").on(t.endpoint),
    rlr_isActive_idx: index("rlr_isActive_idx").on(t.isActive),
  })
);

// F14: Backup Snapshots
export const backupSnapshots = pgTable(
  "backup_snapshots",
  {
    id: serial("id").primaryKey(),
    snapshotType: text("snapshot_type").notNull(),
    status: text("status").notNull().default("in_progress"),
    sizeBytes: integer("size_bytes"),
    storageUrl: text("storage_url"),
    tablesIncluded: integer("tables_included"),
    rowsBackedUp: integer("rows_backed_up"),
    durationMs: integer("duration_ms"),
    rtoMinutes: integer("rto_minutes"),
    rpoMinutes: integer("rpo_minutes"),
    triggeredBy: text("triggered_by").notNull(),
    completedAt: timestamp("completed_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    bs_status_idx: index("bs_status_idx").on(t.status),
    bs_createdAt_idx: index("bs_createdAt_idx").on(t.createdAt),
  })
);

// F15: Workflow Definitions & Instances
export const workflowDefinitions = pgTable(
  "workflow_definitions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    steps: text("steps").notNull(),
    slaHours: integer("sla_hours"),
    escalationRules: text("escalation_rules"),
    isActive: boolean("is_active").default(true),
    version: integer("version").default(1),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    wdef_category_idx: index("wdef_category_idx").on(t.category),
    wdef_isActive_idx: index("wdef_isActive_idx").on(t.isActive),
  })
);

export const workflowInstances = pgTable(
  "workflow_instances",
  {
    id: serial("id").primaryKey(),
    definitionId: integer("definition_id").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    currentStep: integer("current_step").default(0),
    status: text("status").notNull().default("active"),
    assignedTo: integer("assigned_to"),
    startedAt: timestamp("started_at").defaultNow(),
    completedAt: timestamp("completed_at"),
    slaDeadline: timestamp("sla_deadline"),
    stepHistory: text("step_history"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    wi_definitionId_idx: index("wi_definitionId_idx").on(t.definitionId),
    wi_status_idx: index("wi_status_idx").on(t.status),
    wi_assignedTo_idx: index("wi_assignedTo_idx").on(t.assignedTo),
  })
);

// F16: General Ledger
export const glEntries = pgTable(
  "gl_entries",
  {
    id: serial("id").primaryKey(),
    accountCode: text("account_code").notNull(),
    accountName: text("account_name").notNull(),
    entryType: text("entry_type").notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("NGN"),
    reference: text("reference").notNull(),
    description: text("description"),
    periodDate: timestamp("period_date").notNull(),
    postedBy: integer("posted_by"),
    isReversed: boolean("is_reversed").default(false),
    reversalRef: text("reversal_ref"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    gle_accountCode_idx: index("gle_accountCode_idx").on(t.accountCode),
    gle_periodDate_idx: index("gle_periodDate_idx").on(t.periodDate),
    gle_entryType_idx: index("gle_entryType_idx").on(t.entryType),
  })
);

// F17: Training Courses & Enrollments
export const trainingCourses = pgTable(
  "training_courses",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    category: text("category").notNull(),
    contentType: text("content_type").notNull(),
    contentUrl: text("content_url"),
    durationMinutes: integer("duration_minutes"),
    passingScore: integer("passing_score").default(70),
    isMandatory: boolean("is_mandatory").default(false),
    isActive: boolean("is_active").default(true),
    version: integer("version").default(1),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    tc_category_idx: index("tc_category_idx").on(t.category),
    tc_isActive_idx: index("tc_isActive_idx").on(t.isActive),
  })
);

export const trainingEnrollments = pgTable(
  "training_enrollments",
  {
    id: serial("id").primaryKey(),
    courseId: integer("course_id").notNull(),
    agentId: integer("agent_id").notNull(),
    status: text("status").notNull().default("enrolled"),
    progress: integer("progress").default(0),
    score: integer("score"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    certificateUrl: text("certificate_url"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    te_courseId_idx: index("te_courseId_idx").on(t.courseId),
    te_agentId_idx: index("te_agentId_idx").on(t.agentId),
    te_status_idx: index("te_status_idx").on(t.status),
  })
);

// F18: BI Report Definitions
export const biReportDefinitions = pgTable(
  "bi_report_definitions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description"),
    reportType: text("report_type").notNull(),
    dataSource: text("data_source").notNull(),
    query: text("query"),
    schedule: text("schedule"),
    recipients: text("recipients"),
    lastRunAt: timestamp("last_run_at"),
    isActive: boolean("is_active").default(true),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    brd_reportType_idx: index("brd_reportType_idx").on(t.reportType),
    brd_isActive_idx: index("brd_isActive_idx").on(t.isActive),
  })
);

// F19: Observability Alerts
export const observabilityAlerts = pgTable(
  "observability_alerts",
  {
    id: serial("id").primaryKey(),
    alertName: text("alert_name").notNull(),
    service: text("service").notNull(),
    severity: text("severity").notNull(),
    metric: text("metric").notNull(),
    threshold: numeric("threshold", { precision: 10, scale: 2 }).notNull(),
    currentValue: numeric("current_value", { precision: 10, scale: 2 }),
    status: text("status").notNull().default("firing"),
    acknowledgedBy: integer("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    oa_service_idx: index("oa_service_idx").on(t.service),
    oa_status_idx: index("oa_status_idx").on(t.status),
    oa_severity_idx: index("oa_severity_idx").on(t.severity),
    oa_createdAt_idx: index("oa_createdAt_idx").on(t.createdAt),
  })
);

// F20: Encrypted Fields & Data Consent
export const encryptedFields = pgTable(
  "encrypted_fields",
  {
    id: serial("id").primaryKey(),
    tableName: text("table_name").notNull(),
    fieldName: text("field_name").notNull(),
    encryptionKeyId: text("encryption_key_id").notNull(),
    algorithm: text("algorithm").notNull().default("AES-256-GCM"),
    lastRotatedAt: timestamp("last_rotated_at"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    ef_tableName_idx: index("ef_tableName_idx").on(t.tableName),
    ef_fieldName_idx: index("ef_fieldName_idx").on(t.fieldName),
  })
);

export const dataConsentRecords = pgTable(
  "data_consent_records",
  {
    id: serial("id").primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    consentType: text("consent_type").notNull(),
    granted: boolean("granted").notNull(),
    grantedAt: timestamp("granted_at"),
    revokedAt: timestamp("revoked_at"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    version: integer("version").default(1),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    dcr_entityId_idx: index("dcr_entityId_idx").on(t.entityId),
    dcr_consentType_idx: index("dcr_consentType_idx").on(t.consentType),
  })
);

// ── Sprint 51: Missing tables identified by deep audit ──
export const realtime_tx_alerts = pgTable(
  "realtime_tx_alerts",
  {
    id: serial("id").primaryKey(),
    transactionId: text("transaction_id").notNull(),
    alertType: text("alert_type").notNull(),
    severity: text("severity").notNull().default("medium"),
    message: text("message").notNull(),
    metadata: text("metadata"),
    acknowledged: boolean("acknowledged").default(false),
    acknowledgedBy: text("acknowledged_by"),
    acknowledgedAt: timestamp("acknowledged_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    rta_transactionId_idx: index("rta_transactionId_idx").on(t.transactionId),
    rta_alertType_idx: index("rta_alertType_idx").on(t.alertType),
    rta_severity_idx: index("rta_severity_idx").on(t.severity),
  })
);

export const notification_channels = pgTable(
  "notification_channels",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    channelType: text("channel_type").notNull(),
    config: text("config"),
    isActive: boolean("is_active").default(true),
    priority: integer("priority").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  t => ({
    nc_channelType_idx: index("nc_channelType_idx").on(t.channelType),
    nc_isActive_idx: index("nc_isActive_idx").on(t.isActive),
  })
);

export const notification_logs = pgTable(
  "notification_logs",
  {
    id: serial("id").primaryKey(),
    channelId: integer("channel_id"),
    recipientId: text("recipient_id").notNull(),
    recipientType: text("recipient_type").notNull(),
    subject: text("subject"),
    body: text("body").notNull(),
    status: text("status").notNull().default("pending"),
    sentAt: timestamp("sent_at"),
    deliveredAt: timestamp("delivered_at"),
    failureReason: text("failure_reason"),
    retryCount: integer("retry_count").default(0),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    nl_channelId_idx: index("nl_channelId_idx").on(t.channelId),
    nl_status_idx: index("nl_status_idx").on(t.status),
    nl_createdAt_idx: index("nl_createdAt_idx").on(t.createdAt),
  })
);

export const customer_journey_events = pgTable(
  "customer_journey_events",
  {
    id: serial("id").primaryKey(),
    customerId: text("customer_id").notNull(),
    eventType: text("event_type").notNull(),
    eventSource: text("event_source").notNull(),
    eventData: text("event_data"),
    sessionId: text("session_id"),
    deviceType: text("device_type"),
    channel: text("channel"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    cje_customerId_idx: index("cje_customerId_idx").on(t.customerId),
    cje_eventType_idx: index("cje_eventType_idx").on(t.eventType),
    cje_createdAt_idx: index("cje_createdAt_idx").on(t.createdAt),
  })
);

export const gl_accounts = pgTable(
  "gl_accounts",
  {
    id: serial("id").primaryKey(),
    accountCode: text("account_code").notNull().unique(),
    accountName: text("account_name").notNull(),
    accountType: text("account_type").notNull(),
    parentAccountId: integer("parent_account_id"),
    currency: text("currency").notNull().default("NGN"),
    balance: integer("balance").notNull().default(0),
    isActive: boolean("is_active").default(true),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  t => ({
    gla_accountCode_idx: index("gla_accountCode_idx").on(t.accountCode),
    gla_accountType_idx: index("gla_accountType_idx").on(t.accountType),
    gla_isActive_idx: index("gla_isActive_idx").on(t.isActive),
  })
);

export const gl_journal_entries = pgTable(
  "gl_journal_entries",
  {
    id: serial("id").primaryKey(),
    entryNumber: text("entry_number").notNull().unique(),
    description: text("description").notNull(),
    debitAccountId: integer("debit_account_id").notNull(),
    creditAccountId: integer("credit_account_id").notNull(),
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("NGN"),
    referenceType: text("reference_type"),
    referenceId: text("reference_id"),
    postedBy: text("posted_by"),
    reversedEntryId: integer("reversed_entry_id"),
    status: text("status").notNull().default("posted"),
    postedAt: timestamp("posted_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    glje_debitAccountId_idx: index("glje_debitAccountId_idx").on(
      t.debitAccountId
    ),
    glje_creditAccountId_idx: index("glje_creditAccountId_idx").on(
      t.creditAccountId
    ),
    glje_status_idx: index("glje_status_idx").on(t.status),
  })
);

export const sla_definitions = pgTable(
  "sla_definitions",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    serviceType: text("service_type").notNull(),
    metricType: text("metric_type").notNull(),
    targetValue: integer("target_value").notNull(),
    warningThreshold: integer("warning_threshold"),
    criticalThreshold: integer("critical_threshold"),
    measurementWindow: text("measurement_window").notNull().default("1h"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  t => ({
    slad_serviceType_idx: index("slad_serviceType_idx").on(t.serviceType),
    slad_isActive_idx: index("slad_isActive_idx").on(t.isActive),
  })
);

export const sla_breaches = pgTable(
  "sla_breaches",
  {
    id: serial("id").primaryKey(),
    slaDefinitionId: integer("sla_definition_id").notNull(),
    breachType: text("breach_type").notNull(),
    actualValue: integer("actual_value").notNull(),
    targetValue: integer("target_value").notNull(),
    duration: integer("duration"),
    impactLevel: text("impact_level").notNull().default("medium"),
    resolvedAt: timestamp("resolved_at"),
    resolution: text("resolution"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    slab_slaDefinitionId_idx: index("slab_slaDefinitionId_idx").on(
      t.slaDefinitionId
    ),
    slab_createdAt_idx: index("slab_createdAt_idx").on(t.createdAt),
  })
);

export const data_export_jobs = pgTable(
  "data_export_jobs",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    exportType: text("export_type").notNull(),
    format: text("format").notNull().default("csv"),
    filters: text("filters"),
    status: text("status").notNull().default("pending"),
    fileUrl: text("file_url"),
    fileSize: integer("file_size"),
    recordCount: integer("record_count"),
    requestedBy: text("requested_by").notNull(),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  t => ({
    dej_status_idx: index("dej_status_idx").on(t.status),
    dej_requestedBy_idx: index("dej_requestedBy_idx").on(t.requestedBy),
    dej_createdAt_idx: index("dej_createdAt_idx").on(t.createdAt),
  })
);

export const platform_health_checks = pgTable(
  "platform_health_checks",
  {
    id: serial("id").primaryKey(),
    serviceName: text("service_name").notNull(),
    checkType: text("check_type").notNull(),
    status: text("status").notNull().default("healthy"),
    responseTime: integer("response_time"),
    statusCode: integer("status_code"),
    message: text("message"),
    metadata: text("metadata"),
    checkedAt: timestamp("checked_at").defaultNow(),
  },
  t => ({
    phc_serviceName_idx: index("phc_serviceName_idx").on(t.serviceName),
    phc_status_idx: index("phc_status_idx").on(t.status),
    phc_checkedAt_idx: index("phc_checkedAt_idx").on(t.checkedAt),
  })
);

export const platform_incidents = pgTable(
  "platform_incidents",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    severity: text("severity").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    affectedServices: text("affected_services"),
    rootCause: text("root_cause"),
    resolution: text("resolution"),
    reportedBy: text("reported_by"),
    assignedTo: text("assigned_to"),
    startedAt: timestamp("started_at").defaultNow(),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  t => ({
    pi_severity_idx: index("pi_severity_idx").on(t.severity),
    pi_status_idx: index("pi_status_idx").on(t.status),
    pi_createdAt_idx: index("pi_createdAt_idx").on(t.createdAt),
  })
);

// ── Sprint 53: Commission Engine DB Persistence ─────────────────────────────
export const commissionTiers = pgTable(
  "commission_tiers",
  {
    id: serial("id").primaryKey(),
    tierId: varchar("tier_id", { length: 16 }).notNull().unique(),
    name: varchar("name", { length: 128 }).notNull(),
    transactionType: varchar("transaction_type", { length: 32 }).notNull(),
    minVolume: numeric("min_volume", { precision: 15, scale: 2 })
      .default("0")
      .notNull(),
    maxVolume: numeric("max_volume", { precision: 15, scale: 2 })
      .default("999999999")
      .notNull(),
    rate: numeric("rate", { precision: 8, scale: 4 }).notNull(),
    flatFee: numeric("flat_fee", { precision: 10, scale: 2 })
      .default("0")
      .notNull(),
    bonusRate: numeric("bonus_rate", { precision: 8, scale: 4 })
      .default("0")
      .notNull(),
    agentRole: varchar("agent_role", { length: 32 }).default("agent").notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    effectiveFrom: timestamp("effective_from").defaultNow().notNull(),
    effectiveTo: timestamp("effective_to"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  t => ({
    txTypeIdx: index("ct_transaction_type_idx").on(t.transactionType),
    activeIdx: index("ct_is_active_idx").on(t.isActive),
  })
);
export type CommissionTier = typeof commissionTiers.$inferSelect;
export type InsertCommissionTier = typeof commissionTiers.$inferInsert;

export const commissionSplits = pgTable(
  "commission_splits",
  {
    id: serial("id").primaryKey(),
    splitId: varchar("split_id", { length: 16 }).notNull().unique(),
    transactionType: varchar("transaction_type", { length: 32 }).notNull(),
    superAgentShare: numeric("super_agent_share", {
      precision: 5,
      scale: 2,
    }).notNull(),
    masterAgentShare: numeric("master_agent_share", {
      precision: 5,
      scale: 2,
    }).notNull(),
    agentShare: numeric("agent_share", { precision: 5, scale: 2 }).notNull(),
    subAgentShare: numeric("sub_agent_share", {
      precision: 5,
      scale: 2,
    }).notNull(),
    platformShare: numeric("platform_share", {
      precision: 5,
      scale: 2,
    }).notNull(),
    isActive: boolean("is_active").default(true).notNull(),
    effectiveFrom: timestamp("effective_from").defaultNow().notNull(),
    effectiveTo: timestamp("effective_to"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  t => ({
    txTypeIdx: index("cs_transaction_type_idx").on(t.transactionType),
    activeIdx: index("cs_is_active_idx").on(t.isActive),
  })
);
export type CommissionSplit = typeof commissionSplits.$inferSelect;
export type InsertCommissionSplit = typeof commissionSplits.$inferInsert;

// ── Sprint 53: Dispute Evidence Attachments ─────────────────────────────────
export const disputeEvidence = pgTable(
  "dispute_evidence",
  {
    id: serial("id").primaryKey(),
    disputeId: integer("dispute_id").notNull(),
    fileName: varchar("file_name", { length: 256 }).notNull(),
    fileUrl: text("file_url").notNull(),
    fileKey: varchar("file_key", { length: 256 }).notNull(),
    mimeType: varchar("mime_type", { length: 64 }),
    fileSize: integer("file_size"),
    uploadedBy: varchar("uploaded_by", { length: 64 }).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => ({
    de_disputeId_idx: index("de_disputeId_idx").on(t.disputeId),
    de_createdAt_idx: index("de_createdAt_idx").on(t.createdAt),
  })
);
export type DisputeEvidence = typeof disputeEvidence.$inferSelect;

// ── Sprint 53: Commission Audit Trail ───────────────────────────────────────
export const commissionAuditTrail = pgTable(
  "commission_audit_trail",
  {
    id: serial("id").primaryKey(),
    entityType: varchar("entity_type", { length: 32 }).notNull(), // tier, split, payout, clawback
    entityId: varchar("entity_id", { length: 32 }).notNull(),
    action: varchar("action", { length: 32 }).notNull(), // created, updated, deleted, approved, rejected
    previousValue: json("previous_value"),
    newValue: json("new_value"),
    performedBy: varchar("performed_by", { length: 64 }).notNull(),
    reason: text("reason"),
    ipAddress: varchar("ip_address", { length: 45 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => ({
    entityIdx: index("cat_entity_idx").on(t.entityType, t.entityId),
    actionIdx: index("cat_action_idx").on(t.action),
    createdAtIdx: index("cat_created_at_idx").on(t.createdAt),
  })
);
export type CommissionAuditTrail = typeof commissionAuditTrail.$inferSelect;

// ─── Load Test Runs (S59-2) ─────────────────────────────────────────────────
export const loadTestRunStatusEnum = pgEnum("load_test_run_status", [
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export const loadTestRuns = pgTable(
  "load_test_runs",
  {
    id: serial("id").primaryKey(),
    runId: varchar("run_id", { length: 64 }).notNull().unique(),
    status: loadTestRunStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at").defaultNow().notNull(),
    completedAt: timestamp("completed_at"),
    triggeredBy: varchar("triggered_by", { length: 128 }),
    // Config
    targetRps: integer("target_rps").notNull().default(100),
    durationSeconds: integer("duration_seconds").notNull().default(60),
    concurrency: integer("concurrency").notNull().default(10),
    zipfSkew: numeric("zipf_skew", { precision: 4, scale: 2 }).default("1.07"),
    merchantCount: integer("merchant_count").default(1000),
    // Results (stored as JSON for flexibility)
    results: json("results").$type<{
      totalRequests: number;
      successCount: number;
      errorCount: number;
      actualRps: number;
      avgLatencyMs: number;
      p50LatencyMs: number;
      p95LatencyMs: number;
      p99LatencyMs: number;
      maxLatencyMs: number;
      zipfDistribution: Array<{
        merchantId: number;
        requestCount: number;
        percentage: number;
      }>;
      latencyHistogram: Array<{ bucket: string; count: number }>;
      timeline: Array<{
        second: number;
        rps: number;
        avgLatencyMs: number;
        errorRate: number;
      }>;
    }>(),
    errorMessage: text("error_message"),
  },
  t => ({
    statusIdx: index("ltr_status_idx").on(t.status),
    startedAtIdx: index("ltr_started_at_idx").on(t.startedAt),
  })
);
export type LoadTestRun = typeof loadTestRuns.$inferSelect;
export type NewLoadTestRun = typeof loadTestRuns.$inferInsert;

// Sprint 79 - Real-Time Billing Engine Tables
export const billingModelTypeEnum = pgEnum("billing_model_type", [
  "revenue_share",
  "subscription",
  "hybrid",
]);

export const platformBillingLedger = pgTable(
  "platform_billing_ledger",
  {
    id: serial("id").primaryKey(),
    transactionId: integer("transaction_id").notNull(),
    transactionRef: varchar("transaction_ref", { length: 64 }).notNull(),
    transactionType: varchar("transaction_type", { length: 32 }).notNull(),
    agentId: integer("agent_id").notNull(),
    policyTransactionId: integer("policy_transaction_id"),
    grossAmount: numeric("gross_amount", { precision: 15, scale: 2 }).notNull(),
    grossFee: numeric("gross_fee", { precision: 12, scale: 2 }).notNull(),
    agentCommission: numeric("agent_commission", {
      precision: 12,
      scale: 2,
    }).notNull(),
    switchFee: numeric("switch_fee", { precision: 12, scale: 2 }).notNull(),
    aggregatorFee: numeric("aggregator_fee", {
      precision: 12,
      scale: 2,
    }).notNull(),
    platformNetFee: numeric("platform_net_fee", {
      precision: 12,
      scale: 2,
    }).notNull(),
    billingModel: billingModelTypeEnum("billing_model")
      .notNull()
      .default("revenue_share"),
    clientRevenue: numeric("client_revenue", {
      precision: 12,
      scale: 2,
    }).notNull(),
    platformRevenue: numeric("platform_revenue", {
      precision: 12,
      scale: 2,
    }).notNull(),
    revenueSharePct: numeric("revenue_share_pct", { precision: 5, scale: 2 }),
    currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
    region: varchar("region", { length: 32 }),
    carrier: varchar("carrier", { length: 32 }),
    tigerBeetleTransferId: varchar("tigerbeetle_transfer_id", { length: 64 }),
    kafkaOffset: varchar("kafka_offset", { length: 64 }),
    processedAt: timestamp("processed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => ({
    txRefIdx: index("pbl_tx_ref_idx").on(t.transactionRef),
    agentIdx: index("pbl_agent_idx").on(t.agentId),
    processedAtIdx: index("pbl_processed_at_idx").on(t.processedAt),
    billingModelIdx: index("pbl_billing_model_idx").on(t.billingModel),
    regionIdx: index("pbl_region_idx").on(t.region),
  })
);
export type PlatformBillingLedgerEntry =
  typeof platformBillingLedger.$inferSelect;
export type NewPlatformBillingLedgerEntry =
  typeof platformBillingLedger.$inferInsert;

export const billingRevenuePeriods = pgTable(
  "billing_revenue_periods",
  {
    id: serial("id").primaryKey(),
    periodType: varchar("period_type", { length: 10 }).notNull(),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    transactionCount: integer("transaction_count").notNull().default(0),
    grossVolume: numeric("gross_volume", { precision: 18, scale: 2 })
      .notNull()
      .default("0.00"),
    totalFees: numeric("total_fees", { precision: 15, scale: 2 })
      .notNull()
      .default("0.00"),
    totalClientRevenue: numeric("total_client_revenue", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    totalPlatformRevenue: numeric("total_platform_revenue", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    totalAgentCommissions: numeric("total_agent_commissions", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    totalSwitchFees: numeric("total_switch_fees", { precision: 15, scale: 2 })
      .notNull()
      .default("0.00"),
    totalAggregatorFees: numeric("total_aggregator_fees", {
      precision: 15,
      scale: 2,
    })
      .notNull()
      .default("0.00"),
    breakdownByType: json("breakdown_by_type"),
    breakdownByRegion: json("breakdown_by_region"),
    activeAgents: integer("active_agents").notNull().default(0),
    activeFieldAgents: integer("active_field_agents").notNull().default(0),
    avgTxPerAgent: numeric("avg_tx_per_agent", {
      precision: 8,
      scale: 2,
    }).default("0.00"),
    periodOpexEstimate: numeric("period_opex_estimate", {
      precision: 15,
      scale: 2,
    }).default("0.00"),
    netPlatformProfit: numeric("net_platform_profit", {
      precision: 15,
      scale: 2,
    }).default("0.00"),
    billingModel: billingModelTypeEnum("billing_model")
      .notNull()
      .default("revenue_share"),
    currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
    dataSourceHash: varchar("data_source_hash", { length: 64 }),
  },
  t => ({
    periodTypeIdx: index("brp_period_type_idx").on(t.periodType),
    periodStartIdx: index("brp_period_start_idx").on(t.periodStart),
    compositeIdx: index("brp_composite_idx").on(
      t.periodType,
      t.periodStart,
      t.billingModel
    ),
  })
);
export type BillingRevenuePeriod = typeof billingRevenuePeriods.$inferSelect;
export type NewBillingRevenuePeriod = typeof billingRevenuePeriods.$inferInsert;

export const billingReconciliationReports = pgTable(
  "billing_reconciliation_reports",
  {
    id: serial("id").primaryKey(),
    reportPeriod: varchar("report_period", { length: 20 }).notNull(),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    billingModel: billingModelTypeEnum("billing_model").notNull(),
    status: reconciliationStatusEnum("status").notNull().default("pending"),
    projectedTransactions: integer("projected_transactions"),
    projectedGrossVolume: numeric("projected_gross_volume", {
      precision: 18,
      scale: 2,
    }),
    projectedPlatformRevenue: numeric("projected_platform_revenue", {
      precision: 15,
      scale: 2,
    }),
    projectedClientRevenue: numeric("projected_client_revenue", {
      precision: 15,
      scale: 2,
    }),
    projectedAgents: integer("projected_agents"),
    projectedTxPerAgent: numeric("projected_tx_per_agent", {
      precision: 8,
      scale: 2,
    }),
    actualTransactions: integer("actual_transactions"),
    actualGrossVolume: numeric("actual_gross_volume", {
      precision: 18,
      scale: 2,
    }),
    actualPlatformRevenue: numeric("actual_platform_revenue", {
      precision: 15,
      scale: 2,
    }),
    actualClientRevenue: numeric("actual_client_revenue", {
      precision: 15,
      scale: 2,
    }),
    actualAgents: integer("actual_agents"),
    actualTxPerAgent: numeric("actual_tx_per_agent", {
      precision: 8,
      scale: 2,
    }),
    revenueVariancePct: numeric("revenue_variance_pct", {
      precision: 8,
      scale: 2,
    }),
    volumeVariancePct: numeric("volume_variance_pct", {
      precision: 8,
      scale: 2,
    }),
    agentVariancePct: numeric("agent_variance_pct", { precision: 8, scale: 2 }),
    insights: json("insights"),
    generatedBy: varchar("generated_by", { length: 64 }).default(
      "billing-reconciliation-engine"
    ),
    approvedBy: varchar("approved_by", { length: 64 }),
    approvedAt: timestamp("approved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => ({
    periodIdx: index("brr_period_idx").on(t.reportPeriod),
    statusIdx: index("brr_status_idx").on(t.status),
    billingModelIdx: index("brr_billing_model_idx").on(t.billingModel),
  })
);
export type BillingReconciliationReport =
  typeof billingReconciliationReports.$inferSelect;
export type NewBillingReconciliationReport =
  typeof billingReconciliationReports.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// Sprint 80: Billing RBAC, Audit Trail, Tenant Billing Onboarding
// ═══════════════════════════════════════════════════════════════════════════════

export const billingRoleEnum = pgEnum("billing_role", [
  "platform_admin",
  "billing_admin",
  "billing_analyst",
  "billing_viewer",
]);

export const billingPermissionEnum = pgEnum("billing_permission", [
  "view_ledger",
  "record_split",
  "run_reconciliation",
  "manage_billing_config",
  "view_dashboard",
  "export_data",
  "resolve_discrepancy",
  "manage_tenant_billing",
]);

export const billingAuditActionEnum = pgEnum("billing_audit_action", [
  "config_created",
  "config_updated",
  "config_deleted",
  "split_recorded",
  "reconciliation_run",
  "discrepancy_resolved",
  "tenant_billing_provisioned",
  "billing_model_changed",
  "permission_granted",
  "permission_revoked",
  "export_generated",
  "invoice_generated",
  "payment_recorded",
  "subscription_created",
  "subscription_updated",
  "subscription_cancelled",
  "credit_applied",
  "refund_processed",
  "late_fee_applied",
  "usage_recorded",
  "proration_applied",
]);

export const billingRoleAssignments = pgTable(
  "billing_role_assignments",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    tenantId: integer("tenant_id").notNull(),
    billingRole: billingRoleEnum("billing_role").notNull(),
    permissions: json("permissions").$type<string[]>(),
    grantedBy: integer("granted_by").notNull(),
    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
    isActive: boolean("is_active").notNull().default(true),
  },
  t => ({
    userTenantIdx: index("bra_user_tenant_idx").on(t.userId, t.tenantId),
    tenantIdx: index("bra_tenant_idx").on(t.tenantId),
    roleIdx: index("bra_role_idx").on(t.billingRole),
  })
);
export type BillingRoleAssignment = typeof billingRoleAssignments.$inferSelect;
export type NewBillingRoleAssignment =
  typeof billingRoleAssignments.$inferInsert;

export const billingAuditLog = pgTable(
  "billing_audit_log",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull(),
    userId: integer("user_id").notNull(),
    userName: varchar("user_name", { length: 128 }),
    action: billingAuditActionEnum("action").notNull(),
    resourceType: varchar("resource_type", { length: 64 }).notNull(),
    resourceId: varchar("resource_id", { length: 128 }),
    beforeState: json("before_state"),
    afterState: json("after_state"),
    metadata: json("metadata"),
    ipAddress: varchar("ip_address", { length: 45 }),
    userAgent: varchar("user_agent", { length: 512 }),
    sessionId: varchar("session_id", { length: 128 }),
    kafkaOffset: varchar("kafka_offset", { length: 64 }),
    notificationSent: boolean("notification_sent").default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  t => ({
    tenantIdx: index("bal_tenant_idx").on(t.tenantId),
    userIdx: index("bal_user_idx").on(t.userId),
    actionIdx: index("bal_action_idx").on(t.action),
    resourceIdx: index("bal_resource_idx").on(t.resourceType, t.resourceId),
    createdAtIdx: index("bal_created_at_idx").on(t.createdAt),
  })
);
export type BillingAuditLogEntry = typeof billingAuditLog.$inferSelect;
export type NewBillingAuditLogEntry = typeof billingAuditLog.$inferInsert;

export const tenantBillingConfig = pgTable(
  "tenant_billing_config",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull().unique(),
    billingModel: billingModelTypeEnum("billing_model")
      .notNull()
      .default("revenue_share"),
    revenueShareConfig: json("revenue_share_config"),
    subscriptionConfig: json("subscription_config"),
    hybridConfig: json("hybrid_config"),
    currency: varchar("currency", { length: 3 }).notNull().default("NGN"),
    effectiveDate: timestamp("effective_date").notNull().defaultNow(),
    contractEndDate: timestamp("contract_end_date"),
    autoRenew: boolean("auto_renew").notNull().default(true),
    provisionedAt: timestamp("provisioned_at").notNull().defaultNow(),
    provisionedBy: integer("provisioned_by"),
    tigerBeetleAccountId: varchar("tigerbeetle_account_id", { length: 64 }),
    kafkaTopicPrefix: varchar("kafka_topic_prefix", { length: 64 }),
    status: varchar("status", { length: 20 }).notNull().default("active"),
    lastModifiedAt: timestamp("last_modified_at").notNull().defaultNow(),
    lastModifiedBy: integer("last_modified_by"),
  },
  t => ({
    tenantIdx: uniqueIndex("tbc_tenant_idx").on(t.tenantId),
    billingModelIdx: index("tbc_billing_model_idx").on(t.billingModel),
    statusIdx: index("tbc_status_idx").on(t.status),
  })
);
export type TenantBillingConfig = typeof tenantBillingConfig.$inferSelect;
export type NewTenantBillingConfig = typeof tenantBillingConfig.$inferInsert;

export const billingProvisioningHistory = pgTable(
  "billing_provisioning_history",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").notNull(),
    step: varchar("step", { length: 64 }).notNull(),
    status: varchar("status", { length: 20 }).notNull().default("pending"),
    details: json("details"),
    temporalWorkflowId: varchar("temporal_workflow_id", { length: 128 }),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
    error: text("error"),
  },
  t => ({
    tenantIdx: index("bph_tenant_idx").on(t.tenantId),
    stepIdx: index("bph_step_idx").on(t.step),
    statusIdx: index("bph_status_idx").on(t.status),
  })
);
export type BillingProvisioningHistoryEntry =
  typeof billingProvisioningHistory.$inferSelect;
export type NewBillingProvisioningHistoryEntry =
  typeof billingProvisioningHistory.$inferInsert;

// ─── Face Enrollment (ArcFace 512-d Embeddings) ──────────────────────────────
export const faceEnrollments = pgTable(
  "face_enrollments",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    enrollmentType: varchar("enrollmentType", { length: 32 })
      .notNull()
      .default("kyc"), // kyc | login | payment
    embeddingVector: text("embeddingVector").notNull(), // JSON-serialized 512-d float array
    embeddingVersion: varchar("embeddingVersion", { length: 32 })
      .notNull()
      .default("arcface_w600k_r50"),
    qualityScore: numeric("qualityScore", { precision: 5, scale: 4 }),
    livenessScore: numeric("livenessScore", { precision: 5, scale: 4 }),
    antiSpoofScore: numeric("antiSpoofScore", { precision: 5, scale: 4 }),
    sourceImageHash: varchar("sourceImageHash", { length: 128 }),
    deviceFingerprint: varchar("deviceFingerprint", { length: 256 }),
    ipAddress: varchar("ipAddress", { length: 64 }),
    isActive: boolean("isActive").notNull().default(true),
    revokedAt: timestamp("revokedAt"),
    revokedReason: text("revokedReason"),
    expiresAt: timestamp("expiresAt"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    userIdIdx: index("fe_userId_idx").on(t.userId),
    tenantIdIdx: index("fe_tenantId_idx").on(t.tenantId),
    activeIdx: index("fe_active_idx").on(t.userId, t.isActive),
  })
);
export type FaceEnrollment = typeof faceEnrollments.$inferSelect;
export type NewFaceEnrollment = typeof faceEnrollments.$inferInsert;

// ─── Biometric Audit Events ──────────────────────────────────────────────────
export const biometricAuditEvents = pgTable(
  "biometric_audit_events",
  {
    id: serial("id").primaryKey(),
    sessionId: varchar("sessionId", { length: 128 }).notNull(),
    userId: integer("userId"),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    outcome: varchar("outcome", { length: 32 }).notNull(),
    confidenceScore: numeric("confidenceScore", { precision: 5, scale: 4 }),
    spoofType: varchar("spoofType", { length: 64 }),
    spoofScore: numeric("spoofScore", { precision: 5, scale: 4 }),
    livenessMethod: varchar("livenessMethod", { length: 32 }),
    matchScore: numeric("matchScore", { precision: 5, scale: 4 }),
    processingTimeMs: integer("processingTimeMs"),
    deviceInfo: json("deviceInfo").$type<{
      userAgent?: string;
      platform?: string;
      screen?: string;
    }>(),
    ipAddress: varchar("ipAddress", { length: 64 }),
    geoLocation: json("geoLocation").$type<{
      lat?: number;
      lng?: number;
      country?: string;
    }>(),
    errorDetails: text("errorDetails"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    sessionIdIdx: index("bae_sessionId_idx").on(t.sessionId),
    userIdIdx: index("bae_userId_idx").on(t.userId),
    eventTypeIdx: index("bae_eventType_idx").on(t.eventType),
    outcomeIdx: index("bae_outcome_idx").on(t.outcome),
    tenantIdIdx: index("bae_tenantId_idx").on(t.tenantId),
    createdAtIdx: index("bae_createdAt_idx").on(t.createdAt),
  })
);
export type BiometricAuditEvent = typeof biometricAuditEvents.$inferSelect;
export type NewBiometricAuditEvent = typeof biometricAuditEvents.$inferInsert;

// ─── Receipt Templates ────────────────────────────────────────────────────────
export const receiptTemplates = pgTable("receipt_templates", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  channel: varchar("channel", { length: 32 }).notNull().default("print"),
  bodyTemplate: text("bodyTemplate").notNull(),
  headerTemplate: text("headerTemplate"),
  footerTemplate: text("footerTemplate"),
  isDefault: boolean("isDefault").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ReceiptTemplate = typeof receiptTemplates.$inferSelect;

// ─── Guide Feedback ───────────────────────────────────────────────────────────
export const guideFeedback = pgTable(
  "guide_feedback",
  {
    id: serial("id").primaryKey(),
    guideId: varchar("guideId", { length: 128 }).notNull(),
    subsection: varchar("subsection", { length: 128 }),
    userId: integer("userId"),
    rating: integer("rating").notNull(),
    comment: text("comment"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    guideIdIdx: index("gf_guideId_idx").on(t.guideId),
    userIdIdx: index("gf_userId_idx").on(t.userId),
  })
);
export type GuideFeedback = typeof guideFeedback.$inferSelect;


// ═══════════════════════════════════════════════════════════════════════════════
// INSURANCE DOMAIN SCHEMAS — Added in comprehensive schema audit
// Covers: Policies, Claims, Underwriting, Reinsurance, Actuarial, Brokers,
//         Beneficiaries, Endorsements, Renewals, Coverage, Risk, Reserves,
//         Stakeholder roles (broker, underwriter, claims adjuster, actuary,
//         compliance officer, regulator, customer/policyholder, reinsurer)
// ═══════════════════════════════════════════════════════════════════════════════

// import { pgTable, serial, varchar, text, integer, boolean, timestamp, numeric, json, index, pgEnum, uniqueIndex } from "drizzle-orm/pg-core";

// ─── Stakeholder Role Enums ──────────────────────────────────────────────────
export const insuranceStakeholderRoleEnum = pgEnum("insurance_stakeholder_role", [
  "policyholder",
  "beneficiary",
  "broker",
  "underwriter",
  "claims_adjuster",
  "actuary",
  "compliance_officer",
  "regulator",
  "reinsurer",
  "agent",
  "supervisor",
  "admin",
  "super_admin",
]);

export const policyStatusEnum = pgEnum("policy_status", [
  "draft",
  "quoted",
  "bound",
  "active",
  "endorsed",
  "renewed",
  "cancelled",
  "lapsed",
  "expired",
  "suspended",
]);

export const claimStatusEnum = pgEnum("claim_status", [
  "submitted",
  "under_review",
  "investigation",
  "approved",
  "partially_approved",
  "rejected",
  "paid",
  "closed",
  "appealed",
  "escalated",
]);

export const underwritingDecisionEnum = pgEnum("underwriting_decision", [
  "pending",
  "approved",
  "approved_with_conditions",
  "referred",
  "declined",
  "counter_offered",
]);

export const endorsementTypeEnum = pgEnum("endorsement_type", [
  "addition",
  "deletion",
  "modification",
  "extension",
  "reduction",
  "cancellation",
  "reinstatement",
]);

export const reinsuranceTypeEnum = pgEnum("reinsurance_type", [
  "proportional",
  "non_proportional",
  "quota_share",
  "surplus",
  "excess_of_loss",
  "stop_loss",
  "catastrophe",
]);

export const coverageTypeEnum = pgEnum("coverage_type", [
  "life",
  "health",
  "motor",
  "property",
  "liability",
  "marine",
  "aviation",
  "agriculture",
  "credit",
  "travel",
  "micro",
  "group_life",
  "annuity",
  "pension",
]);

// ─── Insurance Products ───────────────────────────────────────────────────────
export const insuranceProducts = pgTable(
  "insurance_products",
  {
    id: serial("id").primaryKey(),
    productCode: varchar("productCode", { length: 32 }).notNull().unique(),
    name: varchar("name", { length: 256 }).notNull(),
    description: text("description"),
    coverageType: coverageTypeEnum("coverageType").notNull(),
    minPremium: numeric("minPremium", { precision: 18, scale: 2 }),
    maxCoverageAmount: numeric("maxCoverageAmount", { precision: 18, scale: 2 }),
    minAge: integer("minAge"),
    maxAge: integer("maxAge"),
    waitingPeriodDays: integer("waitingPeriodDays").default(0),
    policyTermMonths: integer("policyTermMonths").default(12),
    isActive: boolean("isActive").default(true).notNull(),
    regulatoryApprovalRef: varchar("regulatoryApprovalRef", { length: 128 }),
    naicomProductCode: varchar("naicomProductCode", { length: 64 }),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    productCodeIdx: index("ip_productCode_idx").on(t.productCode),
    coverageTypeIdx: index("ip_coverageType_idx").on(t.coverageType),
    tenantIdx: index("ip_tenant_idx").on(t.tenantId),
  })
);
export type InsuranceProduct = typeof insuranceProducts.$inferSelect;
export type InsertInsuranceProduct = typeof insuranceProducts.$inferInsert;

// ─── Policies ─────────────────────────────────────────────────────────────────
export const policies = pgTable(
  "policies",
  {
    id: serial("id").primaryKey(),
    policyNumber: varchar("policyNumber", { length: 64 }).notNull().unique(),
    productId: integer("productId").notNull(),
    customerId: integer("customerId").notNull(),
    agentId: integer("agentId"),
    brokerId: integer("brokerId"),
    underwriterId: integer("underwriterId"),
    status: policyStatusEnum("status").default("draft").notNull(),
    coverageType: coverageTypeEnum("coverageType").notNull(),
    sumInsured: numeric("sumInsured", { precision: 18, scale: 2 }).notNull(),
    annualPremium: numeric("annualPremium", { precision: 18, scale: 2 }).notNull(),
    startDate: timestamp("startDate"),
    endDate: timestamp("endDate"),
    renewalDate: timestamp("renewalDate"),
    cancellationDate: timestamp("cancellationDate"),
    cancellationReason: text("cancellationReason"),
    policyDocument: text("policyDocument"),
    certificateNumber: varchar("certificateNumber", { length: 64 }),
    naicomRef: varchar("naicomRef", { length: 128 }),
    termsAndConditions: json("termsAndConditions"),
    metadata: json("metadata"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    policyNumberIdx: uniqueIndex("pol_policyNumber_idx").on(t.policyNumber),
    customerIdx: index("pol_customer_idx").on(t.customerId),
    agentIdx: index("pol_agent_idx").on(t.agentId),
    statusIdx: index("pol_status_idx").on(t.status),
    renewalIdx: index("pol_renewal_idx").on(t.renewalDate),
    tenantIdx: index("pol_tenant_idx").on(t.tenantId),
  })
);
export type Policy = typeof policies.$inferSelect;
export type InsertPolicy = typeof policies.$inferInsert;

// ─── Beneficiaries ────────────────────────────────────────────────────────────
export const beneficiaries = pgTable(
  "beneficiaries",
  {
    id: serial("id").primaryKey(),
    policyId: integer("policyId").notNull(),
    name: varchar("name", { length: 256 }).notNull(),
    relationship: varchar("relationship", { length: 64 }).notNull(),
    percentage: numeric("percentage", { precision: 5, scale: 2 }).notNull().default("100"),
    dateOfBirth: timestamp("dateOfBirth"),
    nationalId: varchar("nationalId", { length: 64 }),
    phone: varchar("phone", { length: 32 }),
    email: varchar("email", { length: 320 }),
    address: text("address"),
    isMinor: boolean("isMinor").default(false),
    guardianName: varchar("guardianName", { length: 256 }),
    guardianId: varchar("guardianId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    policyIdx: index("ben_policy_idx").on(t.policyId),
  })
);
export type Beneficiary = typeof beneficiaries.$inferSelect;
export type InsertBeneficiary = typeof beneficiaries.$inferInsert;

// ─── Claims ───────────────────────────────────────────────────────────────────
export const claims = pgTable(
  "claims",
  {
    id: serial("id").primaryKey(),
    claimNumber: varchar("claimNumber", { length: 64 }).notNull().unique(),
    policyId: integer("policyId").notNull(),
    claimantId: integer("claimantId").notNull(),
    assignedAdjusterId: integer("assignedAdjusterId"),
    status: claimStatusEnum("status").default("submitted").notNull(),
    claimType: varchar("claimType", { length: 64 }).notNull(),
    incidentDate: timestamp("incidentDate").notNull(),
    reportedDate: timestamp("reportedDate").defaultNow().notNull(),
    claimedAmount: numeric("claimedAmount", { precision: 18, scale: 2 }).notNull(),
    approvedAmount: numeric("approvedAmount", { precision: 18, scale: 2 }),
    paidAmount: numeric("paidAmount", { precision: 18, scale: 2 }),
    deductible: numeric("deductible", { precision: 18, scale: 2 }),
    incidentDescription: text("incidentDescription").notNull(),
    investigationNotes: text("investigationNotes"),
    rejectionReason: text("rejectionReason"),
    settlementDate: timestamp("settlementDate"),
    isFraudSuspected: boolean("isFraudSuspected").default(false),
    fraudScore: numeric("fraudScore", { precision: 5, scale: 4 }),
    documents: json("documents").$type<string[]>(),
    metadata: json("metadata"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    claimNumberIdx: uniqueIndex("cl_claimNumber_idx").on(t.claimNumber),
    policyIdx: index("cl_policy_idx").on(t.policyId),
    statusIdx: index("cl_status_idx").on(t.status),
    adjusterIdx: index("cl_adjuster_idx").on(t.assignedAdjusterId),
    tenantIdx: index("cl_tenant_idx").on(t.tenantId),
  })
);
export type Claim = typeof claims.$inferSelect;
export type InsertClaim = typeof claims.$inferInsert;

// ─── Claim Documents ──────────────────────────────────────────────────────────
export const claimDocuments = pgTable(
  "claim_documents",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claimId").notNull(),
    documentType: varchar("documentType", { length: 64 }).notNull(),
    fileName: varchar("fileName", { length: 256 }).notNull(),
    fileUrl: text("fileUrl").notNull(),
    fileSize: integer("fileSize"),
    mimeType: varchar("mimeType", { length: 128 }),
    uploadedBy: integer("uploadedBy"),
    isVerified: boolean("isVerified").default(false),
    verifiedBy: integer("verifiedBy"),
    verifiedAt: timestamp("verifiedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    claimIdx: index("cd_claim_idx").on(t.claimId),
  })
);
export type ClaimDocument = typeof claimDocuments.$inferSelect;

// ─── Underwriting Assessments ─────────────────────────────────────────────────
export const underwritingAssessments = pgTable(
  "underwriting_assessments",
  {
    id: serial("id").primaryKey(),
    policyId: integer("policyId").notNull(),
    underwriterId: integer("underwriterId"),
    decision: underwritingDecisionEnum("decision").default("pending").notNull(),
    riskScore: numeric("riskScore", { precision: 5, scale: 2 }),
    riskCategory: varchar("riskCategory", { length: 32 }),
    premiumLoading: numeric("premiumLoading", { precision: 5, scale: 4 }),
    exclusions: json("exclusions").$type<string[]>(),
    conditions: json("conditions").$type<string[]>(),
    notes: text("notes"),
    decisionDate: timestamp("decisionDate"),
    expiryDate: timestamp("expiryDate"),
    referralReason: text("referralReason"),
    counterOfferDetails: json("counterOfferDetails"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    policyIdx: index("ua_policy_idx").on(t.policyId),
    underwriterIdx: index("ua_underwriter_idx").on(t.underwriterId),
    decisionIdx: index("ua_decision_idx").on(t.decision),
  })
);
export type UnderwritingAssessment = typeof underwritingAssessments.$inferSelect;

// ─── Endorsements ─────────────────────────────────────────────────────────────
export const endorsements = pgTable(
  "endorsements",
  {
    id: serial("id").primaryKey(),
    endorsementNumber: varchar("endorsementNumber", { length: 64 }).notNull().unique(),
    policyId: integer("policyId").notNull(),
    type: endorsementTypeEnum("type").notNull(),
    effectiveDate: timestamp("effectiveDate").notNull(),
    description: text("description").notNull(),
    premiumAdjustment: numeric("premiumAdjustment", { precision: 18, scale: 2 }).default("0"),
    sumInsuredAdjustment: numeric("sumInsuredAdjustment", { precision: 18, scale: 2 }).default("0"),
    changesDetail: json("changesDetail"),
    approvedBy: integer("approvedBy"),
    approvedAt: timestamp("approvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    endorsementNumberIdx: uniqueIndex("end_number_idx").on(t.endorsementNumber),
    policyIdx: index("end_policy_idx").on(t.policyId),
  })
);
export type Endorsement = typeof endorsements.$inferSelect;

// ─── Policy Renewals ──────────────────────────────────────────────────────────
export const policyRenewals = pgTable(
  "policy_renewals",
  {
    id: serial("id").primaryKey(),
    originalPolicyId: integer("originalPolicyId").notNull(),
    renewedPolicyId: integer("renewedPolicyId"),
    renewalNoticeDate: timestamp("renewalNoticeDate"),
    renewalDueDate: timestamp("renewalDueDate").notNull(),
    renewalPremium: numeric("renewalPremium", { precision: 18, scale: 2 }),
    isAutoRenewal: boolean("isAutoRenewal").default(false),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    notificationSent: boolean("notificationSent").default(false),
    notificationSentAt: timestamp("notificationSentAt"),
    completedAt: timestamp("completedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    originalPolicyIdx: index("pr_original_idx").on(t.originalPolicyId),
    dueDateIdx: index("pr_dueDate_idx").on(t.renewalDueDate),
  })
);
export type PolicyRenewal = typeof policyRenewals.$inferSelect;

// ─── Coverage Items ───────────────────────────────────────────────────────────
export const coverageItems = pgTable(
  "coverage_items",
  {
    id: serial("id").primaryKey(),
    policyId: integer("policyId").notNull(),
    coverageType: coverageTypeEnum("coverageType").notNull(),
    coverageName: varchar("coverageName", { length: 256 }).notNull(),
    sumInsured: numeric("sumInsured", { precision: 18, scale: 2 }).notNull(),
    deductible: numeric("deductible", { precision: 18, scale: 2 }).default("0"),
    premium: numeric("premium", { precision: 18, scale: 2 }).notNull(),
    isExcluded: boolean("isExcluded").default(false),
    exclusionReason: text("exclusionReason"),
    startDate: timestamp("startDate"),
    endDate: timestamp("endDate"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    policyIdx: index("ci_policy_idx").on(t.policyId),
    coverageTypeIdx: index("ci_coverageType_idx").on(t.coverageType),
  })
);
export type CoverageItem = typeof coverageItems.$inferSelect;

// ─── Risk Assessments ─────────────────────────────────────────────────────────
export const riskAssessments = pgTable(
  "risk_assessments",
  {
    id: serial("id").primaryKey(),
    policyId: integer("policyId"),
    customerId: integer("customerId"),
    assessmentType: varchar("assessmentType", { length: 64 }).notNull(),
    overallRiskScore: numeric("overallRiskScore", { precision: 5, scale: 2 }),
    riskCategory: varchar("riskCategory", { length: 32 }),
    factors: json("factors"),
    recommendations: json("recommendations").$type<string[]>(),
    assessedBy: integer("assessedBy"),
    assessedAt: timestamp("assessedAt").defaultNow().notNull(),
    validUntil: timestamp("validUntil"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    policyIdx: index("ra_policy_idx").on(t.policyId),
    customerIdx: index("ra_customer_idx").on(t.customerId),
  })
);
export type RiskAssessment = typeof riskAssessments.$inferSelect;

// ─── Actuarial Reserves ───────────────────────────────────────────────────────
export const actuarialReserves = pgTable(
  "actuarial_reserves",
  {
    id: serial("id").primaryKey(),
    reserveType: varchar("reserveType", { length: 64 }).notNull(),
    productId: integer("productId"),
    coverageType: coverageTypeEnum("coverageType"),
    calculationDate: timestamp("calculationDate").notNull(),
    grossReserve: numeric("grossReserve", { precision: 18, scale: 2 }).notNull(),
    netReserve: numeric("netReserve", { precision: 18, scale: 2 }).notNull(),
    ibrnReserve: numeric("ibrnReserve", { precision: 18, scale: 2 }),
    unearnedPremiumReserve: numeric("unearnedPremiumReserve", { precision: 18, scale: 2 }),
    claimsReserve: numeric("claimsReserve", { precision: 18, scale: 2 }),
    methodology: varchar("methodology", { length: 128 }),
    assumptions: json("assumptions"),
    calculatedBy: integer("calculatedBy"),
    approvedBy: integer("approvedBy"),
    approvedAt: timestamp("approvedAt"),
    reportingPeriod: varchar("reportingPeriod", { length: 16 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    calcDateIdx: index("ar_calcDate_idx").on(t.calculationDate),
    reserveTypeIdx: index("ar_reserveType_idx").on(t.reserveType),
  })
);
export type ActuarialReserve = typeof actuarialReserves.$inferSelect;

// ─── Reinsurance Treaties ─────────────────────────────────────────────────────
export const reinsuranceTreaties = pgTable(
  "reinsurance_treaties",
  {
    id: serial("id").primaryKey(),
    treatyNumber: varchar("treatyNumber", { length: 64 }).notNull().unique(),
    reinsurerId: integer("reinsurerId"),
    reinsurerName: varchar("reinsurerName", { length: 256 }).notNull(),
    type: reinsuranceTypeEnum("type").notNull(),
    coverageType: coverageTypeEnum("coverageType"),
    retentionLimit: numeric("retentionLimit", { precision: 18, scale: 2 }),
    cessionLimit: numeric("cessionLimit", { precision: 18, scale: 2 }),
    cessionPercentage: numeric("cessionPercentage", { precision: 5, scale: 4 }),
    premiumRate: numeric("premiumRate", { precision: 5, scale: 4 }),
    startDate: timestamp("startDate").notNull(),
    endDate: timestamp("endDate"),
    isActive: boolean("isActive").default(true),
    terms: json("terms"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    treatyNumberIdx: uniqueIndex("rt_treatyNumber_idx").on(t.treatyNumber),
    reinsurerIdx: index("rt_reinsurer_idx").on(t.reinsurerId),
    typeIdx: index("rt_type_idx").on(t.type),
  })
);
export type ReinsuranceTreaty = typeof reinsuranceTreaties.$inferSelect;

// ─── Reinsurance Cessions ─────────────────────────────────────────────────────
export const reinsuranceCessions = pgTable(
  "reinsurance_cessions",
  {
    id: serial("id").primaryKey(),
    treatyId: integer("treatyId").notNull(),
    policyId: integer("policyId").notNull(),
    cededPremium: numeric("cededPremium", { precision: 18, scale: 2 }).notNull(),
    cededSumInsured: numeric("cededSumInsured", { precision: 18, scale: 2 }).notNull(),
    retainedPremium: numeric("retainedPremium", { precision: 18, scale: 2 }).notNull(),
    retainedSumInsured: numeric("retainedSumInsured", { precision: 18, scale: 2 }).notNull(),
    cessionDate: timestamp("cessionDate").defaultNow().notNull(),
    settlementDate: timestamp("settlementDate"),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    treatyIdx: index("rc_treaty_idx").on(t.treatyId),
    policyIdx: index("rc_policy_idx").on(t.policyId),
  })
);
export type ReinsuranceCession = typeof reinsuranceCessions.$inferSelect;

// ─── Broker Profiles ──────────────────────────────────────────────────────────
export const brokers = pgTable(
  "brokers",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId"),
    brokerCode: varchar("brokerCode", { length: 32 }).notNull().unique(),
    companyName: varchar("companyName", { length: 256 }).notNull(),
    licenseNumber: varchar("licenseNumber", { length: 128 }).notNull(),
    licenseExpiry: timestamp("licenseExpiry"),
    naicomRegNumber: varchar("naicomRegNumber", { length: 64 }),
    commissionRate: numeric("commissionRate", { precision: 5, scale: 4 }),
    contactEmail: varchar("contactEmail", { length: 320 }),
    contactPhone: varchar("contactPhone", { length: 32 }),
    address: text("address"),
    isActive: boolean("isActive").default(true),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    brokerCodeIdx: uniqueIndex("br_brokerCode_idx").on(t.brokerCode),
    licenseIdx: index("br_license_idx").on(t.licenseNumber),
    tenantIdx: index("br_tenant_idx").on(t.tenantId),
  })
);
export type Broker = typeof brokers.$inferSelect;
export type InsertBroker = typeof brokers.$inferInsert;

// ─── Premium Payments ─────────────────────────────────────────────────────────
export const premiumPayments = pgTable(
  "premium_payments",
  {
    id: serial("id").primaryKey(),
    policyId: integer("policyId").notNull(),
    paymentReference: varchar("paymentReference", { length: 128 }).notNull().unique(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
    paymentDate: timestamp("paymentDate").defaultNow().notNull(),
    dueDate: timestamp("dueDate"),
    paymentMethod: varchar("paymentMethod", { length: 64 }),
    channel: varchar("channel", { length: 64 }),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    gatewayRef: varchar("gatewayRef", { length: 256 }),
    receiptNumber: varchar("receiptNumber", { length: 64 }),
    periodStart: timestamp("periodStart"),
    periodEnd: timestamp("periodEnd"),
    isInstallment: boolean("isInstallment").default(false),
    installmentNumber: integer("installmentNumber"),
    totalInstallments: integer("totalInstallments"),
    tigerBeetleRef: varchar("tigerBeetleRef", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    policyIdx: index("pp_policy_idx").on(t.policyId),
    paymentRefIdx: uniqueIndex("pp_paymentRef_idx").on(t.paymentReference),
    statusIdx: index("pp_status_idx").on(t.status),
    dueDateIdx: index("pp_dueDate_idx").on(t.dueDate),
  })
);
export type PremiumPayment = typeof premiumPayments.$inferSelect;
export type InsertPremiumPayment = typeof premiumPayments.$inferInsert;

// ─── NAICOM Compliance Reports ────────────────────────────────────────────────
export const naicomReports = pgTable(
  "naicom_reports",
  {
    id: serial("id").primaryKey(),
    reportType: varchar("reportType", { length: 64 }).notNull(),
    reportingPeriod: varchar("reportingPeriod", { length: 16 }).notNull(),
    submissionDate: timestamp("submissionDate"),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    reportData: json("reportData"),
    submittedBy: integer("submittedBy"),
    naicomAcknowledgement: varchar("naicomAcknowledgement", { length: 256 }),
    dueDate: timestamp("dueDate"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    reportTypeIdx: index("nr_reportType_idx").on(t.reportType),
    periodIdx: index("nr_period_idx").on(t.reportingPeriod),
    statusIdx: index("nr_status_idx").on(t.status),
  })
);
export type NaicomReport = typeof naicomReports.$inferSelect;

// ─── Actuarial Tables (Mortality, Morbidity) ──────────────────────────────────
export const actuarialTables = pgTable(
  "actuarial_tables",
  {
    id: serial("id").primaryKey(),
    tableCode: varchar("tableCode", { length: 32 }).notNull().unique(),
    tableName: varchar("tableName", { length: 256 }).notNull(),
    tableType: varchar("tableType", { length: 64 }).notNull(),
    gender: varchar("gender", { length: 16 }),
    smokerStatus: varchar("smokerStatus", { length: 16 }),
    validFrom: timestamp("validFrom").notNull(),
    validTo: timestamp("validTo"),
    data: json("data").notNull(),
    source: varchar("source", { length: 256 }),
    approvedBy: integer("approvedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    tableCodeIdx: uniqueIndex("at_tableCode_idx").on(t.tableCode),
  })
);
export type ActuarialTable = typeof actuarialTables.$inferSelect;

// ─── Policy Workflow Events (Temporal integration) ────────────────────────────
export const policyWorkflowEvents = pgTable(
  "policy_workflow_events",
  {
    id: serial("id").primaryKey(),
    policyId: integer("policyId").notNull(),
    workflowId: varchar("workflowId", { length: 256 }),
    temporalRunId: varchar("temporalRunId", { length: 256 }),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    fromStatus: policyStatusEnum("fromStatus"),
    toStatus: policyStatusEnum("toStatus"),
    triggeredBy: integer("triggeredBy"),
    triggeredByRole: insuranceStakeholderRoleEnum("triggeredByRole"),
    payload: json("payload"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    policyIdx: index("pwe_policy_idx").on(t.policyId),
    workflowIdx: index("pwe_workflow_idx").on(t.workflowId),
    eventTypeIdx: index("pwe_eventType_idx").on(t.eventType),
  })
);
export type PolicyWorkflowEvent = typeof policyWorkflowEvents.$inferSelect;

// ─── Claim Workflow Events ────────────────────────────────────────────────────
export const claimWorkflowEvents = pgTable(
  "claim_workflow_events",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claimId").notNull(),
    workflowId: varchar("workflowId", { length: 256 }),
    temporalRunId: varchar("temporalRunId", { length: 256 }),
    eventType: varchar("eventType", { length: 64 }).notNull(),
    fromStatus: claimStatusEnum("fromStatus"),
    toStatus: claimStatusEnum("toStatus"),
    triggeredBy: integer("triggeredBy"),
    triggeredByRole: insuranceStakeholderRoleEnum("triggeredByRole"),
    payload: json("payload"),
    notes: text("notes"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    claimIdx: index("cwe_claim_idx").on(t.claimId),
    workflowIdx: index("cwe_workflow_idx").on(t.workflowId),
  })
);
export type ClaimWorkflowEvent = typeof claimWorkflowEvents.$inferSelect;

// ─── Stakeholder Profiles ─────────────────────────────────────────────────────
export const stakeholderProfiles = pgTable(
  "stakeholder_profiles",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull().unique(),
    role: insuranceStakeholderRoleEnum("role").notNull(),
    licenseNumber: varchar("licenseNumber", { length: 128 }),
    licenseExpiry: timestamp("licenseExpiry"),
    specializations: json("specializations").$type<string[]>(),
    maxClaimAuthority: numeric("maxClaimAuthority", { precision: 18, scale: 2 }),
    isActive: boolean("isActive").default(true),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    userIdx: uniqueIndex("sp_user_idx").on(t.userId),
    roleIdx: index("sp_role_idx").on(t.role),
    tenantIdx: index("sp_tenant_idx").on(t.tenantId),
  })
);
export type StakeholderProfile = typeof stakeholderProfiles.$inferSelect;

// ─── IFRS 17 Measurement Groups ───────────────────────────────────────────────
export const ifrs17MeasurementGroups = pgTable(
  "ifrs17_measurement_groups",
  {
    id: serial("id").primaryKey(),
    groupCode: varchar("groupCode", { length: 64 }).notNull().unique(),
    productId: integer("productId"),
    coverageType: coverageTypeEnum("coverageType"),
    measurementModel: varchar("measurementModel", { length: 64 }).notNull(),
    reportingPeriod: varchar("reportingPeriod", { length: 16 }).notNull(),
    csm: numeric("csm", { precision: 18, scale: 2 }),
    ra: numeric("ra", { precision: 18, scale: 2 }),
    lrc: numeric("lrc", { precision: 18, scale: 2 }),
    lrc_remaining: numeric("lrc_remaining", { precision: 18, scale: 2 }),
    calculatedAt: timestamp("calculatedAt").defaultNow().notNull(),
    calculatedBy: integer("calculatedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    groupCodeIdx: uniqueIndex("img_groupCode_idx").on(t.groupCode),
    periodIdx: index("img_period_idx").on(t.reportingPeriod),
  })
);
export type Ifrs17MeasurementGroup = typeof ifrs17MeasurementGroups.$inferSelect;

// ─── Dapr Workflow State ──────────────────────────────────────────────────────
export const daprWorkflowState = pgTable(
  "dapr_workflow_state",
  {
    id: serial("id").primaryKey(),
    workflowName: varchar("workflowName", { length: 128 }).notNull(),
    instanceId: varchar("instanceId", { length: 256 }).notNull().unique(),
    status: varchar("status", { length: 32 }).notNull(),
    input: json("input"),
    output: json("output"),
    errorMessage: text("errorMessage"),
    startedAt: timestamp("startedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
    lastUpdatedAt: timestamp("lastUpdatedAt").defaultNow().notNull(),
  },
  t => ({
    instanceIdIdx: uniqueIndex("dws_instanceId_idx").on(t.instanceId),
    workflowNameIdx: index("dws_workflowName_idx").on(t.workflowName),
    statusIdx: index("dws_status_idx").on(t.status),
  })
);
export type DaprWorkflowState = typeof daprWorkflowState.$inferSelect;

// ─── Fluvio Event Log ─────────────────────────────────────────────────────────
export const fluvioEventLog = pgTable(
  "fluvio_event_log",
  {
    id: serial("id").primaryKey(),
    topic: varchar("topic", { length: 128 }).notNull(),
    partition: integer("partition"),
    offset: integer("offset"),
    key: varchar("key", { length: 256 }),
    payload: json("payload"),
    processedAt: timestamp("processedAt").defaultNow().notNull(),
    status: varchar("status", { length: 32 }).default("processed").notNull(),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    topicIdx: index("fel_topic_idx").on(t.topic),
    statusIdx: index("fel_status_idx").on(t.status),
  })
);
export type FluvioEventLog = typeof fluvioEventLog.$inferSelect;

// ─── TigerBeetle Sync Log ─────────────────────────────────────────────────────
export const tigerBeetleSyncLog = pgTable(
  "tigerbeetle_sync_log",
  {
    id: serial("id").primaryKey(),
    transferId: varchar("transferId", { length: 128 }).notNull(),
    debitAccountId: varchar("debitAccountId", { length: 128 }).notNull(),
    creditAccountId: varchar("creditAccountId", { length: 128 }).notNull(),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    ledger: integer("ledger"),
    code: integer("code"),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    syncedAt: timestamp("syncedAt"),
    errorMessage: text("errorMessage"),
    retryCount: integer("retryCount").default(0),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    transferIdIdx: index("tbsl_transferId_idx").on(t.transferId),
    statusIdx: index("tbsl_status_idx").on(t.status),
  })
);
export type TigerBeetleSyncLog = typeof tigerBeetleSyncLog.$inferSelect;

// ─── Permify Relationship Cache ───────────────────────────────────────────────
export const permifyRelationshipCache = pgTable(
  "permify_relationship_cache",
  {
    id: serial("id").primaryKey(),
    subjectType: varchar("subjectType", { length: 64 }).notNull(),
    subjectId: varchar("subjectId", { length: 128 }).notNull(),
    entityType: varchar("entityType", { length: 64 }).notNull(),
    entityId: varchar("entityId", { length: 128 }).notNull(),
    permission: varchar("permission", { length: 64 }).notNull(),
    allowed: boolean("allowed").notNull(),
    cachedAt: timestamp("cachedAt").defaultNow().notNull(),
    expiresAt: timestamp("expiresAt"),
  },
  t => ({
    lookupIdx: index("prc_lookup_idx").on(t.subjectType, t.subjectId, t.entityType, t.entityId, t.permission),
  })
);
export type PermifyRelationshipCache = typeof permifyRelationshipCache.$inferSelect;

// ─── Additional tables (definitions in schema.additions.ts) ──────────────────
export {
  posTerminals,
  underwritingApplications,
  insuranceServices,
  policyQuotes,
  kycVerifications,
  notifications,
  insuranceProductTypes,
  insurance_portalAds,
} from "./schema.additions";
