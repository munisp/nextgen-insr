// 2026-10-03 (W8-B7): Redis test-instance guard tests. The guard is the
// fail-closed boundary that keeps tests off non-test Redis instances.
import { describe, expect, it } from "vitest";
import { assertTestRedisUrl, TestRedisUrlError } from "../testRedisGuard";

const NOENV: NodeJS.ProcessEnv = {};

describe("assertTestRedisUrl", () => {
  it("accepts loopback test instances on ports 6399 and 6379", () => {
    expect(assertTestRedisUrl("redis://127.0.0.1:6399", NOENV)).toBe(
      "redis://127.0.0.1:6399"
    );
    expect(assertTestRedisUrl("redis://:redis_dev@localhost:6379", NOENV)).toBe(
      "redis://:redis_dev@localhost:6379"
    );
    // No explicit port → Redis default 6379 (allowlisted).
    expect(assertTestRedisUrl("redis://127.0.0.1", NOENV)).toBe("redis://127.0.0.1");
  });

  it("refuses non-loopback hosts with a loud message", () => {
    expect(() => assertTestRedisUrl("redis://redis.prod.internal:6379", NOENV)).toThrow(
      TestRedisUrlError
    );
    expect(() => assertTestRedisUrl("redis://10.0.0.5:6399", NOENV)).toThrow(
      /only loopback/
    );
  });

  it("refuses non-allowlisted ports and non-redis protocols", () => {
    expect(() => assertTestRedisUrl("redis://127.0.0.1:6380", NOENV)).toThrow(
      TestRedisUrlError
    );
    expect(() => assertTestRedisUrl("http://127.0.0.1:6379", NOENV)).toThrow(
      /protocol/
    );
    expect(() => assertTestRedisUrl("not a url", NOENV)).toThrow(/parseable/);
  });

  it("CHANNEL_CORE_TEST_REDIS_URL is an exact-match opt-in", () => {
    const env = { CHANNEL_CORE_TEST_REDIS_URL: "redis://testcontainer:6399" };
    expect(assertTestRedisUrl("redis://testcontainer:6399", env)).toBe(
      "redis://testcontainer:6399"
    );
    expect(() => assertTestRedisUrl("redis://127.0.0.1:6399", env)).toThrow(
      /only that exact URL/
    );
  });
});
