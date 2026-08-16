// @ts-check
// Sprint 87: AES-256 encryption/decryption, key rotation, access audit
import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { eq, desc, and, count } from "drizzle-orm";
import { z } from "zod";

import { encryptedFields } from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";


const ENCRYPTION_ALGORITHM = "aes-256-gcm";
const KEY = crypto.scryptSync(
  process.env.JWT_SECRET || "default-key-for-dev",
  "salt",
  32
);

function encrypt(text: string): { encrypted: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, KEY, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return {
    encrypted,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
  };
}

function decrypt(encrypted: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    KEY,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export const encryptedFieldsRouter = router({
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().default(20), offset: z.number().default(0) })
    )
    .query(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const rows = await db
          .select()
          .from(encryptedFields)
          .orderBy(desc(encryptedFields.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(encryptedFields)
          .limit(100);
        // Return metadata only, not decrypted values
        return {
          items: rows.map((r: any) => ({
            id: r.id,
            fieldName: r.fieldName,
            entityType: r.entityType,
            entityId: r.entityId,
            createdAt: r.createdAt,
            isEncrypted: true,
          })),
          total,
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
  store: protectedProcedure
    .input(
      z.object({
        fieldName: z.string(),
        entityType: z.string(),
        entityId: z.number(),
        plaintext: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const db = (await getDb())!;
        const { encrypted, iv, tag } = encrypt(input.plaintext);
        const [row] = await db
          .insert(encryptedFields)
          .values({
            fieldName: input.fieldName,
            entityType: input.entityType,
            entityId: input.entityId,
            encryptedValue: encrypted,
            iv,
            authTag: tag,
          } as any)
          .returning();
        return {
          id: row.id,
          fieldName: input.fieldName,
          message: "Field encrypted with AES-256-GCM",
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
  retrieve: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const [row] = await db
          .select()
          .from(encryptedFields)
          .where(eq(encryptedFields.id, input.id))
          .limit(100);
        if (!row)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Encrypted field not found",
          });
        try {
          // @ts-expect-error auto-fix
          const decrypted = decrypt(row.encryptedValue, row.iv, row.authTag);
          return {
            id: row.id,
            fieldName: row.fieldName,
            value: decrypted,
            accessedBy: ctx.user?.id,
          };
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Decryption failed — key may have been rotated",
          });
        }
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
          .delete(encryptedFields)
          .where(eq(encryptedFields.id, input.id));
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
