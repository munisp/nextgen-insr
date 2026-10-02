/**
 * 2026-10-02 (A5): CSAT survey persistence tests — persistence-audit row A5.
 *
 * The in-memory `surveyStore` array in agentOperations.ts is REMOVED;
 * submitSurvey/getSurveyStats/getSurveyForSession are now async and persist
 * to the PG table csat_surveys (drizzle/schema.ts), FAIL-CLOSED.
 *
 * These tests run against a REAL PGlite (in-process Postgres) — no mocks.
 * The drizzle handle is injected via __setSurveyPersistenceDbForTesting
 * (same wave-1 pattern as classB-persistence.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import {
  submitSurvey,
  getSurveyStats,
  getSurveyForSession,
  __setSurveyPersistenceDbForTesting,
} from "../agentOperations";

let pglite: PGlite;

beforeAll(async () => {
  pglite = new PGlite();
  await pglite.exec(`
    CREATE TABLE csat_surveys (
      id SERIAL PRIMARY KEY,
      "sessionId" INTEGER NOT NULL,
      "userId" VARCHAR(128) NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT NOT NULL,
      categories JSONB NOT NULL,
      "submittedAt" TIMESTAMP DEFAULT NOW() NOT NULL
    );
    CREATE INDEX csat_session_idx ON csat_surveys ("sessionId");
    CREATE INDEX csat_submitted_idx ON csat_surveys ("submittedAt");
  `);
  __setSurveyPersistenceDbForTesting(drizzle(pglite));
});

afterAll(async () => {
  __setSurveyPersistenceDbForTesting(null);
  await pglite.close();
});

describe("csat_surveys PG persistence (A5)", () => {
  it("submitSurvey → getSurveyForSession round-trip persists to PG", async () => {
    const before = Date.now();
    const saved = await submitSurvey({
      sessionId: 9001,
      userId: "user-a5-1",
      rating: 7, // out of range — must clamp to 5
      comment: "Excellent claims support",
      categories: ["helpful", "fast"],
    });
    expect(saved.rating).toBe(5);
    expect(saved.submittedAt).toBeGreaterThanOrEqual(before);

    // Prove the row is REALLY in Postgres, not memory.
    const raw = await pglite.query<{
      sessionId: number;
      userId: string;
      rating: number;
      comment: string;
      categories: string[];
    }>(`SELECT * FROM csat_surveys WHERE "sessionId" = 9001`);
    expect(raw.rows).toHaveLength(1);
    expect(raw.rows[0].userId).toBe("user-a5-1");
    expect(raw.rows[0].rating).toBe(5);
    expect(raw.rows[0].categories).toEqual(["helpful", "fast"]);

    const fetched = await getSurveyForSession(9001);
    expect(fetched).toBeDefined();
    expect(fetched).toMatchObject({
      sessionId: 9001,
      userId: "user-a5-1",
      rating: 5,
      comment: "Excellent claims support",
      categories: ["helpful", "fast"],
    });
  });

  it("getSurveyStats aggregates persisted rows (distribution, categories, NPS)", async () => {
    await submitSurvey({
      sessionId: 9002,
      userId: "user-a5-2",
      rating: 1,
      comment: "Slow",
      categories: ["slow"],
    });

    const stats = await getSurveyStats();
    expect(stats.totalResponses).toBe(2);
    expect(stats.ratingDistribution[5]).toBe(1);
    expect(stats.ratingDistribution[1]).toBe(1);
    expect(stats.averageRating).toBe(3);
    expect(stats.topFeedbackCategories[0]).toEqual({
      category: "helpful",
      count: 1,
    });
    // promoters (>=4): 1, detractors (<=2): 1 → NPS 0
    expect(stats.npsScore).toBe(0);
  });

  it("restart simulation: a fresh drizzle handle over the same DB still reads the surveys", async () => {
    // The module holds NO survey state anymore, so a fresh drizzle handle
    // over the same PGlite database models a process restart: the data MUST
    // survive (it lives in Postgres, not in process memory).
    __setSurveyPersistenceDbForTesting(drizzle(pglite));
    try {
      const fetched = await getSurveyForSession(9001);
      expect(fetched?.userId).toBe("user-a5-1");
      const stats = await getSurveyStats();
      expect(stats.totalResponses).toBe(2);
    } finally {
      __setSurveyPersistenceDbForTesting(drizzle(pglite));
    }
  });

  it("getSurveyForSession returns undefined for an unknown session", async () => {
    expect(await getSurveyForSession(999999)).toBeUndefined();
  });

  it("fail-closed: submitSurvey/getSurveyStats/getSurveyForSession THROW when the DB is unavailable", async () => {
    // 2026-10-02 (A5): force the genuine null-DB input through the real
    // getDb path (spy returns null for exactly these calls) — the SUT is the
    // fail-closed guard in resolveSurveyDb(), not a mocked survey module.
    // Pattern per emailQueue.pglite.test.ts (2026-10-02, C2-ci).
    __setSurveyPersistenceDbForTesting(null);
    const dbModule = await import("../../db");
    try {
      let spy = vi.spyOn(dbModule, "getDb").mockResolvedValueOnce(null);
      await expect(
        submitSurvey({
          sessionId: 9100,
          userId: "user-a5-x",
          rating: 3,
          comment: "must not persist",
          categories: [],
        })
      ).rejects.toThrow(/unavailable|fail-closed/i);
      spy.mockRestore();

      spy = vi.spyOn(dbModule, "getDb").mockResolvedValueOnce(null);
      await expect(getSurveyStats()).rejects.toThrow(/unavailable|fail-closed/i);
      spy.mockRestore();

      spy = vi.spyOn(dbModule, "getDb").mockResolvedValueOnce(null);
      await expect(getSurveyForSession(9001)).rejects.toThrow(
        /unavailable|fail-closed/i
      );
      spy.mockRestore();
    } finally {
      __setSurveyPersistenceDbForTesting(drizzle(pglite));
    }

    // Nothing slipped in during the outage.
    const raw = await pglite.query(
      `SELECT * FROM csat_surveys WHERE "sessionId" = 9100`
    );
    expect(raw.rows).toHaveLength(0);
  });
});
