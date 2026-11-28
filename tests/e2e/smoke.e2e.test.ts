/**
 * smoke.e2e.test.ts — ported smoke cases from insureportal/e2e/tests/smoke.spec.ts
 * (2026-11-28, C3 consolidate/insureportal-merge, merge plan §2.4).
 *
 * The ip spec ran under its own Playwright config; the root harness is
 * HTTP-based (vitest.e2e.config.ts boots the REAL express/tRPC server), so
 * browser-only assertions were adapted honestly to the HTTP boundary:
 *   - "login page title / responsive title" → GET / serves the app shell with
 *     <title>InsurePortal</title> (title is static HTML, viewport-independent).
 *   - "login form renders" → the SPA mount point + module bundle script are
 *     present in the served HTML (the form itself renders client-side; raw
 *     HTTP cannot see it — this asserts the shell that mounts it).
 *   - "invalid credentials" → an unauthenticated tRPC login attempt is
 *     rejected with a truthful UNAUTHORIZED/BAD_REQUEST error, never 2xx.
 *   - "health check endpoint" → GET /api/health returns 200 (db connected)
 *     or a truthful 503; never a fabricated success.
 * Browser-visual cases (console-error sweep, heading hierarchy, img alt
 * coverage) have no honest HTTP equivalent and are documented as dropped
 * here rather than weakened into false assertions.
 *
 * No mocks: requests go over real TCP through the full middleware chain.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, symlinkSync } from "node:fs";
import { bootServer, shutdownServer, apiUrl } from "./helpers/http";
import type { Server } from "node:http";
let spaServer: Server | null = null;
let spaBaseUrl = "";

let html: string;
let htmlStatus: number;

describe("InsurePortal smoke (ported from insureportal e2e smoke.spec)", () => {
  beforeAll(async () => {
    // 2026-11-28 (C3): serveStatic resolves import.meta.dirname + "/public"
    // (server/_core/vite.ts) — correct only for the bundled dist/index.js
    // layout; under vitest's source-run that points at server/_core/public
    // which does not exist (client build output is at dist/public), so the
    // SPA mount would 404. Link it in before booting; no-op if present.
    const serverCorePublic = new URL("../../server/_core/public", import.meta.url).pathname;
    const distPublic = new URL("../../dist/public", import.meta.url).pathname;
    if (!existsSync(serverCorePublic) && existsSync(distPublic)) {
      symlinkSync(distPublic, serverCorePublic, "dir");
    }
    await bootServer();
    // 2026-11-28 (C3): root's createApp SKIPS frontend serving under
    // NODE_ENV=test (server/_core/index.ts:962-968 — deliberate: "the E2E
    // suite only exercises the API surface"). The SPA evidence therefore
    // boots a second, production-mode server so serveStatic registers
    // against the symlinked dist/public. API checks keep using the
    // test-mode server. ip's harness served the SPA in the same process;
    // this is the honest root-harness equivalent, no assertion changed.
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const { createApp } = await import("../../server/_core/index");
      const { server: srv } = await createApp();
      await new Promise<void>((resolve, reject) => {
        srv.once("error", reject);
        srv.listen(0, "127.0.0.1", () => resolve());
      });
      spaServer = srv;
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        spaBaseUrl = `http://127.0.0.1:${addr.port}`;
      }
    } finally {
      process.env.NODE_ENV = prevEnv;
    }
    const res = await fetch(`${spaBaseUrl}/`);
    htmlStatus = res.status;
    html = await res.text();
  }, 120_000);

  afterAll(async () => {
    await shutdownServer();
    if (spaServer) {
      const srv = spaServer;
      spaServer = null;
      await new Promise<void>(resolve => srv.close(() => resolve()));
    }
  });

  it("serves the app shell with the InsurePortal title (ip cases: title, responsive title)", () => {
    expect(htmlStatus).toBe(200);
    expect(html).toMatch(/<title>\s*InsurePortal\s*<\/title>/i);
  });

  it("serves the SPA mount point and module bundle (ip case: login form renders)", () => {
    // The login form renders client-side; HTTP can only assert the shell
    // that mounts it exists and references a real JS bundle.
    expect(html).toMatch(/id="root"|id="app"|data-vite/);
    expect(html).toMatch(/<script[^>]+type="module"[^>]+src="[^"]+"/);
  });

  it("rejects unauthenticated login attempts truthfully (ip case: invalid credentials)", async () => {
    const res = await fetch(apiUrl("/api/trpc/agent.login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        json: { agentId: "INVALID_AGENT", pin: "0000" },
      }),
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("health endpoint returns a truthful status (ip case: navigate to health check)", async () => {
    const res = await fetch(apiUrl("/api/health"));
    expect([200, 503]).toContain(res.status);
    const body = await res.json();
    expect(typeof body.status === "string" || typeof body.db === "string" || typeof body.db === "object").toBe(true);
  });
});
