/**
 * ddosTelemetry-windowkey.test.ts — I-wave (AB-22b, 2026-09)
 *
 * Proves the rate-window second dimension:
 *   - normalizeRoute collapses per-entity path segments (no cardinality bomb)
 *   - routeClientKeyFor keys by (IP, normalized route), namespaced "ipr:"
 *   - the middleware records BOTH dimensions into the counter (per-IP and
 *     per-(IP, route)) — verified against a REAL RateWindowCounter with an
 *     in-memory persist collector, via the middleware's injected counter
 */
import { describe, it, expect } from "vitest";
import {
  RateWindowCounter,
  clientKeyFor,
  routeClientKeyFor,
  normalizeRoute,
  ddosTelemetryMiddleware,
} from "./lib/ddosTelemetry";

function fakeReq(ip: string, path: string) {
  return { ip, path, socket: { remoteAddress: ip } } as never;
}
const fakeRes = {} as never;
const noop = () => {};

describe("AB-22b: ddos telemetry window keying", () => {
  it("normalizeRoute collapses numeric / uuid / long-hex segments", () => {
    expect(normalizeRoute("/api/trpc/agent.getById/12345")).toBe(
      "/api/trpc/agent.getById/:id"
    );
    expect(
      normalizeRoute("/api/users/550e8400-e29b-41d4-a716-446655440000/x")
    ).toBe("/api/users/:id/x");
    expect(normalizeRoute("/api/items/0123456789abcdef0123")).toBe(
      "/api/items/:id"
    );
    expect(normalizeRoute("/api/health")).toBe("/api/health");
  });

  it("routeClientKeyFor is stable per (ip, normalized route) and namespaced", () => {
    const a = routeClientKeyFor("10.0.0.1", "/api/trpc/merchant.pay/42");
    const b = routeClientKeyFor("10.0.0.1", "/api/trpc/merchant.pay/99");
    const c = routeClientKeyFor("10.0.0.1", "/api/trpc/other/42");
    expect(a).toBe(b); // normalized ids collapse
    expect(a).not.toBe(c); // route dimension differs
    expect(a.startsWith("ipr:")).toBe(true);
    expect(a).not.toBe(clientKeyFor("10.0.0.1")); // distinct from per-IP key
  });

  it("middleware records per-IP AND per-(IP, route) windows; single-route burst breaches", async () => {
    const buckets: Array<{ clientKey: string; count: number }> = [];
    const breaches: Array<{ clientKey: string; count: number }> = [];
    const counter = new RateWindowCounter(
      { windowSeconds: 60, threshold: 3 },
      (b, e) => {
        buckets.push(...b);
        breaches.push(...e);
      }
    );

    const ip = "192.0.2.55";
    // 4 hits on ONE route from one IP (threshold 3) across mixed ids.
    for (const id of ["1", "2", "3", "4"]) {
      ddosTelemetryMiddleware(
        fakeReq(ip, `/api/trpc/x/${id}`),
        fakeRes,
        noop,
        counter
      );
    }
    // 2 hits on a DIFFERENT route (below per-route threshold) from same IP.
    for (let i = 0; i < 2; i++) {
      ddosTelemetryMiddleware(fakeReq(ip, "/api/trpc/y"), fakeRes, noop, counter);
    }

    counter.flush();

    const bucketKeys = buckets.map(b => b.clientKey);
    const ipKey = clientKeyFor(ip);
    const routeX = routeClientKeyFor(ip, "/api/trpc/x/1");
    const routeY = routeClientKeyFor(ip, "/api/trpc/y");
    expect(bucketKeys).toContain(ipKey); // per-IP dimension
    expect(bucketKeys).toContain(routeX); // per-(IP, route) dimension
    expect(bucketKeys).toContain(routeY);

    // The single-route burst (4 on /x) breached; the 2-hit /y did not.
    // (Aggregate 6 hits may also breach the per-IP dimension — both are
    // honest signals; what must hold is the route dimension tripping.)
    const breachKeys = new Set(breaches.map(b => b.clientKey));
    expect(breachKeys.has(routeX)).toBe(true);
    expect(breachKeys.has(routeY)).toBe(false);
  });
});
