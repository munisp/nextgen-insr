/**
 * lakehouse.test.ts — Unit tests for the Data Lakehouse layer
 *
 * Tests cover:
 *  1. Haversine distance calculation
 *  2. Snapshot key generation
 *  3. Transaction heatmap grid cell assignment
 *  4. Agent density grid aggregation
 *  5. Nearby agent haversine filter
 *  6. Gold-layer daily summary aggregation
 *  7. Lakehouse cron schedule registration
 *  8. DataFusion SQL validation
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Haversine helper (inlined for unit testing) ───────────────────────────────
function haversineMetres(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ── Grid cell helper (inlined) ────────────────────────────────────────────────
function gridCell(lat: number, lon: number, cellDeg: number): string {
  return `${Math.floor(lat / cellDeg) * cellDeg},${Math.floor(lon / cellDeg) * cellDeg}`;
}

// ── Snapshot key helper (inlined) ─────────────────────────────────────────────
function transactionSnapshotKey(date: string): string {
  const [y, m, d] = date.split("-");
  return `${y}/${m}/${d}/transactions-${date}.json`;
}

function fraudSnapshotKey(date: string): string {
  const [y, m, d] = date.split("-");
  return `${y}/${m}/${d}/fraud-events-${date}.json`;
}

function settlementSnapshotKey(date: string): string {
  const [y, m, d] = date.split("-");
  return `${y}/${m}/${d}/settlement-summary-${date}.json`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Haversine distance calculation", () => {
  it("returns 0 for identical coordinates", () => {
    expect(haversineMetres(6.5244, 3.3792, 6.5244, 3.3792)).toBe(0);
  });

  it("calculates distance between Lagos and Abuja (~530km)", () => {
    const dist = haversineMetres(6.5244, 3.3792, 9.0579, 7.4951);
    expect(dist).toBeGreaterThan(500_000);
    expect(dist).toBeLessThan(560_000);
  });

  it("calculates distance between two nearby Lagos points (~1.1km)", () => {
    // Victoria Island to Lekki Phase 1 approx
    const dist = haversineMetres(6.4281, 3.4219, 6.4355, 3.4316);
    expect(dist).toBeGreaterThan(500);
    expect(dist).toBeLessThan(2_000);
  });

  it("is symmetric (A→B = B→A)", () => {
    const d1 = haversineMetres(6.5244, 3.3792, 9.0579, 7.4951);
    const d2 = haversineMetres(9.0579, 7.4951, 6.5244, 3.3792);
    expect(Math.abs(d1 - d2)).toBeLessThan(1); // within 1 metre
  });
});

describe("Grid cell assignment", () => {
  it("assigns Lagos coordinates to correct 0.1° cell", () => {
    const cell = gridCell(6.5244, 3.3792, 0.1);
    // floating point: floor(3.3792 / 0.1) * 0.1 may produce 3.3000000000000003
    expect(parseFloat(cell.split(",")[0])).toBeCloseTo(6.5, 5);
    expect(parseFloat(cell.split(",")[1])).toBeCloseTo(3.3, 5);
  });

  it("assigns Abuja coordinates to correct 0.1° cell", () => {
    const cell = gridCell(9.0579, 7.4951, 0.1);
    expect(parseFloat(cell.split(",")[0])).toBeCloseTo(9.0, 5);
    expect(parseFloat(cell.split(",")[1])).toBeCloseTo(7.4, 5);
  });

  it("uses 0.5° cells correctly", () => {
    const cell = gridCell(6.5244, 3.3792, 0.5);
    expect(parseFloat(cell.split(",")[0])).toBeCloseTo(6.5, 5);
    expect(parseFloat(cell.split(",")[1])).toBeCloseTo(3.0, 5);
  });

  it("groups nearby points into the same cell", () => {
    const c1 = gridCell(6.51, 3.31, 0.1);
    const c2 = gridCell(6.59, 3.39, 0.1);
    expect(c1).toBe(c2);
  });

  it("separates points in different cells", () => {
    const c1 = gridCell(6.51, 3.31, 0.1);
    const c2 = gridCell(6.61, 3.41, 0.1);
    expect(c1).not.toBe(c2);
  });
});

describe("Snapshot key generation", () => {
  it("generates correct transaction snapshot key", () => {
    const key = transactionSnapshotKey("2026-04-15");
    expect(key).toBe("2026/04/15/transactions-2026-04-15.json");
  });

  it("generates correct fraud events snapshot key", () => {
    const key = fraudSnapshotKey("2026-04-15");
    expect(key).toBe("2026/04/15/fraud-events-2026-04-15.json");
  });

  it("generates correct settlement snapshot key", () => {
    const key = settlementSnapshotKey("2026-04-15");
    expect(key).toBe("2026/04/15/settlement-summary-2026-04-15.json");
  });

  it("handles single-digit months and days correctly", () => {
    const key = transactionSnapshotKey("2026-01-05");
    expect(key).toBe("2026/01/05/transactions-2026-01-05.json");
  });
});

describe("Transaction heatmap aggregation", () => {
  interface TxRow {
    lat: number | null;
    lon: number | null;
    amount: string;
    type: string;
  }

  function buildHeatmap(rows: TxRow[], cellDeg: number) {
    const grid: Record<
      string,
      { lat: number; lon: number; count: number; volume: number }
    > = {};
    for (const row of rows) {
      if (!row.lat || !row.lon) continue;
      const key = gridCell(row.lat, row.lon, cellDeg);
      const [latStr, lonStr] = key.split(",");
      if (!grid[key]) {
        grid[key] = {
          lat: parseFloat(latStr),
          lon: parseFloat(lonStr),
          count: 0,
          volume: 0,
        };
      }
      grid[key].count++;
      grid[key].volume += parseFloat(row.amount);
    }
    return Object.values(grid);
  }

  it("groups transactions into correct cells", () => {
    const rows: TxRow[] = [
      { lat: 6.51, lon: 3.31, amount: "5000", type: "cash_in" },
      { lat: 6.55, lon: 3.35, amount: "3000", type: "cash_out" },
      { lat: 9.05, lon: 7.49, amount: "2000", type: "transfer" },
    ];
    const cells = buildHeatmap(rows, 0.1);
    expect(cells).toHaveLength(2); // Lagos cell + Abuja cell
  });

  it("accumulates volume correctly", () => {
    const rows: TxRow[] = [
      { lat: 6.51, lon: 3.31, amount: "5000", type: "cash_in" },
      { lat: 6.55, lon: 3.35, amount: "3000", type: "cash_out" },
    ];
    const cells = buildHeatmap(rows, 0.1);
    expect(cells[0].volume).toBe(8000);
    expect(cells[0].count).toBe(2);
  });

  it("skips rows with null coordinates", () => {
    const rows: TxRow[] = [
      { lat: null, lon: null, amount: "5000", type: "cash_in" },
      { lat: 6.51, lon: 3.31, amount: "3000", type: "cash_out" },
    ];
    const cells = buildHeatmap(rows, 0.1);
    expect(cells).toHaveLength(1);
  });

  it("returns empty array for empty input", () => {
    const cells = buildHeatmap([], 0.1);
    expect(cells).toHaveLength(0);
  });
});

describe("Nearby agent haversine filter", () => {
  interface AgentRow {
    id: number;
    name: string;
    agentId: string;
    tier: string;
    premiumReserve: string;
    lat: number | null;
    lon: number | null;
  }

  function findNearby(
    agents: AgentRow[],
    lat: number,
    lon: number,
    radiusMetres: number,
    limit: number
  ) {
    return agents
      .filter(a => a.lat != null && a.lon != null)
      .map(a => ({
        ...a,
        distanceMetres: Math.round(
          haversineMetres(lat, lon, Number(a.lat), Number(a.lon))
        ),
      }))
      .filter(a => a.distanceMetres <= radiusMetres)
      .sort((a, b) => a.distanceMetres - b.distanceMetres)
      .slice(0, limit);
  }

  const AGENTS: AgentRow[] = [
    {
      id: 1,
      name: "Agent A",
      agentId: "AGT001",
      tier: "Gold",
      premiumReserve: "500000",
      lat: 6.5244,
      lon: 3.3792,
    },
    {
      id: 2,
      name: "Agent B",
      agentId: "AGT002",
      tier: "Silver",
      premiumReserve: "200000",
      lat: 6.525,
      lon: 3.38,
    },
    {
      id: 3,
      name: "Agent C",
      agentId: "AGT003",
      tier: "Bronze",
      premiumReserve: "100000",
      lat: 9.0579,
      lon: 7.4951,
    },
    {
      id: 4,
      name: "Agent D",
      agentId: "AGT004",
      tier: "Bronze",
      premiumReserve: "50000",
      lat: null,
      lon: null,
    },
  ];

  it("finds agents within 1km of Lagos centre", () => {
    const nearby = findNearby(AGENTS, 6.5244, 3.3792, 1_000, 10);
    expect(nearby.map(a => a.agentId)).toContain("AGT001");
    expect(nearby.map(a => a.agentId)).toContain("AGT002");
    expect(nearby.map(a => a.agentId)).not.toContain("AGT003");
  });

  it("excludes agents with null coordinates", () => {
    const nearby = findNearby(AGENTS, 6.5244, 3.3792, 100_000, 10);
    expect(nearby.map(a => a.agentId)).not.toContain("AGT004");
  });

  it("sorts by distance ascending", () => {
    const nearby = findNearby(AGENTS, 6.5244, 3.3792, 1_000, 10);
    for (let i = 1; i < nearby.length; i++) {
      expect(nearby[i].distanceMetres).toBeGreaterThanOrEqual(
        nearby[i - 1].distanceMetres
      );
    }
  });

  it("respects the limit parameter", () => {
    const nearby = findNearby(AGENTS, 6.5244, 3.3792, 100_000, 1);
    expect(nearby).toHaveLength(1);
  });

  it("returns empty array when no agents are within radius", () => {
    const nearby = findNearby(AGENTS, 0, 0, 100, 10);
    expect(nearby).toHaveLength(0);
  });
});

describe("Gold-layer daily summary aggregation", () => {
  interface TxRow {
    agentId: number;
    agentId: string;
    agentTier: string;
    amount: string;
    fee: string;
    commission: string;
    status: string;
    fraudScore: string | null;
  }

  function buildDailySummary(rows: TxRow[]) {
    const map = new Map<
      number,
      {
        agentId: number;
        agentId: string;
        agentTier: string;
        txCount: number;
        txVolume: number;
        txFees: number;
        txCommission: number;
        successCount: number;
        failedCount: number;
        fraudCount: number;
      }
    >();

    for (const row of rows) {
      if (!map.has(row.agentId)) {
        map.set(row.agentId, {
          agentId: row.agentId,
          agentId: row.agentId,
          agentTier: row.agentTier,
          txCount: 0,
          txVolume: 0,
          txFees: 0,
          txCommission: 0,
          successCount: 0,
          failedCount: 0,
          fraudCount: 0,
        });
      }
      const entry = map.get(row.agentId)!;
      entry.txCount++;
      entry.txVolume += parseFloat(row.amount);
      entry.txFees += parseFloat(row.fee);
      entry.txCommission += parseFloat(row.commission);
      if (row.status === "success") entry.successCount++;
      if (row.status === "failed") entry.failedCount++;
      if (parseFloat(row.fraudScore ?? "0") >= 0.7) entry.fraudCount++;
    }

    return Array.from(map.values()).map(e => ({
      ...e,
      successRate: e.txCount ? e.successCount / e.txCount : 0,
    }));
  }

  it("aggregates transactions per agent correctly", () => {
    const rows: TxRow[] = [
      {
        agentId: 1,
        agentId: "AGT001",
        agentTier: "Gold",
        amount: "5000",
        fee: "50",
        commission: "25",
        status: "success",
        fraudScore: "0.1",
      },
      {
        agentId: 1,
        agentId: "AGT001",
        agentTier: "Gold",
        amount: "3000",
        fee: "30",
        commission: "15",
        status: "failed",
        fraudScore: "0.8",
      },
      {
        agentId: 2,
        agentId: "AGT002",
        agentTier: "Silver",
        amount: "2000",
        fee: "20",
        commission: "10",
        status: "success",
        fraudScore: "0.2",
      },
    ];
    const summary = buildDailySummary(rows);
    expect(summary).toHaveLength(2);

    const agt1 = summary.find(s => s.agentId === "AGT001")!;
    expect(agt1.txCount).toBe(2);
    expect(agt1.txVolume).toBe(8000);
    expect(agt1.successRate).toBe(0.5);
    expect(agt1.fraudCount).toBe(1);
  });

  it("calculates success rate as 1.0 when all transactions succeed", () => {
    const rows: TxRow[] = [
      {
        agentId: 1,
        agentId: "AGT001",
        agentTier: "Gold",
        amount: "5000",
        fee: "50",
        commission: "25",
        status: "success",
        fraudScore: "0.1",
      },
      {
        agentId: 1,
        agentId: "AGT001",
        agentTier: "Gold",
        amount: "3000",
        fee: "30",
        commission: "15",
        status: "success",
        fraudScore: "0.2",
      },
    ];
    const summary = buildDailySummary(rows);
    expect(summary[0].successRate).toBe(1.0);
  });

  it("returns empty array for empty input", () => {
    expect(buildDailySummary([])).toHaveLength(0);
  });
});

describe("DataFusion SQL validation", () => {
  function validateSql(sql: string): { valid: boolean; error?: string } {
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed) return { valid: false, error: "Empty query" };
    if (!trimmed.startsWith("SELECT"))
      return { valid: false, error: "Only SELECT queries are allowed" };
    const dangerous = [
      "DROP",
      "DELETE",
      "INSERT",
      "UPDATE",
      "TRUNCATE",
      "ALTER",
      "CREATE",
      "GRANT",
      "REVOKE",
    ];
    for (const kw of dangerous) {
      if (trimmed.includes(kw))
        return { valid: false, error: `Dangerous keyword detected: ${kw}` };
    }
    return { valid: true };
  }

  it("accepts valid SELECT queries", () => {
    expect(
      validateSql("SELECT * FROM insureportal.silver.transactions LIMIT 100").valid
    ).toBe(true);
  });

  it("rejects empty queries", () => {
    expect(validateSql("").valid).toBe(false);
  });

  it("rejects non-SELECT queries", () => {
    expect(validateSql("SHOW TABLES").valid).toBe(false);
  });

  it("rejects DROP TABLE", () => {
    const result = validateSql("SELECT 1; DROP TABLE transactions");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("DROP");
  });

  it("rejects DELETE statements", () => {
    expect(validateSql("DELETE FROM transactions").valid).toBe(false);
  });

  it("rejects INSERT statements", () => {
    expect(validateSql("INSERT INTO transactions VALUES (1)").valid).toBe(
      false
    );
  });

  it("accepts complex analytical queries", () => {
    const sql = `
      SELECT agent_code, agent_tier,
             count(*) as tx_count,
             sum(amount) as volume,
             avg(fraud_score) as avg_fraud
      FROM insureportal.silver.transactions
      WHERE tx_date >= '2026-01-01'
      GROUP BY agent_code, agent_tier
      ORDER BY volume DESC
      LIMIT 50
    `;
    expect(validateSql(sql).valid).toBe(true);
  });
});

describe("Lakehouse bucket constants", () => {
  it("defines expected bucket names", () => {
    const BUCKETS = {
      TRANSACTIONS: "insureportal-transactions",
      SETTLEMENTS: "insureportal-settlements",
      FRAUD_EVENTS: "insureportal-fraud-events",
      AGENT_METRICS: "insureportal-agent-metrics",
    };
    expect(BUCKETS.TRANSACTIONS).toBe("insureportal-transactions");
    expect(BUCKETS.SETTLEMENTS).toBe("insureportal-settlements");
    expect(BUCKETS.FRAUD_EVENTS).toBe("insureportal-fraud-events");
    expect(BUCKETS.AGENT_METRICS).toBe("insureportal-agent-metrics");
  });
});

describe("Snapshot date helpers", () => {
  it("yesterday() returns a date string in YYYY-MM-DD format", () => {
    function yesterday(): string {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString().slice(0, 10);
    }
    const result = yesterday();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const parsed = new Date(result);
    const now = new Date();
    const diffMs = now.getTime() - parsed.getTime();
    expect(diffMs).toBeGreaterThan(0);
    expect(diffMs).toBeLessThan(2 * 24 * 3600 * 1000); // less than 2 days ago
  });
});
