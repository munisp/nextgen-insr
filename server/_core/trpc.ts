import { NOT_ADMIN_ERR_MSG, UNAUTHED_ERR_MSG } from "@shared/const";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { TrpcContext } from "./context";
import { permifyCheck } from "../_core/permify";
import { createObservabilityMiddleware } from "../middleware/observabilityMiddleware";
import { createSidecarMiddleware } from "../middleware/sidecarIntegration";

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
});

export const router = t.router;
export const middleware = t.middleware;

// ── Observability middleware: instruments ALL procedures with Kafka, Redis,
//    Fluvio, TigerBeetle (fire-and-forget, fail-open) ────────────────────────
const observability = createObservabilityMiddleware(t);
const sidecarMiddleware = createSidecarMiddleware(t);

// Base: t.procedure.use(observability) applied to all procedure levels
export const publicProcedure = t.procedure
  .use(observability)
  .use(sidecarMiddleware);

// ── requireUser: verify JWT session ──────────────────────────────────────────
const requireUser = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// ── requirePermify: enforce Permify "can_access" check for authenticated users
// FAIL-CLOSED: when Permify is unreachable, permifyCheck denies access and
// emits an alert-level log (see server/_core/permify.ts). Fail-open is only
// possible via the explicit, insecure opt-in env PERMIFY_FAIL_OPEN=true,
// which logs a loud startup warning and must never be used in production
// outside a declared incident.
const requirePermify = t.middleware(async opts => {
  const { ctx, next } = opts;

  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }

  // Permify check: user:<userId> can "access" system:insurance-portal
  // This is the base access gate — resource-level checks are done per-procedure.
  const allowed = await permifyCheck({
    subjectType: "user",
    subjectId: String(ctx.user.id),
    entityType: "system",
    entityId: "insurance-portal",
    permission: "access",
  });

  if (!allowed) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Access denied by authorization policy",
    });
  }

  return next({
    ctx: {
      ...ctx,
      user: ctx.user,
    },
  });
});

// ── protectedProcedure: JWT auth + Permify base access check ─────────────────
// Chain: protectedProcedure = t.procedure.use(observability).use(requireUser).use(requirePermify)
export const protectedProcedure = t.procedure
  .use(observability)
  .use(sidecarMiddleware)
  .use(requireUser)
  .use(requirePermify);

// ── adminProcedure: JWT auth + role=admin + Permify admin check ───────────────
// Chain: adminProcedure = t.procedure.use(observability).use(requireUser).use(requireAdmin)
export const adminProcedure = t.procedure
  .use(observability)
  .use(sidecarMiddleware)
  .use(
    t.middleware(async opts => {
      const { ctx, next } = opts;

      if (!ctx.user) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: UNAUTHED_ERR_MSG,
        });
      }

      if (ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
      }

      // Permify check: user:<userId> can "admin_access" system:insurance-portal
      const allowed = await permifyCheck({
        subjectType: "user",
        subjectId: String(ctx.user.id),
        entityType: "system",
        entityId: "insurance-portal",
        permission: "admin_access",
      });

      if (!allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access denied by authorization policy",
        });
      }

      return next({
        ctx: {
          ...ctx,
          user: ctx.user,
        },
      });
    })
  );
