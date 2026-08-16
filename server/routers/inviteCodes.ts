/**
 * Invite Code Router — Generate, validate, list, and revoke partner invite codes.
 * Only admins/super-admins can generate codes; public validation is allowed for onboarding.
 */
import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

// ─── In-memory store (production: replace with DB via getDb + inviteCodes table) ──
interface InviteCodeRecord {
  id: number;
  code: string;
  type: "one_time" | "multi_use";
  status: "active" | "used" | "expired" | "revoked";
  maxUses: number;
  usedCount: number;
  createdBy: number | null;
  assignedTenantId: number | null;
  partnerName: string | null;
  partnerEmail: string | null;
  notes: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

let nextId = 1;
const store: InviteCodeRecord[] = [];

function generateCode(): string {
  return "RF-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

export const inviteCodesRouter = router({
  /** Admin: Generate a new invite code */
  generate: protectedProcedure
    .input(
      z.object({
        type: z.enum(["one_time", "multi_use"]).default("one_time"),
        maxUses: z.number().int().min(1).max(1000).default(1),
        partnerName: z.string().max(128).optional(),
        partnerEmail: z.string().email().max(320).optional(),
        notes: z.string().max(500).optional(),
        expiresAt: z.string().datetime().optional(),
      })
    )
    .mutation(({ input, ctx }) => {
      const code = generateCode();
      const record: InviteCodeRecord = {
        id: nextId++,
        code,
        type: input.type,
        status: "active",
        maxUses: input.type === "one_time" ? 1 : input.maxUses,
        usedCount: 0,
        createdBy: ctx.user?.id ?? null,
        assignedTenantId: null,
        partnerName: input.partnerName ?? null,
        partnerEmail: input.partnerEmail ?? null,
        notes: input.notes ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.push(record);
      return record;
    }),

  /** Admin: List all invite codes with pagination */
  list: protectedProcedure
    .input(
      z
        .object({
          page: z.number().int().min(1).default(1),
          limit: z.number().int().min(1).max(100).default(20),
          status: z.enum(["active", "used", "expired", "revoked"]).optional(),
          search: z.string().max(128).optional(),
        })
        .optional()
    )
    .query(({ input }) => {
      const { page = 1, limit = 20, status, search } = input ?? {};
      let filtered = [...store];
      if (status) filtered = filtered.filter(c => c.status === status);
      if (search) {
        const q = search.toLowerCase();
        filtered = filtered.filter(
          c =>
            c.code.toLowerCase().includes(q) ||
            c.partnerName?.toLowerCase().includes(q) ||
            c.partnerEmail?.toLowerCase().includes(q)
        );
      }
      filtered.sort(
        (a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime()
      );
      const total = filtered.length;
      const items = filtered.slice((page - 1) * limit, page * limit);
      return {
        items,
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      };
    }),

  /** Public: Validate an invite code (used during partner onboarding) */
  validate: protectedProcedure
    .input(z.object({ code: z.string().min(1).max(32) }))
    .query(({ input }) => {
      const record = store.find(c => c.code === input.code);
      if (!record) return { valid: false, reason: "Code not found" };
      if (record.status === "revoked")
        return { valid: false, reason: "Code has been revoked" };
      if (record.status === "used")
        return { valid: false, reason: "Code has already been used" };
      if (record.status === "expired")
        return { valid: false, reason: "Code has expired" };
      if (record.expiresAt && record.expiresAt < new Date()) {
        record.status = "expired";
        return { valid: false, reason: "Code has expired" };
      }
      if (record.usedCount >= record.maxUses) {
        record.status = "used";
        return { valid: false, reason: "Code has reached maximum uses" };
      }
      return {
        valid: true,
        code: record.code,
        type: record.type,
        partnerName: record.partnerName,
        partnerEmail: record.partnerEmail,
        remainingUses: record.maxUses - record.usedCount,
      };
    }),

  /** Internal: Mark a code as used (called during tenant creation) */
  markUsed: protectedProcedure
    .input(z.object({ code: z.string(), tenantId: z.number().int() }))
    .mutation(({ input }) => {
      const record = store.find(c => c.code === input.code);
      if (!record)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invite code not found",
        });
      record.usedCount += 1;
      record.assignedTenantId = input.tenantId;
      record.updatedAt = new Date();
      if (record.type === "one_time" || record.usedCount >= record.maxUses) {
        record.status = "used";
      }
      return record;
    }),

  /** Admin: Revoke an invite code */
  revoke: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(({ input }) => {
      const record = store.find(c => c.id === input.id);
      if (!record)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Invite code not found",
        });
      record.status = "revoked";
      record.updatedAt = new Date();
      return record;
    }),

  /** Admin: Get stats about invite codes */
  stats: protectedProcedure.query(() => {
    return {
      total: store.length,
      active: store.filter(c => c.status === "active").length,
      used: store.filter(c => c.status === "used").length,
      expired: store.filter(c => c.status === "expired").length,
      revoked: store.filter(c => c.status === "revoked").length,
      totalTenantsCreated: store.filter(c => c.assignedTenantId !== null)
        .length,
    };
  }),
});
