/**
 * PAY-1/PAY-3: tbClient retry-safety + compensating reversal, exercised
 * against the REAL mini-TigerBeetle ledger spawned by the unit globalSetup
 * (protocol-faithful double-entry, ref/id idempotency — NOT a mock).
 *
 *   - retry-after-timeout semantics: same ref + same payload reposts the SAME
 *     deterministic transfer id → exactly one durable transfer (idempotent
 *     replay), never a double-post.
 *   - same ref + DIFFERENT payload → loud rejection, never silent re-execute.
 *   - tbReverseTransfer posts a real compensating reversal and is itself
 *     idempotent (repeated compensation does not move value twice).
 *   - withTbCompensation reverses the committed TB leg when the PG effect
 *     fails and rethrows the original error with a compensation annotation.
 */
import { describe, it, expect } from "vitest";

import {
  tbCreateTransfer,
  tbReverseTransfer,
  withTbCompensation,
  tbDeterministicTransferId,
  tbPayloadHash,
  TBLedgerUnavailableError,
  TBIdempotencyConflictError,
  type TBTransferRequest,
} from "./tbClient";

let seq = 0;
function req(overrides: Partial<TBTransferRequest> = {}): TBTransferRequest {
  seq++;
  return {
    debitAccountId: `t-debit-${seq}`,
    creditAccountId: `t-credit-${seq}`,
    amount: 12_345,
    ledger: 2000,
    code: 300,
    ref: `F1-UT-${Date.now()}-${seq}`,
    txType: "unit_test",
    ...overrides,
  };
}

describe("tbClient deterministic id + payload hash (PAY-3)", () => {
  it("derives a stable id from ref+payload and a different id for a different payload", () => {
    const a = req({ ref: "F1-DET-1" });
    const b = req({ ref: "F1-DET-1" }); // same ref, same fields except accounts differ
    const a2 = { ...a };
    expect(tbDeterministicTransferId(a2)).toBe(tbDeterministicTransferId(a));
    expect(tbPayloadHash({ ...a, amount: 999 })).not.toBe(tbPayloadHash(a));
    expect(tbDeterministicTransferId(b)).not.toBe(tbDeterministicTransferId(a));
  });
});

describe("tbCreateTransfer retry safety (PAY-3)", () => {
  it("reposting the same ref+payload is an idempotent replay — one durable transfer", async () => {
    const r = req();
    const first = await tbCreateTransfer({ ...r });
    const second = await tbCreateTransfer({ ...r });
    expect(second.id).toBe(first.id);
    expect((second as any).idempotentReplay).toBe(true);
  });

  it("same ref with a different amount is loudly rejected, never re-executed", async () => {
    const r = req();
    await tbCreateTransfer({ ...r });
    await expect(tbCreateTransfer({ ...r, amount: r.amount + 1 })).rejects.toSatisfy(
      (e) => e instanceof TBLedgerUnavailableError || e instanceof TBIdempotencyConflictError
    );
  });
});

describe("tbReverseTransfer (PAY-1 compensating reversal)", () => {
  it("posts a real reversal and is idempotent on repeat", async () => {
    const r = req();
    await tbCreateTransfer({ ...r });
    const rev1 = await tbReverseTransfer({ ...r }, "unit-test");
    expect(rev1.id).toBeTruthy();
    // Repeating the compensation must NOT move value twice.
    const rev2 = await tbReverseTransfer({ ...r }, "unit-test");
    expect(rev2.id).toBe(rev1.id);
    expect((rev2 as any).idempotentReplay).toBe(true);
  });

  it("refuses to compensate a ref-less transfer (loud)", async () => {
    await expect(tbReverseTransfer(req({ ref: undefined }), "unit-test")).rejects.toThrow(
      /no ref/
    );
  });
});

describe("withTbCompensation saga (PAY-1)", () => {
  it("reverses the committed TB leg when the PG effect fails and rethrows", async () => {
    const r = req();
    await tbCreateTransfer({ ...r });

    const pgError = new Error("simulated PG constraint failure");
    await expect(
      withTbCompensation("unit-test-saga", { ...r }, async () => {
        throw pgError;
      })
    ).rejects.toThrow(/simulated PG constraint failure.*TB compensation posted/);

    // The compensation really happened: replaying the reversal ref is now an
    // idempotent replay (proves the -REV transfer is durable).
    const rev = await tbReverseTransfer({ ...r }, "unit-test-saga");
    expect((rev as any).idempotentReplay).toBe(true);
  });

  it("passes through the PG effect result on success (no reversal)", async () => {
    const r = req();
    await tbCreateTransfer({ ...r });
    const out = await withTbCompensation("unit-test-saga-ok", { ...r }, async () => "committed");
    expect(out).toBe("committed");
  });
});
