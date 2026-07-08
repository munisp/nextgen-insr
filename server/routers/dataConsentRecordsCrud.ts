// @ts-check

// Sprint 87: GDPR/NDPR compliance, consent expiry, withdrawal workflow
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { dataConsentRecords } from "../../drizzle/schema";
import { eq, desc, and, count, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

const CONSENT_TYPES = [
  "data_processing",
  "marketing",
  "analytics",
  "third_party_sharing",
  "biometric",
];
const CONSENT_EXPIRY_DAYS = 365;

export const dataConsentRecordsRouter = router({
  list: protectedProcedure
    .input(
      z.object({
        userId: z.number().optional(),
        consentType: z.string().optional(),
        limit: z.number().default(20),
        offset: z.number().default(0),
      })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const conditions: any[] = [];
        if (input.userId)
          conditions.push(
            eq(dataConsentRecords.userAgent, input.userId as any)
          );
        if (input.consentType)
          conditions.push(
            eq(dataConsentRecords.consentType, input.consentType)
          );
        const rows = await db
          .select()
          .from(dataConsentRecords)
          .where(conditions.length ? and(...conditions) : undefined)
          .orderBy(desc(dataConsentRecords.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(dataConsentRecords)
          .where(conditions.length ? and(...conditions) : undefined)
          .limit(100);
        const enriched = rows.map((r: any) => ({
          ...r,
          isExpired: r.expiresAt ? new Date(r.expiresAt) < new Date() : false,
        }));
        return { items: enriched, total };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(dataConsentRecords)
          .where(eq(dataConsentRecords.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Consent record not found",
          });
        return row;
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            error instanceof Error ? error.message : "Internal server error",
        });
      }
    }),
  grantConsent: protectedProcedure
    .input(
      z.object({
        userId: z.number(),
        consentType: z.enum([
          "data_processing",
          "marketing",
          "analytics",
          "third_party_sharing",
          "biometric",
        ]),
        ipAddress: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const expiresAt = new Date(Date.now() + CONSENT_EXPIRY_DAYS * 86400000);
        const [row] = await db
          .insert(dataConsentRecords)
          .values({
            ...input,
            status: "granted",
            grantedAt: new Date(),
            expiresAt,
          } as any)
          .returning();
        return {
          ...row,
          message: `Consent granted for ${input.consentType}. Expires: ${expiresAt.toISOString()}`,
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
  withdrawConsent: protectedProcedure
    .input(z.object({ id: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [record] = await db
          .select()
          .from(dataConsentRecords)
          .where(eq(dataConsentRecords.id, input.id))
          .limit(100);
        if (!record)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Consent record not found",
          });
        await db
          .update(dataConsentRecords)
          .set({
            withdrawalReason: input.reason,
          } as any)
          .where(eq(dataConsentRecords.id, input.id));
        return {
          success: true,
          message: "Consent withdrawn per NDPR Article 2.3",
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
  getComplianceStatus: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const records = await db
          .select()
          .from(dataConsentRecords)
          .where(eq(dataConsentRecords.userAgent, input.userId as any))
          .limit(100);
        const active = records.filter(
          (r: any) =>
            r.status === "granted" &&
            (!r.expiresAt || new Date(r.expiresAt) > new Date())
        );
        const missing = CONSENT_TYPES.filter(
          t => !active.find((r: any) => r.consentType === t)
        );
        return {
          userId: input.userId,
          activeConsents: active.length,
          missingConsents: missing,
          isCompliant:
            missing.filter(m => m === "data_processing").length === 0,
          consentTypes: CONSENT_TYPES,
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
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        await db
          .delete(dataConsentRecords)
          .where(eq(dataConsentRecords.id, input.id));
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
});
