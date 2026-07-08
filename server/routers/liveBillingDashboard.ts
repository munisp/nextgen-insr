// @ts-check

import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";

export const liveBillingDashboardRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        limit: z.number().default(20),
        offset: z.number().default(0),
        search: z.string().optional(),
      })
    )
    .query(async () => {
      return { data: [], total: 0, limit: 20, offset: 0 };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return { id: input.id, lastUpdated: new Date().toISOString() };
    }),

  getSummary: protectedProcedure.query(async () => {
    return { totalRecords: 0, lastUpdated: new Date().toISOString() };
  }),

  getRecent: protectedProcedure
    .input(
      z.object({ days: z.number().default(7), limit: z.number().default(10) })
    )
    .query(async () => {
      return [];
    }),

  getFinancialModelData: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        billingModel: z.string(),
        projectionYears: z.number(),
      })
    )
    .query(async () => {
      const actualMonthlyData = [
        {
          month: "2024-01",
          agents: 120,
          transactions: 45000,
          grossRevenue: 6750000,
          platformRevenue: 1890000,
          clientRevenue: 4860000,
        },
        {
          month: "2024-02",
          agents: 135,
          transactions: 52000,
          grossRevenue: 7800000,
          platformRevenue: 2184000,
          clientRevenue: 5616000,
        },
        {
          month: "2024-03",
          agents: 150,
          transactions: 60000,
          grossRevenue: 9000000,
          platformRevenue: 2520000,
          clientRevenue: 6480000,
        },
      ];
      return {
        actualMonthlyData,
        currentMonth: {
          agents: 150,
          transactionsToday: 2000,
          grossRevenueToday: 300000,
          platformRevenueToday: 84000,
        },
        operatingCosts: {
          infrastructure: 500000,
          personnel: 2000000,
          switchFees: 300000,
          grandTotal: 2800000,
        },
        modelComparison: {
          revenueShare: {
            monthlyRevenue: 2520000,
            annualRevenue: 30240000,
            marginPct: 28,
          },
          subscription: {
            monthlyRevenue: 2250000,
            annualRevenue: 27000000,
            marginPct: 25,
          },
          hybrid: {
            monthlyRevenue: 2700000,
            annualRevenue: 32400000,
            marginPct: 30,
          },
        },
        kpis: {
          totalGrossRevenue: 23550000,
          totalPlatformRevenue: 6594000,
          totalClientRevenue: 16956000,
          avgRevenuePerAgent: 43960,
          avgTransactionsPerAgent: 346,
        },
      };
    }),

  getRevenueStream: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        intervalSeconds: z.number().optional(),
      })
    )
    .query(async () => {
      return {
        timestamp: Date.now(),
        lastMinute: {
          transactions: 35,
          grossFees: 5250,
          platformShare: 1470,
        },
        lastHour: {
          transactions: 2100,
          grossFees: 315000,
          platformShare: 88200,
        },
        activeAgents: 85,
        activePosDevices: 120,
      };
    }),

  exportForFinancialModel: protectedProcedure
    .input(
      z.object({
        clientId: z.string(),
        format: z.string().default("json"),
      })
    )
    .query(async ({ input }) => {
      return {
        exportedAt: Date.now(),
        clientId: input.clientId,
        format: input.format,
        data: {
          agentNetwork: {
            currentAgents: 150,
            growthRate: 12,
            avgTransactionsPerAgent: 400,
          },
          revenue: {
            avgGrossFeeNGN: 150,
            avgPlatformSharePct: 28,
            monthlyGrossRevenue: 9000000,
          },
          costs: {
            monthlyInfrastructure: 500000,
            monthlySwitchFees: 300000,
            monthlyPersonnel: 2000000,
          },
        },
      };
    }),
});
