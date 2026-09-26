// Sprint 87: Upgraded from mock data to real DB queries — apiKeyManagement
// AUTH-8/9: revoke/rotate are REAL DB mutations (checked at auth time via
// developerPortal.validateKey: status!=="active" || revokedAt → 401), and
// getStats is no longer public.
import crypto from "node:crypto";

import { TRPCError } from "@trpc/server";
import { eq, desc, and, sql, count } from "drizzle-orm";
import { z } from "zod";

import { apiKeys } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { apiScopeSchema } from "./developerPortal";

// 2026-09-19 (L-wave, L-P-9): server-side rate-limit ceilings. Callers may
// request a rateLimit but it is CLAMPED server-side — a non-admin can never
// self-grant more than RATE_LIMIT_CAP_USER requests/hour; the schema max
// (100k) is reserved for admins.
const RATE_LIMIT_CAP_USER = 1000;
const RATE_LIMIT_CAP_ADMIN = 100000;

/** Non-admin callers only ever see their own keys; admins see all. */
function ownershipWhere(user: { id: number; role?: string }) {
  return user.role === "admin" ? undefined : eq(apiKeys.userId, user.id);
}

/** Same format as developerPortal.generateApiKey — raw shown ONCE. */
function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `54lk_${crypto.randomBytes(32).toString("hex")}`;
  const prefix = raw.slice(0, 12);
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hash, prefix };
}

const listKeys = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input, ctx }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      // 2026-09-19 (L-wave, L-P-9): ownership scoping — previously this
      // listed EVERY integrator's key metadata (prefixes, scopes, tenant
      // linkage) platform-wide.
      const where = ownershipWhere(ctx.user);
      const rows = await db
        .select()
        .from(apiKeys)
        .where(where)
        .orderBy(desc(apiKeys.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(apiKeys)
        .where(where);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
/**
 * AUTH-8: REAL rotation. Generates a fresh secret, atomically replaces the
 * stored hash/prefix on the existing key record, and returns the new raw key
 * exactly once. The old secret stops authenticating immediately because
 * auth-time validation hashes the presented key and compares to keyHash.
 */
const rotateKey = protectedProcedure
  .input(
    z.object({
      id: z.number(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    try {
      const db = (await getDb())!;
      const [existing] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
        .limit(1);
      if (!existing)
        throw new TRPCError({ code: "NOT_FOUND", message: "rotateKey: record not found" });
      if (existing.status !== "active" || existing.revokedAt)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "rotateKey: cannot rotate a revoked/inactive key",
        });
      // Ownership/tenant scoping: a non-admin may only rotate their own keys.
      if (ctx.user.role !== "admin" && existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "rotateKey: not your key" });
      }
      const { raw, hash, prefix } = generateApiKey();
      const [row] = await db
        .update(apiKeys)
        .set({ keyHash: hash, keyPrefix: prefix })
        .where(eq(apiKeys.id, input.id))
        .returning();
      return {
        success: true,
        id: row.id,
        keyPrefix: row.keyPrefix,
        rawKey: raw, // shown once — never stored
        message: "rotateKey completed — store the new key; it will not be shown again",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const getUsage = protectedProcedure
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
    })
  )
  .query(async ({ input, ctx }) => {
    try {
      const db = (await getDb())!;
      const lim = input.limit ?? 10;
      const offset = ((input.page ?? 1) - 1) * lim;
      // 2026-09-19 (L-wave, L-P-9): same ownership scoping as listKeys —
      // usage rows leak the same cross-integrator metadata.
      const where = ownershipWhere(ctx.user);
      const rows = await db
        .select()
        .from(apiKeys)
        .where(where)
        .orderBy(desc(apiKeys.id))
        .limit(lim)
        .offset(offset);
      const [{ total }] = await db
        .select({ total: count() })
        .from(apiKeys)
        .where(where);
      return { items: rows, total, page: input.page ?? 1, limit: lim };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const getStats = protectedProcedure // AUTH-9: was publicProcedure — key inventory is not public
  .input(
    z.object({
      page: z.number().optional(),
      limit: z.number().optional(),
      search: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    })
  )
  .query(async ({ input }) => {
    try {
      const db = (await getDb())!;
      const [{ total }] = await db
        .select({ total: count() })
        .from(apiKeys)
        .limit(100);
      const recent = await db
        .select()
        .from(apiKeys)
        .orderBy(desc(apiKeys.id))
        .limit(5);
      // F-12 (full sweep): fixture stats (350/280/70/1.25M) returned after
      // real queries whose results were discarded -> REAL aggregates from
      // api_keys. Request telemetry has no store -> honest 0s.
      const [tot] = await db.select({ value: count() }).from(apiKeys).limit(100);
      const [act] = await db
        .select({ value: count() })
        .from(apiKeys)
        .where(eq(apiKeys.status, "active"))
        .limit(100);
      const [rev] = await db
        .select({ value: count() })
        .from(apiKeys)
        .where(eq(apiKeys.status, "revoked"))
        .limit(100);
      return {
        totalKeys: Number(tot.value),
        activeKeys: Number(act.value),
        revokedKeys: Number(rev.value),
        totalRequests24h: 0,
        avgRequestsPerKey: 0,
        suspiciousActivity: 0,
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
const createKey = protectedProcedure
  .input(
    z.object({
      // AUTH-8: whitelisted fields only — caller can no longer smuggle
      // keyHash/status/userId through a free-form `data` bag.
      name: z.string().min(1).max(128),
      description: z.string().max(1024).optional(),
      // 2026-09-19 (L-wave, L-P-9): scopes are validated against the
      // server-side allowlist (same VALID_SCOPES as developerPortal) —
      // callers can no longer self-grant arbitrary scope strings.
      // 2026-09-25 (Q-wave Q1): allowlist also covers the anchored
      // "embed:product:<id>" pattern via apiScopeSchema (same discipline).
      scopes: z.array(apiScopeSchema).max(64).optional(),
      rateLimit: z.number().int().positive().max(100000).optional(),
      expiresAt: z.coerce.date().optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    try {
      const db = (await getDb())!;
      const { raw, hash, prefix } = generateApiKey();
      // 2026-09-19 (L-wave, L-P-9): rateLimit is server-capped per role —
      // the requested value is a ceiling preference, never a self-grant.
      const cap = ctx.user.role === "admin" ? RATE_LIMIT_CAP_ADMIN : RATE_LIMIT_CAP_USER;
      const effectiveRateLimit = Math.min(input.rateLimit ?? RATE_LIMIT_CAP_USER, cap);
      const [row] = await db
        .insert(apiKeys)
        .values({
          keyHash: hash,
          keyPrefix: prefix,
          name: input.name,
          description: input.description ?? null,
          userId: ctx.user.id, // server-side identity — never caller-supplied
          tenantId: ctx.user.tenantId ?? null,
          status: "active",
          scopes: input.scopes ?? [],
          rateLimit: effectiveRateLimit,
          expiresAt: input.expiresAt ?? null,
        })
        .returning();
      return {
        success: true,
        id: row.id,
        keyPrefix: row.keyPrefix,
        rawKey: raw, // shown once — never stored
        message: "createKey completed — store the key; it will not be shown again",
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });
/**
 * AUTH-8: REAL revocation. Writes status="revoked" + revokedAt to api_keys —
 * the same columns the auth-time validator (developerPortal.validateKey)
 * rejects on — so a revoked key stops working immediately.
 */
const revokeKey = protectedProcedure
  .input(
    z.object({
      id: z.number(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    try {
      const db = (await getDb())!;
      const [existing] = await db
        .select()
        .from(apiKeys)
        .where(eq(apiKeys.id, input.id))
        .limit(1);
      if (!existing)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "revokeKey: record not found",
        });
      if (ctx.user.role !== "admin" && existing.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "revokeKey: not your key" });
      }
      const [row] = await db
        .update(apiKeys)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(eq(apiKeys.id, input.id))
        .returning();
      return {
        success: true,
        id: row.id,
        status: row.status,
        revokedAt: row.revokedAt?.toISOString() ?? null,
        message: "revokeKey completed",
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message:
          error instanceof Error ? error.message : "Internal server error",
      });
    }
  });

export const apiKeyManagementRouter = router({
  listKeys,
  rotateKey,
  getUsage,
  getStats,
  createKey,
  revokeKey,
});
