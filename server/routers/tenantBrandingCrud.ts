// Sprint 87: Theme validation, asset management, preview generation
import { TRPCError } from "@trpc/server";
import { eq, desc, count } from "drizzle-orm";
import { z } from "zod";

import { tenantBranding } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";

const HEX_REGEX = /^#[0-9A-Fa-f]{6,8}$/;
const ALLOWED_FONTS = [
  "Inter",
  "Roboto",
  "Open Sans",
  "Lato",
  "Poppins",
  "Montserrat",
  "Nunito",
  "DM Sans",
];

function validateHexColor(color: string): boolean {
  return HEX_REGEX.test(color);
}
function getContrastRatio(hex1: string, hex2: string): number {
  const lum = (hex: string) => {
    const rgb = parseInt(hex.slice(1), 16);
    const r = ((rgb >> 16) & 255) / 255;
    const g = ((rgb >> 8) & 255) / 255;
    const b = (rgb & 255) / 255;
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = lum(hex1),
    l2 = lum(hex2);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

export const tenantBrandingRouter = router({
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().default(20), offset: z.number().default(0) })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(tenantBranding)
          .orderBy(desc(tenantBranding.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(tenantBranding)
          .limit(100);
        return { items: rows, total };
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
          .from(tenantBranding)
          .where(eq(tenantBranding.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Branding config not found",
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
  getByTenant: protectedProcedure
    .input(z.object({ tenantId: z.number() }))
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(tenantBranding)
          .where(eq(tenantBranding.tenantId, input.tenantId))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "No branding configured for this tenant",
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
  upsert: protectedProcedure
    .input(
      z.object({
        tenantId: z.number(),
        primaryColor: z.string().optional(),
        secondaryColor: z.string().optional(),
        accentColor: z.string().optional(),
        backgroundColor: z.string().optional(),
        textColor: z.string().optional(),
        fontFamily: z.string().optional(),
        brandName: z.string().optional(),
        tagline: z.string().optional(),
        logoUrl: z.string().optional(),
        supportEmail: z.string().email().optional(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        // Validate colors
        const colorFields = [
          "primaryColor",
          "secondaryColor",
          "accentColor",
          "backgroundColor",
          "textColor",
        ] as const;
        for (const field of colorFields) {
          if (input[field] && !validateHexColor(input[field]!))
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Invalid hex color for ${field}: ${input[field]}`,
            });
        }
        // Check contrast ratio for accessibility (WCAG AA requires 4.5:1)
        if (input.backgroundColor && input.textColor) {
          const ratio = getContrastRatio(
            input.backgroundColor,
            input.textColor
          );
          if (ratio < 4.5)
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Insufficient contrast ratio (${ratio.toFixed(1)}:1). WCAG AA requires at least 4.5:1.`,
            });
        }
        if (input.fontFamily && !ALLOWED_FONTS.includes(input.fontFamily))
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Font not available. Choose from: ${ALLOWED_FONTS.join(", ")}`,
          });
        const [existing] = await db
          .select()
          .from(tenantBranding)
          .where(eq(tenantBranding.tenantId, input.tenantId))
          .limit(100);
        if (existing) {
          const [row] = await db
            .update(tenantBranding)
            .set(input)
            .where(eq(tenantBranding.tenantId, input.tenantId))
            .returning();
          return { ...row, message: "Branding updated" };
        }
        const [row] = await db
          .insert(tenantBranding)
          .values(input as any)
          .returning();
        return { ...row, message: "Branding created" };
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
        await db.delete(tenantBranding).where(eq(tenantBranding.id, input.id));
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
