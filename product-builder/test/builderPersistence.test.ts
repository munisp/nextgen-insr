import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { ProductBuilderEngine, ProductDefinition } from "../src/engine/builder";
import { ProductStore, RunQuery } from "../src/store";

/**
 * Persistence-audit A1 regression tests (2026-10-01, C2d).
 * Real PG (PGlite) — no mocks. Verifies write-through persistence across
 * "restart" (new engine instance, same DB) and fail-closed behavior.
 */

let pglite: PGlite;
let runQuery: RunQuery;

function makeEngine(): ProductBuilderEngine {
  return new ProductBuilderEngine(new ProductStore(runQuery));
}

const SAMPLE_INPUT: Partial<ProductDefinition> = {
  name: "Hospital Cash Plus",
  type: "health",
  benefits: [
    { id: "b1", name: "Daily Hospital Cash", description: "per day", amount: 5000, type: "fixed", limit: 30, waitingPeriod: 0 },
  ],
  exclusions: ["pre-existing"],
  premiumFormula: { baseRate: 1200, factors: [{ variable: "age", type: "multiplier", values: { "18-30": 1.0 } }], minPremium: 500, maxPremium: 50000, taxes: [{ name: "VAT", rate: 0.075 }] },
  underwritingRules: [{ field: "age", operator: "lte", value: 65, action: "accept" }],
  waitingPeriod: 14,
  maxAge: 65,
  minAge: 18,
  currency: "NGN",
  regulatoryApproval: "NAICOM/2026/0042",
  createdBy: "test-officer@example.com",
};

beforeAll(async () => {
  pglite = new PGlite();
  runQuery = async <R>(text: string, params?: unknown[]) => {
    const res = await pglite.query<R>(text, params as never[]);
    return { rows: res.rows };
  };
});

afterAll(async () => {
  await pglite.close();
});

describe("A1: Postgres-backed product persistence", () => {
  it("creates a product and reads it back identically after a simulated restart", async () => {
    const engine1 = makeEngine();
    await engine1.init();

    const created = await engine1.createProduct(SAMPLE_INPUT);
    expect(created.id).toBeTruthy();
    expect(created.status).toBe("draft");
    expect(created.regulatoryApproval).toBe("NAICOM/2026/0042");

    // Simulate restart: brand-new engine instance against the SAME database.
    const engine2 = makeEngine();
    await engine2.init(); // idempotent
    const readBack = await engine2.getProduct(created.id);

    expect(readBack).toBeDefined();
    expect(readBack).toEqual(created);
  });

  it("persists updates (benefits, version bump) across restart", async () => {
    const engine1 = makeEngine();
    const created = await engine1.createProduct(SAMPLE_INPUT);

    const updated = await engine1.updateProduct(created.id, {
      name: "Hospital Cash Plus v2",
      exclusions: ["pre-existing", "cosmetic"],
    });
    expect(updated).toBeDefined();
    expect(updated!.version).toBe(created.version + 1);

    const engine2 = makeEngine(); // restart
    const readBack = await engine2.getProduct(created.id);
    expect(readBack!.name).toBe("Hospital Cash Plus v2");
    expect(readBack!.exclusions).toEqual(["pre-existing", "cosmetic"]);
    expect(readBack!.version).toBe(2);
  });

  it("persists lifecycle transitions draft→published→retired and supports status-filtered list", async () => {
    const engine1 = makeEngine();
    const created = await engine1.createProduct({ ...SAMPLE_INPUT, name: "Motor TP" });

    const pub = await engine1.publishProduct(created.id);
    expect(pub).toMatchObject({ status: "published" });

    const engine2 = makeEngine(); // restart
    expect((await engine2.getProduct(created.id))!.status).toBe("published");

    const published = await engine2.listProducts("published");
    expect(published.some((p) => p.id === created.id)).toBe(true);
    expect(published.every((p) => p.status === "published")).toBe(true);

    await engine2.retireProduct(created.id);
    const engine3 = makeEngine(); // restart
    expect((await engine3.getProduct(created.id))!.status).toBe("retired");
    expect((await engine3.listProducts("published")).some((p) => p.id === created.id)).toBe(false);
  });

  it("returns undefined for unknown ids (404 path preserved)", async () => {
    const engine = makeEngine();
    expect(await engine.getProduct("does-not-exist")).toBeUndefined();
    expect(await engine.updateProduct("does-not-exist", { name: "x" })).toBeUndefined();
    expect(await engine.publishProduct("does-not-exist")).toEqual({ error: "Product not found" });
  });

  it("FAIL-CLOSED: mutations throw loudly when PG is unavailable (no memory fallback)", async () => {
    const deadPglite = new PGlite();
    await deadPglite.close(); // simulate PG down
    const deadQuery: RunQuery = async <R>(text: string, params?: unknown[]) => {
      const res = await deadPglite.query<R>(text, params as never[]);
      return { rows: res.rows };
    };
    const engine = new ProductBuilderEngine(new ProductStore(deadQuery));

    await expect(engine.init()).rejects.toThrow();
    await expect(engine.createProduct(SAMPLE_INPUT)).rejects.toThrow();
    await expect(engine.getProduct("any-id")).rejects.toThrow();
    await expect(engine.updateProduct("any-id", { name: "x" })).rejects.toThrow();
    await expect(engine.publishProduct("any-id")).rejects.toThrow();
  });

  it("FAIL-CLOSED: a second engine against a broken DB cannot see phantom data", async () => {
    const throwingQuery: RunQuery = () => Promise.reject(new Error("connection refused"));
    const engine = new ProductBuilderEngine(new ProductStore(throwingQuery));
    await expect(engine.listProducts()).rejects.toThrow(/connection refused/);
  });
});
