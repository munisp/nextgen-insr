/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROTOCOL-FAITHFUL LOCAL SIMULATOR — TEST CODE ONLY — NOT EVIDENCE OF
 * PROVIDER BEHAVIOR.
 *
 * frankfurterSimulator.ts — local HTTP server reproducing the Frankfurter
 * (ECB reference rates) API JSON shapes as documented and as consumed by the
 * production client (server/routers/fxRates.ts):
 *
 *   GET /latest?from=EUR
 *     -> 200 {"amount":1.0,"base":"EUR","date":"YYYY-MM-DD","rates":{"USD":1.09,...}}
 *   GET /{start}..{end}?from=AAA&to=BBB
 *     -> 200 {"amount":1.0,"base":"AAA","start_date":...,"end_date":...,
 *             "rates":{"YYYY-MM-DD":{"BBB":1.09}, ...}}
 *
 * Simulator modes: "normal" | "malformed" (rates with invalid values) |
 * "empty" (no rates) | "slow" (response delayed past the client timeout).
 *
 * Framework rule: official sandboxes are preferred; this simulator exists
 * ONLY because no ECB/Frankfurter test endpoint is reachable from the test
 * environment. It is a documented gap (THREAT_MODEL.md §F-02) and is NOT
 * evidence of Frankfurter/ECB-specific behavior.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export type FrankfurterSimulatorMode = "normal" | "malformed" | "empty" | "slow";

export class FrankfurterSimulator {
  private server: http.Server;
  mode: FrankfurterSimulatorMode = "normal";
  slowDelayMs = 30_000;
  readonly requests: string[] = [];

  private constructor() {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  static async start(): Promise<FrankfurterSimulator> {
    const sim = new FrankfurterSimulator();
    await new Promise<void>(resolve =>
      sim.server.listen(0, "127.0.0.1", () => resolve())
    );
    return sim;
  }

  get baseUrl(): string {
    const addr = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${addr.port}`;
  }

  async stop(): Promise<void> {
    (this.server as any).closeAllConnections?.();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    this.requests.push(url.pathname + url.search);

    if (this.mode === "slow") {
      req.socket.on("close", () => res.destroy());
      setTimeout(() => {
        try {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ rates: { USD: 1.09 } }));
        } catch {
          /* client already gone */
        }
      }, this.slowDelayMs);
      return;
    }

    if (url.pathname === "/latest") {
      if (this.mode === "malformed") {
        // Shape violation: numeric-looking strings, negative rate, junk code.
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            amount: 1.0,
            base: "EUR",
            date: "2026-01-02",
            rates: { USD: "1.09", XXX: -5, "us": 1.1 },
          })
        );
        return;
      }
      if (this.mode === "empty") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ amount: 1.0, base: "EUR", date: "2026-01-02", rates: {} }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          amount: 1.0,
          base: "EUR",
          date: "2026-01-02",
          rates: { USD: 1.0932, GBP: 0.8312, JPY: 157.41 },
        })
      );
      return;
    }

    // Time-series range: /2026-01-01..2026-01-31?from=EUR&to=USD
    const rangeMatch = url.pathname.match(/^\/(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/);
    if (rangeMatch) {
      const to = url.searchParams.get("to") ?? "USD";
      if (this.mode === "malformed") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            amount: 1.0,
            base: url.searchParams.get("from") ?? "EUR",
            start_date: rangeMatch[1],
            end_date: rangeMatch[2],
            rates: { "2026-01-02": { [to]: -1 } },
          })
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          amount: 1.0,
          base: url.searchParams.get("from") ?? "EUR",
          start_date: rangeMatch[1],
          end_date: rangeMatch[2],
          rates: {
            "2026-01-02": { [to]: 1.0932 },
            "2026-01-05": { [to]: 1.0941 },
          },
        })
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Not found" }));
  }
}
