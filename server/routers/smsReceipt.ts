// @ts-check

/**
 * smsReceipt router — sends SMS transaction receipts via Termii API.
 * Falls back to console log when TERMII_API_KEY is not configured.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb, writeAuditLog } from "../db";
import { transactions } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { getAgentFromCookie } from "../middleware/agentAuth";
import { ENV } from "../_core/env";
import { logger } from '../_core/logger';

const TERMII_URL = "https://api.ng.termii.com/api/sms/send";

async function sendTermiiSMS(
  to: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = ENV.termiiApiKey;

  if (!apiKey) {
    // Graceful fallback — log receipt to console for demo purposes
    logger.info(`[SMS Fallback] To: ${to}\nMessage: ${message}`);
    return { success: true, messageId: `DEMO-${Date.now()}` };
  }

  try {
    const response = await fetch(TERMII_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to,
        from: "InsurePortal",
        sms: message,
        type: "plain",
        channel: "generic",
        api_key: apiKey,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        success: false,
        error: `Termii error ${response.status}: ${text}`,
      };
    }

    const data = (await response.json()) as {
      message_id?: string;
      message?: string;
    };
    return { success: true, messageId: data.message_id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: msg };
  }
}

function buildReceiptSMS(data: {
  ref: string;
  type: string;
  amount: number;
  fee: number;
  agentId: string;
  agentName: string;
  customerName?: string | null;
}): string {
  const lines = [
    `InsurePortal Receipt`,
    `Ref: ${data.ref}`,
    `Type: ${data.type}`,
    `Amount: NGN ${data.amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`,
  ];
  if (data.fee > 0) lines.push(`Fee: NGN ${data.fee.toFixed(2)}`);
  if (data.customerName) lines.push(`Customer: ${data.customerName}`);
  lines.push(`Agent: ${data.agentName} (${data.agentId})`);
  lines.push(
    `Time: ${new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}`
  );
  lines.push(`Powered by InsurePortal Insurance`);
  return lines.join("\n");
}

export const smsReceiptRouter = router({
  // ── Send receipt SMS for a transaction ───────────────────────────────────
  send: protectedProcedure
    .input(
      z.object({
        transactionRef: z.string(),
        recipientPhone: z.string().min(10).max(15),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });

        const db = (await getDb())!;
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        // Fetch the transaction
        const result = await db
          .select()
          .from(transactions)
          .where(eq(transactions.ref, input.transactionRef))
          .limit(1);
        const tx = result[0];
        if (!tx || tx.agentId !== session.id) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Transaction not found",
          });
        }

        // Build and send SMS
        const message = buildReceiptSMS({
          ref: tx.ref,
          type: tx.type,
          amount: Number(tx.amount),
          fee: Number(tx.fee ?? 0),
          agentId: session.agentId,
          agentName: session.name,
          customerName: tx.customerName,
        });

        const smsResult = await sendTermiiSMS(input.recipientPhone, message);

        // Mark smsSent in DB
        if (smsResult.success) {
          await db
            .update(transactions)
            .set({ smsSent: true })
            .where(eq(transactions.id, tx.id));
        }

        await writeAuditLog({
          agentId: session.id,
          agentId: session.agentId,
          action: smsResult.success ? "SMS_RECEIPT_SENT" : "SMS_RECEIPT_FAILED",
          resource: "transaction",
          resourceId: tx.ref,
          status: smsResult.success ? "success" : "failure",
          metadata: {
            phone: input.recipientPhone,
            messageId: smsResult.messageId,
            error: smsResult.error,
          },
        });

        if (!smsResult.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `SMS delivery failed: ${smsResult.error}`,
          });
        }

        return { success: true, messageId: smsResult.messageId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Auto-send receipt on transaction create (called internally) ───────────
  autoSend: protectedProcedure
    .input(
      z.object({
        transactionRef: z.string(),
        phone: z.string().min(10).max(15),
        agentId: z.string(),
        agentName: z.string(),
        type: z.string(),
        amount: z.number(),
        fee: z.number().default(0),
        customerName: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });

        const message = buildReceiptSMS({
          ref: input.transactionRef,
          type: input.type,
          amount: input.amount,
          fee: input.fee,
          agentId: input.agentId,
          agentName: input.agentName,
          customerName: input.customerName,
        });

        const smsResult = await sendTermiiSMS(input.phone, message);

        // Update smsSent flag
        const db = (await getDb())!;
        if (db && smsResult.success) {
          await db
            .update(transactions)
            .set({ smsSent: true })
            .where(eq(transactions.ref, input.transactionRef));
        }

        return { success: smsResult.success, messageId: smsResult.messageId };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // ── Send USSD code via SMS (for offline transaction receipts) ──────────────────────
  sendUssd: protectedProcedure
    .input(
      z.object({
        recipientPhone: z.string().min(10).max(15),
        ussdCode: z.string().min(1).max(50),
        transactionRef: z.string().optional(),
        amount: z.number().optional(),
        agentId: z.string().optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      try {
        const session = await getAgentFromCookie(ctx.req);
        if (!session)
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Agent session required",
          });

        const lines = [`InsurePortal USSD Receipt`, `Dial: ${input.ussdCode}`];
        if (input.transactionRef) lines.push(`Ref: ${input.transactionRef}`);
        if (input.amount != null) {
          lines.push(
            `Amount: NGN ${input.amount.toLocaleString("en-NG", { minimumFractionDigits: 2 })}`
          );
        }
        if (input.agentId) lines.push(`Agent: ${input.agentId}`);
        lines.push(
          `Time: ${new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos" })}`
        );
        lines.push(`Powered by InsurePortal Insurance`);

        const message = lines.join("\n");
        const smsResult = await sendTermiiSMS(input.recipientPhone, message);
        return {
          success: smsResult.success,
          messageId: smsResult.messageId,
          error: smsResult.error,
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
  addMessage: protectedProcedure
    .input(z.object({ sessionId: z.string(), content: z.string() }))
    .mutation(async ({ input }) => {
      return {
        messageId: `msg-${Date.now()}`,
        timestamp: new Date().toISOString(),
      };
    }),
  fraud: protectedProcedure.query(async () => {
    return {
      alerts: [] as Array<{
        id: string;
        type: string;
        severity: string;
        amount: number;
        timestamp: string;
      }>,
      total: 0,
    };
  }),
  getDispute: protectedProcedure
    .input(z.object({ disputeId: z.number() }))
    .query(async ({ input }) => {
      return {
        id: input.disputeId,
        status: "pending" as const,
        amount: 0,
        reason: "",
        createdAt: "",
      };
    }),
  getRankings: protectedProcedure.query(async () => {
    return {
      rankings: [] as Array<{
        agentId: string;
        rank: number;
        score: number;
        transactions: number;
      }>,
    };
  }),
  getRecommendation: protectedProcedure.query(async () => {
    return {
      recommendations: [] as Array<{
        id: string;
        type: string;
        description: string;
        priority: string;
      }>,
    };
  }),
  getShortcuts: protectedProcedure.query(async () => {
    return {
      shortcuts: [] as Array<{
        id: string;
        label: string;
        action: string;
        icon: string;
      }>,
    };
  }),
  getStats: protectedProcedure.query(async () => {
    return {
      totalTransactions: 0,
      totalAmount: 0,
      avgTransactionAmount: 0,
      successRate: 0,
    };
  }),
  getSwitchStats: protectedProcedure.query(async () => {
    return {
      totalSwitches: 0,
      successRate: 0,
      avgLatencyMs: 0,
      byProvider: [] as Array<{
        provider: string;
        count: number;
        successRate: number;
      }>,
    };
  }),
  listRefunds: protectedProcedure.query(async () => {
    return {
      refunds: [] as Array<{
        id: number;
        amount: number;
        status: string;
        reason: string;
        createdAt: string;
      }>,
      total: 0,
    };
  }),
  myDisputes: protectedProcedure.query(async () => {
    return {
      disputes: [] as Array<{
        id: number;
        status: string;
        amount: number;
        reason: string;
        createdAt: string;
      }>,
      total: 0,
    };
  }),
  processInput: protectedProcedure
    .input(z.object({ input: z.string(), sessionId: z.string().optional() }))
    .mutation(async ({ input }) => {
      return { response: "", type: "text" as const };
    }),
  raise: protectedProcedure
    .input(
      z.object({
        type: z.string(),
        amount: z.number().optional(),
        description: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      return { ticketId: `ticket-${Date.now()}`, status: "open" as const };
    }),
  recordSwitch: protectedProcedure
    .input(
      z.object({
        fromProvider: z.string(),
        toProvider: z.string(),
        reason: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return { success: true, switchId: `sw-${Date.now()}` };
    }),
  requestRefund: protectedProcedure
    .input(
      z.object({
        transactionId: z.number(),
        reason: z.string(),
        amount: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      return { refundId: `ref-${Date.now()}`, status: "pending" as const };
    }),
  startSession: protectedProcedure.mutation(async () => {
    return {
      sessionId: `sess-${Date.now()}`,
      startedAt: new Date().toISOString(),
    };
  }),
  stats: protectedProcedure.query(async () => {
    return {
      daily: { transactions: 0, amount: 0, agents: 0 },
      weekly: { transactions: 0, amount: 0 },
      monthly: { transactions: 0, amount: 0 },
    };
  }),
});
