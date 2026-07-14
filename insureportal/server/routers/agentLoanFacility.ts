/**
 * F04: Agent Loan & Credit Facility
 * Loan application, credit scoring, disbursement, repayment tracking, interest calculation
 */
import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { getDb } from "../db";
import { agentLoans, agents, transactions } from "@schema";
import { eq, desc, and, gte, count, sum, avg, sql } from "drizzle-orm";

// Business rules
const INTEREST_RATES = {
  float_advance: 2.5,
  working_capital: 5.0,
  emergency: 8.0,
}; // monthly %
const MAX_LOAN_MULTIPLIER = 3; // max loan = 3x average monthly volume
const MIN_CREDIT_SCORE = 500;
const CREDIT_SCORE_WEIGHTS = {
  txVolume: 0.3,
  repaymentHistory: 0.25,
  accountAge: 0.2,
  floatUtilization: 0.15,
  fraudHistory: 0.1,
};

export const agentLoanFacilityRouter = router({
  // List loans with filtering
  list: protectedProcedure
    .input(
      z.object({
        page: z.number().default(1),
        limit: z.number().default(20),
        status: z
          .enum([
            "pending",
            "approved",
            "disbursed",
            "repaying",
            "completed",
            "defaulted",
            "rejected",
          ])
          .optional(),
        agentId: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) return { items: [], total: 0 };
        const conditions = [];
        if (input.status) conditions.push(eq(agentLoans.status, input.status));
        if (input.agentId)
          conditions.push(eq(agentLoans.agentId, input.agentId));
        const where = conditions.length > 0 ? and(...conditions) : undefined;
        const items = await db
          .select()
          .from(agentLoans)
          .where(where)
          .orderBy(desc(agentLoans.createdAt))
          .limit(input.limit)
          .offset((input.page - 1) * input.limit);
        const [{ total }] = await db
          .select({ total: count() })
          .from(agentLoans)
          .where(where)
          .limit(100);
        return { items, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Apply for a loan
  applyLoan: protectedProcedure
    .input(
      z.object({
        agentId: z.number(),
        loanType: z.enum(["float_advance", "working_capital", "emergency"]),
        principalAmount: z.number().min(10000),
        tenorDays: z.number().min(7).max(365),
        collateralType: z.string().optional(),
        collateralValue: z.number().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        // Calculate credit score
        const creditScore = await calculateCreditScore(db, input.agentId);
        if (creditScore < MIN_CREDIT_SCORE) {
          throw new Error(
            `Credit score ${creditScore} below minimum ${MIN_CREDIT_SCORE}`
          );
        }
        // Calculate interest
        const monthlyRate = INTEREST_RATES[input.loanType] / 100;
        const months = input.tenorDays / 30;
        const totalInterest = input.principalAmount * monthlyRate * months;
        const totalRepayable = input.principalAmount + totalInterest;
        const [loan] = await db
          .insert(agentLoans)
          .values({
            agentId: input.agentId,
            loanType: input.loanType,
            principalAmount: String(input.principalAmount),
            interestRate: String(INTEREST_RATES[input.loanType]),
            tenorDays: input.tenorDays,
            totalRepayable: String(totalRepayable),
            status: "pending",
            creditScore,
            collateralType: input.collateralType,
            collateralValue: input.collateralValue
              ? String(input.collateralValue)
              : null,
            dueDate: new Date(Date.now() + input.tenorDays * 86400000),
          })
          .returning();
        return { loan, creditScore, totalInterest, totalRepayable };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Approve a loan
  approve: protectedProcedure
    .input(z.object({ loanId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .update(agentLoans)
          .set({
            status: "approved",
            approvedBy: ctx.user?.id,
            updatedAt: new Date(),
          })
          .where(eq(agentLoans.id, input.loanId));
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

  // Disburse a loan (credit agent float)
  disburse: protectedProcedure
    .input(z.object({ loanId: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [loan] = await db
          .select()
          .from(agentLoans)
          .where(eq(agentLoans.id, input.loanId))
          .limit(100);
        if (!loan) throw new Error("Loan not found");
        if (loan.status !== "approved")
          throw new Error("Loan must be approved before disbursement");
        // Credit agent float
        await db
          .update(agents)
          .set({
            premiumReserve: sql`"premiumReserve" + ${loan.principalAmount}`,
          })
          .where(eq(agents.id, loan.agentId));
        await db
          .update(agentLoans)
          .set({
            status: "disbursed",
            disbursedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(agentLoans.id, input.loanId));
        return { success: true, disbursedAmount: loan.principalAmount };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),

  // Record repayment
  recordRepayment: protectedProcedure
    .input(z.object({ loanId: z.number(), amount: z.number().min(1) }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        const [loan] = await db
          .select()
          .from(agentLoans)
          .where(eq(agentLoans.id, input.loanId))
          .limit(100);
        if (!loan) throw new Error("Loan not found");
        const newRepaid =
          parseFloat(String(loan.amountRepaid || "0")) + input.amount;
        const totalRepayable = parseFloat(String(loan.totalRepayable));
        const isFullyRepaid = newRepaid >= totalRepayable;
        await db
          .update(agentLoans)
          .set({
            amountRepaid: String(newRepaid),
            status: isFullyRepaid ? "completed" : "repaying",
            updatedAt: new Date(),
          })
          .where(eq(agentLoans.id, input.loanId));
        return {
          success: true,
          amountRepaid: newRepaid,
          remaining: totalRepayable - newRepaid,
          fullyRepaid: isFullyRepaid,
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

  // Reject a loan
  reject: protectedProcedure
    .input(z.object({ loanId: z.number(), reason: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db) throw new Error("Database unavailable");
        await db
          .update(agentLoans)
          .set({ status: "rejected", updatedAt: new Date() })
          .where(eq(agentLoans.id, input.loanId));
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

  // Get credit score for an agent
  creditScore: protectedProcedure
    .input(z.object({ agentId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        if (!db)
          return { score: 0, breakdown: {}, eligible: false, maxLoanAmount: 0 };
        const score = await calculateCreditScore(db, input.agentId);
        return {
          score,
          eligible: score >= MIN_CREDIT_SCORE,
          maxLoanAmount: score >= MIN_CREDIT_SCORE ? score * 1000 : 0,
          breakdown: CREDIT_SCORE_WEIGHTS,
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

  // Portfolio summary
  portfolioSummary: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db)
      return {
        totalLoans: 0,
        totalDisbursed: "0",
        totalRepaid: "0",
        defaultRate: 0,
        activeLoans: 0,
      };
    const [stats] = await db
      .select({
        totalLoans: count(),
        totalDisbursed: sum(agentLoans.principalAmount),
        totalRepaid: sum(agentLoans.amountRepaid),
      })
      .from(agentLoans);
    const [defaulted] = await db
      .select({ count: count() })
      .from(agentLoans)
      .where(eq(agentLoans.status, "defaulted"))
      .limit(100);
    const [active] = await db
      .select({ count: count() })
      .from(agentLoans)
      .where(sql`${agentLoans.status} IN ('disbursed', 'repaying')`);
    return {
      totalLoans: stats.totalLoans || 0,
      totalDisbursed: stats.totalDisbursed || "0",
      totalRepaid: stats.totalRepaid || "0",
      defaultRate: stats.totalLoans
        ? ((defaulted.count || 0) / stats.totalLoans) * 100
        : 0,
      activeLoans: active.count || 0,
    };
  }),
});

async function calculateCreditScore(db: any, agentId: number): Promise<number> {
  // Transaction volume score (0-300)
  const [txStats] = await db
    .select({ total: sum(transactions.amount), count: count() })
    .from(transactions)
    .where(
      and(
        eq(transactions.agentId, agentId),
        gte(transactions.createdAt, new Date(Date.now() - 90 * 86400000))
      )
    );
  const volumeScore = Math.min(((txStats.count || 0) / 100) * 300, 300);
  // Repayment history score (0-250)
  const [loanStats] = await db
    .select({ total: count() })
    .from(agentLoans)
    .where(
      and(eq(agentLoans.agentId, agentId), eq(agentLoans.status, "completed"))
    );
  const repaymentScore = Math.min((loanStats.total || 0) * 50, 250);
  // Account age score (0-200)
  const [agent] = await db
    .select()
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(100);
  const ageMonths = agent
    ? (Date.now() - new Date(agent.createdAt).getTime()) / (30 * 86400000)
    : 0;
  const ageScore = Math.min(ageMonths * 15, 200);
  // Float utilization (0-150)
  const floatScore = agent
    ? Math.min(
        (parseFloat(String(agent.premiumReserve || "0")) /
          parseFloat(String(agent.floatLimit || "1000000"))) *
          150,
        150
      )
    : 0;
  // Total (max 850, like FICO)
  return Math.round(volumeScore + repaymentScore + ageScore + floatScore);
}
