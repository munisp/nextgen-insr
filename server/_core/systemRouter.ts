// @ts-check

import { z } from "zod";
import { notifyOwner } from "./notification";
import { ENV } from "./env";
import { adminProcedure, publicProcedure, router } from "./trpc";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  // Returns the VAPID public key for web push subscriptions.
  // Safe to expose publicly — the private key never leaves the server.
  vapidPublicKey: publicProcedure.query(() => ({
    key: ENV.vapidPublicKey,
  })),
});
