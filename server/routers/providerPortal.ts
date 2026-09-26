/**
 * providerPortal.ts — Q4 health & retention wave (2026-09-25)
 *
 * Provider (hospital) portal endpoints, Curacel model:
 *  - Provider-scoped auth REUSES the existing API-key pattern
 *    (api_keys table + SHA-256-at-rest, see developerPortal/apiKeyManagement).
 *    Staff mint provider keys via providerPortal.createProviderKey (admin);
 *    the key's scopes carry "provider:portal" and its description carries the
 *    machine-readable binding `provider:<providerCode>`. Provider procedures
 *    resolve the key from the `x-api-key` header (or explicit apiKey input
 *    for server-to-server callers), and every query is scoped to the bound
 *    providerCode — fail-closed: unresolvable/expired/foreign keys denied.
 *  - submitPreAuthorization: priced FAIL-CLOSED against provider_tariffs —
 *    no active tariff row for (providerCode, serviceCode), no quote.
 *  - checkClaimStatus: a provider sees ONLY claims explicitly bound to them
 *    (claims.metadata->>'providerCode' = their code). Foreign claims return
 *    NOT_FOUND (existence is not leaked) and every lookup is audit-logged.
 *  - Tariff CRUD is staff-gated (admin); providers can read their own
 *    tariffs only.
 */
import crypto from "crypto";

import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  apiKeys,
  auditLog,
  claims,
  providerTariffs,
} from "../../drizzle/schema";
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import type { TrpcContext } from "../_core/context";

const PROVIDER_SCOPE = "provider:portal";
const PROVIDER_DESC_RE = /^provider:([A-Za-z0-9_-]{1,64})$/;

interface ProviderIdentity {
  providerCode: string;
  apiKeyId: number;
}

/**
 * Resolve the caller's provider identity from an API key. FAIL-CLOSED on
 * every anomaly: unknown key, inactive, expired, missing scope, or a
 * malformed/missing provider binding.
 */
async function resolveProvider(
  ctx: TrpcContext,
  apiKeyInput?: string
): Promise<ProviderIdentity> {
  const headerVal = (ctx.req?.headers as Record<string, unknown> | undefined)?.[
    "x-api-key"
  ];
  const raw =
    (typeof headerVal === "string" && headerVal) || apiKeyInput || null;
  if (!raw) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Provider API key required (x-api-key header)",
    });
  }
  const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
  const db = (await getDb())!;
  const [key] = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);
  if (!key || key.status !== "active") {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid or inactive provider API key",
    });
  }
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "API key expired" });
  }
  const scopes = Array.isArray(key.scopes) ? key.scopes : [];
  if (!scopes.includes(PROVIDER_SCOPE)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "API key lacks the provider:portal scope",
    });
  }
  const match = PROVIDER_DESC_RE.exec(key.description ?? "");
  if (!match) {
    // Fail-closed: a provider key with no parseable binding scopes to nothing.
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "API key has no valid provider binding",
    });
  }
  await db.insert(auditLog).values({
    action: "provider_portal_access",
    resource: "provider_portal",
    resourceId: match[1],
    status: "success",
    metadata: { apiKeyId: key.id, providerCode: match[1] },
  } as any);
  return { providerCode: match[1], apiKeyId: key.id };
}

function generateProviderKey(): { raw: string; hash: string; prefix: string } {
  const raw = `54lk_${crypto.randomBytes(32).toString("hex")}`;
  return {
    raw,
    hash: crypto.createHash("sha256").update(raw).digest("hex"),
    prefix: raw.slice(0, 12),
  };
}

export const providerPortalRouter = router({
  // ── Staff: provider credential minting ───────────────────────────────────
  createProviderKey: adminProcedure
    .input(
      z.object({
        providerCode: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,64}$/, "Invalid provider code"),
        name: z.string().min(1).max(128),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const k = generateProviderKey();
      const [row] = await db
        .insert(apiKeys)
        .values({
          keyHash: k.hash,
          keyPrefix: k.prefix,
          name: input.name,
          description: `provider:${input.providerCode}`,
          userId: ctx.user.id,
          scopes: [PROVIDER_SCOPE],
          status: "active",
        })
        .returning();
      await db.insert(auditLog).values({
        action: "provider_key_created",
        resource: "api_keys",
        resourceId: String(row.id),
        status: "success",
        metadata: { providerCode: input.providerCode, createdBy: ctx.user.id },
      } as any);
      // Raw key is returned exactly once; only the SHA-256 hash persists.
      return { id: row.id, apiKey: k.raw, providerCode: input.providerCode };
    }),

  // ── Staff: tariff CRUD ───────────────────────────────────────────────────
  upsertTariff: adminProcedure
    .input(
      z.object({
        providerCode: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        serviceCode: z.string().min(1).max(64),
        serviceName: z.string().max(256).optional(),
        negotiatedPrice: z.number().positive().max(1_000_000_000),
        currency: z.string().length(3).default("NGN"),
        active: z.boolean().default(true),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = (await getDb())!;
      const [existing] = await db
        .select()
        .from(providerTariffs)
        .where(
          and(
            eq(providerTariffs.providerCode, input.providerCode),
            eq(providerTariffs.serviceCode, input.serviceCode)
          )
        )
        .limit(1);
      let row;
      if (existing) {
        [row] = await db
          .update(providerTariffs)
          .set({
            serviceName: input.serviceName ?? existing.serviceName,
            negotiatedPrice: String(input.negotiatedPrice),
            currency: input.currency,
            active: input.active,
            updatedAt: new Date(),
          })
          .where(eq(providerTariffs.id, existing.id))
          .returning();
      } else {
        [row] = await db
          .insert(providerTariffs)
          .values({
            providerCode: input.providerCode,
            serviceCode: input.serviceCode,
            serviceName: input.serviceName ?? null,
            negotiatedPrice: String(input.negotiatedPrice),
            currency: input.currency,
            active: input.active,
          })
          .returning();
      }
      await db.insert(auditLog).values({
        action: existing
          ? "provider_tariff_updated"
          : "provider_tariff_created",
        resource: "provider_tariffs",
        resourceId: String(row.id),
        status: "success",
        metadata: {
          providerCode: input.providerCode,
          serviceCode: input.serviceCode,
          staffId: ctx.user.id,
        },
      } as any);
      return row;
    }),

  listTariffs: adminProcedure
    .input(
      z.object({ providerCode: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })
    )
    .query(async ({ input }) => {
      const db = (await getDb())!;
      const rows = await db
        .select()
        .from(providerTariffs)
        .where(eq(providerTariffs.providerCode, input.providerCode))
        .orderBy(desc(providerTariffs.updatedAt))
        .limit(200);
      return { tariffs: rows, count: rows.length };
    }),

  // ── Provider: read own tariffs (API-key auth, provider-scoped) ──────────
  // publicProcedure: the API key IS the credential here — resolveProvider is
  // the fail-closed gate; no user session exists for partner systems.
  myTariffs: publicProcedure
    .input(z.object({ apiKey: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const identity = await resolveProvider(ctx, input?.apiKey);
      const db = (await getDb())!;
      const rows = await db
        .select()
        .from(providerTariffs)
        .where(eq(providerTariffs.providerCode, identity.providerCode))
        .orderBy(desc(providerTariffs.updatedAt))
        .limit(200);
      return {
        providerCode: identity.providerCode,
        tariffs: rows,
        count: rows.length,
      };
    }),

  // ── Provider: submit a pre-authorization request priced off the tariff ───
  submitPreAuthorization: publicProcedure
    .input(
      z.object({
        apiKey: z.string().optional(),
        serviceCode: z.string().min(1).max(64),
        // Pseudonymous member reference (e.g. policy/member number) — the
        // pre-auth record is a pricing/authorization request, not a chart.
        memberRef: z.string().min(1).max(128),
        notes: z.string().max(1000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const identity = await resolveProvider(ctx, input.apiKey);
      const db = (await getDb())!;
      const [tariff] = await db
        .select()
        .from(providerTariffs)
        .where(
          and(
            eq(providerTariffs.providerCode, identity.providerCode),
            eq(providerTariffs.serviceCode, input.serviceCode),
            eq(providerTariffs.active, true)
          )
        )
        .limit(1);
      if (!tariff) {
        // Fail-closed pricing (Curacel discipline): no negotiated tariff,
        // no pre-auth quote — the request is denied, not guessed.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No active negotiated tariff for service ${input.serviceCode} under your provider agreement; pre-authorization cannot be priced`,
        });
      }
      const preAuthRef = `preauth-${Date.now()}-${crypto
        .randomBytes(6)
        .toString("hex")}`;
      // Durable, auditable pre-auth record (append-only audit trail): the
      // priced quote is persisted with the negotiated tariff snapshot so the
      // adjudication team can approve/deny against the exact quoted price.
      await db.insert(auditLog).values({
        action: "provider_preauth_requested",
        resource: "provider_preauth",
        resourceId: preAuthRef,
        status: "success",
        metadata: {
          providerCode: identity.providerCode,
          serviceCode: input.serviceCode,
          memberRef: input.memberRef,
          quotedPrice: tariff.negotiatedPrice,
          currency: tariff.currency,
          tariffId: tariff.id,
          notes: input.notes ?? null,
        },
      } as any);
      return {
        preAuthRef,
        providerCode: identity.providerCode,
        serviceCode: input.serviceCode,
        quotedPrice: tariff.negotiatedPrice,
        currency: tariff.currency,
        status: "submitted",
      };
    }),

  // ── Provider: check status of THEIR claims only ──────────────────────────
  checkClaimStatus: publicProcedure
    .input(
      z.object({
        apiKey: z.string().optional(),
        claimId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      const identity = await resolveProvider(ctx, input.apiKey);
      const db = (await getDb())!;
      const rows = await db
        .select({
          id: claims.id,
          claimNumber: claims.claimNumber,
          status: claims.status,
          reportedDate: claims.reportedDate,
          providerCode: sql<
            string | null
          >`${claims.metadata}->>'providerCode'`,
        })
        .from(claims)
        .where(eq(claims.id, input.claimId))
        .limit(1);
      const claim = rows[0];
      const allowed = claim && claim.providerCode === identity.providerCode;
      await db.insert(auditLog).values({
        action: "provider_claim_status_check",
        resource: "claims",
        resourceId: String(input.claimId),
        // audit_status enum: success|failure|warning; metadata.allowed
        // carries the denial.
        status: allowed ? "success" : "failure",
        metadata: {
          providerCode: identity.providerCode,
          allowed,
        },
      } as any);
      if (!allowed) {
        // Fail-closed scoping: foreign/unbound claims are indistinguishable
        // from nonexistent ones — no existence leak.
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Claim not found for your provider account",
        });
      }
      return {
        claimNumber: claim.claimNumber,
        status: claim.status,
        reportedDate: claim.reportedDate,
      };
    }),
});
