/**
 * amlScreening.integration.test.ts — real-DB integration tests for AML
 * screening, sanctions matching, velocity risk, and CTR filing honesty.
 *
 * DD-LEGACY contract migration: a screening can only be "cleared" when a REAL
 * external sanctions provider is configured and responds no-match. These
 * tests therefore spin a REAL local HTTP stub (node:http on 127.0.0.1,
 * ephemeral port) as the provider — no fetch mocking.
 *
 * Proves:
 *   - clean entity + provider no-match → score 0 / low / cleared + filing
 *   - provider match → score 100 / critical / flagged (provider evidence)
 *   - provider NOT configured → clean entity is queued as pending_review
 *   - provider unreachable → screening_unavailable (never cleared)
 *   - a sanctions-keyword name ("Boko Haram…") scores 100 / critical / flagged
 *   - a Cyrillic-lookalike bypass attempt ("Воko Наram") is also caught
 *   - 24h velocity from 12 seeded transactions stacks with PEP (score 45)
 *   - ₦6,000,000 requires a CTR, persisted honestly as "pending"
 *   - list reads filings with a status filter
 *   - anonymous callers write nothing
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { eq, count } from "drizzle-orm";
import { getDb } from "../../server/db";
import { complianceFilings, transactions } from "../../drizzle/schema";
import {
  callerFor,
  adminUser,
  expectCounted as expect,
  expectTrpcError,
  resetAssertionCount,
  getAssertionCount,
} from "./helpers/trpc";

const FILE = "amlScreening";
const VELOCITY_ENTITY = "Velocity Trader";

// ── Real stub sanctions provider ─────────────────────────────────────────────
let provider: Server;
let providerUrl = "";
let providerMode: "nomatch" | "match" = "nomatch";

async function filingByReference(referenceNumber: string) {
  const db = (await getDb())!;
  const rows = await db
    .select()
    .from(complianceFilings)
    .where(eq(complianceFilings.referenceNumber, referenceNumber));
  return rows[0];
}

async function filingCount(): Promise<number> {
  const db = (await getDb())!;
  const [row] = await db.select({ c: count() }).from(complianceFilings);
  return Number(row?.c ?? 0);
}

describe("amlScreening router (integration, real DB)", () => {
  beforeAll(async () => {
    resetAssertionCount();
    provider = createServer((req, res) => {
      if (req.method === "POST" && req.url === "/screen") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            providerMode === "match"
              ? { match: true, lists: ["STUB-SANCTIONS-LIST"] }
              : { match: false }
          )
        );
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>(resolve =>
      provider.listen(0, "127.0.0.1", resolve)
    );
    const { port } = provider.address() as AddressInfo;
    providerUrl = `http://127.0.0.1:${port}`;
    process.env.SANCTIONS_SCREENING_URL = providerUrl;
  });

  afterAll(async () => {
    delete process.env.SANCTIONS_SCREENING_URL;
    await new Promise<void>(resolve => provider.close(() => resolve()));
    console.log(`[integration] ${FILE}: ${getAssertionCount()} assertions`);
  });

  it("clean entity + provider no-match screens to score 0 / low / cleared and persists an AML_SCREENING filing", async () => {
    providerMode = "nomatch";
    const caller = callerFor(adminUser);
    const res = await caller.amlScreening.screen({
      entityName: "Adaeze Clean Customer",
      entityType: "individual",
      amount: 10000,
    });

    expect(res.riskScore).toBe(0);
    expect(res.riskLevel).toBe("low");
    expect(res.status).toBe("cleared");
    expect(res.sanctionsScreening).toBe("external_provider");
    expect(res.requiresSar).toBe(false);
    expect(res.requiresCtr).toBe(false);

    const filing = await filingByReference(res.referenceNumber);
    expect(filing).toBeTruthy();
    expect(filing!.filingType).toBe("AML_SCREENING");
    expect(filing!.status).toBe("cleared");
  });

  it("provider match → score 100 / critical / flagged with provider evidence", async () => {
    providerMode = "match";
    const caller = callerFor(adminUser);
    const res = await caller.amlScreening.screen({
      entityName: "Ordinary Looking Name",
      entityType: "individual",
      amount: 5000,
    });

    expect(res.riskScore).toBe(100);
    expect(res.riskLevel).toBe("critical");
    expect(res.status).toBe("flagged");
    expect(res.requiresSar).toBe(true);
    expect(
      res.flags.some(f => f.startsWith("sanctions_provider_match"))
    ).toBe(true);

    const filing = await filingByReference(res.referenceNumber);
    expect(filing!.status).toBe("flagged");
    providerMode = "nomatch";
  });

  it("provider NOT configured → clean entity is queued as pending_review (never pass-by-default)", async () => {
    const saved = process.env.SANCTIONS_SCREENING_URL;
    delete process.env.SANCTIONS_SCREENING_URL;
    try {
      const caller = callerFor(adminUser);
      const res = await caller.amlScreening.screen({
        entityName: "Another Clean Customer",
        entityType: "individual",
        amount: 10000,
      });

      expect(res.riskScore).toBe(0);
      expect(res.status).toBe("pending_review");
      expect(res.sanctionsScreening).toBe("not_configured");
      expect(res.requiresSar).toBe(false);

      const filing = await filingByReference(res.referenceNumber);
      expect(filing!.status).toBe("pending_review");
    } finally {
      process.env.SANCTIONS_SCREENING_URL = saved;
    }
  });

  it("provider unreachable → screening_unavailable (never cleared)", async () => {
    const saved = process.env.SANCTIONS_SCREENING_URL;
    process.env.SANCTIONS_SCREENING_URL = "http://127.0.0.1:9"; // dead
    try {
      const caller = callerFor(adminUser);
      const res = await caller.amlScreening.screen({
        entityName: "Third Clean Customer",
        entityType: "individual",
        amount: 10000,
      });

      expect(res.status).toBe("screening_unavailable");
      expect(res.sanctionsScreening).toBe("provider_unavailable");
      expect(res.flags).toContain("sanctions_provider_unavailable");

      const filing = await filingByReference(res.referenceNumber);
      expect(filing!.status).toBe("screening_unavailable");
    } finally {
      process.env.SANCTIONS_SCREENING_URL = saved;
    }
  });

  it("sanctions-keyword name scores 100 / critical / flagged / requiresSar", async () => {
    providerMode = "nomatch";
    const caller = callerFor(adminUser);
    const res = await caller.amlScreening.screen({
      entityName: "Boko Haram Logistics Ltd",
      entityType: "organization",
      amount: 25000,
    });

    expect(res.riskScore).toBe(100);
    expect(res.riskLevel).toBe("critical");
    expect(res.status).toBe("flagged");
    expect(res.requiresSar).toBe(true);
    expect(res.flags).toContain("name_sanctions_match");

    const filing = await filingByReference(res.referenceNumber);
    expect(filing!.status).toBe("flagged");
    expect(filing!.flaggedCount).toBe(1);
  });

  it("Cyrillic-lookalike bypass attempt (Воko Наram) is also caught", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.amlScreening.screen({
      // В, о, Н, а are Cyrillic homoglyphs — must normalize to "boko haram…"
      entityName: "Воko Наram Trading Co",
      entityType: "organization",
    });

    expect(res.riskScore).toBe(100);
    expect(res.riskLevel).toBe("critical");
    expect(res.status).toBe("flagged");
    expect(res.requiresSar).toBe(true);
  });

  it("velocity from 12 seeded 24h transactions stacks with PEP (score 45)", async () => {
    const db = (await getDb())!;
    for (let i = 0; i < 12; i++) {
      await db.insert(transactions).values({
        ref: `TX-IT-VEL-${i}`,
        agentId: 1,
        type: "Cash In",
        amount: "15000.00",
        customerName: `${VELOCITY_ENTITY} Ltd`,
        status: "success",
      });
    }

    const caller = callerFor(adminUser);
    const res = await caller.amlScreening.screen({
      entityName: VELOCITY_ENTITY,
      entityType: "individual",
      isPep: true,
    });

    // 20 (medium_velocity_10+) + 25 (politically_exposed_person) = 45
    expect(res.riskScore).toBe(45);
    expect(res.flags).toContain("medium_velocity_10+");
    expect(res.flags).toContain("politically_exposed_person");
    expect(res.riskLevel).toBe("medium");
  });

  it("₦6,000,000 requires a CTR, persisted honestly as 'pending' (CBN unreachable)", async () => {
    const caller = callerFor(adminUser);
    const res = await caller.amlScreening.screen({
      entityName: "Highvalue Customer",
      entityType: "organization",
      amount: 6_000_000,
    });

    expect(res.requiresCtr).toBe(true);
    expect(res.ctrReference).toBeTruthy();

    // The CBN endpoint is not configured with a reachable URL+key, so the
    // filing must be queued as "pending" — never reported as submitted.
    const ctrFiling = await filingByReference(res.ctrReference!);
    expect(ctrFiling).toBeTruthy();
    expect(ctrFiling!.filingType).toBe("CTR");
    expect(ctrFiling!.status).toBe("pending");
    expect(ctrFiling!.submittedTo).toBe("CBN");
    expect(ctrFiling!.submittedAt).toBeNull();
  });

  it("list reads persisted filings and honours the status filter", async () => {
    const caller = callerFor(adminUser);

    const flagged = await caller.amlScreening.list({ status: "flagged" });
    expect(flagged.total).toBeGreaterThanOrEqual(2);
    expect(flagged.items.every(f => f.status === "flagged")).toBe(true);

    const cleared = await caller.amlScreening.list({ status: "cleared" });
    expect(cleared.total).toBeGreaterThanOrEqual(1);
    expect(cleared.items.every(f => f.status === "cleared")).toBe(true);

    const ctr = await caller.amlScreening.list({ status: "pending" });
    expect(ctr.items.some(f => f.filingType === "CTR")).toBe(true);
  });

  it("anonymous caller is rejected and writes nothing", async () => {
    const before = await filingCount();
    const caller = callerFor(null);
    await expectTrpcError(
      caller.amlScreening.screen({
        entityName: "Anonymous Screen Attempt",
        entityType: "individual",
      }),
      "UNAUTHORIZED"
    );
    expect(await filingCount()).toBe(before);
  });
});
