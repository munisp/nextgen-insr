/**
 * auth-f3.test.ts — Wave F3 audit fixes (auth.md)
 *
 * Real-behavior tests (PGlite wire-protocol DB, real Socket.IO server/client,
 * real jose JWTs). No mocks for the behavior under test.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import path from "node:path";

import { SignJWT } from "jose";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getJwtSecret } from "./lib/envValidation";

const PG_PORT = 54399;
const PG_URL = `postgresql://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`;
let pgliteChild: ChildProcess | null = null;

async function startPglite(): Promise<void> {
  const script = path.resolve(
    __dirname,
    "../tests/integration/setup/pgliteServer.mjs"
  );
  pgliteChild = spawn(process.execPath, [script], {
    env: { ...process.env, PGLITE_PORT: String(PG_PORT) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise<void>((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("PGlite start timeout")), 30_000);
    pgliteChild!.stdout!.on("data", d => {
      if (String(d).includes("PGLITE_READY")) {
        clearTimeout(to);
        resolve();
      }
    });
    pgliteChild!.on("exit", c => reject(new Error(`pglite exited ${c}`)));
  });
  process.env.POSTGRES_URL = PG_URL;
  // Unit suite has no Redis; socket tests exercise the explicit non-prod demo
  // leg (the AUTH-16 fail-closed default is asserted separately below).
  process.env.AUTH_REVOCATION_FAIL_OPEN_DEMO = "true";
}

async function createTables() {
  const { getDb } = await import("./db");
  const { sql } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) throw new Error("PGlite DB not reachable");
  await db.execute(sql`CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY)`);
  await db.execute(sql`INSERT INTO users (id) VALUES (1) ON CONFLICT DO NOTHING`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id serial PRIMARY KEY,
      "keyHash" varchar(128) NOT NULL UNIQUE,
      "keyPrefix" varchar(12) NOT NULL,
      name varchar(128) NOT NULL,
      description text,
      "userId" integer NOT NULL REFERENCES users(id),
      "tenantId" integer,
      status varchar(20) NOT NULL DEFAULT 'active',
      scopes json DEFAULT '[]',
      "rateLimit" integer NOT NULL DEFAULT 1000,
      "lastUsedAt" timestamp,
      "expiresAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "revokedAt" timestamp
    )`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id serial PRIMARY KEY,
      "sessionRef" varchar(32) NOT NULL UNIQUE,
      "agentId" integer NOT NULL,
      category varchar(64),
      subject varchar(256),
      status varchar(20) NOT NULL DEFAULT 'open',
      "supportAgentName" varchar(128),
      rating integer,
      "resolvedAt" timestamp,
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  // 2026-09-18 (G3): authenticateAgentSocket now re-checks the agent row
  // (isActive/deletedAt) from the DB at connection time — a suspended or
  // nonexistent agent's still-unexpired JWT must be denied. The socket-auth
  // fixtures below therefore seed REAL agent rows: 42 ACTIVE (what an
  // approved agent looks like post-G3) and 43 SUSPENDED (denial-path case).
  // Full column set mirroring drizzle/schema.ts `agents` (getAgentById does
  // db.select() — an explicit ALL-columns projection — so a partial table
  // errors and the socket auth would fail closed, denying even valid agents).
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS agents (
      id serial PRIMARY KEY,
      "agentId" varchar(32) NOT NULL UNIQUE,
      name varchar(128) NOT NULL,
      phone varchar(20) NOT NULL DEFAULT '',
      email varchar(320),
      location varchar(128),
      "terminalModel" varchar(64) DEFAULT 'PAX A920 MAX',
      "terminalSerial" varchar(64),
      tier varchar(32) NOT NULL DEFAULT 'Bronze',
      role varchar(32) NOT NULL DEFAULT 'agent',
      "pinHash" varchar(128) NOT NULL DEFAULT '',
      "failedPinAttempts" integer NOT NULL DEFAULT 0,
      "pinLockedUntil" timestamp,
      "premiumReserve" numeric(15,2) NOT NULL DEFAULT '0.00',
      "floatLimit" numeric(15,2) NOT NULL DEFAULT '1000000.00',
      "commissionBalance" numeric(15,2) NOT NULL DEFAULT '0.00',
      "loyaltyPoints" integer NOT NULL DEFAULT 0,
      streak integer NOT NULL DEFAULT 0,
      rank integer DEFAULT 0,
      "isActive" boolean NOT NULL DEFAULT false,
      "floatLocked" boolean NOT NULL DEFAULT false,
      "terminalEnabled" boolean NOT NULL DEFAULT true,
      "terminalDisabledReason" text,
      "lastLoginAt" timestamp,
      "deletedAt" timestamp,
      "tenantId" integer,
      "creditScore" integer DEFAULT 0,
      "creditLimit" numeric(15,2) DEFAULT '0.00',
      "creditRating" varchar(16) DEFAULT 'N/A',
      "parentAgentId" integer,
      "hierarchyRole" varchar(32) DEFAULT 'agent',
      "hierarchyLevel" integer DEFAULT 3,
      "commissionSplitOverride" numeric(5,2),
      "createdAt" timestamp NOT NULL DEFAULT now(),
      "updatedAt" timestamp NOT NULL DEFAULT now()
    )`);
  await db.execute(sql`
    INSERT INTO agents (id, "agentId", name, phone, "pinHash", "isActive")
    VALUES
      (42, 'AGT-42', 'F3 Socket Agent', '08011110001', 'x', true),
      (43, 'AGT-43', 'F3 Suspended Agent', '08011110002', 'x', false)
    ON CONFLICT (id) DO NOTHING`);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS impersonation_events (
      id serial PRIMARY KEY,
      "adminUserId" integer NOT NULL,
      "adminSub" varchar(128),
      "targetAgentId" integer NOT NULL,
      action varchar(128) NOT NULL,
      path varchar(256),
      "ipAddress" varchar(64),
      "userAgent" varchar(512),
      metadata json,
      "createdAt" timestamp NOT NULL DEFAULT now()
    )`);
}

beforeAll(async () => {
  await startPglite();
  await createTables();
}, 60_000);

afterAll(async () => {
  pgliteChild?.kill("SIGTERM");
});

async function signAgentSession(sub: number, name = "Agent"): Promise<string> {
  const secret = new TextEncoder().encode(getJwtSecret());
  return new SignJWT({ agentId: `AGT-${sub}`, name, tier: "gold", role: "agent" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(sub))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

describe("AUTH-1/2/3/4: Socket.IO namespace authz", () => {
  let http: HttpServer;
  let io: ReturnType<typeof import("./socket").initSocketIO>;
  let port: number;
  const clients: ClientSocket[] = [];

  beforeAll(async () => {
    const { initSocketIO } = await import("./socket");
    http = createServer();
    io = initSocketIO(http);
    await new Promise<void>(r => http.listen(0, "127.0.0.1", r));
    port = (http.address() as any).port;
  });

  afterAll(async () => {
    clients.forEach(c => c.close());
    io?.close();
    await new Promise(r => http.close(r));
  });

  function connect(ns: string, cookie?: string): Promise<ClientSocket> {
    return new Promise((resolve, reject) => {
      const c = ioClient(`http://127.0.0.1:${port}${ns}`, {
        path: "/api/socket.io",
        transports: ["websocket"],
        extraHeaders: cookie ? { cookie } : {},
        reconnection: false,
        timeout: 5000,
      });
      clients.push(c);
      c.on("connect", () => resolve(c));
      c.on("connect_error", e => reject(e));
    });
  }

  it("rejects unauthenticated /fraud, /terminal, /settlement, /chat connections", async () => {
    for (const ns of ["/fraud", "/terminal", "/settlement", "/chat"]) {
      await expect(connect(ns)).rejects.toThrow(/Authentication required/);
    }
  });

  it("accepts a valid agent_session JWT on /fraud", async () => {
    const jwt = await signAgentSession(42);
    const c = await connect("/fraud", `agent_session=${jwt}`);
    expect(c.connected).toBe(true);
  });

  // 2026-09-18 (G3): a SUSPENDED agent's still-unexpired JWT must be denied
  // at socket-connection time on every authenticated namespace (the isActive
  // DB re-check in authenticateAgentSocket).
  it("G3: rejects a suspended agent's valid JWT on all namespaces", async () => {
    const jwt = await signAgentSession(43);
    for (const ns of ["/fraud", "/terminal", "/settlement", "/chat"]) {
      await expect(
        connect(ns, `agent_session=${jwt}`)
      ).rejects.toThrow(/Authentication required/);
    }
  });

  it("AUTH-2: terminal:register binds the room to the TOKEN identity", async () => {
    const jwt = await signAgentSession(42);
    const c = await connect("/terminal", `agent_session=${jwt}`);
    c.emit("terminal:register", "999999");
    await new Promise(r => setTimeout(r, 300));
    const serverSocket = io.of("/terminal").sockets.get(c.id!)!;
    expect(serverSocket.rooms.has("agent:42")).toBe(true);
    expect(serverSocket.rooms.has("agent:999999")).toBe(false);
  });

  it("AUTH-4: chat:join allowed only for sessions the agent owns", async () => {
    const { getDb } = await import("./db");
    const { chatSessions } = await import("../drizzle/schema");
    const db = (await getDb())!;
    await db.insert(chatSessions).values({ sessionRef: "OWNED1", agentId: 42 } as any).onConflictDoNothing();
    await db.insert(chatSessions).values({ sessionRef: "STRANGER", agentId: 7 } as any).onConflictDoNothing();
    const jwt = await signAgentSession(42);
    const c = await connect("/chat", `agent_session=${jwt}`);
    c.emit("chat:join", "OWNED1");
    c.emit("chat:join", "STRANGER");
    c.emit("chat:join", "NO_SUCH_SESSION");
    await new Promise(r => setTimeout(r, 500));
    const serverSocket = io.of("/chat").sockets.get(c.id!)!;
    expect(serverSocket.rooms.has("session:OWNED1")).toBe(true);
    expect(serverSocket.rooms.has("session:STRANGER")).toBe(false);
    expect(serverSocket.rooms.has("session:NO_SUCH_SESSION")).toBe(false);
  });
});

describe("AUTH-8/9: apiKeyManagement real lifecycle", () => {
  const adminCtx = {
    user: { id: 1, role: "admin", tenantId: null },
    req: { headers: {}, protocol: "https" },
    res: {},
  } as any;

  it("createKey → revokeKey → rotateKey hit the real DB; getStats requires auth", async () => {
    const { apiKeyManagementRouter } = await import("./routers/apiKeyManagement");
    const { getDb } = await import("./db");
    const { apiKeys } = await import("../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = (await getDb())!;
    const caller = apiKeyManagementRouter.createCaller(adminCtx);

    const anonCaller = apiKeyManagementRouter.createCaller({
      user: null,
      req: { headers: {} },
      res: {},
    } as any);
    await expect(anonCaller.getStats({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const created = await caller.createKey({ name: "ci-key", scopes: ["read"] });
    expect(created.success).toBe(true);
    expect(created.rawKey).toMatch(/^54lk_/);
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.id));
    expect(row.status).toBe("active");
    expect(row.userId).toBe(1);
    expect(row.keyHash).not.toBe(created.rawKey);

    const revoked = await caller.revokeKey({ id: created.id });
    expect(revoked.status).toBe("revoked");
    const [row2] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.id));
    expect(row2.status).toBe("revoked");
    expect(row2.revokedAt).not.toBeNull();

    await expect(caller.rotateKey({ id: created.id })).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const created2 = await caller.createKey({ name: "ci-key-2" });
    const [before] = await db.select().from(apiKeys).where(eq(apiKeys.id, created2.id));
    const rotated = await caller.rotateKey({ id: created2.id });
    expect(rotated.rawKey).toMatch(/^54lk_/);
    const [after] = await db.select().from(apiKeys).where(eq(apiKeys.id, created2.id));
    expect(after.keyHash).not.toBe(before.keyHash);
    const crypto = await import("node:crypto");
    const oldHash = crypto.createHash("sha256").update(created2.rawKey!).digest("hex");
    const newHash = crypto.createHash("sha256").update(rotated.rawKey!).digest("hex");
    expect(after.keyHash).toBe(newHash);
    expect(after.keyHash).not.toBe(oldHash);
  });
});

describe("AUTH-12: journey tenant guard fail-closed", () => {
  it("denies read/ops journeys when Permify is unreachable (J05, J16)", async () => {
    const { assertTenantAccess } = await import("./journey-tenant-guard");
    const ctx = { tenantId: "t-test", userId: "u1", userRole: "agent" };
    await expect(assertTenantAccess("J05_AgentDailyOpsWorkflow", ctx)).rejects.toMatchObject({ type: "AUTHORIZATION_DENIED" });
    await expect(assertTenantAccess("J16_CustomerSelfServiceWorkflow", ctx)).rejects.toMatchObject({ type: "AUTHORIZATION_DENIED" });
  });

  it("denies unknown journeys (no silent allow)", async () => {
    const { assertTenantAccess } = await import("./journey-tenant-guard");
    await expect(
      assertTenantAccess("J99_NotARealWorkflow", { tenantId: "t", userId: "u", userRole: "agent" })
    ).rejects.toMatchObject({ type: "AUTHORIZATION_DENIED" });
  });

  it("every journey mapping is fail-closed", async () => {
    const { JOURNEY_PERMISSIONS } = await import("./journey-tenant-guard");
    for (const [name, perm] of Object.entries(JOURNEY_PERMISSIONS)) {
      expect(perm.failClosed, name).toBe(true);
    }
  });
});

describe("AUTH-16: revocation checks fail closed by default", () => {
  it("revocationFailClosed is true unless the explicit non-prod demo flag", async () => {
    const { revocationFailClosed } = await import("./middleware/agentAuth");
    const prev = process.env.AUTH_REVOCATION_FAIL_OPEN_DEMO;
    delete process.env.AUTH_REVOCATION_FAIL_OPEN_DEMO;
    expect(revocationFailClosed()).toBe(true);
    process.env.AUTH_REVOCATION_FAIL_OPEN_DEMO = "true";
    expect(revocationFailClosed()).toBe(false);
    if (prev === undefined) delete process.env.AUTH_REVOCATION_FAIL_OPEN_DEMO;
    else process.env.AUTH_REVOCATION_FAIL_OPEN_DEMO = prev;
  });
});

describe("AUTH-17: financialProcedure coverage", () => {
  it("all wired financial mutations have operation mappings", async () => {
    const { ROUTER_OPERATION_MAP } = await import("./_core/permifyMiddleware");
    const required = [
      "transactions.create","transactions.reverse","transactions.approveReversal","transactions.rejectReversal",
      "insuranceWorkflows.payPremium","insuranceWorkflows.settleClaimPayment","insuranceWorkflows.adjudicateClaim",
      "airtimeVending.vend","crossBorderRemittanceHub.initiateTransfer",
      "transactionReversalWorkflow.create","transactionReversalWorkflow.review","transactionReversalWorkflow.execute",
      "premiumTopUp.topUp","disputeRefund.initiateRefund","merchantPayments.pay","splitPayments.createSplit",
      "agentLoanFacility.applyLoan","billingLedger.recordSplit",
    ];
    for (const p of required) {
      expect(ROUTER_OPERATION_MAP[p], p).toBeDefined();
      expect(ROUTER_OPERATION_MAP[p], p).not.toBe("read");
    }
  });

  it("denies a financial mutation for a role without the operation", async () => {
    const { transactionsRouter } = await import("./routers/transactions");
    const caller = transactionsRouter.createCaller({
      user: { id: 1, role: "user", tenantId: null },
      req: { headers: {} },
      res: {},
    } as any);
    await expect(
      caller.reverse({ transactionId: 1, reason: "audit-test reversal" } as any)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("AUTH-18: PBAC fail-closed + cache invalidation", () => {
  it("denies when the policy engine is disabled/unreachable (no local fallback)", async () => {
    const { authorize } = await import("./middleware/pbacEnforcement");
    const decision = await authorize({ userId: 1, role: "admin", timestamp: Date.now() }, "read");
    expect(decision.allowed).toBe(false);
    expect(decision.policy).toBe("fail_closed");
  });

  it("short-TTL cache honors invalidatePermissionsForUser for revocation", async () => {
    process.env.PBAC_LOCAL_RBAC_FALLBACK_DEMO = "true";
    try {
      const { authorize, invalidatePermissionsForUser } = await import("./middleware/pbacEnforcement");
      const ctx = { userId: 555, role: "admin" as const, timestamp: Date.now() };
      const first = await authorize(ctx, "export_data", "demo-res");
      expect(first.allowed).toBe(true);
      const second = await authorize(ctx, "export_data", "demo-res");
      expect(second.cached).toBe(true);
      const removed = invalidatePermissionsForUser(555);
      expect(removed).toBeGreaterThan(0);
      const third = await authorize(ctx, "export_data", "demo-res");
      expect(third.cached).toBe(false);
    } finally {
      delete process.env.PBAC_LOCAL_RBAC_FALLBACK_DEMO;
    }
  });
});

describe("AUTH-19: admin impersonation audit trail", () => {
  it("resolveAgentScope admin leg writes an impersonation_events row", async () => {
    const { resolveAgentScope } = await import("./middleware/agentAuth");
    const { getDb } = await import("./db");
    const { impersonationEvents } = await import("../drizzle/schema");
    const db = (await getDb())!;
    const req = {
      headers: { cookie: "", "user-agent": "vitest" },
      url: "/api/test",
      socket: { remoteAddress: "127.0.0.1" },
    } as any;
    const scope = await resolveAgentScope(req, "admin", 4242);
    expect(scope).toEqual({ ok: true, agentId: 4242 });
    await new Promise(r => setTimeout(r, 500));
    const rows = await db.select().from(impersonationEvents);
    const hit = rows.find(r => r.targetAgentId === 4242);
    expect(hit, "impersonation event persisted").toBeDefined();
    expect(hit!.action).toBe("admin_agent_scope");
  });
});
