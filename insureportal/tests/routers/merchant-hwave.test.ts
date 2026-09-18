/**
 * merchant-hwave.test.ts — H-wave (2026-09) REAL-code auth-gate tests for the
 * legacy insureportal merchant tree. Unlike the replica-style tests in this
 * directory, these build actual tRPC callers against the PRODUCTION routers
 * and middleware chain; only paths that fail before any DB access are
 * asserted (the harness has no PGlite in this tree).
 *
 * Proves:
 *   - the static X-Merchant-Code bearer path no longer authenticates
 *     (removal, not deprecation)
 *   - merchant procedures require a Keycloak principal bound via keycloakSub
 *   - agent bulkActivate/bulkSuspend/bulkDelete are admin-gated
 */
import { describe, it, expect } from "vitest";
import { merchantRouter } from "../../server/routers/merchant";
import { agentRouter } from "../../server/routers/agent";
import { merchantPayoutSettlementRouter } from "../../server/routers/merchantPayoutSettlement";
import type { TrpcContext } from "../../server/_core/context";

function ctxFor(user: TrpcContext["user"], headers: Record<string, string> = {}) {
  return {
    req: { headers, socket: { remoteAddress: "127.0.0.1" } },
    res: {},
    user,
  } as unknown as TrpcContext;
}

const noSubUser = {
  id: 910001,
  email: "nosub@hwave.test",
  name: "No Sub",
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

describe("H-wave: legacy merchant auth hardening (real routers)", () => {
  it("anonymous caller → UNAUTHORIZED", async () => {
    const caller = merchantRouter.createCaller(ctxFor(null));
    await expectTrpcCode(caller.getProfile(), "UNAUTHORIZED");
  });

  it("Keycloak principal WITHOUT keycloakSub claim → UNAUTHORIZED", async () => {
    const caller = merchantRouter.createCaller(ctxFor(noSubUser));
    await expectTrpcCode(caller.getProfile(), "UNAUTHORIZED");
  });

  it("the static X-Merchant-Code header no longer authenticates (removed)", async () => {
    const caller = merchantRouter.createCaller(
      ctxFor(noSubUser, { "x-merchant-code": "MC0123456789" })
    );
    // If the header path still existed this would reach the DB instead of
    // failing at the identity gate.
    await expectTrpcCode(caller.getProfile(), "UNAUTHORIZED");
    await expectTrpcCode(
      caller.updateProfile({ address: "1 H-Wave Close" }),
      "UNAUTHORIZED"
    );
  });

  it("initiatePayout no longer accepts caller-supplied bank details at the gate", async () => {
    const caller = merchantPayoutSettlementRouter.createCaller(ctxFor(null));
    await expectTrpcCode(
      caller.initiatePayout({
        merchantId: 1,
        amount: 5000,
        // legacy client-supplied destination — stripped by the schema; the
        // call must fail at AUTH, never reach a funds write.
        bankCode: "999",
        accountNumber: "0000000000",
        accountName: "Attacker",
      } as never),
      "UNAUTHORIZED"
    );
  });
});

describe("H-wave: agent bulk ops are admin-gated (real router)", () => {
  it("non-admin bulkActivate/bulkSuspend/bulkDelete → FORBIDDEN", async () => {
    const caller = agentRouter.createCaller(ctxFor(noSubUser));
    await expectTrpcCode(caller.bulkActivate({ ids: [1] }), "FORBIDDEN");
    await expectTrpcCode(
      caller.bulkSuspend({ ids: [1], reason: "h-wave test" }),
      "FORBIDDEN"
    );
    await expectTrpcCode(
      caller.bulkDelete({ ids: [1], reason: "h-wave test" }),
      "FORBIDDEN"
    );
  });

  it("anonymous bulk ops → UNAUTHORIZED", async () => {
    const caller = agentRouter.createCaller(ctxFor(null));
    await expectTrpcCode(caller.bulkActivate({ ids: [1] }), "UNAUTHORIZED");
  });
});
