/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROTOCOL-FAITHFUL LOCAL SIMULATOR — TEST CODE ONLY — NOT EVIDENCE OF
 * PROVIDER BEHAVIOR.
 *
 * termiiSimulator.ts — local HTTP server implementing the Termii Send
 * Message API wire protocol FAITHFULLY as documented and as encoded in the
 * production client (server/lib/smsService.ts):
 *
 *   POST /api/sms/send
 *     request:  JSON {to, from, sms, type, channel, api_key}
 *     success:  200 JSON {message_id, message, balance, user}
 *     failure:  4xx JSON {message}
 *
 * Simulator behaviors used to exercise unknown-outcome handling:
 *   mode "normal"        — well-formed 200 with message_id
 *   mode "drop_response" — accepts the request, records it, then HOLDS the
 *                          socket open past the client timeout (simulates
 *                          "provider accepted, response lost")
 *   mode "malformed"     — 200 with a body that lacks message_id
 *   mode "reject"        — 400 with an error message (definitive rejection)
 *
 * Framework rule: official sandboxes are preferred; this simulator exists
 * ONLY because no Termii sandbox is reachable from the test environment.
 * It is a documented gap (THREAT_MODEL.md §F-02) and is NOT evidence of
 * Termii-specific behavior.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

export type TermiiSimulatorMode = "normal" | "drop_response" | "malformed" | "reject";

export interface TermiiRequestRecord {
  to: string;
  from: string;
  sms: string;
  type: string;
  channel: string;
  api_key: string;
  receivedAt: number;
}

export class TermiiSimulator {
  private server: http.Server;
  private counter = 0;
  mode: TermiiSimulatorMode = "normal";
  /** Every request the simulator received (including dropped ones). */
  readonly requests: TermiiRequestRecord[] = [];
  /** How many send requests were ACCEPTED (reached the handler). */
  get acceptedCount(): number {
    return this.requests.length;
  }

  private constructor() {
    this.server = http.createServer((req, res) => this.handle(req, res));
  }

  static async start(): Promise<TermiiSimulator> {
    const sim = new TermiiSimulator();
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
    // Destroy lingering sockets held open by drop_response mode.
    (this.server as any).closeAllConnections?.();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method !== "POST" || req.url !== "/api/sms/send") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Not found" }));
      return;
    }
    let raw = "";
    req.on("data", chunk => (raw += chunk));
    req.on("end", () => {
      let body: any = {};
      try {
        body = JSON.parse(raw);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Invalid JSON" }));
        return;
      }
      this.requests.push({
        to: String(body.to ?? ""),
        from: String(body.from ?? ""),
        sms: String(body.sms ?? ""),
        type: String(body.type ?? ""),
        channel: String(body.channel ?? ""),
        api_key: String(body.api_key ?? ""),
        receivedAt: Date.now(),
      });

      switch (this.mode) {
        case "reject":
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Invalid sender id" }));
          return;
        case "malformed":
          // 2xx WITHOUT the documented message_id — a malformed reply.
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", note: "simulator malformed reply" }));
          return;
        case "drop_response":
          // Request accepted and recorded; response intentionally never sent
          // (socket destroyed only when the client aborts).
          req.socket.on("close", () => res.destroy());
          return;
        case "normal":
        default: {
          const id = `termii_sim_${Date.now()}_${this.counter++}`;
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              message_id: id,
              message: "Successfully Sent",
              balance: 9,
              user: "protocol-faithful-simulator",
            })
          );
          return;
        }
      }
    });
  }
}
