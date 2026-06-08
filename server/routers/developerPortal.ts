/**
 * developerPortal.ts — P3-C Developer Portal Router
 *
 * Provides API key management for third-party developers integrating with InsurePortal.
 *
 * Procedures:
 *  - devPortal.createKey    — create a new API key (protected)
 *  - devPortal.listKeys     — list own API keys (protected)
 *  - devPortal.revokeKey    — revoke an API key (protected)
 *  - devPortal.rotateKey    — rotate (replace) an API key (protected)
 *  - devPortal.getUsage     — get usage stats for a key (protected)
 *  - devPortal.validateKey  — validate a raw API key (public, for gateway use)
 */
import crypto from "crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { eq, and, isNull, desc, gte, count, sql } from "drizzle-orm";
import { getDb } from "../db";
import { apiKeys, webhookSecrets, apiKeyUsage } from "../../drizzle/schema";
import { router, protectedProcedure } from "../_core/trpc";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_SCOPES = [
  "transactions:read",
  "transactions:write",
  "agents:read",
  "agents:write",
  "settlements:read",
  "disputes:read",
  "disputes:write",
  "analytics:read",
  "kyc:read",
  "webhooks:manage",
] as const;

type ApiScope = (typeof VALID_SCOPES)[number];

/**
 * Generate a new API key in the format: 54lk_{prefix}_{random}
 * Returns both the raw key (shown once) and its SHA-256 hash for storage.
 */
function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const randomBytes = crypto.randomBytes(32).toString("hex");
  const raw = `54lk_${randomBytes}`;
  const prefix = raw.slice(0, 12); // "54lk_" + 7 chars
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash, prefix };
}

/**
 * Hash a raw API key for lookup.
 */
function hashApiKey(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const developerPortalRouter = router({
  /**
   * Create a new API key.
   * Returns the raw key ONCE — it cannot be retrieved again.
   */
  createKey: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(128),
        description: z.string().max(512).optional(),
        scopes: z
          .array(z.enum(VALID_SCOPES))
          .min(1)
          .max(VALID_SCOPES.length)
          .default(["transactions:read"]),
        rateLimit: z.number().int().min(100).max(100_000).default(1_000),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Limit: max 10 active keys per user
        const existingKeys = await db
          .select({ id: apiKeys.id })
          .from(apiKeys)
          .where(
            and(
              eq(apiKeys.userId, ctx.user.id),
              eq(apiKeys.status, "active"),
              isNull(apiKeys.revokedAt)
            )
          );

        if (existingKeys.length >= 10) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Maximum of 10 active API keys allowed. Revoke an existing key first.",
          });
        }

        const { raw, hash, prefix } = generateApiKey();
        const expiresAt = input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86_400_000)
          : null;

        const inserted = await db
          .insert(apiKeys)
          .values({
            keyHash: hash,
            keyPrefix: prefix,
            name: input.name,
            description: input.description,
            userId: ctx.user.id,
            tenantId: ctx.user.tenantId ?? null,
            status: "active",
            scopes: input.scopes as string[],
            rateLimit: input.rateLimit,
            expiresAt: expiresAt ?? undefined,
            createdAt: new Date(),
          })
          .returning({
            id: apiKeys.id,
            keyPrefix: apiKeys.keyPrefix,
            createdAt: apiKeys.createdAt,
          });

        return {
          success: true,
          id: inserted[0].id,
          keyPrefix: inserted[0].keyPrefix,
          rawKey: raw, // ⚠️ Shown ONCE — store it securely
          name: input.name,
          scopes: input.scopes,
          rateLimit: input.rateLimit,
          expiresAt: expiresAt?.toISOString() ?? null,
          createdAt: inserted[0].createdAt,
          warning:
            "This is the only time your API key will be shown. Copy it now.",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /**
   * List all API keys for the authenticated user (without raw key values).
   */
  listKeys: protectedProcedure.query(async ({ ctx }) => {
    try {
      const db = (await getDb())!;
      if (!db) return { keys: [] };

      const rows = await db
        .select({
          id: apiKeys.id,
          keyPrefix: apiKeys.keyPrefix,
          name: apiKeys.name,
          description: apiKeys.description,
          status: apiKeys.status,
          scopes: apiKeys.scopes,
          rateLimit: apiKeys.rateLimit,
          lastUsedAt: apiKeys.lastUsedAt,
          expiresAt: apiKeys.expiresAt,
          createdAt: apiKeys.createdAt,
          revokedAt: apiKeys.revokedAt,
        })
        .from(apiKeys)
        .where(eq(apiKeys.userId, ctx.user.id))
        .orderBy(desc(apiKeys.createdAt));

      return { keys: rows };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  /**
   * Revoke an API key.
   */
  revokeKey: protectedProcedure
    .input(z.object({ keyId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Verify ownership
        const [key] = await db
          .select({ id: apiKeys.id, userId: apiKeys.userId })
          .from(apiKeys)
          .where(eq(apiKeys.id, input.keyId))
          .limit(1);

        if (!key)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "API key not found",
          });
        if (key.userId !== ctx.user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "You do not own this API key",
          });
        }

        await db
          .update(apiKeys)
          .set({ status: "revoked", revokedAt: new Date() })
          .where(eq(apiKeys.id, input.keyId));

        return { success: true, message: "API key revoked successfully" };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /**
   * Rotate an API key: revoke the old one and create a new one with the same settings.
   * Returns the new raw key ONCE.
   */
  rotateKey: protectedProcedure
    .input(z.object({ keyId: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Verify ownership
        const [oldKey] = await db
          .select()
          .from(apiKeys)
          .where(
            and(eq(apiKeys.id, input.keyId), eq(apiKeys.userId, ctx.user.id))
          )
          .limit(1);

        if (!oldKey)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "API key not found or not owned by you",
          });

        const { raw, hash, prefix } = generateApiKey();

        // Revoke old key
        await db
          .update(apiKeys)
          .set({ status: "revoked", revokedAt: new Date() })
          .where(eq(apiKeys.id, input.keyId));

        // Create new key with same settings
        const inserted = await db
          .insert(apiKeys)
          .values({
            keyHash: hash,
            keyPrefix: prefix,
            name: oldKey.name + " (rotated)",
            description: oldKey.description,
            userId: ctx.user.id,
            tenantId: oldKey.tenantId,
            status: "active",
            scopes: oldKey.scopes,
            rateLimit: oldKey.rateLimit,
            expiresAt: oldKey.expiresAt,
            createdAt: new Date(),
          })
          .returning({ id: apiKeys.id });

        return {
          success: true,
          newKeyId: inserted[0].id,
          newKeyPrefix: prefix,
          rawKey: raw, // ⚠️ Shown ONCE
          warning:
            "Old key has been revoked. This is the only time your new API key will be shown.",
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /**
   * Validate a raw API key (for use by the API gateway / middleware).
   * Returns key metadata if valid, throws UNAUTHORIZED if not.
   */
  validateKey: protectedProcedure
    .input(z.object({ rawKey: z.string().min(1) }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const hash = hashApiKey(input.rawKey);

        const [key] = await db
          .select({
            id: apiKeys.id,
            keyPrefix: apiKeys.keyPrefix,
            name: apiKeys.name,
            userId: apiKeys.userId,
            tenantId: apiKeys.tenantId,
            status: apiKeys.status,
            scopes: apiKeys.scopes,
            rateLimit: apiKeys.rateLimit,
            expiresAt: apiKeys.expiresAt,
            revokedAt: apiKeys.revokedAt,
          })
          .from(apiKeys)
          .where(eq(apiKeys.keyHash, hash))
          .limit(1);

        if (!key)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid API key",
          });
        if (key.status !== "active" || key.revokedAt) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "API key has been revoked",
          });
        }
        if (key.expiresAt && key.expiresAt < new Date()) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "API key has expired",
          });
        }

        // Update lastUsedAt (fire-and-forget)
        db.update(apiKeys)
          .set({ lastUsedAt: new Date() })
          .where(eq(apiKeys.id, key.id))
          .catch((e: unknown) =>
            console.error("[DevPortal] lastUsedAt update failed:", e)
          );

        return {
          valid: true,
          keyId: key.id,
          keyPrefix: key.keyPrefix,
          userId: key.userId,
          tenantId: key.tenantId,
          scopes: key.scopes,
          rateLimit: key.rateLimit,
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── webhookSecrets CRUD ──────────────────────────────────────────────────
  listWebhookSecrets: protectedProcedure.query(async ({ ctx }) => {
    try {
      if (ctx.user.role !== "admin") throw new TRPCError({ code: "FORBIDDEN" });
      const db = (await getDb())!;
      if (!db) throw new Error("Database connection unavailable");
      return db
        .select({
          id: webhookSecrets.id,
          integrationName: webhookSecrets.integrationName,
          algorithm: webhookSecrets.algorithm,
          isActive: webhookSecrets.isActive,
          lastRotatedAt: webhookSecrets.lastRotatedAt,
          createdAt: webhookSecrets.createdAt,
        })
        .from(webhookSecrets)
        .orderBy(desc(webhookSecrets.createdAt))
        .limit(100);
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  }),

  createWebhookSecret: protectedProcedure
    .input(
      z.object({
        integrationName: z.string().min(1).max(64),
        algorithm: z.enum(["sha256", "sha512"]).default("sha256"),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const secret = crypto.randomBytes(32).toString("hex");
        const [row] = await db
          .insert(webhookSecrets)
          .values({
            integrationName: input.integrationName,
            secret,
            algorithm: input.algorithm,
            isActive: true,
            lastRotatedAt: new Date(),
          })
          .returning();
        return { ...row, secret };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  rotateWebhookSecret: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        const newSecret = crypto.randomBytes(32).toString("hex");
        const [row] = await db
          .update(webhookSecrets)
          .set({ secret: newSecret, lastRotatedAt: new Date() })
          .where(eq(webhookSecrets.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: "NOT_FOUND" });
        return { ...row, secret: newSecret };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  toggleWebhookSecret: protectedProcedure
    .input(z.object({ id: z.number(), isActive: z.boolean() }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db
          .update(webhookSecrets)
          .set({ isActive: input.isActive })
          .where(eq(webhookSecrets.id, input.id));
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  deleteWebhookSecret: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        if (ctx.user.role !== "admin")
          throw new TRPCError({ code: "FORBIDDEN" });
        const db = (await getDb())!;
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
        await db.delete(webhookSecrets).where(eq(webhookSecrets.id, input.id));
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── apiKeyUsage CRUD ──────────────────────────────────────────────────────
  getApiKeyUsage: protectedProcedure
    .input(
      z.object({
        apiKeyId: z.number(),
        limit: z.number().min(1).max(500).default(100),
        offset: z.number().min(0).default(0),
        since: z.date().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database connection unavailable");
        const conditions: ReturnType<typeof eq>[] = [
          eq(apiKeyUsage.apiKeyId, input.apiKeyId),
        ];
        if (input.since)
          conditions.push(gte(apiKeyUsage.createdAt, input.since));
        return db
          .select()
          .from(apiKeyUsage)
          .where(and(...conditions))
          .orderBy(desc(apiKeyUsage.createdAt))
          .limit(input.limit)
          .offset(input.offset);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getApiKeyUsageSummary: protectedProcedure
    .input(z.object({ apiKeyId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { total: 0, errors: 0, avgResponseMs: 0 };
        const [row] = await db
          .select({
            total: count(),
            errors: sql<number>`COUNT(*) FILTER (WHERE ${apiKeyUsage.statusCode} >= 400)`,
            avgResponseMs: sql<number>`AVG(${apiKeyUsage.responseMs})`,
          })
          .from(apiKeyUsage)
          .where(eq(apiKeyUsage.apiKeyId, input.apiKeyId));
        return row ?? { total: 0, errors: 0, avgResponseMs: 0 };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  recordApiKeyUsage: protectedProcedure
    .input(
      z.object({
        apiKeyId: z.number(),
        endpoint: z.string().max(256),
        method: z.string().max(8),
        statusCode: z.number(),
        responseMs: z.number().optional(),
        ipAddress: z.string().max(45).optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { success: false };
        await db.insert(apiKeyUsage).values(input as any);
        return { success: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  /**
   * Get available API scopes.
   */
  getScopes: protectedProcedure.query(() => {
    return {
      scopes: VALID_SCOPES.map((scope: any) => ({
        name: scope,
        description: getScopeDescription(scope),
      })),
    };
  }),
});

function getScopeDescription(scope: ApiScope): string {
  const descriptions: Record<ApiScope, string> = {
    "transactions:read": "Read transaction history and details",
    "transactions:write": "Create and update transactions",
    "agents:read": "Read agent profiles and status",
    "agents:write": "Update agent details and settings",
    "settlements:read": "Read settlement records",
    "disputes:read": "Read dispute records",
    "disputes:write": "Create and update disputes",
    "analytics:read": "Access analytics and reporting data",
    "kyc:read": "Read KYC session status",
    "webhooks:manage": "Create and manage webhook endpoints",
  };
  return descriptions[scope] ?? scope;
}
