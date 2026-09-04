/**
 * miniTigerBeetle.ts — protocol-faithful in-process ledger for integration tests.
 *
 * LOCAL TEST FALLBACK ONLY. This is an in-process node:http server that
 * implements the HTTP contract server/tbClient.ts consumes from the
 * tb-sidecar (POST /accounts, POST /accounts/batch, POST /transfers,
 * GET /agent/{id}/balance, GET /sync/status, GET /health) with REAL
 * double-entry ledger semantics:
 *
 *   - Atomic debit/credit: a transfer debits the source account and credits
 *     the destination account in one in-memory commit; nothing moves on
 *     rejection.
 *   - Conservation: value is never created or destroyed by a transfer —
 *     every kobo credited is a kobo debited somewhere in the ledger.
 *   - Idempotency: transfers are durable by `ref` (and by explicit `id`).
 *     Replaying a ref returns the ORIGINAL stored result (same transfer id)
 *     and moves nothing. The same ref/id with a DIFFERENT payload is a 409
 *     conflict, never a silent re-execution.
 *   - Balance constraints: accounts carry TigerBeetle-compatible flags
 *     (bit 1 = debits_must_not_exceed_credits, bit 2 =
 *     credits_must_not_exceed_debits). A posting that would violate a
 *     constrained account is rejected 4xx and nothing moves. Unconstrained
 *     accounts (the TigerBeetle default, flags 0) may be debited beyond
 *     their credits — exactly like real TigerBeetle, where overdraft
 *     protection is opt-in per account.
 *
 * HONESTY BOUNDARIES — what this is NOT:
 *   - This is NOT TigerBeetle. It does not implement the VSR binary
 *     protocol, LSM-tree durability, quorum replication, or TB's u128 id
 *     space. State is in-process memory and dies with the test run.
 *   - Production uses the tb-sidecar → TigerBeetle HTTP gateway path
 *     (see tb-sidecar/main.go); this server exists so the fail-closed
 *     ledger legs in server/tbClient.ts have a REAL endpoint to commit
 *     against in the integration suite (mirrors the miniRedis precedent).
 *
 * DELIBERATE DIVERGENCE FROM STOCK TIGERBEETLE (documented, not hidden):
 *   Stock TB rejects a transfer that references a nonexistent account
 *   (account_not_found). The routers in this repo, however, post transfers
 *   against account ids that are NEVER explicitly provisioned through the
 *   tbClient surface — e.g. `customer-{id}` / `insurer-premium-pool`
 *   (server/routers/premiumTopUp.ts:79-88) and `sys-bank-reserve`
 *   (server/routers/floatManagement.ts:153-155,251-255) — so the endpoint
 *   they were written against must auto-provision on first reference.
 *   This server therefore auto-provisions missing transfer accounts with a
 *   zero opening balance and no constraint flags (the TigerBeetle default),
 *   so the fail-closed money paths exercise REAL double-entry movement.
 *   Start with { autoProvision: false } for stock-TB strictness
 *   (unknown account → 404, nothing moves).
 */
import { createServer, type Server } from "node:http";
import crypto from "node:crypto";

/** TigerBeetle-compatible account flag bits (subset the app can exercise). */
export const TB_ACCOUNT_FLAGS = {
  linked: 1 << 0,
  debitsMustNotExceedCredits: 1 << 1,
  creditsMustNotExceedDebits: 1 << 2,
} as const;

interface LedgerAccount {
  id: string;
  agentId?: string;
  ledger: number;
  code: number;
  flags: number;
  debitsPosted: number; // kobo
  creditsPosted: number; // kobo
  createdAt: string;
  autoProvisioned: boolean;
}

interface LedgerTransfer {
  id: string;
  debitAccountId: string;
  creditAccountId: string;
  amount: number; // kobo
  ledger: number;
  code: number;
  ref?: string;
  txType?: string;
  agentId?: string;
  timestamp: string;
}

export interface MiniTigerBeetleOptions {
  /**
   * When true (default), a transfer referencing an unknown account
   * auto-provisions it (flags 0, zero opening balance) — see the header
   * divergence note. When false, unknown accounts are rejected 404,
   * matching stock TigerBeetle.
   */
  autoProvision?: boolean;
}

export interface MiniTigerBeetle {
  port: number;
  url: string;
  close: () => Promise<void>;
}

interface JsonRequest {
  method: string;
  path: string;
  body: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Canonical fingerprint for idempotency-conflict comparison. */
function fingerprint(t: {
  debitAccountId: string;
  creditAccountId: string;
  amount: number;
  ledger: number;
  code: number;
  ref?: string;
}): string {
  return JSON.stringify([
    t.debitAccountId,
    t.creditAccountId,
    t.amount,
    t.ledger,
    t.code,
    t.ref ?? null,
  ]);
}

export async function startMiniTigerBeetle(
  port = 17071,
  opts: MiniTigerBeetleOptions = {}
): Promise<MiniTigerBeetle> {
  const autoProvision = opts.autoProvision ?? true;

  const accounts = new Map<string, LedgerAccount>();
  const transfersById = new Map<string, LedgerTransfer>();
  const transfersByRef = new Map<string, LedgerTransfer>();
  const transferFingerprints = new Map<string, string>(); // id|ref -> fingerprint
  let rejectedTransfers = 0;

  const json = (
    res: import("node:http").ServerResponse,
    status: number,
    body: unknown
  ) => {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(payload),
    });
    res.end(payload);
  };

  const errBody = (code: string, message: string) => ({ error: code, message });

  /** Create an account record. Returns { account, created }. */
  const createAccount = (input: {
    id: string;
    agentId?: string;
    ledger?: number;
    code?: number;
    flags?: number;
    autoProvisioned?: boolean;
  }): { account: LedgerAccount; created: boolean } => {
    const existing = accounts.get(input.id);
    if (existing) return { account: existing, created: false };
    const account: LedgerAccount = {
      id: input.id,
      agentId: input.agentId,
      ledger: input.ledger ?? 1,
      code: input.code ?? 1,
      flags: input.flags ?? 0,
      debitsPosted: 0,
      creditsPosted: 0,
      createdAt: new Date().toISOString(),
      autoProvisioned: input.autoProvisioned ?? false,
    };
    accounts.set(account.id, account);
    return { account, created: true };
  };

  const accountView = (a: LedgerAccount) => ({
    id: a.id,
    agentId: a.agentId ?? null,
    ledger: a.ledger,
    code: a.code,
    flags: a.flags,
    debits_posted: String(a.debitsPosted),
    credits_posted: String(a.creditsPosted),
    autoProvisioned: a.autoProvisioned,
  });

  const transferView = (t: LedgerTransfer, idempotentReplay: boolean) => ({
    id: t.id,
    status: "committed" as const,
    syncStatus: "synced" as const,
    amount: t.amount,
    debitAccountId: t.debitAccountId,
    creditAccountId: t.creditAccountId,
    ledger: t.ledger,
    code: t.code,
    ref: t.ref ?? null,
    txType: t.txType ?? null,
    timestamp: t.timestamp,
    idempotentReplay,
  });

  // ── Route handlers ──────────────────────────────────────────────────────

  const handleCreateAccount = (
    body: unknown,
    res: import("node:http").ServerResponse
  ) => {
    if (!isRecord(body)) {
      return json(res, 400, errBody("malformed_body", "expected a JSON object"));
    }
    const agentId = typeof body.agentId === "string" ? body.agentId : undefined;
    const id =
      typeof body.id === "string" && body.id.length > 0
        ? body.id
        : agentId
          ? `float-${agentId}`
          : undefined;
    if (!id) {
      return json(
        res,
        400,
        errBody("invalid_account", "account requires an `id` (or an `agentId` to derive `float-{agentId}` from)")
      );
    }
    const ledger = typeof body.ledger === "number" ? body.ledger : undefined;
    const code = typeof body.code === "number" ? body.code : undefined;
    const flags = typeof body.flags === "number" ? body.flags : undefined;
    const { account, created } = createAccount({ id, agentId, ledger, code, flags });
    // Idempotent: re-creating an existing account returns the existing
    // record with created:false (tbEnsureAgentAccount only checks res.ok).
    return json(res, 200, { ...accountView(account), created });
  };

  const handleCreateAccountsBatch = (
    body: unknown,
    res: import("node:http").ServerResponse
  ) => {
    if (!isRecord(body) || !Array.isArray(body.accounts)) {
      return json(res, 400, errBody("malformed_body", "expected { accounts: [...] }"));
    }
    const results: unknown[] = [];
    const errors: { index: number; code: string }[] = [];
    (body.accounts as unknown[]).forEach((raw, index) => {
      if (!isRecord(raw) || typeof raw.id !== "string" || raw.id.length === 0) {
        errors.push({ index, code: "invalid_account" });
        return;
      }
      const existing = accounts.get(raw.id);
      if (existing) {
        const requestedFlags = typeof raw.flags === "number" ? raw.flags : 0;
        if (requestedFlags !== existing.flags) {
          // Mirrors TB's exists_with_different_flags — the only batch
          // "error" tbSeedSystemAccounts expects to see (and ignores).
          errors.push({ index, code: "exists_with_different_flags" });
        } else {
          results.push({ ...accountView(existing), created: false });
        }
        return;
      }
      const { account } = createAccount({
        id: raw.id,
        agentId: typeof raw.agentId === "string" ? raw.agentId : undefined,
        ledger: typeof raw.ledger === "number" ? raw.ledger : undefined,
        code: typeof raw.code === "number" ? raw.code : undefined,
        flags: typeof raw.flags === "number" ? raw.flags : undefined,
      });
      results.push({ ...accountView(account), created: true });
    });
    return json(res, 200, { results, errors });
  };

  const handleCreateTransfer = (
    body: unknown,
    res: import("node:http").ServerResponse
  ) => {
    if (!isRecord(body)) {
      rejectedTransfers++;
      return json(res, 400, errBody("malformed_body", "expected a JSON object"));
    }
    const debitAccountId = body.debitAccountId;
    const creditAccountId = body.creditAccountId;
    const amount = body.amount;
    if (typeof debitAccountId !== "string" || debitAccountId.length === 0 ||
        typeof creditAccountId !== "string" || creditAccountId.length === 0) {
      rejectedTransfers++;
      return json(res, 400, errBody("invalid_transfer", "debitAccountId and creditAccountId are required strings"));
    }
    if (debitAccountId === creditAccountId) {
      rejectedTransfers++;
      return json(res, 400, errBody("invalid_transfer", "debit and credit accounts must differ"));
    }
    if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) {
      rejectedTransfers++;
      return json(res, 400, errBody("invalid_amount", "amount must be a positive integer (kobo)"));
    }
    const ref = typeof body.ref === "string" && body.ref.length > 0 ? body.ref : undefined;
    const requestedId =
      typeof body.id === "string" && body.id.length > 0 ? body.id : undefined;
    const ledger = typeof body.ledger === "number" ? body.ledger : 1;
    const code = typeof body.code === "number" ? body.code : 1;
    const fp = fingerprint({ debitAccountId, creditAccountId, amount, ledger, code, ref });

    // ── Idempotency (durable by ref and by explicit id) ──────────────────
    // A replay returns the ORIGINAL committed result and moves NOTHING.
    // The same ref/id with a DIFFERENT payload is a conflict, not a replay.
    const prior =
      (ref ? transfersByRef.get(ref) : undefined) ??
      (requestedId ? transfersById.get(requestedId) : undefined);
    if (prior) {
      const priorKey = prior.ref ?? prior.id;
      if (transferFingerprints.get(priorKey) === fp) {
        return json(res, 200, transferView(prior, true));
      }
      rejectedTransfers++;
      return json(
        res,
        409,
        errBody(
          "idempotency_conflict",
          `a transfer with ${prior.ref ? `ref '${prior.ref}'` : `id '${prior.id}'`} already exists with a different payload; refusing to re-execute`
        )
      );
    }

    // ── Account resolution ───────────────────────────────────────────────
    let debit = accounts.get(debitAccountId);
    let credit = accounts.get(creditAccountId);
    if (!debit || !credit) {
      if (!autoProvision) {
        rejectedTransfers++;
        const missing = !debit ? debitAccountId : creditAccountId;
        return json(
          res,
          404,
          errBody("account_not_found", `ledger account '${missing}' does not exist; transfer NOT committed`)
        );
      }
      // Documented divergence (see header): routers in this repo post
      // transfers against account ids that are never explicitly provisioned,
      // so the ledger endpoint they target must auto-provision on first
      // reference (zero opening balance, unconstrained — TB flag defaults).
      if (!debit) {
        debit = createAccount({
          id: debitAccountId,
          agentId: debitAccountId.startsWith("float-") ? debitAccountId.slice("float-".length) : undefined,
          ledger,
          code,
          autoProvisioned: true,
        }).account;
      }
      if (!credit) {
        credit = createAccount({
          id: creditAccountId,
          agentId: creditAccountId.startsWith("float-") ? creditAccountId.slice("float-".length) : undefined,
          ledger,
          code,
          autoProvisioned: true,
        }).account;
      }
    }

    // ── Balance constraints (TigerBeetle account flags, opt-in) ──────────
    if (
      debit.flags & TB_ACCOUNT_FLAGS.debitsMustNotExceedCredits &&
      debit.debitsPosted + amount > debit.creditsPosted
    ) {
      rejectedTransfers++;
      return json(
        res,
        409,
        errBody(
          "exceeds_credits",
          `debit of ${amount} kobo would take account '${debitAccountId}' (${debit.creditsPosted - debit.debitsPosted} kobo available) below zero; debits_must_not_exceed_credits is set; transfer NOT committed`
        )
      );
    }
    if (
      credit.flags & TB_ACCOUNT_FLAGS.creditsMustNotExceedDebits &&
      credit.creditsPosted + amount > credit.debitsPosted
    ) {
      rejectedTransfers++;
      return json(
        res,
        409,
        errBody(
          "exceeds_debits",
          `credit of ${amount} kobo would violate credits_must_not_exceed_debits on account '${creditAccountId}'; transfer NOT committed`
        )
      );
    }

    // ── Atomic double-entry commit ───────────────────────────────────────
    // Single in-memory commit: debit and credit move together or not at all.
    const transfer: LedgerTransfer = {
      id: requestedId ?? `tb-${crypto.randomBytes(16).toString("hex")}`,
      debitAccountId,
      creditAccountId,
      amount,
      ledger,
      code,
      ref,
      txType: typeof body.txType === "string" ? body.txType : undefined,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
      timestamp: new Date().toISOString(),
    };
    debit.debitsPosted += amount;
    credit.creditsPosted += amount;
    transfersById.set(transfer.id, transfer);
    transferFingerprints.set(transfer.id, fp);
    if (ref) {
      transfersByRef.set(ref, transfer);
      transferFingerprints.set(ref, fp);
    }
    return json(res, 200, transferView(transfer, false));
  };

  const handleAgentBalance = (
    agentId: string,
    res: import("node:http").ServerResponse
  ) => {
    const account = accounts.get(`float-${agentId}`);
    if (!account) {
      // Honest "no ledger account" — tbGetAgentBalance maps non-OK to null
      // and read-path callers fall back to PostgreSQL with source labeling.
      return json(res, 404, errBody("account_not_found", `no ledger account for agent '${agentId}'`));
    }
    const balanceKobo = account.creditsPosted - account.debitsPosted;
    return json(res, 200, {
      agentId,
      accountId: account.id,
      balanceKobo,
      balanceNGN: balanceKobo / 100,
      creditsPosted: account.creditsPosted,
      debitsPosted: account.debitsPosted,
      ledger: account.ledger,
      code: account.code,
    });
  };

  const handleSyncStatus = (res: import("node:http").ServerResponse) => {
    // Honest shape: this ledger applies transfers synchronously, so nothing
    // is ever pending and there is no replication lag. It has no PostgreSQL
    // syncer — postgres is reported "disconnected" rather than faked.
    return json(res, 200, {
      pending: 0,
      synced: transfersById.size,
      failed: rejectedTransfers,
      postgres: "disconnected",
      lagSeconds: 0,
    });
  };

  const handleHealth = (res: import("node:http").ServerResponse) =>
    json(res, 200, {
      status: "ok",
      service: "mini-tigerbeetle",
      upstream: "in-process-ledger (no TigerBeetle cluster; see header honesty note)",
    });

  const route = (
    req: JsonRequest,
    res: import("node:http").ServerResponse
  ): void => {
    const { method, path: p, body } = req;
    if (method === "POST" && p === "/accounts") return handleCreateAccount(body, res);
    if (method === "POST" && p === "/accounts/batch") return handleCreateAccountsBatch(body, res);
    if (method === "POST" && p === "/transfers") return handleCreateTransfer(body, res);
    const balanceMatch = p.match(/^\/agent\/([^/]+)\/balance$/);
    if (method === "GET" && balanceMatch) {
      return handleAgentBalance(decodeURIComponent(balanceMatch[1]!), res);
    }
    if (method === "GET" && p === "/sync/status") return handleSyncStatus(res);
    if (method === "GET" && p === "/health") return handleHealth(res);
    return json(res, 404, errBody("not_found", `unknown route: ${method} ${p}`));
  };

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", c => chunks.push(c as Buffer));
    req.on("end", () => {
      let body: unknown = undefined;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (raw.length > 0) {
        try {
          body = JSON.parse(raw);
        } catch {
          return json(res, 400, errBody("malformed_json", "request body is not valid JSON"));
        }
      }
      try {
        route({ method: req.method ?? "GET", path: (req.url ?? "/").split("?")[0]!, body }, res);
      } catch (err) {
        return json(res, 500, errBody("internal_error", String(err)));
      }
    });
    req.on("error", () => {
      /* client went away — ignore */
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : port;
  return {
    port: boundPort,
    url: `http://127.0.0.1:${boundPort}`,
    close: () =>
      new Promise<void>(resolve => {
        // Destroy lingering keep-alive sockets so close() returns promptly
        // (same pattern as miniRedis).
        server.closeAllConnections?.();
        server.close(() => resolve());
        server.unref();
      }),
  };
}
