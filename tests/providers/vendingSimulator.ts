/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROTOCOL-FAITHFUL LOCAL SIMULATOR — TEST CODE ONLY — NOT EVIDENCE OF
 * PROVIDER BEHAVIOR.
 *
 * vendingSimulator.ts — local HTTP server implementing the vending /
 * bill-payment / mobile-money provider wire protocol consumed by
 * server/lib/providerDispatch.ts (VTpass/Baxi/Reloadly-style JSON APIs):
 *
 *   POST /vend | /pay | /cashin | /cashout
 *     request:  JSON {...operation fields, reference, api_key?}
 *     accept:   200 {"status":"success","provider_ref":"..."}
 *     reject:   400 {"status":"error","message":"..."}   (definitive)
 *   GET  /status/{reference}
 *     -> 200 {"status":"completed"|"pending"|"failed","provider_ref":"..."}
 *
 * Idempotency is provider-side too: a second POST with an already-known
 * reference returns the SAME provider_ref (never a second effect), matching
 * how real vending providers treat idempotency keys.
 *
 * Simulator modes:
 *   "normal"        — accept immediately, status completes on lookup
 *   "drop_response" — accept + record the operation, then HOLD the response
 *                     past the client timeout ("accepted but reply lost")
 *   "malformed"     — 200 with an unrecognized body (no status field)
 *   "reject"        — definitive 400 rejection
 *   "error500"      — 500 (outcome unknown)
 *
 * Framework rule: official sandboxes are preferred; this simulator exists
 * ONLY because no vending/bill/mobile-money provider sandbox is reachable
 * from the test environment. It is a documented gap (THREAT_MODEL.md §F-02)
 * and is NOT evidence of provider-specific behavior.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export type VendingSimulatorMode =
  | "normal"
  | "drop_response"
  | "malformed"
  | "reject"
  | "error500";

export interface VendingOperation {
  path: string;
  reference: string;
  payload: Record<string, unknown>;
  providerRef: string;
  receivedAt: number;
}

export class VendingSimulator {
  private server: http.Server;
  private counter = 0;
  mode: VendingSimulatorMode = "normal";
  /** reference -> terminal status reported by GET /status/{reference}. */
  readonly statuses = new Map<string, "completed" | "pending" | "failed">();
  /** reference -> operation (insertion order preserved). */
  readonly operations = new Map<string, VendingOperation>();

  private constructor() {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  static async start(): Promise<VendingSimulator> {
    const sim = new VendingSimulator();
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

  /** How many operations the provider accepted for a reference (dedup-safe). */
  acceptedCount(reference: string): number {
    return this.operations.has(reference) ? 1 : 0;
  }

  private record(path: string, payload: Record<string, unknown>): VendingOperation {
    const reference = String(payload.reference ?? "");
    const existing = this.operations.get(reference);
    if (existing) return existing; // provider-side idempotency
    const op: VendingOperation = {
      path,
      reference,
      payload,
      providerRef: `vsim_${this.counter++}_${reference}`,
      receivedAt: Date.now(),
    };
    this.operations.set(reference, op);
    this.statuses.set(reference, "completed");
    return op;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname.startsWith("/status/")) {
      const reference = decodeURIComponent(url.pathname.slice("/status/".length));
      const op = this.operations.get(reference);
      if (!op) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "unknown", message: "reference not found" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: this.statuses.get(reference) ?? "pending",
          provider_ref: op.providerRef,
          reference,
        })
      );
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Not found" }));
      return;
    }

    let raw = "";
    req.on("data", chunk => (raw += chunk));
    req.on("end", () => {
      let payload: Record<string, unknown> = {};
      try {
        payload = JSON.parse(raw);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: "Invalid JSON" }));
        return;
      }

      switch (this.mode) {
        case "reject":
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "error", message: "insufficient provider wallet" }));
          return;
        case "error500":
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "internal provider error" }));
          return;
        case "malformed":
          this.record(url.pathname, payload); // accepted, but reply is garbage
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ unexpected: true }));
          return;
        case "drop_response":
          this.record(url.pathname, payload); // accepted, response lost
          req.socket.on("close", () => res.destroy());
          return;
        case "normal":
        default: {
          const op = this.record(url.pathname, payload);
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "success",
              provider_ref: op.providerRef,
              message: "Operation accepted",
            })
          );
          return;
        }
      }
    });
  }
}
