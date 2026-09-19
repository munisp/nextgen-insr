/**
 * policyNumberPredictability.integration.test.ts — I-wave (AB-22a, 2026-09)
 *
 * Proves against a real PGlite DB and the real bindPolicy procedure that
 * policy numbers are:
 *   - no longer the predictable `POL-${Date.now()}-${customerId}` shape
 *   - CSPRNG-random in the body (16 hex chars) while keeping the "POL-"
 *     prefix contract
 *   - unique and non-sequential across rapid back-to-back creation
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../../server/db";
import { policies, insuranceProducts } from "../../drizzle/schema";
import { policyQuotes } from "../../drizzle/schema.additions";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "policyNumberPredictability";
const PRODUCT_CODE = "IWAVE-LIFE-1";

describe("AB-22a: policy numbers are non-predictable (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    const db = (await getDb())!;
    await db
      .insert(insuranceProducts)
      .values({
        productCode: PRODUCT_CODE,
        name: "I-wave Test Life",
        coverageType: "life",
        isActive: true,
      })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
    const db = (await getDb())!;
    const [prod] = await db
      .select({ id: insuranceProducts.id })
      .from(insuranceProducts)
      .where(eq(insuranceProducts.productCode, PRODUCT_CODE))
      .limit(1);
    if (prod) {
      await db.delete(policies).where(eq(policies.productId, prod.id));
      await db.delete(insuranceProducts).where(eq(insuranceProducts.id, prod.id));
    }
  });

  it("rapid creation yields unique, non-sequential, non-predictable numbers", async () => {
    const db = (await getDb())!;
    const [prod] = await db
      .select({ id: insuranceProducts.id })
      .from(insuranceProducts)
      .where(eq(insuranceProducts.productCode, PRODUCT_CODE))
      .limit(1);

    const caller = callerFor(adminUser);
    const CUSTOMER = 881100;
    const created: string[] = [];
    // 2026-09-19 (L-wave, L-P-4): bindPolicy now consumes a REAL pending
    // policy_quotes row (quoteRef resolved server-side; premium/sumInsured
    // derived from the quote), so each iteration seeds an honest quote
    // fixture instead of passing caller-invented terms.
    await db.insert(policyQuotes).values(
      Array.from({ length: 6 }, (_, i) => ({
        customerId: CUSTOMER,
        productId: prod.id,
        sumInsured: "1000000.00",
        premiumAmount: "50000.00",
        totalPayable: "50000.00",
        status: "pending" as const,
        validUntil: new Date(Date.now() + 7 * 86_400_000),
        metadata: { quoteRef: `IWAVE-Q-${i}` },
      }))
    );
    // Back-to-back (same-millisecond) creation is the enumeration case.
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        caller.insuranceWorkflows.bindPolicy({
          quoteRef: `IWAVE-Q-${i}`,
          productId: prod.id,
          customerId: CUSTOMER,
          startDate: `2026-0${(i % 9) + 1}-15`,
        } as never)
      )
    );
    for (const r of results) {
      const p = (r as { policy?: { policyNumber?: string } }).policy;
      expect(p?.policyNumber).toBeTruthy();
      created.push(p!.policyNumber!);
    }

    // Prefix contract retained.
    for (const n of created) expect(n.startsWith("POL-")).toBe(true);
    // OLD predictable shape is gone: POL-<decimal ms>-<customerId>.
    for (const n of created)
      expect(new RegExp(`^POL-\\d+-${CUSTOMER}$`).test(n)).toBe(false);
    // New shape: POL-<base36 ms>-<16 uppercase hex> (64 bits CSPRNG).
    for (const n of created)
      expect(/^POL-[0-9A-Z]+-[0-9A-F]{16}$/.test(n)).toBe(true);
    // Unique.
    expect(new Set(created).size).toBe(created.length);
    // Non-sequential: the random bodies are all distinct even when the
    // millisecond component collides.
    const bodies = created.map(n => n.split("-").pop()!);
    expect(new Set(bodies).size).toBe(bodies.length);

    // Persisted rows match the returned numbers (no client-side fiction).
    const rows = await db
      .select({ policyNumber: policies.policyNumber })
      .from(policies)
      .where(inArray(policies.policyNumber, created));
    expect(rows.length).toBe(created.length);
  });
});
