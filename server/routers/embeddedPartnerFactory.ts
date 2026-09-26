/**
 * embeddedPartnerFactory.ts — Q-wave Q1 (2026-09-25)
 *
 * Embedded partner product factory (Turaco/Lami) + freemium ladder
 * (MicroEnsure) + scenario product builder (ZhongAn).
 *
 * Composition over reinvention — this router WRAPS existing flows:
 *   • Quotes ride the EXISTING policy_quotes table + quoteRef contract, so the
 *     standard insuranceWorkflows.bindPolicy / collectPremium path can consume
 *     embedded quotes unchanged (embeddedBind below performs the same
 *     quote-consumption invariants for server-to-server partners that hold no
 *     user JWT — the premium itself is still collected via the EXISTING
 *     insuranceWorkflows.collectPremium path; a bound embedded policy stays
 *     "bound" until then).
 *   • Claims insert into the EXISTING claims table with the same fail-closed
 *     window/amount discipline as insuranceWorkflows.fileClaim.
 *   • Partner API keys are EXISTING api_keys rows whose scopes carry the
 *     anchored "embed:product:<partnerProductId>" pattern (developerPortal
 *     VALID_SCOPES allowlist extension, 2026-09-25). A key can ONLY touch the
 *     partner_products row(s) it is scoped to — fail-closed, denials audited.
 *   • Freemium paid upgrades collect the premium through the EXISTING
 *     airtime/mobile-money collection adapter (server/lib/
 *     mobileMoneyCollection.ts — real HTTP, config-gated, fail-closed).
 *
 * Integration (addendum 2026-09-25):
 *   • Kafka: publishes embedded.policy.bound / embedded.claim.created /
 *     freemium.upgraded via the existing kafkaClient enqueue-and-return path
 *     (no requireAck — notification semantics, rows committed first).
 *   • Fluvio: same events fanned out to embedded-events / freemium-events.
 *   • Permify: partner→product ownership relations written on product
 *     creation via the existing writePermifyRelationship (best-effort, cache-
 *     busting built in). The partner-key endpoints below are server-to-server
 *     (no user subject), so the user-scoped permifyMiddleware
 *     ROUTER_OPERATION_MAP does not fit them — partner scoping is enforced
 *     directly against the key's product scopes (fail-closed + audit).
 *   • Redis: partner-product config reads cached 60s (cacheGet/cacheSet),
 *     invalidated on update (cacheDel).
 *   • Temporal: enrollFreemium starts the FreemiumUpgradeReminderWorkflow
 *     journey via the existing getTemporalClient pattern (graceful null when
 *     Temporal is unavailable — never a funds/authz path).
 *   • Keycloak: NO CHANGE — the existing JWT auth covers partner staff/admin
 *     users; server-to-server partners use the api_keys mechanism above.
 *     (Disclosed per integration addendum.)
 *
 * Sandbox isolation: a partner_products row is either sandbox or live. All
 * quotes/policies/claims written through it inherit the flag in metadata, and
 * partner-scoped reads only ever see rows of the product's OWN mode — a live
 * key can never read sandbox data and vice versa.
 */
import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  apiKeys,
  claims,
  insuranceProducts,
  partnerProducts,
  freemiumTiers,
  freemiumEnrollments,
  scenarioTemplates,
  policies,
  policyQuotes,
} from "../../drizzle/schema";
import { logger } from "../_core/logger";
import {
  adminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "../_core/trpc";
import { getDb } from "../db";
import { writePermifyRelationship } from "../journey-activities-extended";
import { publishEvent } from "../kafkaClient";
import { EMBED_PRODUCT_SCOPE_RE } from "./developerPortal";
import { writeAuditLog } from "../lib/auditLogger";
import { fluvioProduce, FLUVIO_TOPICS } from "../lib/fluvioClient";
import { collectMobileMoneyPremium } from "../lib/mobileMoneyCollection";
import { cacheDel, cacheGet, cacheSet } from "../redisClient";
import { startFreemiumUpgradeReminder } from "../temporal";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMBED_CACHE_TTL_SECONDS = 60;
const embedCacheKey = (id: number) => `embedded:partner-product:${id}`;

function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

const genPolicyNumber = () =>
  `POL-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(8)
    .toString("hex")
    .toUpperCase()}`;
const genClaimNumber = () =>
  `CLM-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(8)
    .toString("hex")
    .toUpperCase()}`;

interface EmbedKeyContext {
  keyId: number;
  userId: number;
  /** partner_products.id values this key may touch (from its scopes). */
  allowedProductIds: number[];
}

/**
 * Authenticate a partner server-to-server call by raw API key.
 * FAIL-CLOSED: unknown/revoked/expired key, or a key with no embed scopes,
 * is rejected; every denial is audit-logged. Constant-shape failure messages
 * (no key-validity oracle).
 */
async function authenticateEmbedKey(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  rawKey: string
): Promise<EmbedKeyContext> {
  const deny = async (reason: string): Promise<never> => {
    await writeAuditLog({
      action: "EMBED_KEY_AUTH_DENIED",
      resource: "api_key",
      status: "failure",
      metadata: { reason, keyHashPrefix: hashApiKey(rawKey).slice(0, 12) },
    });
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid partner credentials" });
  };

  const hash = hashApiKey(rawKey);
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, hash), eq(apiKeys.status, "active")))
    .limit(1);
  if (!key || key.revokedAt) return deny("unknown_or_revoked");
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return deny("expired");

  const scopes = Array.isArray(key.scopes) ? (key.scopes as string[]) : [];
  const allowedProductIds = scopes
    .filter(s => EMBED_PRODUCT_SCOPE_RE.test(s))
    .map(s => Number(s.split(":")[2]))
    .filter(n => Number.isInteger(n) && n > 0);
  if (allowedProductIds.length === 0) return deny("no_embed_scope");

  // Best-effort usage stamp (non-blocking semantics: failure must not break
  // an authenticated call).
  db.update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, key.id))
    .catch(() => {});

  return { keyId: key.id, userId: key.userId, allowedProductIds };
}

/**
 * Load a partner_products row and enforce that the authenticated key is
 * scoped to it. FAIL-CLOSED (cross-partner deny) + audit.
 */
async function requireProductAccess(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  key: EmbedKeyContext,
  partnerProductId: number
) {
  const [product] = await db
    .select()
    .from(partnerProducts)
    .where(eq(partnerProducts.id, partnerProductId))
    .limit(1);
  if (!product || product.status !== "active") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Partner product not found" });
  }
  if (!key.allowedProductIds.includes(partnerProductId)) {
    await writeAuditLog({
      action: "EMBED_CROSS_PRODUCT_DENIED",
      resource: "partner_product",
      resourceId: String(partnerProductId),
      status: "failure",
      metadata: { keyId: key.keyId, allowedProductIds: key.allowedProductIds },
    });
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "API key is not scoped to this partner product",
    });
  }
  return product;
}

/** Fire-and-forget domain event fan-out (Kafka + Fluvio). Never blocks/throws. */
function publishEmbeddedEvent(
  topic: "embedded.policy.bound" | "embedded.claim.created" | "freemium.upgraded",
  key: string,
  payload: Record<string, unknown>
): void {
  const fluvioTopic =
    topic === "freemium.upgraded"
      ? FLUVIO_TOPICS.FREEMIUM_EVENTS
      : FLUVIO_TOPICS.EMBEDDED_EVENTS;
  publishEvent(topic, key, payload).catch(err =>
    logger.warn({ err: (err as Error)?.message, topic }, "[Embedded] Kafka publish failed (fail-open)")
  );
  fluvioProduce({
    topic: fluvioTopic,
    key,
    payload: { eventType: topic, ...payload },
  }).catch(err =>
    logger.warn({ err: (err as Error)?.message, topic }, "[Embedded] Fluvio publish failed (fail-open)")
  );
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const embeddedPartnerFactoryRouter = router({
  /**
   * Register a partner→product embedding config (admin). Returns the partner
   * server key ONCE (only its sha256 hash is stored).
   */
  createPartnerProduct: adminProcedure
    .input(
      z.object({
        partnerCode: z.string().min(3).max(32),
        partnerName: z.string().min(1).max(128),
        productId: z.number().int().positive(),
        maxSumInsured: z.number().positive(),
        commissionRate: z.number().min(0).max(30).default(5),
        branding: z.record(z.string(), z.unknown()).optional(),
        whitelabel: z.boolean().default(false),
        sandbox: z.boolean().default(false),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [product] = await db
        .select({ id: insuranceProducts.id })
        .from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId))
        .limit(1);
      if (!product) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Insurance product not found" });
      }

      const rawKey = `emb_${crypto.randomBytes(32).toString("hex")}`;
      const [row] = await db
        .insert(partnerProducts)
        .values({
          partnerCode: input.partnerCode,
          partnerName: input.partnerName,
          productId: input.productId,
          maxSumInsured: String(input.maxSumInsured),
          commissionRate: String(input.commissionRate),
          branding: input.branding ?? {},
          whitelabel: input.whitelabel,
          sandbox: input.sandbox,
          apiKeyHash: hashApiKey(rawKey),
          createdByUserId: ctx.user.id,
        })
        .returning();

      // Permify: partner→product ownership relation (best-effort; the write
      // path busts cached decisions itself). Fail-open by design here: the
      // fail-closed enforcement point is the DB-scoped key check above.
      writePermifyRelationship({
        entityType: "partner_product",
        entityId: String(row.id),
        relation: "owner",
        subjectType: "partner",
        subjectId: input.partnerCode,
      }).catch(() => {});

      await writeAuditLog({
        action: "PARTNER_PRODUCT_CREATED",
        resource: "partner_product",
        resourceId: String(row.id),
        metadata: { partnerCode: input.partnerCode, productId: input.productId, sandbox: input.sandbox, createdBy: ctx.user.id },
      });

      return { partnerProductId: row.id, partnerCode: row.partnerCode, apiKey: rawKey };
    }),

  /** Update partner product config (admin). Invalidates the Redis cache entry. */
  updatePartnerProduct: adminProcedure
    .input(
      z.object({
        partnerProductId: z.number().int().positive(),
        partnerName: z.string().min(1).max(128).optional(),
        maxSumInsured: z.number().positive().optional(),
        commissionRate: z.number().min(0).max(30).optional(),
        branding: z.record(z.string(), z.unknown()).optional(),
        whitelabel: z.boolean().optional(),
        status: z.enum(["active", "suspended"]).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.partnerName !== undefined) patch.partnerName = input.partnerName;
      if (input.maxSumInsured !== undefined) patch.maxSumInsured = String(input.maxSumInsured);
      if (input.commissionRate !== undefined) patch.commissionRate = String(input.commissionRate);
      if (input.branding !== undefined) patch.branding = input.branding;
      if (input.whitelabel !== undefined) patch.whitelabel = input.whitelabel;
      if (input.status !== undefined) patch.status = input.status;

      const [row] = await db
        .update(partnerProducts)
        .set(patch)
        .where(eq(partnerProducts.id, input.partnerProductId))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Partner product not found" });

      await cacheDel(embedCacheKey(input.partnerProductId));
      await writeAuditLog({
        action: "PARTNER_PRODUCT_UPDATED",
        resource: "partner_product",
        resourceId: String(row.id),
        metadata: { patch: Object.keys(patch).filter(k => k !== "updatedAt"), updatedBy: ctx.user.id },
      });
      return { updated: true, partnerProductId: row.id };
    }),

  /**
   * Partner-product config lookup — Redis-cached 60s (addendum: cache layer).
   * Cache failures degrade to a direct DB read (TTL bounds staleness).
   */
  getPartnerProduct: protectedProcedure
    .input(z.object({ partnerProductId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const cached = await cacheGet(embedCacheKey(input.partnerProductId));
      if (cached) {
        try {
          return JSON.parse(cached) as Record<string, unknown>;
        } catch {
          // Corrupt cache entry — fall through to DB and refresh.
        }
      }

      const [row] = await db
        .select({
          id: partnerProducts.id,
          partnerCode: partnerProducts.partnerCode,
          partnerName: partnerProducts.partnerName,
          productId: partnerProducts.productId,
          maxSumInsured: partnerProducts.maxSumInsured,
          commissionRate: partnerProducts.commissionRate,
          branding: partnerProducts.branding,
          whitelabel: partnerProducts.whitelabel,
          sandbox: partnerProducts.sandbox,
          status: partnerProducts.status,
        })
        .from(partnerProducts)
        .where(eq(partnerProducts.id, input.partnerProductId))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Partner product not found" });

      // Never cache the apiKeyHash — it is intentionally not selected above.
      await cacheSet(embedCacheKey(input.partnerProductId), JSON.stringify(row), EMBED_CACHE_TTL_SECONDS);
      return row;
    }),

  /** List partner products (admin overview; bounded). */
  listPartnerProducts: adminProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select({
        id: partnerProducts.id,
        partnerCode: partnerProducts.partnerCode,
        partnerName: partnerProducts.partnerName,
        productId: partnerProducts.productId,
        sandbox: partnerProducts.sandbox,
        status: partnerProducts.status,
        createdAt: partnerProducts.createdAt,
      })
      .from(partnerProducts)
      .orderBy(desc(partnerProducts.createdAt))
      .limit(500);
  }),

  /**
   * Issue a product-scoped embed key ("embed:product:<id>") for a partner.
   * FAIL-CLOSED partner scoping: admins may issue for any product; a
   * non-admin caller may only issue for products THEY created (partner self-
   * service). Denials are audited. The raw key is shown once.
   */
  issueEmbedKey: protectedProcedure
    .input(
      z.object({
        partnerProductId: z.number().int().positive(),
        name: z.string().min(1).max(128),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [product] = await db
        .select()
        .from(partnerProducts)
        .where(eq(partnerProducts.id, input.partnerProductId))
        .limit(1);
      if (!product || product.status !== "active") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Partner product not found" });
      }

      const isAdmin = ctx.user.role === "admin";
      if (!isAdmin && product.createdByUserId !== ctx.user.id) {
        await writeAuditLog({
          action: "EMBED_KEY_ISSUE_DENIED",
          resource: "partner_product",
          resourceId: String(input.partnerProductId),
          status: "failure",
          metadata: { userId: ctx.user.id, ownerUserId: product.createdByUserId },
        });
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "You can only issue embed keys for your own partner products",
        });
      }

      const raw = `54lk_${crypto.randomBytes(32).toString("hex")}`;
      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000)
        : null;
      const [key] = await db
        .insert(apiKeys)
        .values({
          keyHash: hashApiKey(raw),
          keyPrefix: raw.slice(0, 12),
          name: input.name,
          description: `Embed key for partner product ${input.partnerProductId} (${product.partnerCode})`,
          userId: ctx.user.id,
          tenantId: ctx.user.tenantId ?? null,
          status: "active",
          scopes: [`embed:product:${input.partnerProductId}`],
          rateLimit: 1000,
          expiresAt,
        })
        .returning();

      await writeAuditLog({
        action: "EMBED_KEY_ISSUED",
        resource: "api_key",
        resourceId: String(key.id),
        metadata: { partnerProductId: input.partnerProductId, issuedBy: ctx.user.id },
      });
      return { keyId: key.id, rawKey: raw, scopes: [`embed:product:${input.partnerProductId}`] };
    }),

  /**
   * Embedded quote (partner server-to-server). Creates a REAL policy_quotes
   * row consumable by the standard bind path. Pricing: embedded micro-covers
   * are flat-priced at the product's regulatory-filed minPremium (disclosed
   * 2026-09-25: rating-engine/dynamicPricing integration is a follow-up; no
   * premium is ever caller-supplied).
   */
  embeddedQuote: publicProcedure
    .input(
      z.object({
        apiKey: z.string().min(32).max(128),
        partnerProductId: z.number().int().positive(),
        customerId: z.number().int().positive(),
        sumInsured: z.number().positive(),
        durationMonths: z.number().int().min(1).max(12).default(1),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const key = await authenticateEmbedKey(db, input.apiKey);
      const partnerProduct = await requireProductAccess(db, key, input.partnerProductId);

      const [product] = await db
        .select()
        .from(insuranceProducts)
        .where(eq(insuranceProducts.id, partnerProduct.productId))
        .limit(1);
      if (!product || !product.isActive) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Underlying insurance product is not active" });
      }

      // Fail-closed limit enforcement: the smaller of the partner cap and the
      // product's regulatory max coverage.
      const caps = [Number(partnerProduct.maxSumInsured)];
      if (product.maxCoverageAmount != null) caps.push(Number(product.maxCoverageAmount));
      const maxAllowed = Math.min(...caps);
      if (input.sumInsured > maxAllowed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `sumInsured exceeds the allowed maximum of ${maxAllowed} for this embedded product`,
        });
      }

      const premium = Number(product.minPremium ?? 0);
      if (!(premium > 0)) {
        // Fail-closed for funds: never quote an unpriced product.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Underlying product has no filed premium — refusing to quote",
        });
      }

      const quoteRef = `EMBQ-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
      const validUntil = new Date(Date.now() + 24 * 3_600_000);
      const [quote] = await db
        .insert(policyQuotes)
        .values({
          customerId: input.customerId,
          productId: product.id,
          productName: product.name,
          productType: product.coverageType,
          sumInsured: String(input.sumInsured),
          premiumAmount: String(premium),
          stampDuty: "0",
          totalPayable: String(premium),
          durationMonths: input.durationMonths,
          coverageType: product.coverageType,
          status: "pending",
          validUntil,
          metadata: {
            quoteRef,
            channel: "embedded",
            partnerProductId: partnerProduct.id,
            partnerCode: partnerProduct.partnerCode,
            sandbox: partnerProduct.sandbox,
          },
        })
        .returning();

      return {
        quoteRef,
        quoteId: quote.id,
        premiumAmount: premium,
        sumInsured: input.sumInsured,
        sandbox: partnerProduct.sandbox,
        validUntil: validUntil.toISOString(),
      };
    }),

  /**
   * Embedded bind (partner server-to-server). Performs the SAME quote-
   * consumption invariants as insuranceWorkflows.bindPolicy (real pending
   * quote, ownership, expiry, premium/sumInsured from the quote only) plus
   * partner-scope enforcement. The policy binds as "bound"; activation still
   * requires premium collection through the EXISTING collectPremium path —
   * this endpoint never marks cover active without collected premium.
   */
  embeddedBind: publicProcedure
    .input(
      z.object({
        apiKey: z.string().min(32).max(128),
        quoteRef: z.string().min(8).max(64),
        startDate: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const key = await authenticateEmbedKey(db, input.apiKey);

      const [quote] = await db
        .select()
        .from(policyQuotes)
        .where(sql`${policyQuotes.metadata}::jsonb ->> 'quoteRef' = ${input.quoteRef}`)
        .limit(1);
      if (!quote) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Unknown quoteRef '${input.quoteRef}'` });
      }
      const meta = (quote.metadata ?? {}) as Record<string, unknown>;
      const partnerProductId = Number(meta.partnerProductId);
      if (!Number.isInteger(partnerProductId)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Quote is not an embedded quote" });
      }
      // Cross-partner deny (fail-closed + audit inside requireProductAccess).
      const partnerProduct = await requireProductAccess(db, key, partnerProductId);

      if (quote.status !== "pending") {
        throw new TRPCError({ code: "CONFLICT", message: `QUOTE_CONSUMED: quote '${input.quoteRef}' is no longer pending (status: ${quote.status})` });
      }
      if (quote.validUntil && new Date(quote.validUntil) < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Quote '${input.quoteRef}' has expired` });
      }
      const quoteSumInsured = Number(quote.sumInsured ?? NaN);
      const quotePremium = Number(quote.premiumAmount ?? NaN);
      if (!(quoteSumInsured > 0) || !(quotePremium > 0)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Quote '${input.quoteRef}' has no recorded sumInsured/premium — refusing to bind (fail-closed for funds)`,
        });
      }

      const startDate = new Date(input.startDate);
      if (Number.isNaN(startDate.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid startDate" });
      }
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + (quote.durationMonths ?? 1));

      let policy;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          [policy] = await db
            .insert(policies)
            .values({
              policyNumber: genPolicyNumber(),
              productId: quote.productId ?? partnerProduct.productId,
              customerId: quote.customerId!,
              status: "bound",
              coverageType: (quote.coverageType ?? "micro") as never,
              sumInsured: String(quoteSumInsured),
              annualPremium: String(quotePremium),
              startDate,
              endDate,
              metadata: {
                channel: "embedded",
                partnerProductId,
                partnerCode: partnerProduct.partnerCode,
                sandbox: partnerProduct.sandbox,
                quoteRef: input.quoteRef,
              },
            })
            .returning();
          break;
        } catch (err) {
          // policy_number unique collision — retry once with fresh entropy.
          if (attempt === 1) throw err;
        }
      }
      if (!policy) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Policy number allocation failed" });
      }

      await db
        .update(policyQuotes)
        .set({ status: "bound", updatedAt: new Date() })
        .where(eq(policyQuotes.id, quote.id));

      await writeAuditLog({
        action: "EMBEDDED_POLICY_BOUND",
        resource: "policy",
        resourceId: String(policy.id),
        metadata: {
          partnerProductId,
          partnerCode: partnerProduct.partnerCode,
          quoteRef: input.quoteRef,
          keyId: key.keyId,
          sandbox: partnerProduct.sandbox,
        },
      });

      publishEmbeddedEvent("embedded.policy.bound", policy.policyNumber, {
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        partnerProductId,
        partnerCode: partnerProduct.partnerCode,
        customerId: quote.customerId,
        sumInsured: quoteSumInsured,
        premium: quotePremium,
        sandbox: partnerProduct.sandbox,
      });

      return {
        policyId: policy.id,
        policyNumber: policy.policyNumber,
        status: "bound",
        premiumDue: quotePremium,
        sandbox: partnerProduct.sandbox,
      };
    }),

  /**
   * Embedded claim (partner server-to-server). Inserts into the EXISTING
   * claims table with the fileClaim discipline: policy must be active, amount
   * is validated server-side against the policy schedule AND the partner cap.
   */
  embeddedClaim: publicProcedure
    .input(
      z.object({
        apiKey: z.string().min(32).max(128),
        policyId: z.number().int().positive(),
        claimType: z.string().min(1).max(64),
        incidentDate: z.string(),
        claimedAmount: z.number().positive(),
        incidentDescription: z.string().min(1).max(4000),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const key = await authenticateEmbedKey(db, input.apiKey);

      const [policy] = await db
        .select()
        .from(policies)
        .where(eq(policies.id, input.policyId))
        .limit(1);
      if (!policy) throw new TRPCError({ code: "NOT_FOUND", message: "Policy not found" });

      const meta = (policy.metadata ?? {}) as Record<string, unknown>;
      const partnerProductId = Number(meta.partnerProductId);
      if (!Number.isInteger(partnerProductId) || meta.channel !== "embedded") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Policy is not an embedded policy" });
      }
      const partnerProduct = await requireProductAccess(db, key, partnerProductId);

      if (policy.status !== "active") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Policy is not active" });
      }

      const incidentDate = new Date(input.incidentDate);
      if (Number.isNaN(incidentDate.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid incidentDate" });
      }
      if (policy.startDate && incidentDate < policy.startDate) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Incident predates policy start" });
      }
      if (incidentDate > new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Incident date cannot be in the future" });
      }

      const maxClaim = Math.min(Number(policy.sumInsured), Number(partnerProduct.maxSumInsured));
      if (input.claimedAmount > maxClaim) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `claimedAmount exceeds the covered maximum of ${maxClaim}`,
        });
      }

      const [claim] = await db
        .insert(claims)
        .values({
          claimNumber: genClaimNumber(),
          policyId: policy.id,
          claimantId: policy.customerId,
          status: "submitted",
          claimType: input.claimType,
          incidentDate,
          claimedAmount: String(input.claimedAmount),
          incidentDescription: input.incidentDescription,
          metadata: {
            channel: "embedded",
            partnerProductId,
            partnerCode: partnerProduct.partnerCode,
            sandbox: partnerProduct.sandbox,
          },
        })
        .returning();

      await writeAuditLog({
        action: "EMBEDDED_CLAIM_CREATED",
        resource: "claim",
        resourceId: String(claim.id),
        metadata: { partnerProductId, policyId: policy.id, keyId: key.keyId },
      });

      publishEmbeddedEvent("embedded.claim.created", claim.claimNumber, {
        claimId: claim.id,
        claimNumber: claim.claimNumber,
        policyId: policy.id,
        partnerProductId,
        partnerCode: partnerProduct.partnerCode,
        claimedAmount: input.claimedAmount,
        sandbox: partnerProduct.sandbox,
      });

      return { claimId: claim.id, claimNumber: claim.claimNumber, status: "submitted" };
    }),

  /**
   * Partner-scoped policy listing. Sandbox isolation is structural: a key
   * only sees rows of ITS product(s), and each product has a fixed mode.
   */
  embeddedListPolicies: publicProcedure
    .input(
      z.object({
        apiKey: z.string().min(32).max(128),
        partnerProductId: z.number().int().positive(),
        limit: z.number().int().min(1).max(200).default(50),
      })
    )
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      const key = await authenticateEmbedKey(db, input.apiKey);
      await requireProductAccess(db, key, input.partnerProductId);

      return db
        .select({
          id: policies.id,
          policyNumber: policies.policyNumber,
          customerId: policies.customerId,
          status: policies.status,
          sumInsured: policies.sumInsured,
          annualPremium: policies.annualPremium,
          startDate: policies.startDate,
          endDate: policies.endDate,
          createdAt: policies.createdAt,
        })
        .from(policies)
        .where(
          sql`${policies.metadata}::jsonb ->> 'partnerProductId' = ${String(input.partnerProductId)}`
        )
        .orderBy(desc(policies.createdAt))
        .limit(input.limit);
    }),

  // ── Freemium ladder (MicroEnsure) ─────────────────────────────────────────

  /** Define a freemium tier (admin). */
  createFreemiumTier: adminProcedure
    .input(
      z.object({
        tierCode: z.string().min(2).max(32),
        name: z.string().min(1).max(128),
        productId: z.number().int().positive(),
        monthlyPremium: z.number().min(0),
        sumInsured: z.number().positive(),
        coverageType: z.string().min(1).max(64),
        isFree: z.boolean().default(false),
        sortOrder: z.number().int().min(0).default(0),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [product] = await db
        .select({ id: insuranceProducts.id })
        .from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Insurance product not found" });
      if (input.isFree && input.monthlyPremium !== 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "A free tier must have zero premium" });
      }

      const [tier] = await db
        .insert(freemiumTiers)
        .values({
          tierCode: input.tierCode,
          name: input.name,
          productId: input.productId,
          monthlyPremium: String(input.monthlyPremium),
          sumInsured: String(input.sumInsured),
          coverageType: input.coverageType,
          isFree: input.isFree,
          sortOrder: input.sortOrder,
        })
        .returning();

      await writeAuditLog({
        action: "FREEMIUM_TIER_CREATED",
        resource: "freemium_tier",
        resourceId: String(tier.id),
        metadata: { tierCode: input.tierCode, createdBy: ctx.user.id },
      });
      return { tierId: tier.id, tierCode: tier.tierCode };
    }),

  /**
   * Enroll the caller onto a FREE tier (paid tiers go through
   * upgradeFreemium). Creates the free-cover policy immediately (zero
   * premium, status active) and starts the Temporal upgrade-reminder journey
   * (best-effort; enrollment is committed first).
   */
  enrollFreemium: protectedProcedure
    .input(z.object({ tierId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [tier] = await db
        .select()
        .from(freemiumTiers)
        .where(eq(freemiumTiers.id, input.tierId))
        .limit(1);
      if (!tier || !tier.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Tier not found" });
      if (!tier.isFree) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Paid tiers require the upgrade path (premium collection)" });
      }

      const [existing] = await db
        .select({ id: freemiumEnrollments.id })
        .from(freemiumEnrollments)
        .where(
          and(
            eq(freemiumEnrollments.customerId, ctx.user.id),
            eq(freemiumEnrollments.status, "active")
          )
        )
        .limit(1);
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Customer already has an active freemium enrollment" });
      }

      const startDate = new Date();
      const endDate = new Date(startDate);
      endDate.setFullYear(endDate.getFullYear() + 1);
      const [policy] = await db
        .insert(policies)
        .values({
          policyNumber: genPolicyNumber(),
          productId: tier.productId,
          customerId: ctx.user.id,
          status: "active", // zero-premium free cover — no collection needed
          coverageType: tier.coverageType as never,
          sumInsured: String(tier.sumInsured),
          annualPremium: "0",
          startDate,
          endDate,
          metadata: { channel: "freemium", tierId: tier.id, tierCode: tier.tierCode },
        })
        .returning();

      const [enrollment] = await db
        .insert(freemiumEnrollments)
        .values({
          customerId: ctx.user.id,
          tierId: tier.id,
          policyId: policy.id,
          status: "active",
        })
        .returning();

      await writeAuditLog({
        action: "FREEMIUM_ENROLLED",
        resource: "freemium_enrollment",
        resourceId: String(enrollment.id),
        metadata: { customerId: ctx.user.id, tierId: tier.id, policyId: policy.id },
      });

      // Temporal journey hook (graceful null when Temporal is unavailable).
      startFreemiumUpgradeReminder({
        enrollmentId: enrollment.id,
        customerId: ctx.user.id,
      }).catch(() => {});

      return { enrollmentId: enrollment.id, policyId: policy.id, tierCode: tier.tierCode };
    }),

  /**
   * Upgrade an enrollment to the next PAID tier. Premium is collected FIRST
   * via the airtime/mobile-money adapter (config-gated, fail-closed): if the
   * collection does not explicitly succeed, the enrollment stays on its
   * current tier and NO paid cover is activated.
   */
  upgradeFreemium: protectedProcedure
    .input(
      z.object({
        enrollmentId: z.number().int().positive(),
        targetTierId: z.number().int().positive(),
        msisdn: z.string().min(8).max(20),
        channel: z.enum(["airtime", "mobile_money"]).default("mobile_money"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [enrollment] = await db
        .select()
        .from(freemiumEnrollments)
        .where(eq(freemiumEnrollments.id, input.enrollmentId))
        .limit(1);
      if (!enrollment || enrollment.status !== "active") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Enrollment not found" });
      }
      // IDOR guard (fail-closed): only the enrolled customer may upgrade it.
      if (enrollment.customerId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You can only upgrade your own enrollment" });
      }

      const [currentTier] = await db
        .select()
        .from(freemiumTiers)
        .where(eq(freemiumTiers.id, enrollment.tierId))
        .limit(1);
      const [targetTier] = await db
        .select()
        .from(freemiumTiers)
        .where(eq(freemiumTiers.id, input.targetTierId))
        .limit(1);
      if (!currentTier || !targetTier || !targetTier.isActive) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Tier not found" });
      }
      if (
        targetTier.productId !== currentTier.productId ||
        targetTier.sortOrder <= currentTier.sortOrder ||
        targetTier.isFree
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target must be a higher PAID tier of the same product",
        });
      }

      const premium = Number(targetTier.monthlyPremium);
      const reference = `FREEMIUM-UPG-${enrollment.id}-${targetTier.id}-${crypto.randomBytes(4).toString("hex")}`;
      const collection = await collectMobileMoneyPremium({
        msisdn: input.msisdn,
        amount: premium,
        currency: "NGN",
        reference,
        channel: input.channel,
        narration: `Freemium upgrade to ${targetTier.name}`,
      });
      if (!collection.success) {
        // FAIL-CLOSED: no paid cover without a collected premium.
        await writeAuditLog({
          action: "FREEMIUM_UPGRADE_DECLINED",
          resource: "freemium_enrollment",
          resourceId: String(enrollment.id),
          status: "failure",
          metadata: { reason: collection.reason, targetTierId: targetTier.id },
        });
        return { upgraded: false as const, reason: collection.reason, message: collection.message };
      }

      const startDate = new Date();
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + 1);
      const [policy] = await db
        .insert(policies)
        .values({
          policyNumber: genPolicyNumber(),
          productId: targetTier.productId,
          customerId: ctx.user.id,
          status: "active", // premium collected above
          coverageType: targetTier.coverageType as never,
          sumInsured: String(targetTier.sumInsured),
          annualPremium: String(premium * 12),
          startDate,
          endDate,
          metadata: {
            channel: "freemium",
            tierId: targetTier.id,
            tierCode: targetTier.tierCode,
            upgradedFromEnrollment: enrollment.id,
            collectionRef: collection.providerRef,
          },
        })
        .returning();

      await db
        .update(freemiumEnrollments)
        .set({ tierId: targetTier.id, policyId: policy.id, upgradedAt: new Date() })
        .where(eq(freemiumEnrollments.id, enrollment.id));

      await writeAuditLog({
        action: "FREEMIUM_UPGRADED",
        resource: "freemium_enrollment",
        resourceId: String(enrollment.id),
        metadata: {
          customerId: ctx.user.id,
          fromTierId: currentTier.id,
          toTierId: targetTier.id,
          premium,
          providerRef: collection.providerRef,
        },
      });

      publishEmbeddedEvent("freemium.upgraded", reference, {
        enrollmentId: enrollment.id,
        customerId: ctx.user.id,
        fromTier: currentTier.tierCode,
        toTier: targetTier.tierCode,
        premium,
        providerRef: collection.providerRef,
      });

      return { upgraded: true as const, policyId: policy.id, tierCode: targetTier.tierCode, providerRef: collection.providerRef };
    }),

  /** List active freemium tiers (public catalogue). */
  listFreemiumTiers: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(freemiumTiers)
      .where(eq(freemiumTiers.isActive, true))
      .orderBy(freemiumTiers.sortOrder)
      .limit(100);
  }),

  // ── Scenario product builder (ZhongAn) ────────────────────────────────────

  /** Define an event-bound small-ticket scenario template (admin). */
  createScenarioTemplate: adminProcedure
    .input(
      z.object({
        templateCode: z.string().min(2).max(32),
        name: z.string().min(1).max(128),
        productId: z.number().int().positive(),
        triggerEvent: z.string().min(1).max(64),
        coverageType: z.string().min(1).max(64),
        sumInsured: z.number().positive(),
        premiumAmount: z.number().positive(),
        durationHours: z.number().int().min(1).max(720).default(24),
        terms: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [product] = await db
        .select({ id: insuranceProducts.id })
        .from(insuranceProducts)
        .where(eq(insuranceProducts.id, input.productId))
        .limit(1);
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "Insurance product not found" });

      const [tpl] = await db
        .insert(scenarioTemplates)
        .values({
          templateCode: input.templateCode,
          name: input.name,
          productId: input.productId,
          triggerEvent: input.triggerEvent,
          coverageType: input.coverageType,
          sumInsured: String(input.sumInsured),
          premiumAmount: String(input.premiumAmount),
          durationHours: input.durationHours,
          terms: input.terms ?? {},
        })
        .returning();

      await writeAuditLog({
        action: "SCENARIO_TEMPLATE_CREATED",
        resource: "scenario_template",
        resourceId: String(tpl.id),
        metadata: { templateCode: input.templateCode, createdBy: ctx.user.id },
      });
      return { templateId: tpl.id, templateCode: tpl.templateCode };
    }),

  /**
   * Instantiate a scenario cover for the caller: creates a REAL pending
   * policy_quotes row (scenario-priced by the template, never the caller)
   * with a short validity window; the standard bind path takes it from
   * there. Returns the quoteRef.
   */
  instantiateScenario: protectedProcedure
    .input(z.object({ templateCode: z.string().min(2).max(32) }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB unavailable" });

      const [tpl] = await db
        .select()
        .from(scenarioTemplates)
        .where(eq(scenarioTemplates.templateCode, input.templateCode))
        .limit(1);
      if (!tpl || !tpl.isActive) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scenario template not found" });
      }

      const quoteRef = `SCNQ-${crypto.randomBytes(8).toString("hex").toUpperCase()}`;
      const validUntil = new Date(Date.now() + tpl.durationHours * 3_600_000);
      const [quote] = await db
        .insert(policyQuotes)
        .values({
          customerId: ctx.user.id,
          productId: tpl.productId,
          productName: tpl.name,
          productType: tpl.coverageType,
          sumInsured: String(tpl.sumInsured),
          premiumAmount: String(tpl.premiumAmount),
          stampDuty: "0",
          totalPayable: String(tpl.premiumAmount),
          durationMonths: 1,
          coverageType: tpl.coverageType,
          status: "pending",
          validUntil,
          metadata: {
            quoteRef,
            channel: "scenario",
            scenarioTemplateId: tpl.id,
            triggerEvent: tpl.triggerEvent,
            durationHours: tpl.durationHours,
          },
        })
        .returning();

      await writeAuditLog({
        action: "SCENARIO_INSTANTIATED",
        resource: "scenario_template",
        resourceId: String(tpl.id),
        metadata: { customerId: ctx.user.id, quoteRef },
      });

      return {
        quoteRef,
        quoteId: quote.id,
        premiumAmount: Number(tpl.premiumAmount),
        sumInsured: Number(tpl.sumInsured),
        triggerEvent: tpl.triggerEvent,
        validUntil: validUntil.toISOString(),
      };
    }),

  /** List active scenario templates (public catalogue). */
  listScenarioTemplates: publicProcedure.query(async () => {
    const db = await getDb();
    if (!db) return [];
    return db
      .select()
      .from(scenarioTemplates)
      .where(eq(scenarioTemplates.isActive, true))
      .orderBy(desc(scenarioTemplates.createdAt))
      .limit(100);
  }),
});
