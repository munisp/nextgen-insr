/**
 * insuranceServiceFleet.ts — Insurance Service Fleet Management stub.
 *
 * 2026-11-27 (W32-C): added `getStats`, ported from main's
 * server/routers/insuranceServiceFleet.ts getStats (real status aggregate
 * over the pos_terminals fleet table — the same procedure main's identical
 * TerminalFleetPage client calls as trpc.insuranceServiceFleet.getStats).
 * Port deltas vs main (documented):
 *   - Imports adapted to portal conventions (`posTerminals` from "@schema";
 *     main imports it from "../../drizzle/schema.additions").
 *   - main's `// @ts-expect-error middleware type mismatch` directive on the
 *     `total` line is dropped: under the portal tsconfig (strict:false,
 *     noImplicitAny:false) the suppressed error does not fire, so the
 *     directive would itself raise TS2578 (unused '@ts-expect-error').
 *   - Null-db arm kept verbatim from main (fail-closed zero counts), the
 *     house fail-closed-empty posture (cf. W29 taxCollection).
 * The pre-existing stub `list` is unchanged (out of scope for the W32-C
 * contract-drift sites; no client caller depends on it).
 */
import { router, protectedProcedure } from "../_core/trpc";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { posTerminals } from "@schema";
import { getDb } from "../db";

export const insuranceServiceFleetRouter = router({
  list: protectedProcedure.query(async () => {
    return { items: [], total: 0 };
  }),

  // ── Fleet status aggregate (ported from main's getStats) ────────────────
  getStats: protectedProcedure.query(async () => {
    const db = (await getDb())!;
    if (!db)
      return {
        total: 0,
        active: 0,
        inactive: 0,
        maintenance: 0,
        unassigned: 0,
      };

    const rows = await db
      .select({
        status: posTerminals.status,
        cnt: sql<number>`count(*)::int`,
      })
      .from(posTerminals)
      .groupBy(posTerminals.status);

    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.status] = r.cnt;

    return {
      total: Object.values(counts).reduce((a, b) => a + b, 0),
      active: counts["active"] ?? 0,
      inactive: counts["inactive"] ?? 0,
      maintenance: counts["maintenance"] ?? 0,
      unassigned: counts["unassigned"] ?? 0,
    };
  }),
});
