/**
 * actuaryAdmin.authz.test.ts — W34-D (2026-11-28) fail-closed authz tests
 * for the actuaryAdmin router (server/routers/actuaryAdmin.ts), following
 * the server/_core/permifyBootGuardW23.test.ts pattern.
 *
 * Contract under test (design §7.4 + Appendix E):
 *   1. Permify-DOWN denies actuaryAdmin.* UNCONDITIONALLY — including for a
 *      platform `admin` DB role (actuaryAdminProcedure has NO admin
 *      short-circuit: platform admin ≠ actuary_admin, per the Keycloak role
 *      hierarchy; see routers/actuaryRoleGuard.ts header).
 *   2. Permify-UP with the actuary_admin permission granted → the caller
 *      passes the gate (and then fails closed at the honest DB-outage gate,
 *      PRECONDITION_FAILED — proving the mutation was not silently denied).
 *   3. Permify-UP with the permission explicitly DENIED → FORBIDDEN.
 *   4. Anonymous caller → UNAUTHORIZED.
 *
 * Both Permify states are exercised through REAL HTTP: a fake Permify
 * server at an ephemeral port for the UP cases, and port 9 (immediately
 * refused, the W23 discard-port posture) for the DOWN case. Modules are
 * re-imported under vi.resetModules + vi.stubEnv so the module-scoped
 * PERMIFY_URL binds the address under test.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { TrpcContext } from "../../server/_core/context";

// ── Fake Permify keyed by subject (HTTP-boundary double) ────────────────────
let permifyServer: http.Server;
let permifyUrl: string;
const GRANTED_ACTUARY_ADMIN = new Set<string>();

async function startServer(
  handler: http.RequestListener
): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${addr.port}` };
}

beforeAll(async () => {
  const pm = await startServer((req, res) => {
    let body = "";
    req.on("data", c => (body += String(c)));
    req.on("end", () => {
      let can: "CHECK_RESULT_ALLOWED" | "CHECK_RESULT_DENIED" =
        "CHECK_RESULT_ALLOWED";
      try {
        const parsed = JSON.parse(body) as {
          subject?: { id?: string };
          entity?: { type?: string };
        };
        // Base access (system:insureportal access) is always granted so the
        // test isolates the actuary manage_* gate.
        if (
          parsed.entity?.type === "actuary" &&
          parsed.subject?.id &&
          !GRANTED_ACTUARY_ADMIN.has(parsed.subject.id)
        ) {
          can = "CHECK_RESULT_DENIED";
        }
      } catch {
        can = "CHECK_RESULT_DENIED";
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ can }));
    });
  });
  permifyServer = pm.server;
  permifyUrl = pm.url;
});

afterAll(async () => {
  await new Promise<void>(r => permifyServer.close(() => r()));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function ctxFor(user: TrpcContext["user"]) {
  return {
    req: { headers: {}, socket: { remoteAddress: "127.0.0.1" } },
    res: {},
    user,
  } as unknown as TrpcContext;
}

const adminUser = {
  id: 880101,
  email: "admin@w34d.test",
  name: "Platform Admin",
  role: "admin", // platform admin — NOT actuary_admin (no short-circuit)
} as unknown as TrpcContext["user"];

const actuaryAdminUser = {
  id: 880102,
  email: "actuary.admin@w34d.test",
  name: "Actuary Admin",
  role: "user",
} as unknown as TrpcContext["user"];

async function expectTrpcCode(p: Promise<unknown>, code: string) {
  try {
    await p;
    throw new Error(`expected TRPCError ${code}, but call succeeded`);
  } catch (err) {
    expect(
      (err as { code?: string }).code,
      `expected ${code}, got: ${(err as Error).message}`
    ).toBe(code);
  }
}

const UPSERT_INPUT = {
  productLine: "motor",
  version: "2026.09",
  action: "create" as const,
};

const APPROVE_INPUT = { kind: "reserve" as const, id: 1 };

async function freshAdminRouter(permifyAddress: string) {
  vi.stubEnv("PERMIFY_URL", permifyAddress);
  vi.resetModules();
  return import("../../server/routers/actuaryAdmin");
}

describe("W34-D: Permify-DOWN denies actuaryAdmin.* unconditionally (fail-closed)", () => {
  // Port 9 (discard) is refused immediately — the W23 outage posture.
  const DOWN = "http://127.0.0.1:9";

  it("platform admin DB role is ALSO denied on upsertRateVersion (no admin short-circuit)", async () => {
    const { actuaryAdminRouter } = await freshAdminRouter(DOWN);
    const caller = actuaryAdminRouter.createCaller(ctxFor(adminUser));
    await expectTrpcCode(caller.upsertRateVersion(UPSERT_INPUT), "FORBIDDEN");
  });

  it("actuary_admin candidate is denied on approveRun when Permify is down", async () => {
    const { actuaryAdminRouter } = await freshAdminRouter(DOWN);
    const caller = actuaryAdminRouter.createCaller(ctxFor(actuaryAdminUser));
    await expectTrpcCode(caller.approveRun(APPROVE_INPUT), "FORBIDDEN");
  });

  it("manageReferralRules denied when Permify is down", async () => {
    const { actuaryAdminRouter } = await freshAdminRouter(DOWN);
    const caller = actuaryAdminRouter.createCaller(ctxFor(actuaryAdminUser));
    await expectTrpcCode(
      caller.manageReferralRules({
        action: "disable",
        rule: {
          id: 1,
          productLine: "motor",
          predicate: {},
          action: "refer",
          reasonCode: "SI_THRESHOLD",
          priority: 100,
          isActive: false,
        },
      }),
      "FORBIDDEN"
    );
  });
});

describe("W34-D: Permify-UP actuary_admin gate decisions", () => {
  it("granted subject passes the gate (reaches honest DB-outage PRECONDITION_FAILED, not FORBIDDEN)", async () => {
    GRANTED_ACTUARY_ADMIN.add(String(actuaryAdminUser.id));
    const { actuaryAdminRouter } = await freshAdminRouter(permifyUrl);
    const caller = actuaryAdminRouter.createCaller(ctxFor(actuaryAdminUser));
    await expectTrpcCode(
      caller.upsertRateVersion(UPSERT_INPUT),
      "PRECONDITION_FAILED"
    );
  });

  it("denied subject → FORBIDDEN", async () => {
    GRANTED_ACTUARY_ADMIN.delete(String(adminUser.id));
    const { actuaryAdminRouter } = await freshAdminRouter(permifyUrl);
    const caller = actuaryAdminRouter.createCaller(ctxFor(adminUser));
    await expectTrpcCode(caller.upsertRateVersion(UPSERT_INPUT), "FORBIDDEN");
  });

  it("anonymous caller → UNAUTHORIZED", async () => {
    const { actuaryAdminRouter } = await freshAdminRouter(permifyUrl);
    const caller = actuaryAdminRouter.createCaller(ctxFor(null));
    await expectTrpcCode(caller.upsertRateVersion(UPSERT_INPUT), "UNAUTHORIZED");
  });

  it("approveRun also gated (granted → PRECONDITION_FAILED at the DB gate)", async () => {
    GRANTED_ACTUARY_ADMIN.add(String(actuaryAdminUser.id));
    const { actuaryAdminRouter } = await freshAdminRouter(permifyUrl);
    const caller = actuaryAdminRouter.createCaller(ctxFor(actuaryAdminUser));
    await expectTrpcCode(caller.approveRun(APPROVE_INPUT), "PRECONDITION_FAILED");
  });
});
