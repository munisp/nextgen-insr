/**
 * schema.innovations.ts
 * Drizzle ORM table definitions for all 20 innovation features.
 * Sprint 108 — wired to tRPC routers and journey activities.
 */
import {
  pgTable, serial, bigserial, integer, varchar, text, decimal,
  boolean, jsonb, date, timestamp, index, uniqueIndex,
} from "drizzle-orm/pg-core";
import { customers, policies, claims, users } from "./schema";

// ── 1. Telematics Events ──────────────────────────────────────────────────────
export const telematicsEvents = pgTable("telematics_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  policyId: integer("policy_id").notNull().references(() => policies.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  deviceId: varchar("device_id", { length: 64 }).notNull(),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  speedKmh: decimal("speed_kmh", { precision: 6, scale: 2 }),
  acceleration: decimal("acceleration", { precision: 6, scale: 3 }),
  distanceKm: decimal("distance_km", { precision: 10, scale: 3 }),
  durationSeconds: integer("duration_seconds"),
  riskScore: decimal("risk_score", { precision: 5, scale: 2 }),
  drivingScore: decimal("driving_score", { precision: 5, scale: 2 }),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  policyIdx: index("idx_telematics_policy").on(t.policyId, t.recordedAt),
  customerIdx: index("idx_telematics_customer").on(t.customerId, t.recordedAt),
}));

// ── 2. Wearable Readings ──────────────────────────────────────────────────────
export const wearableReadings = pgTable("wearable_readings", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  policyId: integer("policy_id").references(() => policies.id),
  deviceType: varchar("device_type", { length: 32 }).notNull(),
  deviceId: varchar("device_id", { length: 64 }),
  readingDate: date("reading_date").notNull(),
  steps: integer("steps"),
  activeMinutes: integer("active_minutes"),
  sleepHours: decimal("sleep_hours", { precision: 4, scale: 2 }),
  heartRateAvg: integer("heart_rate_avg"),
  heartRateResting: integer("heart_rate_resting"),
  bmi: decimal("bmi", { precision: 5, scale: 2 }),
  bloodPressureSystolic: integer("blood_pressure_systolic"),
  bloodPressureDiastolic: integer("blood_pressure_diastolic"),
  bloodGlucose: decimal("blood_glucose", { precision: 6, scale: 2 }),
  wellnessScore: decimal("wellness_score", { precision: 5, scale: 2 }),
  rewardPointsEarned: integer("reward_points_earned").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 3. P2P Pools ──────────────────────────────────────────────────────────────
export const p2pPools = pgTable("p2p_pools", {
  id: serial("id").primaryKey(),
  poolName: varchar("pool_name", { length: 128 }).notNull(),
  poolType: varchar("pool_type", { length: 32 }).notNull(),
  productType: varchar("product_type", { length: 32 }).notNull(),
  organiserId: integer("organiser_id").notNull().references(() => customers.id),
  maxMembers: integer("max_members").notNull().default(50),
  contributionAmount: decimal("contribution_amount", { precision: 15, scale: 2 }).notNull(),
  contributionFrequency: varchar("contribution_frequency", { length: 16 }).notNull().default("monthly"),
  poolBalance: decimal("pool_balance", { precision: 15, scale: 2 }).notNull().default("0"),
  reinsuranceThreshold: decimal("reinsurance_threshold", { precision: 15, scale: 2 }).notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("forming"),
  tbAccountId: varchar("tb_account_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const p2pPoolMembers = pgTable("p2p_pool_members", {
  id: serial("id").primaryKey(),
  poolId: integer("pool_id").notNull().references(() => p2pPools.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  policyId: integer("policy_id").references(() => policies.id),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  contributionPaid: decimal("contribution_paid", { precision: 15, scale: 2 }).notNull().default("0"),
  claimsMade: integer("claims_made").notNull().default(0),
  claimsAmount: decimal("claims_amount", { precision: 15, scale: 2 }).notNull().default("0"),
  status: varchar("status", { length: 16 }).notNull().default("active"),
});

export const p2pPoolClaims = pgTable("p2p_pool_claims", {
  id: serial("id").primaryKey(),
  poolId: integer("pool_id").notNull().references(() => p2pPools.id),
  memberId: integer("member_id").notNull().references(() => p2pPoolMembers.id),
  claimAmount: decimal("claim_amount", { precision: 15, scale: 2 }).notNull(),
  approvedAmount: decimal("approved_amount", { precision: 15, scale: 2 }),
  paidFromPool: decimal("paid_from_pool", { precision: 15, scale: 2 }),
  paidFromInsurer: decimal("paid_from_insurer", { precision: 15, scale: 2 }),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  filedAt: timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
  settledAt: timestamp("settled_at", { withTimezone: true }),
});

// ── 4. Parametric Insurance ───────────────────────────────────────────────────
export const parametricTriggers = pgTable("parametric_triggers", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id").notNull().references(() => policies.id),
  triggerType: varchar("trigger_type", { length: 32 }).notNull(),
  dataSource: varchar("data_source", { length: 64 }).notNull(),
  locationName: varchar("location_name", { length: 128 }),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  radiusKm: decimal("radius_km", { precision: 6, scale: 2 }).default("50"),
  thresholdValue: decimal("threshold_value", { precision: 12, scale: 4 }).notNull(),
  thresholdUnit: varchar("threshold_unit", { length: 16 }).notNull(),
  thresholdDirection: varchar("threshold_direction", { length: 8 }).notNull().default("below"),
  measurementPeriodDays: integer("measurement_period_days").notNull().default(30),
  payoutAmount: decimal("payout_amount", { precision: 15, scale: 2 }).notNull(),
  payoutPercentage: decimal("payout_percentage", { precision: 5, scale: 2 }),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const parametricPayouts = pgTable("parametric_payouts", {
  id: serial("id").primaryKey(),
  triggerId: integer("trigger_id").notNull().references(() => parametricTriggers.id),
  policyId: integer("policy_id").notNull().references(() => policies.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  triggerDate: date("trigger_date").notNull(),
  measuredValue: decimal("measured_value", { precision: 12, scale: 4 }).notNull(),
  thresholdValue: decimal("threshold_value", { precision: 12, scale: 4 }).notNull(),
  payoutAmount: decimal("payout_amount", { precision: 15, scale: 2 }).notNull(),
  tbTransferId: varchar("tb_transfer_id", { length: 64 }),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  dataSourceUrl: text("data_source_url"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 5. NHIA Integration ───────────────────────────────────────────────────────
export const nhiaEnrollments = pgTable("nhia_enrollments", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  nhiaId: varchar("nhia_id", { length: 32 }).unique().notNull(),
  schemeType: varchar("scheme_type", { length: 32 }).notNull(),
  employerCode: varchar("employer_code", { length: 32 }),
  facilityCode: varchar("facility_code", { length: 32 }),
  enrollmentDate: date("enrollment_date").notNull(),
  expiryDate: date("expiry_date"),
  dependants: integer("dependants").notNull().default(0),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const nhiaClaims = pgTable("nhia_claims", {
  id: serial("id").primaryKey(),
  enrollmentId: integer("enrollment_id").notNull().references(() => nhiaEnrollments.id),
  claimId: integer("claim_id").references(() => claims.id),
  nhiaClaimRef: varchar("nhia_claim_ref", { length: 32 }).unique(),
  facilityCode: varchar("facility_code", { length: 32 }).notNull(),
  diagnosisCode: varchar("diagnosis_code", { length: 16 }),
  procedureCode: varchar("procedure_code", { length: 16 }),
  claimAmount: decimal("claim_amount", { precision: 15, scale: 2 }).notNull(),
  approvedAmount: decimal("approved_amount", { precision: 15, scale: 2 }),
  nhiaStatus: varchar("nhia_status", { length: 16 }).notNull().default("submitted"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  adjudicatedAt: timestamp("adjudicated_at", { withTimezone: true }),
});

// ── 6. Comparison Quotes ──────────────────────────────────────────────────────
export const comparisonQuotes = pgTable("comparison_quotes", {
  id: serial("id").primaryKey(),
  sessionId: varchar("session_id", { length: 64 }).notNull(),
  customerId: integer("customer_id").references(() => customers.id),
  productType: varchar("product_type", { length: 32 }).notNull(),
  riskData: jsonb("risk_data").notNull(),
  quotes: jsonb("quotes").notNull(),
  selectedQuoteId: varchar("selected_quote_id", { length: 32 }),
  converted: boolean("converted").notNull().default(false),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 7. Group Insurance ────────────────────────────────────────────────────────
export const groupPolicies = pgTable("group_policies", {
  id: serial("id").primaryKey(),
  groupName: varchar("group_name", { length: 128 }).notNull(),
  groupType: varchar("group_type", { length: 32 }).notNull(),
  organiserId: integer("organiser_id").notNull().references(() => customers.id),
  productId: integer("product_id").notNull(),
  masterPolicyNumber: varchar("master_policy_number", { length: 32 }).unique().notNull(),
  sumInsuredPerMember: decimal("sum_insured_per_member", { precision: 15, scale: 2 }).notNull(),
  premiumPerMember: decimal("premium_per_member", { precision: 15, scale: 2 }).notNull(),
  totalMembers: integer("total_members").notNull().default(0),
  totalPremium: decimal("total_premium", { precision: 15, scale: 2 }).notNull().default("0"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  tbAccountId: varchar("tb_account_id", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const groupMembers = pgTable("group_members", {
  id: serial("id").primaryKey(),
  groupPolicyId: integer("group_policy_id").notNull().references(() => groupPolicies.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  individualPolicyId: integer("individual_policy_id").references(() => policies.id),
  employeeId: varchar("employee_id", { length: 32 }),
  memberType: varchar("member_type", { length: 16 }).notNull().default("principal"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  status: varchar("status", { length: 16 }).notNull().default("active"),
});

// ── 8. Bancassurance ──────────────────────────────────────────────────────────
export const bancassurancePartners = pgTable("bancassurance_partners", {
  id: serial("id").primaryKey(),
  partnerName: varchar("partner_name", { length: 128 }).notNull(),
  partnerType: varchar("partner_type", { length: 32 }).notNull(),
  partnerCode: varchar("partner_code", { length: 16 }).unique().notNull(),
  apiKeyHash: varchar("api_key_hash", { length: 64 }),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull().default("5.0"),
  productsEnabled: jsonb("products_enabled").notNull().default([]),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const bancassuranceReferrals = pgTable("bancassurance_referrals", {
  id: serial("id").primaryKey(),
  partnerId: integer("partner_id").notNull().references(() => bancassurancePartners.id),
  customerId: integer("customer_id").references(() => customers.id),
  policyId: integer("policy_id").references(() => policies.id),
  referralCode: varchar("referral_code", { length: 32 }).unique().notNull(),
  productType: varchar("product_type", { length: 32 }).notNull(),
  premiumAmount: decimal("premium_amount", { precision: 15, scale: 2 }),
  commissionAmount: decimal("commission_amount", { precision: 15, scale: 2 }),
  status: varchar("status", { length: 16 }).notNull().default("referred"),
  referredAt: timestamp("referred_at", { withTimezone: true }).notNull().defaultNow(),
  convertedAt: timestamp("converted_at", { withTimezone: true }),
});

// ── 9. Open Insurance ─────────────────────────────────────────────────────────
export const openApiConsents = pgTable("open_api_consents", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  thirdPartyId: varchar("third_party_id", { length: 64 }).notNull(),
  thirdPartyName: varchar("third_party_name", { length: 128 }).notNull(),
  scopes: text("scopes").array().notNull(),
  consentToken: varchar("consent_token", { length: 128 }).unique().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const openApiDataRequests = pgTable("open_api_data_requests", {
  id: serial("id").primaryKey(),
  consentId: integer("consent_id").notNull().references(() => openApiConsents.id),
  endpoint: varchar("endpoint", { length: 128 }).notNull(),
  responseHash: varchar("response_hash", { length: 64 }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 10. Climate Risk ──────────────────────────────────────────────────────────
export const climateRiskScores = pgTable("climate_risk_scores", {
  id: serial("id").primaryKey(),
  locationName: varchar("location_name", { length: 128 }),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  geohash: varchar("geohash", { length: 12 }),
  floodRisk: decimal("flood_risk", { precision: 5, scale: 2 }),
  droughtRisk: decimal("drought_risk", { precision: 5, scale: 2 }),
  windstormRisk: decimal("windstorm_risk", { precision: 5, scale: 2 }),
  earthquakeRisk: decimal("earthquake_risk", { precision: 5, scale: 2 }),
  wildfireRisk: decimal("wildfire_risk", { precision: 5, scale: 2 }),
  compositeRisk: decimal("composite_risk", { precision: 5, scale: 2 }),
  dataSource: varchar("data_source", { length: 64 }),
  validFrom: date("valid_from").notNull(),
  validTo: date("valid_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 11. Renewal Predictions ───────────────────────────────────────────────────
export const renewalPredictions = pgTable("renewal_predictions", {
  id: serial("id").primaryKey(),
  policyId: integer("policy_id").notNull().references(() => policies.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  predictionDate: date("prediction_date").notNull(),
  lapseProbability: decimal("lapse_probability", { precision: 5, scale: 4 }).notNull(),
  lapseRiskTier: varchar("lapse_risk_tier", { length: 8 }).notNull(),
  keyFactors: jsonb("key_factors"),
  recommendedAction: varchar("recommended_action", { length: 32 }),
  discountOfferPct: decimal("discount_offer_pct", { precision: 5, scale: 2 }),
  outreachSent: boolean("outreach_sent").notNull().default(false),
  outreachSentAt: timestamp("outreach_sent_at", { withTimezone: true }),
  converted: boolean("converted"),
  modelVersion: varchar("model_version", { length: 16 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 12. SLO & Incidents ───────────────────────────────────────────────────────
export const sloDefinitions = pgTable("slo_definitions", {
  id: serial("id").primaryKey(),
  serviceName: varchar("service_name", { length: 64 }).notNull(),
  sloName: varchar("slo_name", { length: 128 }).notNull(),
  metricType: varchar("metric_type", { length: 32 }).notNull(),
  targetValue: decimal("target_value", { precision: 8, scale: 4 }).notNull(),
  measurementWindowDays: integer("measurement_window_days").notNull().default(30),
  alertThreshold: decimal("alert_threshold", { precision: 8, scale: 4 }),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const errorBudgetBurns = pgTable("error_budget_burns", {
  id: serial("id").primaryKey(),
  sloId: integer("slo_id").notNull().references(() => sloDefinitions.id),
  measurementDate: date("measurement_date").notNull(),
  measuredValue: decimal("measured_value", { precision: 12, scale: 4 }).notNull(),
  budgetRemainingPct: decimal("budget_remaining_pct", { precision: 8, scale: 4 }).notNull(),
  burnRate: decimal("burn_rate", { precision: 8, scale: 4 }).notNull(),
  isBreached: boolean("is_breached").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  sloId: integer("slo_id").references(() => sloDefinitions.id),
  title: varchar("title", { length: 256 }).notNull(),
  severity: varchar("severity", { length: 8 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("open"),
  affectedServices: text("affected_services").array(),
  rootCause: text("root_cause"),
  resolution: text("resolution"),
  openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => users.id),
});

// ── 13. CV Damage Assessments ─────────────────────────────────────────────────
export const cvDamageAssessments = pgTable("cv_damage_assessments", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").notNull().references(() => claims.id),
  imageUrl: text("image_url").notNull(),
  damageType: varchar("damage_type", { length: 32 }),
  damageAreas: jsonb("damage_areas"),
  estimatedRepairCost: decimal("estimated_repair_cost", { precision: 15, scale: 2 }),
  confidenceScore: decimal("confidence_score", { precision: 5, scale: 4 }),
  modelVersion: varchar("model_version", { length: 16 }),
  autoApproved: boolean("auto_approved").notNull().default(false),
  reviewedBy: integer("reviewed_by").references(() => users.id),
  assessedAt: timestamp("assessed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 14. Fraud Graph ───────────────────────────────────────────────────────────
export const fraudGraphNodes = pgTable("fraud_graph_nodes", {
  id: serial("id").primaryKey(),
  nodeType: varchar("node_type", { length: 16 }).notNull(),
  nodeId: integer("node_id").notNull(),
  riskScore: decimal("risk_score", { precision: 5, scale: 4 }).notNull().default("0"),
  fraudFlags: text("fraud_flags").array(),
  lastScoredAt: timestamp("last_scored_at", { withTimezone: true }),
});

export const fraudGraphEdges = pgTable("fraud_graph_edges", {
  id: serial("id").primaryKey(),
  fromNodeId: integer("from_node_id").notNull().references(() => fraudGraphNodes.id),
  toNodeId: integer("to_node_id").notNull().references(() => fraudGraphNodes.id),
  edgeType: varchar("edge_type", { length: 32 }).notNull(),
  weight: decimal("weight", { precision: 5, scale: 4 }).notNull().default("1.0"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 15. Voice Claim Transcripts ───────────────────────────────────────────────
export const voiceClaimTranscripts = pgTable("voice_claim_transcripts", {
  id: serial("id").primaryKey(),
  claimId: integer("claim_id").references(() => claims.id),
  customerId: integer("customer_id").notNull().references(() => customers.id),
  audioUrl: text("audio_url"),
  transcript: text("transcript").notNull(),
  language: varchar("language", { length: 8 }).notNull().default("en"),
  intent: varchar("intent", { length: 32 }),
  entities: jsonb("entities"),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── 16. DID / Verifiable Credentials ─────────────────────────────────────────
export const didIdentities = pgTable("did_identities", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull().references(() => customers.id).unique(),
  did: varchar("did", { length: 128 }).unique().notNull(),
  didDocument: jsonb("did_document").notNull(),
  publicKey: text("public_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verifiableCredentials = pgTable("verifiable_credentials", {
  id: serial("id").primaryKey(),
  didId: integer("did_id").notNull().references(() => didIdentities.id),
  credentialType: varchar("credential_type", { length: 32 }).notNull(),
  credentialId: varchar("credential_id", { length: 128 }).unique().notNull(),
  issuer: varchar("issuer", { length: 128 }).notNull(),
  subjectDid: varchar("subject_did", { length: 128 }).notNull(),
  claims: jsonb("claims").notNull(),
  proof: jsonb("proof").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});
