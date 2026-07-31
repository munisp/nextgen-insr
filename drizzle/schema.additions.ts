/**
 * schema.additions.ts — Missing table definitions for InsurePortal
 *
 * These tables were referenced in routers but missing from schema.ts.
 * Imported by routers that need them.
 */
import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  numeric,
  jsonb,
  index,
  uniqueIndex,
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
    claimIdx: index("claims_pay_claim_idx").on(t.claimId),
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
