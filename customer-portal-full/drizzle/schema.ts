import { pgTable, serial, varchar, text, timestamp, pgEnum, numeric, boolean, integer } from "drizzle-orm/pg-core";

export const roleEnum = pgEnum('role', ['user', 'admin']);

export const users = pgTable("users", {
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
export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const policyTypeEnum = pgEnum('policy_type', ['Health', 'Auto', 'Property', 'Life', 'Group_Life', 'Microinsurance', 'Agricultural', 'Parametric']);
export const policyStatusEnum = pgEnum('policy_status', ['Active', 'Expired', 'Cancelled', 'Pending', 'Suspended']);
export const claimStatusEnum = pgEnum('claim_status', ['Submitted', 'Under Review', 'Approved', 'Rejected', 'Paid', 'Escalated']);
export const paymentStatusEnum = pgEnum('payment_status', ['Pending', 'Completed', 'Failed', 'Refunded', 'Partial']);

export const policies = pgTable("policies", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  policyNumber: varchar("policyNumber", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  type: policyTypeEnum("type").notNull(),
  premium: numeric("premium", { precision: 10, scale: 2 }).notNull(),
  status: policyStatusEnum("status").default("Active").notNull(),
  startDate: timestamp("startDate").notNull(),
  expiryDate: timestamp("expiryDate").notNull(),
  sumAssured: numeric("sumAssured", { precision: 15, scale: 2 }),
  coverageDetails: text("coverageDetails"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Policy = typeof policies.$inferSelect;
export type InsertPolicy = typeof policies.$inferInsert;

export const claims = pgTable("claims", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  policyId: serial("policyId").notNull(),
  claimNumber: varchar("claimNumber", { length: 50 }).notNull().unique(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: claimStatusEnum("status").default("Submitted").notNull(),
  incidentDate: timestamp("incidentDate").notNull(),
  description: text("description").notNull(),
  fraudScore: numeric("fraudScore", { precision: 5, scale: 4 }),
  adjudicatorId: integer("adjudicatorId"),
  settlementAmount: numeric("settlementAmount", { precision: 10, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Claim = typeof claims.$inferSelect;
export type InsertClaim = typeof claims.$inferInsert;

export const payments = pgTable("payments", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  policyId: serial("policyId").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  status: paymentStatusEnum("status").default("Pending").notNull(),
  dueDate: timestamp("dueDate").notNull(),
  paidDate: timestamp("paidDate"),
  paymentMethod: varchar("paymentMethod", { length: 50 }),
  transactionRef: varchar("transactionRef", { length: 128 }),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = typeof payments.$inferInsert;

export const referralStatusEnum = pgEnum('referral_status', ['Pending', 'Completed', 'Rewarded']);
export const referrals = pgTable("referrals", {
  id: serial("id").primaryKey(),
  referrerId: serial("referrerId").notNull(),
  referredUserId: serial("referredUserId"),
  referredEmail: varchar("referredEmail", { length: 320 }),
  referredPhone: varchar("referredPhone", { length: 20 }),
  referralCode: varchar("referralCode", { length: 20 }).notNull().unique(),
  status: referralStatusEnum("status").default("Pending").notNull(),
  rewardAmount: numeric("rewardAmount", { precision: 10, scale: 2 }).default("500.00").notNull(),
  rewardPaidDate: timestamp("rewardPaidDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = typeof referrals.$inferInsert;

export const reviewTypeEnum = pgEnum('review_type', ['Agent', 'Service', 'Claim', 'Policy']);
export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  reviewType: reviewTypeEnum("reviewType").notNull(),
  entityId: serial("entityId").notNull(),
  rating: serial("rating").notNull(),
  comment: text("comment"),
  agentName: varchar("agentName", { length: 255 }),
  isPublic: boolean("isPublic").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Review = typeof reviews.$inferSelect;
export type InsertReview = typeof reviews.$inferInsert;

// ── Insurance Radar / Fraud Detection ────────────────────────────────────────
export const riskLevelEnum = pgEnum('risk_level', ['low', 'medium', 'high', 'critical']);
export const fraudDecisionEnum = pgEnum('fraud_decision', ['allow', 'flag', 'review', 'block']);
export const fraudScores = pgTable("fraud_scores", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  scoreId: varchar("scoreId", { length: 64 }).notNull().unique(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: varchar("entityId", { length: 128 }).notNull(),
  score: numeric("score", { precision: 5, scale: 4 }).notNull(),
  riskLevel: riskLevelEnum("riskLevel").notNull(),
  decision: fraudDecisionEnum("decision").notNull(),
  confidence: numeric("confidence", { precision: 5, scale: 4 }).notNull(),
  processingTime: serial("processingTime").notNull(),
  topFactors: text("topFactors").array(),
  matchedRules: text("matchedRules").array(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export const fraudRings = pgTable("fraud_rings", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  ringId: varchar("ringId", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("active"),
  memberCount: serial("memberCount").notNull().default(0),
  totalLoss: numeric("totalLoss", { precision: 15, scale: 2 }).default("0"),
  detectedAt: timestamp("detectedAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const fraudAlerts = pgTable("fraud_alerts", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  alertId: varchar("alertId", { length: 64 }).notNull().unique(),
  severity: riskLevelEnum("severity").notNull(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: varchar("entityId", { length: 128 }).notNull(),
  message: text("message").notNull(),
  resolved: boolean("resolved").default(false).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  resolvedAt: timestamp("resolvedAt"),
});
export type FraudScore = typeof fraudScores.$inferSelect;
export type InsertFraudScore = typeof fraudScores.$inferInsert;
export type FraudRing = typeof fraudRings.$inferSelect;
export type InsertFraudRing = typeof fraudRings.$inferInsert;
export type FraudAlert = typeof fraudAlerts.$inferSelect;
export type InsertFraudAlert = typeof fraudAlerts.$inferInsert;

// ── ERPNext Integration ───────────────────────────────────────────────────────
export const erpnextSyncStatusEnum = pgEnum('erpnext_sync_status', ['Pending', 'Synced', 'Failed', 'Conflict']);
export const erpnextTransactions = pgTable("erpnext_transactions", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  erpDocType: varchar("erpDocType", { length: 64 }).notNull(),
  erpDocId: varchar("erpDocId", { length: 128 }).notNull(),
  localEntityType: varchar("localEntityType", { length: 64 }).notNull(),
  localEntityId: varchar("localEntityId", { length: 128 }).notNull(),
  syncStatus: erpnextSyncStatusEnum("syncStatus").default("Pending").notNull(),
  amount: numeric("amount", { precision: 15, scale: 2 }),
  currency: varchar("currency", { length: 8 }).default("NGN"),
  lastSyncAt: timestamp("lastSyncAt"),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const erpnextReconciliation = pgTable("erpnext_reconciliation", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  period: varchar("period", { length: 7 }).notNull(),
  localAmount: numeric("localAmount", { precision: 15, scale: 2 }).notNull(),
  erpAmount: numeric("erpAmount", { precision: 15, scale: 2 }).notNull(),
  variance: numeric("variance", { precision: 15, scale: 2 }).notNull(),
  status: varchar("status", { length: 32 }).notNull().default("Pending"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type ERPNextTransaction = typeof erpnextTransactions.$inferSelect;
export type InsertERPNextTransaction = typeof erpnextTransactions.$inferInsert;

// ── Premium Rate Management ───────────────────────────────────────────────────
export const premiumRateTables = pgTable("premium_rate_tables", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  productType: varchar("productType", { length: 64 }).notNull(),
  effectiveDate: timestamp("effectiveDate").notNull(),
  expiryDate: timestamp("expiryDate"),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  baseRate: numeric("baseRate", { precision: 8, scale: 4 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const premiumRiskFactors = pgTable("premium_risk_factors", {
  id: serial("id").primaryKey(),
  tableId: serial("tableId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  category: varchar("category", { length: 64 }).notNull(),
  weight: numeric("weight", { precision: 5, scale: 4 }).notNull(),
  minValue: numeric("minValue", { precision: 10, scale: 4 }),
  maxValue: numeric("maxValue", { precision: 10, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const premiumRateChanges = pgTable("premium_rate_changes", {
  id: serial("id").primaryKey(),
  tableId: serial("tableId").notNull(),
  factorId: serial("factorId").notNull(),
  oldRate: numeric("oldRate", { precision: 8, scale: 4 }).notNull(),
  newRate: numeric("newRate", { precision: 8, scale: 4 }).notNull(),
  changedBy: serial("changedBy").notNull(),
  reason: text("reason").notNull(),
  effectiveDate: timestamp("effectiveDate").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export const premiumRateAuditLogs = pgTable("premium_rate_audit_logs", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  action: varchar("action", { length: 64 }).notNull(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: serial("entityId").notNull(),
  details: text("details"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PremiumRateTable = typeof premiumRateTables.$inferSelect;
export type InsertPremiumRateTable = typeof premiumRateTables.$inferInsert;

// ── Broker API Management ─────────────────────────────────────────────────────
export const brokerApiKeys = pgTable("broker_api_keys", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  apiKey: varchar("apiKey", { length: 64 }).notNull().unique(),
  permissions: text("permissions").array().notNull(),
  rateLimit: serial("rateLimit").notNull().default(1000),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  lastUsedAt: timestamp("lastUsedAt"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const brokerApiUsage = pgTable("broker_api_usage", {
  id: serial("id").primaryKey(),
  keyId: serial("keyId").notNull(),
  userId: serial("userId").notNull(),
  endpoint: varchar("endpoint", { length: 255 }).notNull(),
  method: varchar("method", { length: 8 }).notNull(),
  statusCode: serial("statusCode").notNull(),
  responseTimeMs: serial("responseTimeMs").notNull(),
  requestDate: timestamp("requestDate").defaultNow().notNull(),
});
export type BrokerAPIKey = typeof brokerApiKeys.$inferSelect;
export type InsertBrokerAPIKey = typeof brokerApiKeys.$inferInsert;

// ── Knowledge Graph ───────────────────────────────────────────────────────────
export const knowledgeGraphNodes = pgTable("knowledge_graph_nodes", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  nodeId: varchar("nodeId", { length: 128 }).notNull(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  properties: text("properties"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const knowledgeGraphEdges = pgTable("knowledge_graph_edges", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  sourceNodeId: varchar("sourceNodeId", { length: 128 }).notNull(),
  targetNodeId: varchar("targetNodeId", { length: 128 }).notNull(),
  relationship: varchar("relationship", { length: 128 }).notNull(),
  weight: numeric("weight", { precision: 5, scale: 4 }).default("1.0"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type KnowledgeGraphNode = typeof knowledgeGraphNodes.$inferSelect;
export type KnowledgeGraphEdge = typeof knowledgeGraphEdges.$inferSelect;

// ── Telco Credit Scoring ──────────────────────────────────────────────────────
export const telcoCreditScores = pgTable("telco_credit_scores", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  phoneNumber: varchar("phoneNumber", { length: 20 }).notNull(),
  provider: varchar("provider", { length: 64 }).notNull(),
  score: serial("score").notNull(),
  grade: varchar("grade", { length: 2 }).notNull(),
  factors: text("factors").array(),
  consentGiven: boolean("consentGiven").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
});
export type TelcoCreditScore = typeof telcoCreditScores.$inferSelect;
export type InsertTelcoCreditScore = typeof telcoCreditScores.$inferInsert;

// ── Actuarial Module ──────────────────────────────────────────────────────────
export const actuarialCalculations = pgTable("actuarial_calculations", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  calculationType: varchar("calculationType", { length: 64 }).notNull(),
  policyType: varchar("policyType", { length: 64 }),
  inputParams: text("inputParams"),
  result: numeric("result", { precision: 15, scale: 4 }),
  breakdown: text("breakdown"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ActuarialCalculation = typeof actuarialCalculations.$inferSelect;

// ── Bancassurance ─────────────────────────────────────────────────────────────
export const bancassurancePartners = pgTable("bancassurance_partners", {
  id: serial("id").primaryKey(),
  bankName: varchar("bankName", { length: 255 }).notNull(),
  bankCode: varchar("bankCode", { length: 20 }),
  commissionRate: numeric("commissionRate", { precision: 5, scale: 4 }),
  products: text("products").array(),
  status: varchar("status", { length: 32 }).default("Active"),
  apiEndpoint: text("apiEndpoint"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const bancassuranceOffers = pgTable("bancassurance_offers", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  partnerId: serial("partnerId").notNull(),
  offerType: varchar("offerType", { length: 64 }).notNull(),
  premium: numeric("premium", { precision: 10, scale: 2 }),
  sumAssured: numeric("sumAssured", { precision: 15, scale: 2 }),
  status: varchar("status", { length: 32 }).default("Pending"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type BancassurancePartner = typeof bancassurancePartners.$inferSelect;
export type BancassuranceOffer = typeof bancassuranceOffers.$inferSelect;

// ── Group Life Administration ─────────────────────────────────────────────────
export const groupLifeSchemes = pgTable("group_life_schemes", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  schemeName: varchar("schemeName", { length: 255 }).notNull(),
  employerName: varchar("employerName", { length: 255 }),
  employerId: varchar("employerId", { length: 64 }),
  schemeType: varchar("schemeType", { length: 32 }).default("contributory"),
  totalMembers: integer("totalMembers").default(0),
  totalSumAssured: numeric("totalSumAssured", { precision: 15, scale: 2 }),
  annualPremium: numeric("annualPremium", { precision: 15, scale: 2 }),
  status: varchar("status", { length: 32 }).default("Active"),
  renewalDate: timestamp("renewalDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const groupLifeMembers = pgTable("group_life_members", {
  id: serial("id").primaryKey(),
  schemeId: serial("schemeId").notNull(),
  memberName: varchar("memberName", { length: 255 }).notNull(),
  staffId: varchar("staffId", { length: 64 }),
  dateOfBirth: timestamp("dateOfBirth"),
  salary: numeric("salary", { precision: 15, scale: 2 }),
  sumAssured: numeric("sumAssured", { precision: 15, scale: 2 }),
  status: varchar("status", { length: 32 }).default("Active"),
  enrolledAt: timestamp("enrolledAt").defaultNow().notNull(),
});
export type GroupLifeScheme = typeof groupLifeSchemes.$inferSelect;
export type GroupLifeMember = typeof groupLifeMembers.$inferSelect;

// ── NMID Integration ──────────────────────────────────────────────────────────
export const nmidVerifications = pgTable("nmid_verifications", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  vehicleRegistration: varchar("vehicleRegistration", { length: 20 }).notNull(),
  chassisNumber: varchar("chassisNumber", { length: 64 }),
  engineNumber: varchar("engineNumber", { length: 64 }),
  vehicleMake: varchar("vehicleMake", { length: 64 }),
  vehicleModel: varchar("vehicleModel", { length: 64 }),
  vehicleYear: integer("vehicleYear"),
  ownerName: varchar("ownerName", { length: 255 }),
  verificationStatus: varchar("verificationStatus", { length: 32 }).default("pending"),
  nmidRef: varchar("nmidRef", { length: 128 }),
  verifiedAt: timestamp("verifiedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type NMIDVerification = typeof nmidVerifications.$inferSelect;

// ── PFA Integration ───────────────────────────────────────────────────────────
export const pfaPartners = pgTable("pfa_partners", {
  id: serial("id").primaryKey(),
  pfaName: varchar("pfaName", { length: 255 }).notNull(),
  pfaCode: varchar("pfaCode", { length: 20 }),
  licenseNumber: varchar("licenseNumber", { length: 64 }),
  commissionRate: numeric("commissionRate", { precision: 5, scale: 4 }),
  products: text("products").array(),
  status: varchar("status", { length: 32 }).default("Active"),
  apiEndpoint: text("apiEndpoint"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const pfaAnnuityQuotes = pgTable("pfa_annuity_quotes", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  pfaId: serial("pfaId").notNull(),
  rsaPin: varchar("rsaPin", { length: 32 }),
  retirementAge: integer("retirementAge"),
  accumulatedFund: numeric("accumulatedFund", { precision: 15, scale: 2 }),
  monthlyAnnuity: numeric("monthlyAnnuity", { precision: 10, scale: 2 }),
  annuityType: varchar("annuityType", { length: 64 }),
  quoteRef: varchar("quoteRef", { length: 128 }),
  validUntil: timestamp("validUntil"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type PFAPartner = typeof pfaPartners.$inferSelect;
export type PFAAnnuityQuote = typeof pfaAnnuityQuotes.$inferSelect;

// ── Reinsurance Management ────────────────────────────────────────────────────
export const reinsuranceTreaties = pgTable("reinsurance_treaties", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  treatyName: varchar("treatyName", { length: 255 }).notNull(),
  treatyType: varchar("treatyType", { length: 64 }).notNull(),
  reinsurer: varchar("reinsurer", { length: 255 }),
  reinsurerShare: numeric("reinsurerShare", { precision: 5, scale: 4 }),
  retentionLimit: numeric("retentionLimit", { precision: 15, scale: 2 }),
  coverLimit: numeric("coverLimit", { precision: 15, scale: 2 }),
  commissionRate: numeric("commissionRate", { precision: 5, scale: 4 }),
  effectiveDate: timestamp("effectiveDate"),
  expiryDate: timestamp("expiryDate"),
  status: varchar("status", { length: 32 }).default("Active"),
  linesOfBusiness: text("linesOfBusiness").array(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const reinsuranceCessions = pgTable("reinsurance_cessions", {
  id: serial("id").primaryKey(),
  treatyId: serial("treatyId").notNull(),
  policyId: serial("policyId").notNull(),
  cedingAmount: numeric("cedingAmount", { precision: 15, scale: 2 }).notNull(),
  retainedAmount: numeric("retainedAmount", { precision: 15, scale: 2 }).notNull(),
  reinsurerPremium: numeric("reinsurerPremium", { precision: 10, scale: 2 }),
  status: varchar("status", { length: 32 }).default("Active"),
  cessionDate: timestamp("cessionDate").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ReinsuranceTreaty = typeof reinsuranceTreaties.$inferSelect;
export type ReinsuranceCession = typeof reinsuranceCessions.$inferSelect;

// ── Agent Management ──────────────────────────────────────────────────────────
export const agents = pgTable("agents", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  agentCode: varchar("agentCode", { length: 32 }).notNull().unique(),
  licenseNumber: varchar("licenseNumber", { length: 64 }),
  agencyName: varchar("agencyName", { length: 255 }),
  region: varchar("region", { length: 64 }),
  tier: varchar("tier", { length: 32 }).default("standard"),
  commissionRate: numeric("commissionRate", { precision: 5, scale: 4 }),
  totalPoliciesSold: integer("totalPoliciesSold").default(0),
  totalPremiumCollected: numeric("totalPremiumCollected", { precision: 15, scale: 2 }).default("0"),
  status: varchar("status", { length: 32 }).default("Active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const agentCommissions = pgTable("agent_commissions", {
  id: serial("id").primaryKey(),
  agentId: serial("agentId").notNull(),
  policyId: serial("policyId").notNull(),
  commissionAmount: numeric("commissionAmount", { precision: 10, scale: 2 }).notNull(),
  commissionRate: numeric("commissionRate", { precision: 5, scale: 4 }).notNull(),
  status: varchar("status", { length: 32 }).default("Pending"),
  paidAt: timestamp("paidAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Agent = typeof agents.$inferSelect;
export type AgentCommission = typeof agentCommissions.$inferSelect;

// ── KYC/KYB ──────────────────────────────────────────────────────────────────
export const kycVerifications = pgTable("kyc_verifications", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  verificationType: varchar("verificationType", { length: 32 }).notNull(),
  documentType: varchar("documentType", { length: 64 }),
  documentNumber: varchar("documentNumber", { length: 128 }),
  status: varchar("status", { length: 32 }).default("Pending"),
  verifiedAt: timestamp("verifiedAt"),
  expiresAt: timestamp("expiresAt"),
  riskScore: numeric("riskScore", { precision: 5, scale: 4 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type KYCVerification = typeof kycVerifications.$inferSelect;

// ── NAICOM Compliance ─────────────────────────────────────────────────────────
export const naicomFilings = pgTable("naicom_filings", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  filingType: varchar("filingType", { length: 64 }).notNull(),
  period: varchar("period", { length: 7 }).notNull(),
  status: varchar("status", { length: 32 }).default("Draft"),
  submittedAt: timestamp("submittedAt"),
  dueDate: timestamp("dueDate"),
  filingRef: varchar("filingRef", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type NAICOMFiling = typeof naicomFilings.$inferSelect;

// ── Notifications ─────────────────────────────────────────────────────────────
export const notifications = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  message: text("message").notNull(),
  type: varchar("type", { length: 32 }).notNull(),
  channel: varchar("channel", { length: 32 }).default("in_app"),
  isRead: boolean("isRead").default(false).notNull(),
  readAt: timestamp("readAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type Notification = typeof notifications.$inferSelect;

// ── Analytics Events ──────────────────────────────────────────────────────────
export const analyticsEvents = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  userId: serial("userId"),
  eventType: varchar("eventType", { length: 64 }).notNull(),
  entityType: varchar("entityType", { length: 64 }),
  entityId: varchar("entityId", { length: 128 }),
  properties: text("properties"),
  sessionId: varchar("sessionId", { length: 128 }),
  ipAddress: varchar("ipAddress", { length: 45 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;

// ── Audit Trail ───────────────────────────────────────────────────────────────
export const auditTrail = pgTable("audit_trail", {
  id: serial("id").primaryKey(),
  userId: serial("userId"),
  action: varchar("action", { length: 128 }).notNull(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: varchar("entityId", { length: 128 }),
  oldValues: text("oldValues"),
  newValues: text("newValues"),
  ipAddress: varchar("ipAddress", { length: 45 }),
  userAgent: text("userAgent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type AuditTrailEntry = typeof auditTrail.$inferSelect;

// ── Loyalty / Gamification ────────────────────────────────────────────────────
export const loyaltyPoints = pgTable("loyalty_points", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  points: integer("points").notNull().default(0),
  tier: varchar("tier", { length: 32 }).default("Bronze"),
  totalEarned: integer("totalEarned").notNull().default(0),
  totalRedeemed: integer("totalRedeemed").notNull().default(0),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const loyaltyTransactions = pgTable("loyalty_transactions", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  points: integer("points").notNull(),
  transactionType: varchar("transactionType", { length: 32 }).notNull(),
  description: text("description"),
  referenceId: varchar("referenceId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type LoyaltyPoints = typeof loyaltyPoints.$inferSelect;
export type LoyaltyTransaction = typeof loyaltyTransactions.$inferSelect;

// ── USSD Sessions ─────────────────────────────────────────────────────────────
export const ussdSessions = pgTable("ussd_sessions", {
  id: serial("id").primaryKey(),
  sessionId: varchar("sessionId", { length: 128 }).notNull().unique(),
  phoneNumber: varchar("phoneNumber", { length: 20 }).notNull(),
  currentMenu: varchar("currentMenu", { length: 64 }),
  sessionData: text("sessionData"),
  status: varchar("status", { length: 32 }).default("active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type USSDSession = typeof ussdSessions.$inferSelect;

// ── Document Management ───────────────────────────────────────────────────────
export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: integer("entityId"),
  documentType: varchar("documentType", { length: 64 }).notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileUrl: text("fileUrl").notNull(),
  fileSize: integer("fileSize"),
  mimeType: varchar("mimeType", { length: 128 }),
  status: varchar("status", { length: 32 }).default("Active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type Document = typeof documents.$inferSelect;

// ── Emergency SOS ─────────────────────────────────────────────────────────────
export const emergencyIncidents = pgTable("emergency_incidents", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  incidentType: varchar("incidentType", { length: 64 }).notNull(),
  latitude: numeric("latitude", { precision: 10, scale: 7 }),
  longitude: numeric("longitude", { precision: 10, scale: 7 }),
  description: text("description"),
  status: varchar("status", { length: 32 }).default("Dispatched"),
  emergencyServices: text("emergencyServices").array(),
  resolvedAt: timestamp("resolvedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type EmergencyIncident = typeof emergencyIncidents.$inferSelect;

// ── P2P Insurance Pools ───────────────────────────────────────────────────────
export const p2pPools = pgTable("p2p_pools", {
  id: serial("id").primaryKey(),
  poolName: varchar("poolName", { length: 255 }).notNull(),
  totalFund: numeric("totalFund", { precision: 15, scale: 2 }).default("0"),
  coveragePerMember: numeric("coveragePerMember", { precision: 15, scale: 2 }),
  monthlyContribution: numeric("monthlyContribution", { precision: 10, scale: 2 }),
  memberCount: integer("memberCount").default(0),
  status: varchar("status", { length: 32 }).default("Active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export const p2pMemberships = pgTable("p2p_memberships", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  poolId: serial("poolId").notNull(),
  contribution: numeric("contribution", { precision: 10, scale: 2 }),
  status: varchar("status", { length: 32 }).default("Active"),
  joinedAt: timestamp("joinedAt").defaultNow().notNull(),
});
export type P2PPool = typeof p2pPools.$inferSelect;
export type P2PMembership = typeof p2pMemberships.$inferSelect;

// ── Microinsurance ────────────────────────────────────────────────────────────
export const microinsurancePolicies = pgTable("microinsurance_policies", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  productId: varchar("productId", { length: 64 }).notNull(),
  productName: varchar("productName", { length: 255 }),
  premium: numeric("premium", { precision: 10, scale: 2 }),
  coverage: numeric("coverage", { precision: 15, scale: 2 }),
  duration: integer("duration").notNull(),
  status: varchar("status", { length: 32 }).default("Active"),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type MicroinsurancePolicy = typeof microinsurancePolicies.$inferSelect;

// ── Gig Economy Coverage ──────────────────────────────────────────────────────
export const gigCoveragePolicies = pgTable("gig_coverage_policies", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  planId: varchar("planId", { length: 64 }).notNull(),
  planName: varchar("planName", { length: 255 }),
  platform: varchar("platform", { length: 64 }),
  premium: numeric("premium", { precision: 10, scale: 2 }),
  coverage: numeric("coverage", { precision: 15, scale: 2 }),
  status: varchar("status", { length: 32 }).default("Active"),
  activatedAt: timestamp("activatedAt").defaultNow().notNull(),
  expiresAt: timestamp("expiresAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type GigCoveragePolicy = typeof gigCoveragePolicies.$inferSelect;

// ── SME Policies ──────────────────────────────────────────────────────────────
export const smePolicies = pgTable("sme_policies", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  productId: varchar("productId", { length: 64 }).notNull(),
  businessName: varchar("businessName", { length: 255 }),
  businessType: varchar("businessType", { length: 64 }),
  annualPremium: numeric("annualPremium", { precision: 10, scale: 2 }),
  coverageAmount: numeric("coverageAmount", { precision: 15, scale: 2 }),
  status: varchar("status", { length: 32 }).default("Active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type SMEPolicy = typeof smePolicies.$inferSelect;

// ── Dynamic Pricing History ───────────────────────────────────────────────────
export const dynamicPricingHistory = pgTable("dynamic_pricing_history", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  productType: varchar("productType", { length: 64 }).notNull(),
  basePremium: numeric("basePremium", { precision: 10, scale: 2 }),
  adjustedPremium: numeric("adjustedPremium", { precision: 10, scale: 2 }),
  riskScore: integer("riskScore"),
  quoteId: varchar("quoteId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type DynamicPricingRecord = typeof dynamicPricingHistory.$inferSelect;

// ── Savings Accounts ──────────────────────────────────────────────────────────
export const savingsAccounts = pgTable("savings_accounts", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  planId: varchar("planId", { length: 64 }).notNull(),
  planName: varchar("planName", { length: 255 }),
  balance: numeric("balance", { precision: 15, scale: 2 }).default("0"),
  targetAmount: numeric("targetAmount", { precision: 15, scale: 2 }),
  interestRate: numeric("interestRate", { precision: 5, scale: 4 }),
  status: varchar("status", { length: 32 }).default("Active"),
  maturityDate: timestamp("maturityDate"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type SavingsAccount = typeof savingsAccounts.$inferSelect;

// ── MCMC Simulation Results ───────────────────────────────────────────────────
export const mcmcResults = pgTable("mcmc_results", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  simulationId: varchar("simulationId", { length: 128 }).notNull(),
  iterations: integer("iterations"),
  meanLoss: numeric("meanLoss", { precision: 15, scale: 2 }),
  stdDev: numeric("stdDev", { precision: 15, scale: 2 }),
  var95: numeric("var95", { precision: 15, scale: 2 }),
  var99: numeric("var99", { precision: 15, scale: 2 }),
  processingTime: numeric("processingTime", { precision: 8, scale: 2 }),
  status: varchar("status", { length: 32 }).default("Completed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type MCMCResult = typeof mcmcResults.$inferSelect;

// ── Family Members ────────────────────────────────────────────────────────────
export const familyMembers = pgTable("family_members", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  memberName: varchar("memberName", { length: 255 }).notNull(),
  relationship: varchar("relationship", { length: 64 }).notNull(),
  dateOfBirth: timestamp("dateOfBirth"),
  gender: varchar("gender", { length: 16 }),
  coveredPolicyId: integer("coveredPolicyId"),
  status: varchar("status", { length: 32 }).default("Active"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type FamilyMember = typeof familyMembers.$inferSelect;

// ── Claim Evidence ────────────────────────────────────────────────────────────
export const claimEvidence = pgTable("claim_evidence", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  claimId: integer("claimId").notNull(),
  evidenceType: varchar("evidenceType", { length: 64 }).notNull(),
  fileName: varchar("fileName", { length: 255 }),
  fileUrl: text("fileUrl"),
  description: text("description"),
  status: varchar("status", { length: 32 }).default("Uploaded"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type ClaimEvidenceRecord = typeof claimEvidence.$inferSelect;

// ── WhatsApp Messages ─────────────────────────────────────────────────────────
export const whatsappMessages = pgTable("whatsapp_messages", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  phoneNumber: varchar("phoneNumber", { length: 20 }),
  direction: varchar("direction", { length: 16 }).notNull(),
  messageType: varchar("messageType", { length: 32 }).default("text"),
  content: text("content"),
  status: varchar("status", { length: 32 }).default("sent"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type WhatsAppMessage = typeof whatsappMessages.$inferSelect;

// ── Voice Sessions ────────────────────────────────────────────────────────────
export const voiceSessions = pgTable("voice_sessions", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  language: varchar("language", { length: 8 }).default("en"),
  transcription: text("transcription"),
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
  intent: varchar("intent", { length: 128 }),
  status: varchar("status", { length: 32 }).default("Completed"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});
export type VoiceSession = typeof voiceSessions.$inferSelect;

// ── Insurance Applications ────────────────────────────────────────────────────
export const insuranceApplications = pgTable("insurance_applications", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  applicationId: varchar("applicationId", { length: 128 }).notNull(),
  productType: varchar("productType", { length: 64 }),
  status: varchar("status", { length: 32 }).default("Draft"),
  currentStep: varchar("currentStep", { length: 64 }),
  totalSteps: integer("totalSteps").default(5),
  submittedAt: timestamp("submittedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type InsuranceApplication = typeof insuranceApplications.$inferSelect;

// ── Customer Feedback ─────────────────────────────────────────────────────────
export const customerFeedback = pgTable("customer_feedback", {
  id: serial("id").primaryKey(),
  userId: serial("userId").notNull(),
  feedbackType: varchar("feedbackType", { length: 64 }),
  subject: varchar("subject", { length: 255 }),
  message: text("message"),
  rating: integer("rating"),
  status: varchar("status", { length: 32 }).default("Open"),
  ticketId: varchar("ticketId", { length: 128 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});
export type CustomerFeedbackRecord = typeof customerFeedback.$inferSelect;
