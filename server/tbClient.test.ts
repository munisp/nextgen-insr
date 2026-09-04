/**
 * tbClient.test.ts — Vitest coverage for the TigerBeetle sidecar HTTP client.
 *
 * Tests:
 *  1. tbIsHealthy returns true when sidecar responds 200 OK
 *  2. tbIsHealthy returns false when sidecar is unreachable
 *  3. tbIsHealthy returns false when sidecar returns non-OK status
 *  4. tbIsHealthy returns false on timeout (abort signal)
 *  5. submitTransfer returns a TBTransferResponse on success
 *  6. submitTransfer THROWS TBLedgerUnavailableError when sidecar is unreachable (fail-closed)
 *  7. submitTransfer THROWS TBLedgerUnavailableError on non-OK HTTP response (fail-closed)
 *  7b. submitTransfer THROWS TBLedgerUnavailableError on timeout/abort (fail-closed)
 *  8. ensureAgentAccount returns true when account is created
 *  9. ensureAgentAccount THROWS TBLedgerUnavailableError when sidecar is unreachable (fail-closed)
 *  9b. ensureAgentAccount returns false on non-OK HTTP response (honest ledger answer)
 * 10. getAgentBalance returns balance object on success
 * 11. getAgentBalance returns null when sidecar is unreachable (read path may fall back, labeled)
 * 12. getSyncStatus returns sync stats on success
 * 13. getSyncStatus returns null when sidecar is unreachable
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  tbIsHealthy,
  tbCreateTransfer as submitTransfer,
  tbEnsureAgentAccount as ensureAgentAccount,
  tbGetAgentBalance as getAgentBalance,
  tbGetSyncStatus as getSyncStatus,
  TBLedgerUnavailableError,
} from "./tbClient";

// ── Helper: mock a successful fetch ──────────────────────────────────────────
function mockFetchOk(body: unknown) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);
}

function mockFetchError(err: Error) {
  return vi.spyOn(globalThis, "fetch").mockRejectedValue(err);
}

function mockFetchNotOk(status = 500) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: false,
    status,
    json: async () => ({ error: "server error" }),
    text: async () => "server error",
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── 1-4. tbIsHealthy ─────────────────────────────────────────────────────────
describe("tbIsHealthy", () => {
  it("returns true when sidecar responds 200 OK", async () => {
    mockFetchOk({ status: "ok", service: "tb-sidecar" });
    expect(await tbIsHealthy()).toBe(true);
  });

  it("returns false when sidecar is unreachable (fetch throws)", async () => {
    mockFetchError(new Error("ECONNREFUSED"));
    expect(await tbIsHealthy()).toBe(false);
  });

  it("returns false when sidecar returns non-OK status", async () => {
    mockFetchNotOk(503);
    expect(await tbIsHealthy()).toBe(false);
  });

  it("returns false on abort (timeout simulation)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), {
        name: "AbortError",
      })
    );
    expect(await tbIsHealthy()).toBe(false);
  });
});

// ── 5-7. submitTransfer ───────────────────────────────────────────────────────
describe("submitTransfer", () => {
  const transferReq = {
    debitAccountId: "float-AGT001",
    creditAccountId: "cash-AGT001",
    amount: 500000, // ₦5,000 in kobo
    ref: "TXN-001",
    txType: "cash_out",
    agentId: "AGT001",
  };

  it("returns a TBTransferResponse on success", async () => {
    mockFetchOk({
      id: "transfer-uuid-123",
      status: "committed",
      syncStatus: "pending",
      amount: 500000,
    });
    const result = await submitTransfer(transferReq);
    expect(result).not.toBeNull();
    expect(result?.status).toBe("committed");
    expect(result?.syncStatus).toBe("pending");
    expect(result?.amount).toBe(500000);
  });

  it("throws TBLedgerUnavailableError when sidecar is unreachable (fail-closed)", async () => {
    mockFetchError(new Error("ECONNREFUSED"));
    await expect(submitTransfer(transferReq)).rejects.toBeInstanceOf(TBLedgerUnavailableError);
    await expect(submitTransfer(transferReq)).rejects.toThrow(/NOT committed/);
  });

  it("throws TBLedgerUnavailableError on non-OK HTTP response (fail-closed)", async () => {
    mockFetchNotOk(422);
    await expect(submitTransfer(transferReq)).rejects.toBeInstanceOf(TBLedgerUnavailableError);
    await expect(submitTransfer(transferReq)).rejects.toThrow(/HTTP 422/);
  });

  it("throws TBLedgerUnavailableError on timeout/abort (fail-closed)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      Object.assign(new Error("The operation was aborted"), { name: "AbortError" })
    );
    await expect(submitTransfer(transferReq)).rejects.toBeInstanceOf(TBLedgerUnavailableError);
    await expect(submitTransfer(transferReq)).rejects.toThrow(/timed out/);
  });
});

// ── 8-9. ensureAgentAccount ───────────────────────────────────────────────────
describe("ensureAgentAccount", () => {
  it("returns true when account creation succeeds", async () => {
    mockFetchOk({ id: "float-AGT001", status: "created" });
    const result = await ensureAgentAccount("AGT001");
    expect(result).toBe(true);
  });

  it("throws TBLedgerUnavailableError when sidecar is unreachable (fail-closed)", async () => {
    mockFetchError(new Error("ECONNREFUSED"));
    await expect(ensureAgentAccount("AGT001")).rejects.toBeInstanceOf(TBLedgerUnavailableError);
  });

  it("returns false on non-OK HTTP response", async () => {
    mockFetchNotOk(500);
    const result = await ensureAgentAccount("AGT001");
    expect(result).toBe(false);
  });
});

// ── 10-11. getAgentBalance ────────────────────────────────────────────────────
describe("getAgentBalance", () => {
  it("returns balance object on success", async () => {
    mockFetchOk({
      agentId: "AGT001",
      balanceKobo: 1500000,
      balanceNGN: 15000.0,
    });
    const result = await getAgentBalance("AGT001");
    expect(result).not.toBeNull();
    expect(result?.balanceNGN).toBe(15000.0);
    expect(result?.balanceKobo).toBe(1500000);
  });

  it("returns null when sidecar is unreachable", async () => {
    mockFetchError(new Error("ECONNREFUSED"));
    const result = await getAgentBalance("AGT001");
    expect(result).toBeNull();
  });

  it("returns null on non-OK HTTP response", async () => {
    mockFetchNotOk(404);
    const result = await getAgentBalance("AGT001");
    expect(result).toBeNull();
  });
});

// ── 12-13. getSyncStatus ──────────────────────────────────────────────────────
describe("getSyncStatus", () => {
  it("returns sync stats on success", async () => {
    mockFetchOk({
      pending: 3,
      synced: 142,
      failed: 0,
      postgres: "connected",
    });
    const result = await getSyncStatus();
    expect(result).not.toBeNull();
    expect(result?.pending).toBe(3);
    expect(result?.synced).toBe(142);
    expect(result?.postgres).toBe("connected");
  });

  it("returns null when sidecar is unreachable", async () => {
    mockFetchError(new Error("ECONNREFUSED"));
    const result = await getSyncStatus();
    expect(result).toBeNull();
  });
});
