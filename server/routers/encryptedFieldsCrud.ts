// @ts-check
// DD-TSSEC (A7-4 / A7-6): encrypted field vault with honest guarantees:
//   - AES-256-GCM with a PER-RECORD random 16-byte salt and random IV; the
//     record key is scrypt(FIELD_ENCRYPTION_KEY, recordSalt) — no static salt,
//     no key derived from the JWT signing secret.
//   - The master key is REQUIRED from the environment (FIELD_ENCRYPTION_KEY);
//     there is no default. Production startup fails loud when it is missing.
//   - Access control: every record is bound to the user who stored it
//     (createdBy). list/retrieve/delete are owner-or-admin — no IDOR.
//   - Decrypt events are written to the audit log.
import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { eq, desc, count } from "drizzle-orm";
import { z } from "zod";

import { auditLog, encryptedFields } from "../../drizzle/schema";
import { logger } from "../_core/logger";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getFieldEncryptionKey } from "../lib/envValidation";


const ENCRYPTION_ALGORITHM = "aes-256-gcm";
// Identifies WHICH configured master key produced a record (supports future
// rotation: a v2 key can be introduced without invalidating v1 records).
const ENCRYPTION_KEY_ID = "field-encryption-key:v1";

function encrypt(text: string): {
  encrypted: string;
  iv: string;
  tag: string;
  salt: string;
} {
  // Per-record random salt → per-record key. Two identical plaintexts (or two
  // deployments with the same master key) never share a record key.
  const salt = crypto.randomBytes(16);
  const recordKey = crypto.scryptSync(getFieldEncryptionKey(), salt, 32);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, recordKey, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  return {
    encrypted,
    iv: iv.toString("hex"),
    tag: cipher.getAuthTag().toString("hex"),
    salt: salt.toString("hex"),
  };
}

function decrypt(
  encrypted: string,
  iv: string,
  tag: string,
  salt: string
): string {
  const recordKey = crypto.scryptSync(
    getFieldEncryptionKey(),
    Buffer.from(salt, "hex"),
    32
  );
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    recordKey,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Owner-or-admin scope check (A7-6): a record may be read/deleted only by the
 * user who stored it or by an admin. Fail-closed: legacy rows without
 * createdBy are admin-only, and a missing caller identity never matches.
 */
function assertCanAccess(
  record: { createdBy: number | null },
  user: { id: number; role: string } | null | undefined
): void {
  const isAdmin = user?.role === "admin";
  if (!isAdmin && (user == null || record.createdBy !== user.id)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Encrypted field belongs to a different user",
    });
  }
}

export const encryptedFieldsRouter = router({
  list: protectedProcedure
    .input(
      z.object({ limit: z.number().default(20), offset: z.number().default(0) })
    )
    .query(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        // Owner-or-admin scoping: non-admins only ever see their own records.
        const scope =
          ctx.user?.role === "admin"
            ? undefined
            : eq(encryptedFields.createdBy, ctx.user?.id ?? -1);
        const rows = await db
          .select()
          .from(encryptedFields)
          .where(scope)
          .orderBy(desc(encryptedFields.id))
          .limit(input.limit)
          .offset(input.offset);
        const [{ total }] = await db
          .select({ total: count() })
          .from(encryptedFields)
          .where(scope)
          .limit(100);
        // Return metadata only, not decrypted values
        return {
          items: rows.map(r => ({
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
    .mutation(async ({ input, ctx }) => {
      try {
        const db = (await getDb())!;
        const { encrypted, iv, tag, salt } = encrypt(input.plaintext);
        const [row] = await db
          .insert(encryptedFields)
          .values({
            tableName: input.entityType,
            fieldName: input.fieldName,
            encryptionKeyId: ENCRYPTION_KEY_ID,
            entityType: input.entityType,
            entityId: input.entityId,
            encryptedValue: encrypted,
            iv,
            authTag: tag,
            salt,
            createdBy: ctx.user?.id ?? null,
          })
          .returning();
        return {
          id: row.id,
          fieldName: input.fieldName,
          message:
            "Field encrypted with AES-256-GCM (per-record random salt and IV)",
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
        assertCanAccess(row, ctx.user);
        if (!row.encryptedValue || !row.iv || !row.authTag || !row.salt) {
          // Honest failure: rows without per-record crypto material (e.g.
          // written before per-record salting existed) cannot be decrypted —
          // there is no legacy static-salt fallback key to try.
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Record has no per-record crypto material and cannot be decrypted",
          });
        }
        let decrypted: string;
        try {
          decrypted = decrypt(
            row.encryptedValue,
            row.iv,
            row.authTag,
            row.salt
          );
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message:
              "Decryption failed — ciphertext is corrupt or was written under a different FIELD_ENCRYPTION_KEY",
          });
        }
        // Access audit: every successful decrypt is attributable.
        await db
          .insert(auditLog)
          .values({
            action: "encrypted_field_decrypted",
            resource: "encrypted_fields",
            resourceId: String(row.id),
            agentId: ctx.user?.id ?? null,
            status: "success",
            metadata: { fieldName: row.fieldName },
          })
          .catch(err => {
            logger.warn(
              `[encryptedFields] audit write failed for record ${row.id}: ${String(err)}`
            );
          });
        return {
          id: row.id,
          fieldName: row.fieldName,
          value: decrypted,
          accessedBy: ctx.user?.id,
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
    .mutation(async ({ input, ctx }) => {
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
        assertCanAccess(row, ctx.user);
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
