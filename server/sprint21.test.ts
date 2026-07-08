// @ts-check

import { describe, it, expect, beforeEach } from "vitest";
import {
  generateWeeklyReport,
  getReportHistory,
  getReportById,
  getScheduleConfig,
  updateScheduleConfig,
  startWeeklyReportCron,
  stopWeeklyReportCron,
} from "./lib/weeklyReportGenerator";

describe("Sprint 21 — Weekly Report Generator", () => {
  describe("generateWeeklyReport", () => {
    it("should generate a report with all metric sections", async () => {
      const report = await generateWeeklyReport(false);
      expect(report).toBeDefined();
      expect(report.id).toMatch(/^WR-/);
      expect(report.generatedAt).toBeTruthy();
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
      expect(report.period.start).toBeTruthy();
      expect(report.period.end).toBeTruthy();
    });

    it("should include transaction metrics", async () => {
      const report = await generateWeeklyReport(false);
      const tx = report.metrics.transactions;
      expect(tx.totalCount).toBeGreaterThan(0);
      expect(tx.totalValue).toBeGreaterThan(0);
      expect(tx.successRate).toBeGreaterThan(0);
      expect(tx.avgPerDay).toBeGreaterThan(0);
      expect(tx.peakDay).toBeTruthy();
      expect(Object.keys(tx.byType).length).toBeGreaterThan(0);
    });

    it("should include user activity metrics", async () => {
      const report = await generateWeeklyReport(false);
      const ua = report.metrics.userActivity;
      expect(ua.totalActiveUsers).toBeGreaterThan(0);
      expect(ua.totalSessions).toBeGreaterThan(0);
      expect(ua.avgSessionDuration).toBeTruthy();
      expect(ua.returningUserRate).toBeGreaterThan(0);
    });

    it("should include API performance metrics", async () => {
      const report = await generateWeeklyReport(false);
      const api = report.metrics.apiPerformance;
      expect(api.totalRequests).toBeGreaterThan(0);
      expect(api.p50Ms).toBeGreaterThan(0);
      expect(api.p95Ms).toBeGreaterThanOrEqual(api.p50Ms);
      expect(api.p99Ms).toBeGreaterThanOrEqual(api.p95Ms);
      expect(api.slowestEndpoints.length).toBeGreaterThan(0);
    });

    it("should include error metrics", async () => {
      const report = await generateWeeklyReport(false);
      const err = report.metrics.errors;
      expect(err.totalErrors).toBeGreaterThanOrEqual(0);
      expect(err.errorRate).toBeGreaterThanOrEqual(0);
      expect(err.topErrors.length).toBeGreaterThan(0);
    });

    it("should include security metrics", async () => {
      const report = await generateWeeklyReport(false);
      const sec = report.metrics.security;
      expect(sec.blockedIPs).toBeGreaterThanOrEqual(0);
      expect(sec.failedLogins).toBeGreaterThanOrEqual(0);
      expect(sec.rateLimitHits).toBeGreaterThanOrEqual(0);
    });

    it("should include system metrics", async () => {
      const report = await generateWeeklyReport(false);
      const sys = report.metrics.system;
      expect(sys.uptimePercent).toBeGreaterThanOrEqual(0);
      expect(sys.memoryUsageMB).toBeGreaterThan(0);
    });

    it("should generate a formatted summary string", async () => {
      const report = await generateWeeklyReport(false);
      expect(report.summary).toContain("Weekly System Health Report");
      expect(report.summary).toContain("Transactions");
      expect(report.summary).toContain("User Activity");
      expect(report.summary).toContain("API Performance");
      expect(report.summary).toContain("Security");
    });

    it("should store reports in history", async () => {
      const before = getReportHistory().length;
      await generateWeeklyReport(false);
      expect(getReportHistory().length).toBe(before + 1);
    });
  });

  describe("getReportById", () => {
    it("should retrieve a report by ID", async () => {
      const report = await generateWeeklyReport(false);
      const found = getReportById(report.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(report.id);
    });

    it("should return undefined for non-existent ID", () => {
      expect(getReportById("NONEXISTENT")).toBeUndefined();
    });
  });

  describe("schedule configuration", () => {
    it("should return default schedule config", () => {
      const config = getScheduleConfig();
      expect(config.enabled).toBe(true);
      expect(config.dayOfWeek).toBe(1); // Monday
      expect(config.hourUtc).toBe(8);
      expect(config.notifyOwner).toBe(true);
    });

    it("should update schedule config", () => {
      const updated = updateScheduleConfig({ dayOfWeek: 5, hourUtc: 14 });
      expect(updated.dayOfWeek).toBe(5);
      expect(updated.hourUtc).toBe(14);
      // Reset
      updateScheduleConfig({ dayOfWeek: 1, hourUtc: 8 });
    });
  });

  describe("cron lifecycle", () => {
    it("should start and stop cron without errors", () => {
      expect(() => startWeeklyReportCron()).not.toThrow();
      expect(() => stopWeeklyReportCron()).not.toThrow();
    });
  });

  describe("health score calculation", () => {
    it("should produce a score between 0 and 100", async () => {
      const report = await generateWeeklyReport(false);
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });
  });

  describe("alerts and recommendations", () => {
    it("should produce arrays for alerts and recommendations", async () => {
      const report = await generateWeeklyReport(false);
      expect(Array.isArray(report.alerts)).toBe(true);
      expect(Array.isArray(report.recommendations)).toBe(true);
    });
  });
});
