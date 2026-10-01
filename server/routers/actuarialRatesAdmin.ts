/**
 * actuarialRatesAdmin.ts — Actuarial Wave stage A1 (2026-10-01, A1)
 *
 * Admin-gated CRUD + lifecycle for the unified table-driven rating engine
 * (drizzle/schema.ts rating_tables / rating_factors, resolver in
 * server/lib/ratingEngine.ts). Every procedure is adminProcedure-gated
 * (same gating as actuarialEngine.ts) and writes a hash-chained audit row
 * via writeAuditLog (server/lib/auditLogger.ts).
 *
 * Lifecycle: draft → filed (records filedBy) → active (records approvedBy;
 * approving ATOMICALLY retires the previously active table for the same
 * productCode/coverageClass in one transaction) → retired. Filed/active
 * tables are IMMUTABLE: no in-place value mutation — a rate change is a new
 * version row (createTable auto-increments version per scope key).
 *
 * Scope key: exactly one of productCode / coverageClass must be non-null
 * (fail-closed BAD_REQUEST otherwise — the resolver needs a deterministic
 * scope).
 *
 * NOT mounted in server/routers.ts — the A1 orchestrator wires it.
 */
import { TRPCError } from "@trpc/server";
import { and, desc, eq, max, sql } from "drizzle-orm";
import { z } from "zod";

import { ratingFactors, ratingTables } from "../../drizzle/schema";
import { adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { writeAuditLog } from "../lib/auditLogger";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function requireDb(db: Db | null): Db {
  if (!db) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database unavailable",
    });
  }
  return db;
}

const FACTOR_TYPES = [
  "base",
  "age_band",
  "claims_loading",
  "ncd",
  "location",
  "telematics_cap",
] as const;

const scopeInput = z
  .object({
    productCode: z.string().min(1).nullable().optional(),
    coverageClass: z.string().min(1).nullable().optional(),
  })
  .refine(v => Boolean(v.productCode) !== Boolean(v.coverageClass), {
    message: "Exactly one of productCode / coverageClass must be set",
  });

async function getTableOrThrow(db: Db, tableId: number) {
  const [row] = await db
    .select()
    .from(ratingTables)
    .where(eq(ratingTables.id, tableId))
    .limit(1);
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Rating table not found" });
  }
  return row;
}

function requireStatus(row: { status: string }, expected: string, action: string) {
  if (row.status !== expected) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Cannot ${action} a rating table in status '${row.status}' (requires '${expected}')`,
    });
  }
}

export const actuarialRatesAdminRouter = router({
  /** createTable — always a NEW version row in 'draft'; never mutates existing rows. */
  createTable: adminProcedure
    .input(
      scopeInput.extend({
        effectiveFrom: z.coerce.date(),
        effectiveTo: z.coerce.date().nullable().optional(),
        naicomFilingRef: z.string().min(1).nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const scopeCond = input.productCode
        ? eq(ratingTables.productCode, input.productCode)
        : eq(ratingTables.coverageClass, input.coverageClass!);
      const [maxRow] = await db
        .select({ v: max(ratingTables.version) })
        .from(ratingTables)
        .where(scopeCond);
      const version = (maxRow?.v ?? 0) + 1;
      const [row] = await db
        .insert(ratingTables)
        .values({
          productCode: input.productCode ?? null,
          coverageClass: input.coverageClass ?? null,
          effectiveFrom: input.effectiveFrom,
          effectiveTo: input.effectiveTo ?? null,
          status: "draft",
          version,
          naicomFilingRef: input.naicomFilingRef ?? null,
        })
        .returning();
      await writeAuditLog({
        agentId: ctx.user.id,
        action: "RATING_TABLE_CREATE",
        resource: "rating_table",
        resourceId: String(row.id),
        status: "success",
        metadata: {
          productCode: input.productCode ?? null,
          coverageClass: input.coverageClass ?? null,
          version,
        },
      });
      return row;
    }),

  /** addFactor — draft tables only; filed/active tables are immutable. */
  addFactor: adminProcedure
    .input(
      z.object({
        tableId: z.number().int().positive(),
        factorType: z.enum(FACTOR_TYPES),
        factorKey: z.string().min(1),
        value: z.number(),
        minClamp: z.number().nullable().optional(),
        maxClamp: z.number().nullable().optional(),
        sortOrder: z.number().int(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const table = await getTableOrThrow(db, input.tableId);
      requireStatus(table, "draft", "add a factor to");
      const [row] = await db
        .insert(ratingFactors)
        .values({
          tableId: input.tableId,
          factorType: input.factorType,
          factorKey: input.factorKey,
          value: String(input.value),
          minClamp: input.minClamp != null ? String(input.minClamp) : null,
          maxClamp: input.maxClamp != null ? String(input.maxClamp) : null,
          sortOrder: input.sortOrder,
        })
        .returning();
      await writeAuditLog({
        agentId: ctx.user.id,
        action: "RATING_FACTOR_ADD",
        resource: "rating_table",
        resourceId: String(input.tableId),
        status: "success",
        metadata: {
          factorId: row.id,
          factorType: input.factorType,
          factorKey: input.factorKey,
          value: input.value,
        },
      });
      return row;
    }),

  /** fileTable — draft → filed, records filedBy. Freezes the content. */
  fileTable: adminProcedure
    .input(z.object({ tableId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const table = await getTableOrThrow(db, input.tableId);
      requireStatus(table, "draft", "file");
      const [row] = await db
        .update(ratingTables)
        .set({ status: "filed", filedBy: ctx.user.id, updatedAt: new Date() })
        .where(eq(ratingTables.id, input.tableId))
        .returning();
      await writeAuditLog({
        agentId: ctx.user.id,
        action: "RATING_TABLE_FILE",
        resource: "rating_table",
        resourceId: String(input.tableId),
        status: "success",
        metadata: { version: row.version },
      });
      return row;
    }),

  /**
   * approveTable — filed → active, records approvedBy. In ONE transaction
   * the previously active table for the same scope key is retired, so there
   * is never more than one active table per productCode/coverageClass.
   */
  approveTable: adminProcedure
    .input(z.object({ tableId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const now = new Date();
      const result = await db.transaction(async tx => {
        const [table] = await tx
          .select()
          .from(ratingTables)
          .where(eq(ratingTables.id, input.tableId))
          .limit(1);
        if (!table) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Rating table not found",
          });
        }
        requireStatus(table, "filed", "approve");
        const scopeCond = table.productCode
          ? eq(ratingTables.productCode, table.productCode)
          : eq(ratingTables.coverageClass, table.coverageClass!);
        const retired = await tx
          .update(ratingTables)
          .set({ status: "retired", effectiveTo: now, updatedAt: now })
          .where(
            and(
              scopeCond,
              eq(ratingTables.status, "active"),
              sql`${ratingTables.id} <> ${input.tableId}`
            )
          )
          .returning({ id: ratingTables.id });
        const [approved] = await tx
          .update(ratingTables)
          .set({ status: "active", approvedBy: ctx.user.id, updatedAt: now })
          .where(eq(ratingTables.id, input.tableId))
          .returning();
        return { approved, retiredIds: retired.map(r => r.id) };
      });
      await writeAuditLog({
        agentId: ctx.user.id,
        action: "RATING_TABLE_APPROVE",
        resource: "rating_table",
        resourceId: String(input.tableId),
        status: "success",
        metadata: { retiredTableIds: result.retiredIds },
      });
      return result;
    }),

  /** retireTable — draft/filed/active → retired; sets effectiveTo. */
  retireTable: adminProcedure
    .input(z.object({ tableId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = requireDb(await getDb());
      const table = await getTableOrThrow(db, input.tableId);
      if (table.status === "retired") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Rating table is already retired",
        });
      }
      const now = new Date();
      const [row] = await db
        .update(ratingTables)
        .set({ status: "retired", effectiveTo: now, updatedAt: now })
        .where(eq(ratingTables.id, input.tableId))
        .returning();
      await writeAuditLog({
        agentId: ctx.user.id,
        action: "RATING_TABLE_RETIRE",
        resource: "rating_table",
        resourceId: String(input.tableId),
        status: "success",
        metadata: { previousStatus: table.status },
      });
      return row;
    }),

  listTables: adminProcedure
    .input(
      z
        .object({
          status: z.enum(["draft", "filed", "active", "retired"]).optional(),
          productCode: z.string().optional(),
          coverageClass: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ input }) => {
      const db = requireDb(await getDb());
      const conds = [];
      if (input?.status) conds.push(eq(ratingTables.status, input.status));
      if (input?.productCode)
        conds.push(eq(ratingTables.productCode, input.productCode));
      if (input?.coverageClass)
        conds.push(eq(ratingTables.coverageClass, input.coverageClass));
      return db
        .select()
        .from(ratingTables)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(ratingTables.id));
    }),

  getTable: adminProcedure
    .input(z.object({ tableId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = requireDb(await getDb());
      const table = await getTableOrThrow(db, input.tableId);
      const factors = await db
        .select()
        .from(ratingFactors)
        .where(eq(ratingFactors.tableId, input.tableId))
        .orderBy(ratingFactors.sortOrder);
      return { ...table, factors };
    }),
});
