/**
 * providerFx.integration.test.ts — Frankfurter (ECB) FX provider tests via
 * the REAL fxRates router (full tRPC middleware chain, real DB) (F-02,
 * THREAT_MODEL.md §F-02).
 *
 * The provider is tests/providers/frankfurterSimulator.ts — a
 * PROTOCOL-FAITHFUL LOCAL SIMULATOR implementing the Frankfurter JSON
 * shapes. It is NOT evidence of Frankfurter/ECB behavior; official-endpoint
 * verification remains an open external item.
 *
 * Scenarios:
 *   happy path refresh        -> rates persisted from provider payload
 *   (c) malformed reply       -> loud failure, stored rates NOT poisoned
 *   (a) provider timeout/down -> loud failure (no fabricated rates)
 *   historical time-series    -> parsed per documented shape; malformed day
 *                                fails loudly
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "../../server/db";
import { systemConfig } from "../../drizzle/schema";
import { FrankfurterSimulator } from "../providers/frankfurterSimulator";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "providerFx";

let sim: FrankfurterSimulator;
let savedBase: string | undefined;

async function storedEcbRates(): Promise<Record<string, number> | null> {
  const db = (await getDb())!;
  const [config] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, "fx_rates_ecb"))
    .limit(1);
  return config ? JSON.parse(String(config.value)) : null;
}

describe("frankfurter FX: fail-closed provider handling (protocol-faithful local simulator)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    sim = await FrankfurterSimulator.start();
    savedBase = process.env.FRANKFURTER_BASE_URL;
  });

  beforeEach(() => {
    process.env.FRANKFURTER_BASE_URL = sim.baseUrl;
    sim.mode = "normal";
  });

  afterAll(async () => {
    if (savedBase === undefined) delete process.env.FRANKFURTER_BASE_URL;
    else process.env.FRANKFURTER_BASE_URL = savedBase;
    await sim.stop();
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("refresh persists real provider rates (documented /latest shape)", async () => {
    const caller = callerFor(adminUser);
    const result = await caller.fxRates.refresh();
    expect(result.success).toBe(true);
    expect(result.ratesUpdated).toBeGreaterThan(1);
    const stored = await storedEcbRates();
    expect(stored).not.toBeNull();
    expect(stored!.EUR).toBe(1);
    expect(stored!.USD).toBeCloseTo(1.0932, 4);
  });

  it("(c) malformed provider reply -> loud failure, stored rates NOT poisoned", async () => {
    const caller = callerFor(adminUser);
    const before = await storedEcbRates();
    sim.mode = "malformed";
    const err = await expectTrpcError(caller.fxRates.refresh(), "INTERNAL_SERVER_ERROR");
    expect(err.message).toMatch(/malformed/i);
    const after = await storedEcbRates();
    // Either no rates were ever stored, or the previous value is untouched.
    expect(after).toEqual(before);
  });

  it("(c) empty rates object -> loud failure (no phantom refresh)", async () => {
    const caller = callerFor(adminUser);
    sim.mode = "empty";
    await expectTrpcError(caller.fxRates.refresh(), "INTERNAL_SERVER_ERROR");
  });

  it("(a) provider down -> loud failure, no fabricated rates", async () => {
    const caller = callerFor(adminUser);
    process.env.FRANKFURTER_BASE_URL = "http://127.0.0.1:9";
    const err = await expectTrpcError(caller.fxRates.refresh(), "INTERNAL_SERVER_ERROR");
    expect(err.message).toMatch(/unavailable/i);
  });

  it("getHistorical parses the documented time-series shape", async () => {
    const caller = callerFor(adminUser);
    const result = await caller.fxRates.getHistorical({
      base: "EUR",
      target: "USD",
      days: 30,
    });
    expect(result.source).toBe("frankfurter/ecb");
    expect(result.timeseries.length).toBe(2);
    expect(result.timeseries[0].date).toBe("2026-01-02");
    expect(result.timeseries[0].rate).toBeCloseTo(1.0932, 4);
  });

  it("(c) getHistorical with malformed day entry -> loud failure", async () => {
    const caller = callerFor(adminUser);
    sim.mode = "malformed";
    await expectTrpcError(
      caller.fxRates.getHistorical({ base: "EUR", target: "USD", days: 30 }),
      "INTERNAL_SERVER_ERROR"
    );
  });
});
