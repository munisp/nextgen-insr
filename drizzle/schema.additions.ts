/**
 * schema.additions.ts — Missing table definitions for InsurePortal
 *
 * These tables were referenced in routers but missing from schema.ts.
 * Imported by routers that need them.
 */
import {
  bigint,
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  numeric,
  jsonb,
  json,
  index,
  uniqueIndex,
  pgEnum,
} from "drizzle-orm/pg-core";

// ─── E-Commerce: Insurance Categories ────────────────────────────────────────
export const insuranceCategories = pgTable(
  "insurance_categories",
  {
    id: serial("id").primaryKey(),
    name: varchar("name", { length: 128 }).notNull(),
    slug: varchar("slug", { length: 128 }).notNull(),
    description: text("description"),
    parentId: integer("parentId"),
    iconUrl: text("iconUrl"),
    isActive: boolean("isActive").default(true).notNull(),
    sortOrder: integer("sortOrder").default(0),
    tenantId: varchar("tenantId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    slugIdx: uniqueIndex("ins_cat_slug_idx").on(t.slug),
    tenantIdx: index("ins_cat_tenant_idx").on(t.tenantId),
    activeIdx: index("ins_cat_active_idx").on(t.isActive),
  })
);
export type InsuranceCategory = typeof insuranceCategories.$inferSelect;
export type InsertInsuranceCategory = typeof insuranceCategories.$inferInsert;

// ─── E-Commerce: Insurance Inventory ─────────────────────────────────────────
export const insuranceInventory = pgTable(
  "insurance_inventory",
  {
    id: serial("id").primaryKey(),
    productId: integer("productId").notNull(),
    sku: varchar("sku", { length: 64 }).notNull(),
    quantityAvailable: integer("quantityAvailable").default(0).notNull(),
    quantityReserved: integer("quantityReserved").default(0).notNull(),
    reorderPoint: integer("reorderPoint").default(10),
    maxStock: integer("maxStock").default(1000),
    tenantId: varchar("tenantId", { length: 64 }),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    skuIdx: uniqueIndex("ins_inv_sku_idx").on(t.sku),
    productIdx: index("ins_inv_product_idx").on(t.productId),
    tenantIdx: index("ins_inv_tenant_idx").on(t.tenantId),
  })
);
export type InsuranceInventory = typeof insuranceInventory.$inferSelect;
export type InsertInsuranceInventory = typeof insuranceInventory.$inferInsert;

// ─── E-Commerce: Insurance Carts ─────────────────────────────────────────────
export const insuranceCarts = pgTable(
  "insurance_carts",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customerId"),
    agentId: integer("agentId"),
    sessionId: varchar("sessionId", { length: 128 }),
    status: varchar("status", { length: 32 }).default("active").notNull(),
    totalAmount: numeric("totalAmount", { precision: 15, scale: 2 }).default("0"),
    currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
    tenantId: varchar("tenantId", { length: 64 }),
    expiresAt: timestamp("expiresAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    customerIdx: index("ins_cart_customer_idx").on(t.customerId),
    agentIdx: index("ins_cart_agent_idx").on(t.agentId),
    sessionIdx: index("ins_cart_session_idx").on(t.sessionId),
    statusIdx: index("ins_cart_status_idx").on(t.status),
    tenantIdx: index("ins_cart_tenant_idx").on(t.tenantId),
  })
);
export type InsuranceCart = typeof insuranceCarts.$inferSelect;
export type InsertInsuranceCart = typeof insuranceCarts.$inferInsert;

// ─── E-Commerce: Insurance Cart Items ────────────────────────────────────────
export const insuranceCartItems = pgTable(
  "insurance_cart_items",
  {
    id: serial("id").primaryKey(),
    cartId: integer("cartId").notNull(),
    productId: integer("productId").notNull(),
    quantity: integer("quantity").default(1).notNull(),
    unitPrice: numeric("unitPrice", { precision: 15, scale: 2 }).notNull(),
    totalPrice: numeric("totalPrice", { precision: 15, scale: 2 }).notNull(),
    coveragePeriodMonths: integer("coveragePeriodMonths").default(12),
    beneficiaryData: jsonb("beneficiaryData"),
    addedAt: timestamp("addedAt").defaultNow().notNull(),
  },
  t => ({
    cartIdx: index("ins_cart_item_cart_idx").on(t.cartId),
    productIdx: index("ins_cart_item_product_idx").on(t.productId),
  })
);
export type InsuranceCartItem = typeof insuranceCartItems.$inferSelect;
export type InsertInsuranceCartItem = typeof insuranceCartItems.$inferInsert;

// ─── E-Commerce: Policy Orders ────────────────────────────────────────────────
export const policyOrders = pgTable(
  "policy_orders",
  {
    id: serial("id").primaryKey(),
    orderRef: varchar("orderRef", { length: 64 }).notNull(),
    customerId: integer("customerId"),
    agentId: integer("agentId"),
    cartId: integer("cartId"),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    totalAmount: numeric("totalAmount", { precision: 15, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
    paymentMethod: varchar("paymentMethod", { length: 64 }),
    paymentRef: varchar("paymentRef", { length: 128 }),
    paymentStatus: varchar("paymentStatus", { length: 32 }).default("pending"),
    tbTransferId: varchar("tbTransferId", { length: 128 }),
    notes: text("notes"),
    tenantId: varchar("tenantId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    orderRefIdx: uniqueIndex("pol_order_ref_idx").on(t.orderRef),
    customerIdx: index("pol_order_customer_idx").on(t.customerId),
    agentIdx: index("pol_order_agent_idx").on(t.agentId),
    statusIdx: index("pol_order_status_idx").on(t.status),
    createdAtIdx: index("pol_order_created_idx").on(t.createdAt),
    tenantIdx: index("pol_order_tenant_idx").on(t.tenantId),
  })
);
export type PolicyOrder = typeof policyOrders.$inferSelect;
export type InsertPolicyOrder = typeof policyOrders.$inferInsert;

// ─── E-Commerce: Insurance Order Items ───────────────────────────────────────
export const insuranceOrderItems = pgTable(
  "insurance_order_items",
  {
    id: serial("id").primaryKey(),
    orderId: integer("orderId").notNull(),
    productId: integer("productId").notNull(),
    policyId: integer("policyId"),
    quantity: integer("quantity").default(1).notNull(),
    unitPrice: numeric("unitPrice", { precision: 15, scale: 2 }).notNull(),
    totalPrice: numeric("totalPrice", { precision: 15, scale: 2 }).notNull(),
    coveragePeriodMonths: integer("coveragePeriodMonths").default(12),
    startDate: timestamp("startDate"),
    endDate: timestamp("endDate"),
    beneficiaryData: jsonb("beneficiaryData"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    orderIdx: index("ins_order_item_order_idx").on(t.orderId),
    productIdx: index("ins_order_item_product_idx").on(t.productId),
    policyIdx: index("ins_order_item_policy_idx").on(t.policyId),
  })
);
export type InsuranceOrderItem = typeof insuranceOrderItems.$inferSelect;
export type InsertInsuranceOrderItem = typeof insuranceOrderItems.$inferInsert;

// ─── POS Terminals ────────────────────────────────────────────────────────────
export const posTerminals = pgTable(
  "pos_terminals",
  {
    id: serial("id").primaryKey(),
    terminalId: varchar("terminalId", { length: 64 }).notNull(),
    agentId: integer("agentId"),
    serialNumber: varchar("serialNumber", { length: 128 }).notNull(),
    model: varchar("model", { length: 128 }),
    manufacturer: varchar("manufacturer", { length: 128 }),
    firmwareVersion: varchar("firmwareVersion", { length: 64 }),
    status: varchar("status", { length: 32 }).default("active").notNull(),
    lastHeartbeat: timestamp("lastHeartbeat"),
    ipAddress: varchar("ipAddress", { length: 64 }),
    location: jsonb("location"),
    groupId: integer("groupId"),
    tenantId: varchar("tenantId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    terminalIdIdx: uniqueIndex("pos_terminal_id_idx").on(t.terminalId),
    agentIdx: index("pos_agent_idx").on(t.agentId),
    statusIdx: index("pos_status_idx").on(t.status),
    tenantIdx: index("pos_tenant_idx").on(t.tenantId),
    heartbeatIdx: index("pos_heartbeat_idx").on(t.lastHeartbeat),
  })
);
export type PosTerminal = typeof posTerminals.$inferSelect;
// ─── Payment Token Vault ─────────────────────────────────────────────────────
// Tokenized payment instruments (cards, accounts) used by paymentTokenVault router.
export const paymentTokens = pgTable(
  "payment_tokens",
  {
    id: serial("id").primaryKey(),
    token: varchar("token", { length: 128 }).notNull().unique(),
    identifier: varchar("identifier", { length: 64 }), // masked PAN last-four / 2FA reference
    type: varchar("type", { length: 32 }).notNull(),
    used: boolean("used").default(false).notNull(),
    usedAt: timestamp("usedAt"),
    expiresAt: timestamp("expiresAt"),
    metadata: json("metadata"),
    tenantId: integer("tenantId"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    tokenIdx: uniqueIndex("payment_token_idx").on(t.token),
    tenantIdx: index("payment_token_tenant_idx").on(t.tenantId),
  })
);
export type PaymentToken = typeof paymentTokens.$inferSelect;
export type InsertPaymentToken = typeof paymentTokens.$inferInsert;

export type InsertPosTerminal = typeof posTerminals.$inferInsert;

// ─── Claims Payments ──────────────────────────────────────────────────────────
export const claimsPayments = pgTable(
  "claims_payments",
  {
    id: serial("id").primaryKey(),
    claimId: integer("claimId").notNull(),
    paymentRef: varchar("paymentRef", { length: 128 }).notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
    paymentMethod: varchar("paymentMethod", { length: 64 }).notNull(),
    beneficiaryName: varchar("beneficiaryName", { length: 256 }),
    beneficiaryAccount: varchar("beneficiaryAccount", { length: 64 }),
    beneficiaryBank: varchar("beneficiaryBank", { length: 128 }),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    tbTransferId: varchar("tbTransferId", { length: 128 }),
    processedAt: timestamp("processedAt"),
    failureReason: text("failureReason"),
    approvedBy: integer("approvedBy"),
    tenantId: varchar("tenantId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    paymentRefIdx: uniqueIndex("claims_pay_ref_idx").on(t.paymentRef),
    // F11-3 (DD-TSSTATE): one settlement payment per claim — migration 0053.
    claimIdx: uniqueIndex("claims_pay_claimId_unique").on(t.claimId),
    statusIdx: index("claims_pay_status_idx").on(t.status),
    tenantIdx: index("claims_pay_tenant_idx").on(t.tenantId),
    createdAtIdx: index("claims_pay_created_idx").on(t.createdAt),
  })
);
export type ClaimsPayment = typeof claimsPayments.$inferSelect;
export type InsertClaimsPayment = typeof claimsPayments.$inferInsert;

// ─── Commissions (agent commission ledger) ────────────────────────────────────
export const commissions = pgTable(
  "commissions",
  {
    id: serial("id").primaryKey(),
    agentId: integer("agentId").notNull(),
    transactionId: integer("transactionId"),
    policyId: integer("policyId"),
    commissionType: varchar("commissionType", { length: 64 }).notNull(),
    grossAmount: numeric("grossAmount", { precision: 15, scale: 2 }).notNull(),
    taxAmount: numeric("taxAmount", { precision: 15, scale: 2 }).default("0"),
    netAmount: numeric("netAmount", { precision: 15, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    payoutId: integer("payoutId"),
    tbTransferId: varchar("tbTransferId", { length: 128 }),
    periodStart: timestamp("periodStart"),
    periodEnd: timestamp("periodEnd"),
    tenantId: varchar("tenantId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    agentCreatedIdx: index("comm_agent_created_idx").on(t.agentId, t.createdAt),
    statusIdx: index("comm_status_idx").on(t.status),
    transactionIdx: index("comm_tx_idx").on(t.transactionId),
    tenantIdx: index("comm_tenant_idx").on(t.tenantId),
    payoutIdx: index("comm_payout_idx").on(t.payoutId),
  })
);
export type Commission = typeof commissions.$inferSelect;
export type InsertCommission = typeof commissions.$inferInsert;

// ─── Premiums (premium payment ledger) ───────────────────────────────────────
export const premiums = pgTable(
  "premiums",
  {
    id: serial("id").primaryKey(),
    policyId: integer("policyId").notNull(),
    customerId: integer("customerId"),
    agentId: integer("agentId"),
    premiumRef: varchar("premiumRef", { length: 128 }).notNull(),
    amount: numeric("amount", { precision: 15, scale: 2 }).notNull(),
    currency: varchar("currency", { length: 8 }).default("NGN").notNull(),
    dueDate: timestamp("dueDate").notNull(),
    paidDate: timestamp("paidDate"),
    status: varchar("status", { length: 32 }).default("due").notNull(),
    paymentMethod: varchar("paymentMethod", { length: 64 }),
    paymentRef: varchar("paymentRef", { length: 128 }),
    tbTransferId: varchar("tbTransferId", { length: 128 }),
    gracePeriodDays: integer("gracePeriodDays").default(30),
    tenantId: varchar("tenantId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    premiumRefIdx: uniqueIndex("premium_ref_idx").on(t.premiumRef),
    policyIdx: index("premium_policy_idx").on(t.policyId),
    statusDueIdx: index("premium_status_due_idx").on(t.status, t.dueDate),
    agentIdx: index("premium_agent_idx").on(t.agentId),
    tenantIdx: index("premium_tenant_idx").on(t.tenantId),
  })
);
export type Premium = typeof premiums.$inferSelect;
export type InsertPremium = typeof premiums.$inferInsert;

// ─── Service Nodes (microservice registry) ───────────────────────────────────
export const serviceNodes = pgTable(
  "service_nodes",
  {
    id: serial("id").primaryKey(),
    serviceName: varchar("serviceName", { length: 128 }).notNull(),
    serviceId: varchar("serviceId", { length: 128 }).notNull(),
    host: varchar("host", { length: 256 }).notNull(),
    port: integer("port").notNull(),
    protocol: varchar("protocol", { length: 16 }).default("http").notNull(),
    status: varchar("status", { length: 32 }).default("healthy").notNull(),
    version: varchar("version", { length: 32 }),
    region: varchar("region", { length: 64 }),
    tags: jsonb("tags"),
    healthCheckUrl: text("healthCheckUrl"),
    lastHealthCheck: timestamp("lastHealthCheck"),
    consecutiveFailures: integer("consecutiveFailures").default(0),
    metadata: jsonb("metadata"),
    registeredAt: timestamp("registeredAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    serviceIdIdx: uniqueIndex("svc_node_id_idx").on(t.serviceId),
    nameStatusIdx: index("svc_node_name_status_idx").on(t.serviceName, t.status),
    regionIdx: index("svc_node_region_idx").on(t.region),
  })
);
export type ServiceNode = typeof serviceNodes.$inferSelect;
export type InsertServiceNode = typeof serviceNodes.$inferInsert;

// ─── Underwriting Applications ────────────────────────────────────────────────
export const underwritingApplications = pgTable(
  "underwriting_applications",
  {
    id: serial("id").primaryKey(),
    applicationRef: varchar("applicationRef", { length: 128 }).notNull(),
    customerId: integer("customerId"),
    agentId: integer("agentId"),
    productId: integer("productId").notNull(),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    riskScore: numeric("riskScore", { precision: 5, scale: 2 }),
    riskCategory: varchar("riskCategory", { length: 32 }),
    sumInsured: numeric("sumInsured", { precision: 15, scale: 2 }),
    proposedPremium: numeric("proposedPremium", { precision: 15, scale: 2 }),
    finalPremium: numeric("finalPremium", { precision: 15, scale: 2 }),
    loadingPct: numeric("loadingPct", { precision: 5, scale: 2 }).default("0"),
    exclusions: jsonb("exclusions"),
    conditions: jsonb("conditions"),
    underwriterNotes: text("underwriterNotes"),
    underwriterId: integer("underwriterId"),
    reviewedAt: timestamp("reviewedAt"),
    decisionAt: timestamp("decisionAt"),
    applicationData: jsonb("applicationData"),
    aiRiskAssessment: jsonb("aiRiskAssessment"),
    tenantId: varchar("tenantId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    appRefIdx: uniqueIndex("uw_app_ref_idx").on(t.applicationRef),
    customerIdx: index("uw_app_customer_idx").on(t.customerId),
    statusIdx: index("uw_app_status_idx").on(t.status),
    productIdx: index("uw_app_product_idx").on(t.productId),
    riskCatIdx: index("uw_app_risk_idx").on(t.riskCategory),
    tenantIdx: index("uw_app_tenant_idx").on(t.tenantId),
    createdAtIdx: index("uw_app_created_idx").on(t.createdAt),
  })
);
export type UnderwritingApplication = typeof underwritingApplications.$inferSelect;
export type InsertUnderwritingApplication = typeof underwritingApplications.$inferInsert;

// ─── Marketplace Ads ──────────────────────────────────────────────────────────
export const marketplaceAds = pgTable(
  "marketplace_ads",
  {
    id: serial("id").primaryKey(),
    adRef: varchar("adRef", { length: 64 }).notNull(),
    title: varchar("title", { length: 256 }).notNull(),
    description: text("description"),
    imageUrl: text("imageUrl"),
    targetUrl: text("targetUrl"),
    advertiserName: varchar("advertiserName", { length: 256 }),
    adType: varchar("adType", { length: 32 }).default("banner").notNull(),
    placement: varchar("placement", { length: 64 }),
    status: varchar("status", { length: 32 }).default("active").notNull(),
    startDate: timestamp("startDate"),
    endDate: timestamp("endDate"),
    impressions: integer("impressions").default(0),
    clicks: integer("clicks").default(0),
    budget: numeric("budget", { precision: 15, scale: 2 }),
    spent: numeric("spent", { precision: 15, scale: 2 }).default("0"),
    targetAudience: jsonb("targetAudience"),
    tenantId: varchar("tenantId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    adRefIdx: uniqueIndex("mkt_ad_ref_idx").on(t.adRef),
    statusIdx: index("mkt_ad_status_idx").on(t.status),
    placementIdx: index("mkt_ad_placement_idx").on(t.placement),
    tenantIdx: index("mkt_ad_tenant_idx").on(t.tenantId),
    dateRangeIdx: index("mkt_ad_date_idx").on(t.startDate, t.endDate),
  })
);
export type MarketplaceAd = typeof marketplaceAds.$inferSelect;
export type InsertMarketplaceAd = typeof marketplaceAds.$inferInsert;

// ─── Re-exports for alias compatibility ──────────────────────────────────────
// These allow routers to import `slaBreaches` and `loadTestRunsTable` from schema
export { sla_breaches as slaBreaches } from "./schema";
export { loadTestRuns as loadTestRunsTable } from "./schema";
// insuranceServices alias — terminalLeasing uses insuranceServices which maps to insuranceProducts
export { insuranceProducts as insuranceServices } from "./schema";

// ── SAR Dead-Letter Queue ─────────────────────────────────────────────────────
export const sarDeadLetterQueue = pgTable("sar_dead_letter_queue", {
  id: serial("id").primaryKey(),
  filingType: text("filing_type").notNull().default("SAR"),
  originalFilingId: integer("original_filing_id").notNull(),
  referenceNumber: text("reference_number").notNull(),
  status: text("status").notNull().default("dlq"), // dlq | requeued | resolved
  errorHistory: jsonb("error_history").notNull().default([]),
  lastError: text("last_error"),
  totalRetries: integer("total_retries").notNull().default(0),
  filingData: jsonb("filing_data"),
  routedAt: timestamp("routed_at").notNull().defaultNow(),
  requeuedAt: timestamp("requeued_at"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  resolutionNote: text("resolution_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Policy Quotes ───────────────────────────────────────────────────────────
export const policyQuotes = pgTable(
  "policy_quotes",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customerId"),
    agentId: integer("agentId"),
    productId: integer("productId"),
    productName: text("productName"),
    productType: varchar("productType", { length: 64 }),
    sumInsured: numeric("sumInsured", { precision: 18, scale: 2 }),
    premiumAmount: numeric("premiumAmount", { precision: 18, scale: 2 }),
    stampDuty: numeric("stampDuty", { precision: 18, scale: 2 }),
    totalPayable: numeric("totalPayable", { precision: 18, scale: 2 }),
    durationMonths: integer("durationMonths"),
    coverageType: varchar("coverageType", { length: 64 }),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    validUntil: timestamp("validUntil"),
    metadata: jsonb("metadata"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    customerIdx: index("policy_quotes_customerId_idx").on(t.customerId),
    statusIdx: index("policy_quotes_status_idx").on(t.status),
  })
);

export type PolicyQuote = typeof policyQuotes.$inferSelect;
export type InsertPolicyQuote = typeof policyQuotes.$inferInsert;

// ─── KYC Verifications ───────────────────────────────────────────────────────
export const kycVerifications = pgTable(
  "kyc_verifications",
  {
    id: serial("id").primaryKey(),
    customerId: integer("customerId").notNull(),
    verificationType: varchar("verificationType", { length: 64 }),
    documentNumber: varchar("documentNumber", { length: 128 }),
    nin: varchar("nin", { length: 32 }),
    bvn: varchar("bvn", { length: 32 }),
    selfieUrl: text("selfieUrl"),
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    verificationScore: numeric("verificationScore", { precision: 5, scale: 2 }),
    rejectionReason: text("rejectionReason"),
    verifiedAt: timestamp("verifiedAt"),
    reviewedBy: integer("reviewedBy"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  t => ({
    customerIdx: index("kyc_verifications_customerId_idx").on(t.customerId),
    statusIdx: index("kyc_verifications_status_idx").on(t.status),
  })
);

export type KycVerification = typeof kycVerifications.$inferSelect;
export type InsertKycVerification = typeof kycVerifications.$inferInsert;

// ─── Notifications ───────────────────────────────────────────────────────────
export const notifications = pgTable(
  "notifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId"),
    type: varchar("type", { length: 64 }),
    title: text("title"),
    message: text("message"),
    channel: varchar("channel", { length: 16 }), // sms | push | email | in_app
    status: varchar("status", { length: 32 }).default("pending").notNull(),
    metadata: jsonb("metadata"),
    sentAt: timestamp("sentAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  t => ({
    userIdx: index("notifications_userId_idx").on(t.userId),
    statusIdx: index("notifications_status_idx").on(t.status),
  })
);

export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = typeof notifications.$inferInsert;

// ─── Insurance Product Types ─────────────────────────────────────────────────
export const insuranceProductTypes = pgTable("insurance_product_types", {
  id: serial("id").primaryKey(),
  code: varchar("code", { length: 64 }),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("isActive").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type InsuranceProductType = typeof insuranceProductTypes.$inferSelect;
export type InsertInsuranceProductType = typeof insuranceProductTypes.$inferInsert;

// ─── InsurePortal Ads ────────────────────────────────────────────────────────
export const insurance_portalAds = pgTable("insurance_portal_ads", {
  id: serial("id").primaryKey(),
  title: text("title"),
  imageUrl: text("imageUrl"),
  targetUrl: text("targetUrl"),
  placement: varchar("placement", { length: 64 }),
  isActive: boolean("isActive").default(true).notNull(),
  startDate: timestamp("startDate"),
  endDate: timestamp("endDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type InsurancePortalAd = typeof insurance_portalAds.$inferSelect;
export type InsertInsurancePortalAd = typeof insurance_portalAds.$inferInsert;

// ─── Durable Event Dedupe (DD-TSMONEY, F4/F5) ────────────────────────────────
// Kafka consumer exactly-once marker: inserted in the SAME transaction as the
// event handler's effects; a redelivery conflicts and skips all side effects.
export const processedEvents = pgTable("processed_events", {
  eventId: varchar("event_id", { length: 255 }).primaryKey(),
  eventType: varchar("event_type", { length: 200 }).notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export type ProcessedEvent = typeof processedEvents.$inferSelect;
export type InsertProcessedEvent = typeof processedEvents.$inferInsert;

// Webhook exactly-once marker (Stripe): inserted BEFORE any webhook side
// effect; duplicate deliveries conflict and are acknowledged without
// re-running side effects. Deleted on processing failure so redelivery
// retries.
export const webhookEvents = pgTable("webhook_events", {
  eventId: varchar("event_id", { length: 255 }).primaryKey(),
  provider: varchar("provider", { length: 50 }).notNull(),
  eventType: varchar("event_type", { length: 200 }).notNull(),
  processedAt: timestamp("processed_at").defaultNow().notNull(),
});

export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type InsertWebhookEvent = typeof webhookEvents.$inferInsert;

// ─── Security Mitigation Tracker (B3, F-11 Class-2) ──────────────────────────
// Real store behind securityAudit.getMitigations / listMitigations /
// createMitigation / updateMitigationStatus / getMitigationStats. Status
// transitions are guarded in the router (invalid transition → fail loud);
// the valid set is: open → in_progress/resolved/accepted_risk,
// in_progress → open/resolved/accepted_risk, resolved → open (reopen),
// accepted_risk → open/in_progress.
export const mitigationStatusEnum = pgEnum("mitigation_status", [
  "open",
  "in_progress",
  "resolved",
  "accepted_risk",
]);

export const mitigationSeverityEnum = pgEnum("mitigation_severity", [
  "critical",
  "high",
  "medium",
  "low",
]);

export const securityMitigations = pgTable(
  "security_mitigations",
  {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 200 }).notNull(),
    description: text("description").notNull(),
    severity: mitigationSeverityEnum("severity").notNull(),
    status: mitigationStatusEnum("status").default("open").notNull(),
    ownerUserId: integer("ownerUserId"),
    linkedFindingRef: varchar("linkedFindingRef", { length: 128 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
    resolvedAt: timestamp("resolvedAt"),
  },
  t => ({
    statusIdx: index("security_mitigations_status_idx").on(t.status),
    severityIdx: index("security_mitigations_severity_idx").on(t.severity),
  })
);

export type SecurityMitigation = typeof securityMitigations.$inferSelect;
export type InsertSecurityMitigation = typeof securityMitigations.$inferInsert;
// ─── B7: Generated Weekly Reports ────────────────────────────────────────────
// Persisted weekly report documents. sectionsJson holds the computed section
// payload produced by server/lib/weeklyReport.ts from REAL rows
// (transactions / premiums / claims / policies / agents) — sections whose
// data source does not exist are recorded with a 'no_data_source' marker,
// never with invented numbers.
export const generatedReports = pgTable(
  "generated_reports",
  {
    id: serial("id").primaryKey(),
    weekStart: timestamp("week_start").notNull(),
    weekEnd: timestamp("week_end").notNull(),
    generatedAt: timestamp("generated_at").defaultNow().notNull(),
    // users.id of the admin who triggered generation; NULL = system run.
    generatedBy: integer("generated_by"),
    sectionsJson: json("sections_json").notNull(),
    // 'completed' | 'failed' — a report row is only inserted once section
    // computation has run against the real database.
    status: varchar("status", { length: 32 }).default("completed").notNull(),
  },
  t => ({
    weekStartIdx: index("gr_week_start_idx").on(t.weekStart),
    generatedAtIdx: index("gr_generated_at_idx").on(t.generatedAt),
  })
);
export type GeneratedReport = typeof generatedReports.$inferSelect;
export type InsertGeneratedReport = typeof generatedReports.$inferInsert;

// ─── B5: Backup Job Catalog ──────────────────────────────────────────────────
// Runtime catalog of backup runs. Rows are recorded by the real backup
// tooling (scripts/backup/pg_backup.sh records via psql against DATABASE_URL;
// server-side callers use server/lib/backupCatalog.ts). sizeBytes is NULL
// when the producing tool did not measure it — never defaulted.
export const backupJobs = pgTable(
  "backup_jobs",
  {
    id: serial("id").primaryKey(),
    startedAt: timestamp("started_at").notNull(),
    finishedAt: timestamp("finished_at"),
    // 'running' | 'success' | 'failed'
    status: varchar("status", { length: 32 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }),
    location: text("location"),
    // e.g. 'cron:pg_backup.sh' or a users.id label — who/what ran the backup.
    triggeredBy: varchar("triggered_by", { length: 128 }).notNull(),
    // 'verified' | 'unverified' | 'failed' — NULL while still running.
    verificationStatus: varchar("verification_status", { length: 32 }),
  },
  t => ({
    startedAtIdx: index("bj_started_at_idx").on(t.startedAt),
    statusIdx: index("bj_status_idx").on(t.status),
  })
);
export type BackupJob = typeof backupJobs.$inferSelect;
export type InsertBackupJob = typeof backupJobs.$inferInsert;

// ─── B11: Heuristic Scorer Results ───────────────────────────────────────────
// Persisted outputs of the in-repo statistical scorer
// (server/lib/claimRiskScorer.ts). modelType is 'heuristic-v1' — a
// transparent weighted formula over documented real features, NOT trained ML.
// featureBreakdownJson carries feature values + per-feature weighted
// contributions so every persisted score is auditable.
export const mlScoreResults = pgTable(
  "ml_score_results",
  {
    id: serial("id").primaryKey(),
    // 'claim' | 'transaction'
    subjectType: varchar("subject_type", { length: 32 }).notNull(),
    subjectId: integer("subject_id").notNull(),
    modelType: varchar("model_type", { length: 32 }).notNull(),
    score: numeric("score", { precision: 6, scale: 5 }).notNull(),
    // 'low' | 'medium' | 'high'
    riskBand: varchar("risk_band", { length: 16 }).notNull(),
    featureBreakdownJson: json("feature_breakdown_json").notNull(),
    scoredBy: varchar("scored_by", { length: 64 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => ({
    subjectIdx: index("msr_subject_idx").on(t.subjectType, t.subjectId),
    createdAtIdx: index("msr_created_at_idx").on(t.createdAt),
  })
);
export type MlScoreResult = typeof mlScoreResults.$inferSelect;
export type InsertMlScoreResult = typeof mlScoreResults.$inferInsert;

// ─── B12: USSD Session Telemetry ─────────────────────────────────────────────
// Real USSD telemetry captured at the production capture point
// (ussdGateway.processInput). One row per telco callback interaction.
// menuPath is the cumulative input path within the session (e.g. "1>2"),
// reconstructed from prior events of the same session at capture time.
export const ussdSessionEvents = pgTable(
  "ussd_session_events",
  {
    id: serial("id").primaryKey(),
    sessionId: varchar("session_id", { length: 64 }).notNull(),
    phoneNumber: varchar("phone_number", { length: 32 }),
    agentId: varchar("agent_id", { length: 64 }),
    userInput: varchar("user_input", { length: 256 }),
    menuPath: varchar("menu_path", { length: 512 }),
    gatewayResponse: text("gateway_response"),
    endSession: boolean("end_session").default(false).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => ({
    sessionIdx: index("use_session_idx").on(t.sessionId),
    createdAtIdx: index("use_created_at_idx").on(t.createdAt),
  })
);
export type UssdSessionEvent = typeof ussdSessionEvents.$inferSelect;
export type InsertUssdSessionEvent = typeof ussdSessionEvents.$inferInsert;

// ─── B13: Compliance Chatbot Persistence ─────────────────────────────────────
// Conversation store for the compliance chatbot. The user message is
// persisted before the Ollama call and the assistant reply only after Ollama
// actually produced it — a transcript never contains a fabricated reply.
export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: serial("id").primaryKey(),
    sessionKey: varchar("session_key", { length: 64 }).notNull().unique(),
    userId: integer("user_id"),
    title: varchar("title", { length: 256 }),
    purpose: varchar("purpose", { length: 64 })
      .default("compliance")
      .notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
  },
  t => ({
    userIdx: index("cs_user_idx").on(t.userId),
    lastActivityIdx: index("cs_last_activity_idx").on(t.lastActivityAt),
  })
);
export type ChatSession = typeof chatSessions.$inferSelect;
export type InsertChatSession = typeof chatSessions.$inferInsert;

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull(),
    // 'user' | 'assistant' | 'system'
    role: varchar("role", { length: 16 }).notNull(),
    content: text("content").notNull(),
    // Ollama model that produced the reply (NULL on user messages).
    model: varchar("model", { length: 128 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  t => ({
    sessionIdx: index("cm_session_idx").on(t.sessionId),
  })
);
export type ChatMessage = typeof chatMessages.$inferSelect;
export type InsertChatMessage = typeof chatMessages.$inferInsert;
// ─── B6: DDoS self-telemetry (Wave 2d, migration 0060) ───────────────────────
// One row per client key per finished rate window, persisted by
// server/lib/ddosTelemetry.ts (in-process counting, fire-and-forget flush —
// capture can never block or fail a request). clientKey is sha256(ip)[:32]:
// stable per client without storing raw IPs at rest.
export const ddosRateWindows = pgTable(
  "ddos_rate_windows",
  {
    id: serial("id").primaryKey(),
    windowStart: timestamp("window_start").notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    clientKey: varchar("client_key", { length: 64 }).notNull(),
    requestCount: integer("request_count").notNull(),
    recordedAt: timestamp("recorded_at").defaultNow().notNull(),
  },
  t => ({
    windowStartIdx: index("drw_window_start_idx").on(t.windowStart),
    clientKeyIdx: index("drw_client_key_idx").on(t.clientKey),
  })
);
export type DdosRateWindow = typeof ddosRateWindows.$inferSelect;
export type InsertDdosRateWindow = typeof ddosRateWindows.$inferInsert;

// Threshold-breach events, appended at the moment a client crosses the
// configured per-window request threshold. Only genuinely observed breaches.
export const ddosThresholdEvents = pgTable(
  "ddos_threshold_events",
  {
    id: serial("id").primaryKey(),
    clientKey: varchar("client_key", { length: 64 }).notNull(),
    windowStart: timestamp("window_start").notNull(),
    windowSeconds: integer("window_seconds").notNull(),
    requestCount: integer("request_count").notNull(),
    threshold: integer("threshold").notNull(),
    detectedAt: timestamp("detected_at").defaultNow().notNull(),
  },
  t => ({
    detectedAtIdx: index("dte_detected_at_idx").on(t.detectedAt),
  })
);
export type DdosThresholdEvent = typeof ddosThresholdEvents.$inferSelect;
export type InsertDdosThresholdEvent = typeof ddosThresholdEvents.$inferInsert;

// ─── B4: File-integrity monitoring baseline (Wave 2d, migration 0060) ────────
// Recorded by securityAudit.recordFileBaseline from the server's REAL
// filesystem (server/lib/fileIntegrity.ts). Diffs in getFileIntegrity are
// computed by re-hashing the live files and comparing — nothing is inferred.
export const fileIntegrityBaseline = pgTable(
  "file_integrity_baseline",
  {
    id: serial("id").primaryKey(),
    path: text("path").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    fileSize: integer("file_size").notNull(),
    baselinedAt: timestamp("baselined_at").defaultNow().notNull(),
    baselinedBy: varchar("baselined_by", { length: 128 }),
  },
  t => ({
    pathUnique: uniqueIndex("fib_path_unique").on(t.path),
  })
);
export type FileIntegrityBaselineRow = typeof fileIntegrityBaseline.$inferSelect;
export type InsertFileIntegrityBaseline = typeof fileIntegrityBaseline.$inferInsert;

// ─── B14: Carrier alert resolutions (Wave 2d, migration 0060) ────────────────
// Durable resolutions for the derived carrier alerts returned by
// networkStatusDashboard.getAlerts (alerts themselves are computed at query
// time from sim_probe_log; only the resolution decision is persisted).
export const networkAlertResolutions = pgTable(
  "network_alert_resolutions",
  {
    id: serial("id").primaryKey(),
    alertKey: varchar("alert_key", { length: 255 }).notNull(),
    resolution: text("resolution"),
    resolvedBy: varchar("resolved_by", { length: 128 }),
    resolvedAt: timestamp("resolved_at").defaultNow().notNull(),
  },
  t => ({
    alertKeyIdx: index("nar_alert_key_idx").on(t.alertKey),
  })
);
export type NetworkAlertResolution = typeof networkAlertResolutions.$inferSelect;
export type InsertNetworkAlertResolution = typeof networkAlertResolutions.$inferInsert;
