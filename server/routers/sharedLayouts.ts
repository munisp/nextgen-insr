/**
 * sharedLayouts.ts — Shared Report Layouts Router
 * F-12 (wave-4b): the whole router was mockware — list/getById/getSummary/
 * getRecent served audit-log rows as "shared layouts" (wrong-domain),
 * gallery returned a permissions fixture, and share/import/fork were
 * success-echo mutations. No shared-layout store exists. Every proc
 * fails loud.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

function loud(name: string): never {
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: `sharedLayouts.${name}: no shared-layout store is delivered`,
  });
}

const idInput = z
  .object({ id: z.union([z.number(), z.string()]).optional() })
  .optional();
const pageInput = z.object({
  limit: z.number().min(1).max(100).default(20),
  offset: z.number().min(0).default(0),
});

export const sharedLayoutsRouter = router({
  list: protectedProcedure.input(pageInput).query(async () => loud("list")),
  getById: protectedProcedure.input(idInput).query(async () => loud("getById")),
  getSummary: protectedProcedure.query(async () => loud("getSummary")),
  getRecent: protectedProcedure.input(pageInput).query(async () => loud("getRecent")),
  gallery: protectedProcedure.query(async () => loud("gallery")),
  share: protectedProcedure
    .input(z.object({ id: z.string(), targetUserId: z.string() }))
    .mutation(async () => loud("share")),
  import: protectedProcedure
    .input(z.object({ layoutId: z.string() }))
    .mutation(async () => loud("import")),
  fork: protectedProcedure
    .input(z.object({ layoutId: z.string() }))
    .mutation(async () => loud("fork")),
});
