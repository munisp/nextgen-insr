import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { protectedProcedure, router } from "../_core/trpc";

const notImplemented = () =>
  new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Broadcast announcements are not implemented yet",
  });

// Announcement types: "info", "warning", "critical", "maintenance", "feature"
// Targets: "all", "agents", "admins", "merchants"
// Channels: "banner", "inbox", "push", "email", "sms"
export const broadcastAnnouncementsRouter = router({
  // F-12 (wave-4b): no broadcast store is delivered. Fail loud (original
  // input shape preserved).
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
      })
    )
    .query(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "list: no broadcast store is delivered",
      });
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async () => {
      throw notImplemented();
    }),

  getSummary: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  getRecent: protectedProcedure
    .input(
      z.object({
        days: z.number().min(1).max(90).default(7),
        limit: z.number().min(1).max(50).default(10),
      })
    )
    .query(async () => {
      throw notImplemented();
    }),

  // F-12 (wave-4b): no broadcast store is delivered. Fail loud (mutation
  // preserved — the page calls useMutation).
  create: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw new TRPCError({
        code: "NOT_IMPLEMENTED",
        message: "create: no broadcast store is delivered",
      });
    }),

  delete: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),

  stats: protectedProcedure.query(async () => {
    throw notImplemented();
  }),

  togglePin: protectedProcedure
    .input(
      z.object({ id: z.union([z.number(), z.string()]).optional() }).optional()
    )
    .mutation(async () => {
      throw notImplemented();
    }),
  dismiss: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async () => {
      throw notImplemented();
    }),
});
