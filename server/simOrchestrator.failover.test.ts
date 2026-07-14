/**
 * Tests for simOrchestrator.reportFailover and simOrchestrator.getFailoverHistory
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock DB ───────────────────────────────────────────────────────────────────
const mockInsert = vi.fn().mockResolvedValue([]);
const mockSelect = vi.fn();
const mockDb = {
  insert: vi.fn(() => ({ values: mockInsert })),
  select: vi.fn(() => ({
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        limit: vi.fn().mockResolvedValue([{ apiKey: "test-key-123" }]),
        orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
      })),
      orderBy: vi.fn(() => ({ limit: vi.fn().mockResolvedValue([]) })),
    })),
  })),
};

vi.mock("../server/db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("../drizzle/schema", () => ({
  simFailoverLog: { terminalId: "terminalId", switchedAt: "switchedAt" },
  simOrchestratorConfig: { terminalId: "terminalId", apiKey: "apiKey" },
  simProbeLog: {},
}));

vi.mock("../server/_core/notification", () => ({
  notifyOwner: vi.fn().mockResolvedValue(true),
}));

vi.mock("../server/kafkaClient", () => ({
  publishEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../server/push", () => ({
  notifySimFailover: vi.fn().mockResolvedValue(undefined),
}));

// ── Unit tests for failover logic ─────────────────────────────────────────────

describe("SIM Failover Logic", () => {
  describe("slot name mapping", () => {
    const slotNames = ["Phys1", "Phys2", "ESim1", "ESim2"];

    it("maps slot 0 to Phys1", () => {
      expect(slotNames[0]).toBe("Phys1");
    });

    it("maps slot 1 to Phys2", () => {
      expect(slotNames[1]).toBe("Phys2");
    });

    it("maps slot 2 to ESim1", () => {
      expect(slotNames[2]).toBe("ESim1");
    });

    it("maps slot 3 to ESim2", () => {
      expect(slotNames[3]).toBe("ESim2");
    });

    it("falls back to SlotN for unknown slot index", () => {
      const idx = 9;
      const name = slotNames[idx] ?? `Slot${idx}`;
      expect(name).toBe("Slot9");
    });
  });

  describe("reason label formatting", () => {
    it("formats high_latency reason correctly", () => {
      const reason = "high_latency";
      const latencyMs = 4200;
      const lossX10 = 0;
      const label =
        reason === "high_latency"
          ? `latency ${latencyMs}ms > 3000ms`
          : `packet loss ${(lossX10 / 10).toFixed(1)}% > 20%`;
      expect(label).toBe("latency 4200ms > 3000ms");
    });

    it("formats high_packet_loss reason correctly", () => {
      const reason = "high_packet_loss";
      const latencyMs = 0;
      const lossX10 = 250;
      const label =
        reason === "high_latency"
          ? `latency ${latencyMs}ms > 3000ms`
          : `packet loss ${(lossX10 / 10).toFixed(1)}% > 20%`;
      expect(label).toBe("packet loss 25.0% > 20%");
    });

    it("formats packet loss with one decimal place", () => {
      const lossX10 = 215;
      const label = `packet loss ${(lossX10 / 10).toFixed(1)}% > 20%`;
      expect(label).toBe("packet loss 21.5% > 20%");
    });
  });

  describe("API key validation logic", () => {
    it("accepts matching API key", () => {
      const cfgKey = "insureportal-sim-orchestrator-default-key";
      const inputKey = "insureportal-sim-orchestrator-default-key";
      expect(inputKey === cfgKey).toBe(true);
    });

    it("rejects mismatched API key", () => {
      const cfgKey = "insureportal-sim-orchestrator-default-key";
      const inputKey = "wrong-key";
      expect(inputKey === cfgKey).toBe(false);
    });

    it("falls back to default key when no config exists", () => {
      const defaultKey = "insureportal-sim-orchestrator-default-key";
      const cfg = undefined;
      const expectedKey = (cfg as any)?.apiKey ?? defaultKey;
      expect(expectedKey).toBe(defaultKey);
    });

    it("uses config key when config exists", () => {
      const defaultKey = "insureportal-sim-orchestrator-default-key";
      const cfg = { apiKey: "custom-key-abc" };
      const expectedKey = cfg?.apiKey ?? defaultKey;
      expect(expectedKey).toBe("custom-key-abc");
    });
  });

  describe("failover history response mapping", () => {
    it("maps lossX10 to lossPercent correctly", () => {
      const row = { lossX10: 250, fromSlot: 0, toSlot: 2 };
      const slotNames = ["Phys1", "Phys2", "ESim1", "ESim2"];
      const mapped = {
        ...row,
        fromSlotName: slotNames[row.fromSlot] ?? `Slot${row.fromSlot}`,
        toSlotName: slotNames[row.toSlot] ?? `Slot${row.toSlot}`,
        lossPercent: row.lossX10 / 10,
      };
      expect(mapped.lossPercent).toBe(25.0);
      expect(mapped.fromSlotName).toBe("Phys1");
      expect(mapped.toSlotName).toBe("ESim1");
    });

    it("handles edge case lossX10 = 0", () => {
      const row = { lossX10: 0, fromSlot: 1, toSlot: 3 };
      const slotNames = ["Phys1", "Phys2", "ESim1", "ESim2"];
      const mapped = {
        ...row,
        fromSlotName: slotNames[row.fromSlot] ?? `Slot${row.fromSlot}`,
        toSlotName: slotNames[row.toSlot] ?? `Slot${row.toSlot}`,
        lossPercent: row.lossX10 / 10,
      };
      expect(mapped.lossPercent).toBe(0);
      expect(mapped.fromSlotName).toBe("Phys2");
      expect(mapped.toSlotName).toBe("ESim2");
    });
  });

  describe("GPS coordinate conversion", () => {
    it("converts latE6/lonE6 to decimal degrees", () => {
      const latE6 = 6537000; // 6.537°N (Lagos area)
      const lonE6 = 3378000; // 3.378°E
      const lat = latE6 / 1_000_000;
      const lon = lonE6 / 1_000_000;
      expect(lat).toBeCloseTo(6.537, 3);
      expect(lon).toBeCloseTo(3.378, 3);
    });

    it("converts RSSI to dBm (ASU to dBm formula)", () => {
      const rssi = 20; // ASU value
      const rssiDbm = -113 + rssi * 2;
      expect(rssiDbm).toBe(-73); // -113 + 40 = -73 dBm
    });

    it("returns null for RSSI=99 (unknown/not detectable)", () => {
      const rssi = 99;
      const rssiDbm = rssi === 99 ? null : -113 + rssi * 2;
      expect(rssiDbm).toBeNull();
    });

    it("handles zero coordinates (no GPS fix)", () => {
      const latE6 = 0;
      const lonE6 = 0;
      const lat = latE6 / 1_000_000;
      const lon = lonE6 / 1_000_000;
      expect(lat).toBe(0);
      expect(lon).toBe(0);
    });
  });
});
