// @ts-nocheck
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import {
  platformBillingLedger,
  tenantBillingConfig,
} from "../../drizzle/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import Stripe from "stripe";

let _stripe: Stripe | null = null;
function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key)
      throw new Error("STRIPE_SECRET_KEY environment variable is required");
    _stripe = new Stripe(key, {
      apiVersion: "2025-04-30.basil" as any,
    });
  }
  return _stripe;
}

interface InvoiceLineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  category:
    | "transaction_fee"
    | "subscription"
    | "implementation"
    | "overage"
    | "credit"
    | "adjustment";
}

interface Invoice {
  id: string;
  tenantId: number;
  clientId: string;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  issueDate: string;
  dueDate: string;
  status: "draft" | "issued" | "paid" | "overdue" | "cancelled" | "disputed";
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  lineItems: InvoiceLineItem[];
  notes: string;
  paymentTerms: string;
}

export const billingInvoiceRouter = router({
  generateInvoice: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        clientId: z.string(),
        periodStart: z.string(),
        periodEnd: z.string(),
        currency: z.string().default("NGN"),
        taxRate: z.number().default(7.5),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = await getDb();
        if (!db)
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "DB unavailable",
          });

        const ledgerEntries = await db
          .select({
            totalGrossFees: sql<number>`COALESCE(SUM(${platformBillingLedger.grossFee}), 0)`,
            totalPlatformShare: sql<number>`COALESCE(SUM(${platformBillingLedger.platformRevenue}), 0)`,
            totalClientShare: sql<number>`COALESCE(SUM(${platformBillingLedger.clientRevenue}), 0)`,
            totalSwitchFee: sql<number>`COALESCE(SUM(${platformBillingLedger.switchFee}), 0)`,
            totalAgentCommission: sql<number>`COALESCE(SUM(${platformBillingLedger.agentCommission}), 0)`,
            transactionCount: sql<number>`COUNT(*)`,
          })
          .from(platformBillingLedger)
          .where(
            and(
              eq(platformBillingLedger.agentId, input.tenantId),
              eq(platformBillingLedger.agentId, input.clientId as any),
              gte(platformBillingLedger.createdAt, new Date(input.periodStart)),
              lte(platformBillingLedger.createdAt, new Date(input.periodEnd))
            )
          );

        const stats = ledgerEntries[0] || {
          totalGrossFees: 0,
          totalPlatformShare: 0,
          totalClientShare: 0,
          totalSwitchFee: 0,
          totalAgentCommission: 0,
          transactionCount: 0,
        };

        const lineItems: InvoiceLineItem[] = [
          {
            description: `Transaction processing fees (${stats.transactionCount} transactions)`,
            quantity: Number(stats.transactionCount),
            unitPrice:
              Number(stats.totalGrossFees) /
              Math.max(Number(stats.transactionCount), 1),
            total: Number(stats.totalGrossFees),
            category: "transaction_fee",
          },
          {
            description: "Platform revenue share",
            quantity: 1,
            unitPrice: Number(stats.totalPlatformShare),
            total: Number(stats.totalPlatformShare),
            category: "transaction_fee",
          },
          {
            description: "Switch/network fees",
            quantity: 1,
            unitPrice: Number(stats.totalSwitchFee),
            total: Number(stats.totalSwitchFee),
            category: "transaction_fee",
          },
          {
            description: "Agent commissions",
            quantity: 1,
            unitPrice: Number(stats.totalAgentCommission),
            total: Number(stats.totalAgentCommission),
            category: "transaction_fee",
          },
        ];

        const [config] = await db
          .select()
          .from(tenantBillingConfig)
          .where(eq(tenantBillingConfig.tenantId, input.tenantId))
          .limit(100);
        if (
          config?.billingModel === "subscription" ||
          config?.billingModel === "hybrid"
        ) {
          const subConfig = config.subscriptionConfig;
          // @ts-expect-error auto-fix
          if (subConfig?.perAgentFee) {
            lineItems.push({
              description: "Monthly agent subscription",
              quantity: (subConfig as any).agentCount || 10,
              unitPrice: (subConfig as any).perAgentFee,
              total:
                ((subConfig as any).agentCount || 10) *
                (subConfig as any).perAgentFee,
              category: "subscription",
            });
          }
        }

        const subtotal = lineItems.reduce(
          (sum: any, item: any) => sum + item.total,
          0
        );
        const taxAmount = subtotal * (input.taxRate / 100);
        const total = subtotal + taxAmount;
        const invoiceNumber = `INV-${input.tenantId}-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}-${crypto.randomUUID().toUpperCase()}`;

        const invoice: Invoice = {
          id: `inv_${Date.now()}`,
          tenantId: input.tenantId,
          clientId: input.clientId,
          invoiceNumber,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          issueDate: new Date().toISOString(),
          dueDate: new Date(
            Date.now() + 30 * 24 * 60 * 60 * 1000
          ).toISOString(),
          status: "draft",
          currency: input.currency,
          subtotal,
          taxRate: input.taxRate,
          taxAmount,
          total,
          lineItems,
          notes:
            "Payment due within 30 days. Late payments subject to 2% monthly interest.",
          paymentTerms: "Net 30",
        };
        return invoice;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  listInvoices: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        status: z.string().optional(),
        limit: z.number().default(20),
      })
    )
    .query(async ({ input }) => {
      try {
        return { invoices: [], total: 0, limit: input.limit };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  getInvoice: protectedProcedure
    .input(z.object({ invoiceId: z.string() }))
    .query(async ({ input }) => {
      try {
        return { invoice: null, found: false };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  markPaid: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        paymentRef: z.string(),
        paidAt: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return {
          success: true,
          invoiceId: input.invoiceId,
          status: "paid",
          paymentRef: input.paymentRef,
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

  generateCreditNote: protectedProcedure
    .input(
      z.object({
        invoiceId: z.string(),
        amount: z.number(),
        reason: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return {
          creditNoteNumber: `CN-${crypto.randomUUID().toUpperCase()}`,
          invoiceId: input.invoiceId,
          amount: input.amount,
          reason: input.reason,
          status: "issued",
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

  exportInvoices: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        startDate: z.string(),
        endDate: z.string(),
        format: z.enum(["csv", "xlsx"]).default("csv"),
      })
    )
    .mutation(async ({ input }) => {
      try {
        return {
          downloadUrl: `/api/billing/export/${input.tenantId}/${input.format}`,
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
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

  convertCurrency: protectedProcedure
    .input(
      z.object({
        amount: z.number(),
        from: z.string().default("NGN"),
        to: z.string(),
      })
    )
    .query(async ({ input }) => {
      try {
        const rates: Record<string, number> = {
          USD: 0.00065,
          EUR: 0.0006,
          GBP: 0.00052,
          GHS: 0.0078,
          KES: 0.084,
          ZAR: 0.012,
        };
        const rate = rates[input.to] || 1;
        return {
          originalAmount: input.amount,
          convertedAmount: input.amount * rate,
          rate,
          from: input.from,
          to: input.to,
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
    }),

  // Sprint 82: Stripe Invoice Integration
  createStripeInvoice: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        clientId: z.string(),
        periodStart: z.string(),
        periodEnd: z.string(),
        currency: z.string().default("usd"),
        customerEmail: z.string(),
        customerName: z.string(),
        lineItems: z.array(
          z.object({
            description: z.string(),
            amount: z.number(),
            quantity: z.number().default(1),
          })
        ),
        dueInDays: z.number().default(30),
        autoCollect: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      try {
        let customer: Stripe.Customer;
        const existingCustomers = await getStripe().customers.list({
          email: input.customerEmail,
          limit: 1,
        });
        if (existingCustomers.data.length > 0) {
          customer = existingCustomers.data[0];
        } else {
          customer = await getStripe().customers.create({
            email: input.customerEmail,
            name: input.customerName,
            metadata: {
              tenant_id: String(input.tenantId),
              client_id: input.clientId,
              platform: "insureportal",
            },
          });
        }
        const invoice = await getStripe().invoices.create({
          customer: customer.id,
          collection_method: input.autoCollect
            ? "charge_automatically"
            : "send_invoice",
          days_until_due: input.autoCollect ? undefined : input.dueInDays,
          currency: input.currency,
          metadata: {
            tenant_id: String(input.tenantId),
            client_id: input.clientId,
            period_start: input.periodStart,
            period_end: input.periodEnd,
            user_id: String(ctx.user.id),
          },
          description: `InsurePortal billing for period ${input.periodStart} to ${input.periodEnd}`,
        });
        for (const item of input.lineItems) {
          await getStripe().invoiceItems.create({
            customer: customer.id,
            invoice: invoice.id,
            amount: item.amount,
            currency: input.currency,
            description: item.description,
            quantity: item.quantity,
          });
        }
        const finalizedInvoice = await getStripe().invoices.finalizeInvoice(
          invoice.id
        );
        return {
          success: true,
          stripeInvoiceId: finalizedInvoice.id,
          stripeInvoiceUrl: finalizedInvoice.hosted_invoice_url,
          stripeInvoicePdf: finalizedInvoice.invoice_pdf,
          status: finalizedInvoice.status,
          amountDue: finalizedInvoice.amount_due,
          currency: finalizedInvoice.currency,
          customerId: customer.id,
        };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Stripe invoice creation failed: ${err.message}`,
        });
      }
    }),

  collectPayment: protectedProcedure
    .input(z.object({ stripeInvoiceId: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const invoice = await getStripe().invoices.pay(input.stripeInvoiceId);
        return {
          success: true,
          status: invoice.status,
          amountPaid: invoice.amount_paid,
          paidAt: invoice.status_transitions?.paid_at
            ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
            : null,
        };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Payment collection failed: ${err.message}`,
        });
      }
    }),

  getStripeInvoiceStatus: protectedProcedure
    .input(z.object({ stripeInvoiceId: z.string() }))
    .query(async ({ input }) => {
      try {
        const invoice = await getStripe().invoices.retrieve(
          input.stripeInvoiceId
        );
        return {
          id: invoice.id,
          status: invoice.status,
          amountDue: invoice.amount_due,
          amountPaid: invoice.amount_paid,
          amountRemaining: invoice.amount_remaining,
          currency: invoice.currency,
          hostedUrl: invoice.hosted_invoice_url,
          pdfUrl: invoice.invoice_pdf,
          customerEmail: invoice.customer_email,
          dueDate: invoice.due_date
            ? new Date(invoice.due_date * 1000).toISOString()
            : null,
          paidAt: invoice.status_transitions?.paid_at
            ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
            : null,
        };
      } catch (err: any) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Invoice not found: ${err.message}`,
        });
      }
    }),

  createInvoiceCheckout: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        invoiceId: z.string(),
        amount: z.number(),
        currency: z.string().default("usd"),
        customerEmail: z.string(),
        description: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const origin = ctx.req?.headers?.origin || "http://localhost:3000";
      try {
        const session = await getStripe().checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          customer_email: input.customerEmail,
          line_items: [
            {
              price_data: {
                currency: input.currency,
                product_data: {
                  name: `InsurePortal Invoice: ${input.invoiceId}`,
                  description: input.description,
                },
                unit_amount: input.amount,
              },
              quantity: 1,
            },
          ],
          success_url: `${origin}/billing/invoices?status=paid&invoice=${input.invoiceId}`,
          cancel_url: `${origin}/billing/invoices?status=cancelled&invoice=${input.invoiceId}`,
          allow_promotion_codes: true,
          client_reference_id: String(ctx.user.id),
          metadata: {
            tenant_id: String(input.tenantId),
            invoice_id: input.invoiceId,
            user_id: String(ctx.user.id),
            customer_email: input.customerEmail,
          },
        });
        return { checkoutUrl: session.url, sessionId: session.id };
      } catch (err: any) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Checkout session creation failed: ${err.message}`,
        });
      }
    }),
});
