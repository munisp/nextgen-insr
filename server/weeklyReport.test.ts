/**
 * weeklyReport.test.ts — B7 unit tests for the pure parts of the weekly
 * report engine (server/lib/weeklyReport.ts). Known-answer cases only —
 * defaultWeekWindow is pure calendar math checked against hand-computed
 * ISO-week boundaries; no mocks, no fabricated data. Section computations
 * against real seeded rows are covered in
 * tests/integration/weeklyReports.integration.test.ts.
 */
import { describe, expect, it } from "vitest";

import {
  IMPLEMENTED_SECTIONS,
  defaultWeekWindow,
} from "./lib/weeklyReport";

describe("weekly report lib (B7)", () => {
  describe("IMPLEMENTED_SECTIONS", () => {
    it("declares exactly the five sections with real data sources", () => {
      expect([...IMPLEMENTED_SECTIONS]).toEqual([
        "transactions",
        "premiums",
        "claims",
        "policies",
        "agents",
      ]);
    });
  });

  describe("defaultWeekWindow", () => {
    it("returns the last complete ISO week for a mid-week instant", () => {
      // 2026-06-10 is a Wednesday; the last complete week is
      // Mon 2026-06-01 00:00Z → Mon 2026-06-08 00:00Z.
      const { weekStart, weekEnd } = defaultWeekWindow(
        new Date("2026-06-10T15:42:11.000Z")
      );
      expect(weekStart.toISOString()).toBe("2026-06-01T00:00:00.000Z");
      expect(weekEnd.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    });

    it("a Monday instant belongs to the new week — window is the prior week", () => {
      // 2026-06-08 00:00Z is exactly the Monday boundary.
      const { weekStart, weekEnd } = defaultWeekWindow(
        new Date("2026-06-08T00:00:00.000Z")
      );
      expect(weekStart.toISOString()).toBe("2026-06-01T00:00:00.000Z");
      expect(weekEnd.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    });

    it("handles Sunday (ISO week day 7) correctly", () => {
      // 2026-06-14 is a Sunday of the week starting Mon 2026-06-08.
      const { weekStart, weekEnd } = defaultWeekWindow(
        new Date("2026-06-14T23:59:59.000Z")
      );
      expect(weekStart.toISOString()).toBe("2026-06-01T00:00:00.000Z");
      expect(weekEnd.toISOString()).toBe("2026-06-08T00:00:00.000Z");
    });

    it("window is always exactly 7 days and weekStart < weekEnd", () => {
      const { weekStart, weekEnd } = defaultWeekWindow(new Date());
      expect(weekEnd.getTime() - weekStart.getTime()).toBe(
        7 * 24 * 60 * 60 * 1000
      );
      expect(weekStart.getUTCDay()).toBe(1);
      expect(weekEnd.getUTCDay()).toBe(1);
    });
  });
});
